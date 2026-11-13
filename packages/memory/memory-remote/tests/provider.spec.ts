import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MemoryError } from '@deepseek-ai/dsh-memory'
import * as provider from '../src/index.ts'

/** One recorded request: route, body, and the identity headers the provider sent. */
interface Recorded {
  readonly route: string
  readonly body: Record<string, unknown>
  readonly token: string | undefined
  readonly workspace: string | undefined
  readonly otherId: string | undefined
}

/** A memory-service stand-in with per-route scripted answers. */
async function startService(): Promise<{
  baseUrl: string
  requests: Recorded[]
  routes: Map<string, (body: Record<string, unknown>) => { status?: number; body: unknown }>
  close: () => Promise<void>
}> {
  const requests: Recorded[] = []
  const routes = new Map<string, (body: Record<string, unknown>) => { status?: number; body: unknown }>()
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const body = raw === '' ? {} : JSON.parse(raw) as Record<string, unknown>
      const route = (request.url ?? '').split('/').filter(Boolean).pop() ?? ''
      const auth = request.headers.authorization
      requests.push({
        route,
        body,
        token: typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : undefined,
        workspace: request.headers['x-workspace-id'] as string | undefined,
        otherId: request.headers['x-end-user-other-id'] as string | undefined,
      })
      const handler = routes.get(route)
      if (handler === undefined) {
        response.writeHead(404).end()
        return
      }
      const answer = handler(body)
      response.writeHead(answer.status ?? 200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(answer.body))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    requests,
    routes,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error === undefined) resolve(); else reject(error) })
    }),
  }
}

let closeService: (() => Promise<void>) | undefined

afterEach(async () => {
  await closeService?.()
  closeService = undefined
})

async function mount(serviceUrl: string, over: { timeoutMs?: number } = {}) {
  const ctx = new Context()
  await ctx.plugin(provider, {
    serviceUrl,
    token: 'service-token',
    workspaceId: 'team-a',
    endUserOtherId: 'alice',
    timeoutMs: over.timeoutMs ?? 500,
  })
  return ctx
}

describe('dsh-memory-remote', () => {
  it('sends identity headers and maps a recall payload', async () => {
    const service = await startService()
    closeService = service.close
    service.routes.set('recall', body => ({
      body: {
        items: [{ id: 'm1', content: 'prefers pnpm', kind: 'preference', score: 0.87, query: body.question, source: 'turn' }],
        trace: [{ stage: 'results_merged', count: 1 }],
        degraded: false,
        latencyMs: 7,
      },
    }))
    const ctx = await mount(service.baseUrl)

    const result = await ctx.memory.recall({ question: 'package manager', mode: 'quick', turn: 1 })

    expect(result.degraded).toBe(false)
    expect(result.items).toEqual([
      { id: 'm1', content: 'prefers pnpm', kind: 'preference', score: 0.87, query: 'package manager', source: 'turn' },
    ])
    expect(result.trace).toEqual([{ stage: 'results_merged', count: 1 }])
    const sent = service.requests[0]!
    expect(sent).toMatchObject({ route: 'recall', token: 'service-token', workspace: 'team-a', otherId: 'alice' })
  })

  it('degrades instead of throwing when the service is down', async () => {
    const ctx = await mount('http://127.0.0.1:9', { timeoutMs: 250 })
    const result = await ctx.memory.recall({ question: 'anything', mode: 'quick', turn: 1 })
    expect(result.degraded).toBe(true)
    expect(result.items).toEqual([])
  })

  it('rejects an empty question as a caller error', async () => {
    const service = await startService()
    closeService = service.close
    const ctx = await mount(service.baseUrl)
    await expect(ctx.memory.recall({ question: '  ', mode: 'quick', turn: 1 })).rejects.toBeInstanceOf(MemoryError)
  })

  it('reports write acceptance', async () => {
    const service = await startService()
    closeService = service.close
    service.routes.set('remember', () => ({ body: { queued: true, batchId: 'b-1' } }))
    const ctx = await mount(service.baseUrl)

    const result = await ctx.memory.remember({
      sessionId: 'session-1',
      turn: 2,
      messages: [{ role: 'user', content: 'uses pnpm', at: '2026-11-13T00:00:00Z' }],
      kinds: ['preference'],
    })

    expect(result).toEqual({ queued: true, batchId: 'b-1' })
    expect(service.requests[0]?.body).toMatchObject({
      sessionId: 'session-1',
      messages: [{ role: 'user', content: 'uses pnpm' }],
      kinds: ['preference'],
    })
  })

  it('removes by id and reports the count', async () => {
    const service = await startService()
    closeService = service.close
    service.routes.set('forget', () => ({ body: { removed: 2 } }))
    const ctx = await mount(service.baseUrl)
    await expect(ctx.memory.forget({ target: 'm1' })).resolves.toEqual({ removed: 2 })
  })

  it('surfaces a service rejection as a typed failure', async () => {
    const service = await startService()
    closeService = service.close
    service.routes.set('remember', () => ({ status: 400, body: { error: 'bad' } }))
    const ctx = await mount(service.baseUrl)
    await expect(ctx.memory.remember({
      sessionId: 's',
      turn: 1,
      messages: [{ role: 'user', content: 'x' }],
    })).rejects.toMatchObject({ code: 'MEMORY_UPSTREAM_REJECTED' })
  })

  it('health reflects reachability', async () => {
    const service = await startService()
    closeService = service.close
    service.routes.set('health', () => ({ body: { reachable: true, endUserId: 'eu-1' } }))
    const ctx = await mount(service.baseUrl)
    expect(await ctx.memory.health()).toEqual({ reachable: true, endUserId: 'eu-1' })
  })
})
