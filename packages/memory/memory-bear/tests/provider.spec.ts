import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MemoryError } from '@deepseek-ai/dsh-memory'
import * as provider from '../src/index.ts'

/** One recorded request: path, parsed body, and the headers the provider sent. */
interface Recorded {
  readonly path: string
  readonly body: Record<string, unknown>
  readonly authorization: string | undefined
}

/** A MemoryBear stand-in: routes are scripted per test through `routes`. */
async function startStub(): Promise<{
  baseUrl: string
  requests: Recorded[]
  routes: Map<string, (body: Record<string, unknown>) => { status?: number; body: unknown }>
  close: () => Promise<void>
}> {
  const requests: Recorded[] = []
  const routes = new Map<string, (body: Record<string, unknown>) => { status?: number; body: unknown }>()
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const body = raw === '' ? {} : JSON.parse(raw) as Record<string, unknown>
      const path = request.url ?? ''
      requests.push({ path, body, authorization: request.headers.authorization })
      const route = routes.get(path)
      if (route === undefined) {
        response.writeHead(404).end()
        return
      }
      const answer = route(body)
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

/** The envelope MemoryBear answers with. */
function envelope(data: unknown): unknown {
  return { code: 0, msg: 'ok', data, error: '', time: 0 }
}

let closeStub: (() => Promise<void>) | undefined

afterEach(async () => {
  await closeStub?.()
  closeStub = undefined
})

async function mount(baseUrl: string, over: { timeoutMs?: number } = {}) {
  const ctx = new Context()
  await ctx.plugin(provider, {
    baseUrl,
    apiKey: 'test-key',
    endUserOtherId: 'user-1',
    timeoutMs: over.timeoutMs ?? 500,
  })
  return ctx
}

describe('dsh-memory-bear', () => {
  it('creates the end user once, then recalls with the resolved id', async () => {
    const stub = await startStub()
    closeStub = stub.close
    stub.routes.set('/v1/end_user/create', () => ({ body: envelope({ id: 'eu-1', other_id: 'user-1' }) }))
    stub.routes.set('/v1/memory/read/sync', body => ({
      body: envelope({
        answer: 'ok',
        intermediate_outputs: [
          { id: 'm1', content: 'prefers pnpm', source: 'Preference', score: 0.812, query: body.message },
        ],
      }),
    }))
    const ctx = await mount(stub.baseUrl)

    const first = await ctx.memory.recall({ question: 'package manager', mode: 'quick', turn: 1 })
    const second = await ctx.memory.recall({ question: 'tooling', mode: 'express', turn: 2 })

    expect(first.degraded).toBe(false)
    expect(first.items).toEqual([
      { id: 'm1', content: 'prefers pnpm', kind: 'Preference', score: 0.812, query: 'package manager', source: 'Preference' },
    ])
    expect(second.items[0]?.query).toBe('tooling')
    expect(stub.requests.filter(request => request.path === '/v1/end_user/create')).toHaveLength(1)
    expect(stub.requests.every(request => request.authorization === 'Bearer test-key')).toBe(true)
    const read = stub.requests.find(request => request.path === '/v1/memory/read/sync')!
    expect(read.body.search_switch).toBe('quick')
    expect(read.body.end_user_id).toBe('eu-1')
  })

  it('degrades instead of throwing when the backend is down', async () => {
    const ctx = await mount('http://127.0.0.1:9', { timeoutMs: 300 })
    const result = await ctx.memory.recall({ question: 'anything', mode: 'quick', turn: 1 })
    expect(result.degraded).toBe(true)
    expect(result.items).toEqual([])
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('rejects an empty question as a caller error', async () => {
    const stub = await startStub()
    closeStub = stub.close
    const ctx = await mount(stub.baseUrl)
    await expect(ctx.memory.recall({ question: '   ', mode: 'quick', turn: 1 })).rejects.toBeInstanceOf(MemoryError)
  })

  it('submits a write batch and reports its acceptance', async () => {
    const stub = await startStub()
    closeStub = stub.close
    stub.routes.set('/v1/end_user/create', () => ({ body: envelope({ id: 'eu-1' }) }))
    stub.routes.set('/v1/memory/write', () => ({ body: envelope({ task_ids: ['task-9'] }) }))
    const ctx = await mount(stub.baseUrl)

    const result = await ctx.memory.remember({
      sessionId: 'session-1',
      turn: 3,
      messages: [{ role: 'user', content: 'uses pnpm', at: '2026-11-13T00:00:00Z' }],
    })

    expect(result).toEqual({ queued: true, batchId: 'task-9' })
    const write = stub.requests.find(request => request.path === '/v1/memory/write')!
    expect(write.body).toMatchObject({
      end_user_id: 'eu-1',
      conversation_id: 'session-1',
      messages: [{ role: 'user', content: 'uses pnpm', dialog_at: '2026-11-13T00:00:00Z' }],
    })
  })

  it('rejects forget as unsupported on the API-key surface', async () => {
    const stub = await startStub()
    closeStub = stub.close
    const ctx = await mount(stub.baseUrl)
    await expect(ctx.memory.forget({ target: 'm1' })).rejects.toMatchObject({ code: 'MEMORY_UNSUPPORTED' })
  })

  it('health reports reachability without throwing', async () => {
    const stub = await startStub()
    closeStub = stub.close
    stub.routes.set('/v1/end_user/create', () => ({ body: envelope({ id: 'eu-1' }) }))
    const ctx = await mount(stub.baseUrl)
    expect(await ctx.memory.health()).toEqual({ reachable: true, endUserId: 'eu-1' })
  })
})
