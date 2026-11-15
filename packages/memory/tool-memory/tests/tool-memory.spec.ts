import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
// Type-only: the `memory/*` session-event declarations this spec inspects.
import type {} from '@deepseek-ai/dsh-tool-memory/types'
import { MemoryEngine } from '@deepseek-ai/dsh-memory'
import type {
  MemoryForgetRequest,
  MemoryForgetResult,
  MemoryHealth,
  MemoryListRequest,
  MemoryListResult,
  MemoryProfileRequest,
  MemoryProfileResult,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRememberRequest,
  MemoryRememberResult,
} from '@deepseek-ai/dsh-memory'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'

import * as tool from '../src/index.ts'

const testToolSignal = new AbortController().signal

/** A seam implementation the test scripts; every call is recorded. */
class ScriptedEngine extends MemoryEngine {
  readonly recalls: MemoryRecallRequest[] = []
  readonly writes: MemoryRememberRequest[] = []
  recallResult: MemoryRecallResult = { items: [], trace: [], degraded: false, latencyMs: 5 }

  async recall(request: MemoryRecallRequest): Promise<MemoryRecallResult> {
    this.recalls.push(request)
    return this.recallResult
  }

  async remember(request: MemoryRememberRequest): Promise<MemoryRememberResult> {
    this.writes.push(request)
    return { queued: true, batchId: 'batch-1' }
  }

  forget(_request: MemoryForgetRequest): Promise<MemoryForgetResult> {
    return Promise.reject(new Error('not scripted'))
  }

  profile(_request: MemoryProfileRequest): Promise<MemoryProfileResult> {
    return Promise.reject(new Error('not scripted'))
  }

  list(_request: MemoryListRequest): Promise<MemoryListResult> {
    return Promise.reject(new Error('not scripted'))
  }

  health(): Promise<MemoryHealth> {
    return Promise.resolve({ reachable: true })
  }
}

function agentWithSession(id = 'parent-1'): Agent & { session: Session } {
  const session = Session.create(SessionId(id))
  return { id: SessionId(id), session } as Agent & { session: Session }
}

async function setup(config: tool.Config = {}) {
  const ctx = new Context()
  await ctx.plugin(ScriptedEngine)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(tool, config)
  return { ctx, engine: ctx.memory as ScriptedEngine }
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown, agent: Agent = agentWithSession()) {
  return executeToolFixture(ctx, {
    signal: testToolSignal,
    callId: ToolCallId(`call-${++callCounter}`),
    name,
    arguments: args,
    agent,
  })
}

describe('dsh-tool-memory', () => {
  it('registers recall and write, and omits forget unless enabled', async () => {
    const { ctx } = await setup()
    const names = ctx.tools.schemas().map(schema => schema.name).sort()
    expect(names).toEqual(['memory_recall', 'memory_write'])
  })

  it('registers forget when the deployment enables it', async () => {
    const { ctx } = await setup({ enableForget: true })
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('memory_forget')
  })

  it('recalls through the seam and appends one memory/recall event', async () => {
    const { ctx, engine } = await setup()
    engine.recallResult = {
      items: [{ id: 'm1', content: 'prefers pnpm', kind: 'Preference', score: 0.9, query: 'q', source: 'Preference' }],
      trace: [{ stage: 'results_merged', count: 1 }],
      degraded: false,
      latencyMs: 12,
    }
    const agent = agentWithSession('recall-1')
    const result = await call(ctx, 'memory_recall', { question: 'which package manager', search_mode: 'quick' }, agent)

    expect(result.isError).toBe(false)
    expect(engine.recalls).toHaveLength(1)
    expect(engine.recalls[0]).toMatchObject({ question: 'which package manager', mode: 'quick' })

    const event = agent.session.snapshotEvents().findLast(e => e.type === 'memory/recall')!
    expect(event.data).toMatchObject({
      question: 'which package manager',
      mode: 'quick',
      origin: 'tool',
      degraded: false,
      latencyMs: 12,
    })
    expect(event.data.items).toEqual([{ id: 'm1', content: 'prefers pnpm', kind: 'Preference', score: 0.9 }])
  })

  it('reports a degraded recall without failing the tool', async () => {
    const { ctx, engine } = await setup()
    engine.recallResult = { items: [], trace: [], degraded: true, latencyMs: 800 }
    const agent = agentWithSession('degraded')
    const result = await call(ctx, 'memory_recall', { question: 'anything at all' }, agent)

    expect(result.isError).toBe(false)
    const event = agent.session.snapshotEvents().findLast(e => e.type === 'memory/recall')!
    expect(event.data.degraded).toBe(true)
  })

  it('writes through the seam and records acceptance', async () => {
    const { ctx, engine } = await setup()
    const agent = agentWithSession('write-1')
    const result = await call(ctx, 'memory_write', { content: 'uses pnpm', kind: 'preference' }, agent)

    expect(result.isError).toBe(false)
    expect(engine.writes).toHaveLength(1)
    expect(engine.writes[0]?.sessionId).toBe('write-1')

    const event = agent.session.snapshotEvents().findLast(e => e.type === 'memory/write')!
    expect(event.data).toMatchObject({ batchId: 'batch-1', queued: true, origin: 'tool' })
    expect(event.data.items).toEqual([{ content: 'uses pnpm', kind: 'preference' }])
  })
})
