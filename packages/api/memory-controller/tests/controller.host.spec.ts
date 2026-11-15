/**
 * The memory panel's Host Remote owner over a scripted seam: reads pass
 * through, an unreachable engine degrades a read instead of failing the page,
 * an engine without the operation rejects `memory/unsupported`, and a removal
 * the engine did not confirm always rejects.
 */
import { Context } from '@deepseek-ai/cordis'
import { MemoryEngine, MemoryError } from '@deepseek-ai/dsh-memory'
import type {
  MemoryForgetRequest,
  MemoryForgetResult,
  MemoryHealth,
  MemoryListRequest,
  MemoryListResult,
  MemoryProfileRequest,
  MemoryProfileResult,
  MemoryRecallResult,
  MemoryRememberResult,
} from '@deepseek-ai/dsh-memory'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { describe, expect, it } from 'vitest'
import { MemoryController } from '../src/index.ts'

type Outcome = 'ok' | 'unavailable' | 'unsupported'

/** A seam whose every panel operation answers the scripted outcome. */
class ScriptedEngine extends MemoryEngine {
  outcome: Outcome = 'ok'
  readonly lists: MemoryListRequest[] = []
  readonly forgets: MemoryForgetRequest[] = []

  recall(): Promise<MemoryRecallResult> {
    return Promise.reject(new Error('not scripted'))
  }

  remember(): Promise<MemoryRememberResult> {
    return Promise.reject(new Error('not scripted'))
  }

  async list(request: MemoryListRequest): Promise<MemoryListResult> {
    this.lists.push(request)
    this.fail()
    return {
      items: [{ id: 'm-1', content: '项目统一使用 pnpm', kind: 'preference', createdAt: '2026-11-13T00:00:00.000Z', hits: 2 }],
      total: 7,
    }
  }

  async profile(_request: MemoryProfileRequest): Promise<MemoryProfileResult> {
    this.fail()
    return { sections: { interests: ['CSS Modules'] } }
  }

  async forget(request: MemoryForgetRequest): Promise<MemoryForgetResult> {
    this.forgets.push(request)
    this.fail()
    return { removed: 1 }
  }

  async health(): Promise<MemoryHealth> {
    return { reachable: this.outcome !== 'unavailable' }
  }

  private fail(): void {
    if (this.outcome === 'unavailable') throw new MemoryError('down', 'MEMORY_UNAVAILABLE')
    if (this.outcome === 'unsupported') throw new MemoryError('no such route', 'MEMORY_UNSUPPORTED')
  }
}

/** The Session every call names; no Agent is live for it, so the Host engine serves. */
const S = SessionId('panel-session')

/** A live Agent stand-in; `mute` appends to this Session's log. */
function liveAgent(ctx: Context, id: SessionId): Agent {
  const session = ctx.sessions.create(id)
  const agent = {
    id,
    session,
    options: {},
    model: { provider: 'mock', model: 'mock' },
    inbox: { push: () => {}, drain: () => [], close: () => {} },
    status: 'idle',
    ctx,
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel: () => {},
    runMaintenance: (task: (signal: AbortSignal) => Promise<void>) => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  } as unknown as Agent
  ctx.agents.enter(agent)
  return agent
}

async function harness(withEngine = true): Promise<{ ctx: Context; engine: ScriptedEngine; controller: MemoryController }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  if (withEngine) await ctx.plugin(ScriptedEngine)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(MemoryController)
  return { ctx, engine: ctx.get('memory') as ScriptedEngine, controller: ctx.memoryController }
}

async function failureCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    const failure = remoteErrorOf(error)
    if (failure !== undefined) return failure.code
    throw error
  }
  throw new Error('expected a RemoteError failure')
}

describe('MemoryController', () => {
  it('passes a list request through and reports the engine total', async () => {
    const { engine, controller } = await harness()
    const value = await controller.list({ sessionId: S, query: 'pnpm', limit: 20 })
    expect(engine.lists).toEqual([{ query: 'pnpm', limit: 20 }])
    expect(value).toEqual({
      items: [{ id: 'm-1', content: '项目统一使用 pnpm', kind: 'preference', createdAt: '2026-11-13T00:00:00.000Z', hits: 2 }],
      total: 7,
      degraded: false,
    })
  })

  it('degrades reads when the engine is unreachable', async () => {
    const { engine, controller } = await harness()
    engine.outcome = 'unavailable'
    expect(await controller.list({ sessionId: S })).toEqual({ items: [], total: 0, degraded: true })
    expect(await controller.profile({ sessionId: S })).toEqual({ sections: {}, degraded: true })
    expect(await controller.health({ sessionId: S })).toEqual({ reachable: false })
  })

  it('rejects memory/unsupported when the engine lacks the operation', async () => {
    const { engine, controller } = await harness()
    engine.outcome = 'unsupported'
    expect(await failureCode(() => controller.list({ sessionId: S }))).toBe('memory/unsupported')
    expect(await failureCode(() => controller.profile({ sessionId: S }))).toBe('memory/unsupported')
    expect(await failureCode(() => controller.forget({ sessionId: S, target: 'm-1' }))).toBe('memory/unsupported')
  })

  it('never reports an unconfirmed removal as success', async () => {
    const { engine, controller } = await harness()
    expect(await controller.forget({ sessionId: S, target: 'm-1' })).toEqual({ removed: 1 })
    engine.outcome = 'unavailable'
    expect(await failureCode(() => controller.forget({ sessionId: S, target: 'm-1' }))).toBe('memory/unavailable')
    expect(engine.forgets).toEqual([{ target: 'm-1' }, { target: 'm-1' }])
  })

  it('rejects memory/unsupported for a Session with no engine', async () => {
    const { controller } = await harness(false)
    expect(await failureCode(() => controller.list({ sessionId: S }))).toBe('memory/unsupported')
    expect(await failureCode(() => controller.health({ sessionId: S }))).toBe('memory/unsupported')
  })

  it('propagates a non-engine failure instead of degrading it', async () => {
    const { engine, controller } = await harness()
    engine.list = () => Promise.reject(new TypeError('defect'))
    await expect(controller.list({ sessionId: S })).rejects.toThrow('defect')
  })

  it('records the switch as a session event on the live Session', async () => {
    const { ctx, controller } = await harness()
    const live = SessionId('live-session')
    const agent = liveAgent(ctx, live)
    expect(controller.mute({ sessionId: live, muted: true })).toEqual({ muted: true })
    const event = agent.session.snapshotEvents().findLast(e => e.type === 'memory/mute')
    expect(event?.data).toEqual({ muted: true, origin: 'input-dock' })
  })

  it('refuses to switch a Session that is not live', async () => {
    const { controller } = await harness()
    expect(await failureCode(() => Promise.resolve().then(() => controller.mute({ sessionId: S, muted: true }))))
      .toBe('memory/unavailable')
  })

  it('reads profile sections', async () => {
    const { controller } = await harness()
    expect(await controller.profile({ sessionId: S, sections: ['interests'] })).toEqual({
      sections: { interests: ['CSS Modules'] },
      degraded: false,
    })
  })
})
