import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
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

import * as autosave from '../src/index.ts'

/** A seam the test scripts; recall and write outcomes are per-test. */
class ScriptedEngine extends MemoryEngine {
  readonly recalls: MemoryRecallRequest[] = []
  readonly writes: MemoryRememberRequest[] = []
  recallResult: MemoryRecallResult = { items: [], trace: [], degraded: false, latencyMs: 3 }
  writeFails = false

  async recall(request: MemoryRecallRequest): Promise<MemoryRecallResult> {
    this.recalls.push(request)
    return this.recallResult
  }

  async remember(request: MemoryRememberRequest): Promise<MemoryRememberResult> {
    this.writes.push(request)
    if (this.writeFails) throw new Error('backend down')
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

const SIGNAL = new AbortController().signal

/** A real Session behind a minimal Agent stand-in, as the seam's other consumers do. */
function agentWithSession(ctx: Context, id = 'memory-session'): Agent & { session: Session } {
  const session = ctx.sessions.create(SessionId(id))
  const agent: Agent = {
    id: SessionId(id),
    options: {},
    session,
    model: { provider: 'mock', model: 'mock' } as never,
    inbox: { push: () => {}, drain: () => [], close: () => {} } as never,
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  return agent
}

async function setup(config: autosave.Config = {}) {
  const ctx = new Context()
  await ctx.plugin(ScriptedEngine)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(autosave, config)
  return { ctx, engine: ctx.memory as ScriptedEngine }
}

/**
 * Attach an agent to the registry so its session publishes `session/event`
 * to this context, the way a real agent loop does.
 * @param ctx - the context whose listeners must observe the session.
 * @param agent - the agent to register.
 * @returns the registration disposer.
 */
function attach(ctx: Context, agent: Agent): () => void {
  return ctx.agents.enter(agent)
}

function userTurn(agent: Agent & { session: Session }, text: string) {
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append(
    'user/message',
    createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
    { surfaceOp: 'append' },
  )
}

function preStep(ctx: Context, agent: Agent, messages: readonly unknown[]) {
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { modelSelection: { provider: 'mock', model: 'mock' }, messages: messages as never, turn: 1, step: 1, signal: SIGNAL },
    () => Promise.resolve({ kind: 'enter' as const, messages: messages as never[] }),
  )
}

describe('dsh-memory-autosave', () => {
  it('recalls on step 1 and appends both the event and one snapshot message', async () => {
    const { ctx, engine } = await setup()
    engine.recallResult = {
      items: [{ id: 'm1', content: 'prefers pnpm', kind: 'Preference', score: 0.8, query: 'q', source: 'Preference' }],
      trace: [{ stage: 'results_merged', count: 1 }],
      degraded: false,
      latencyMs: 4,
    }
    const agent = agentWithSession(ctx)
    const messages = [createUserMessage({ content: [{ type: 'text', text: 'which package manager do I prefer' }], source: { kind: 'user' } })]

    const decision = await preStep(ctx, agent, messages)

    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('expected enter')
    expect(decision.messages).toHaveLength(2)
    const injected = decision.messages[1]
    if (injected === undefined) throw new Error('expected an injected message')
    expect(injected.source.kind).toBe('memory-recall')
    const injectedText = injected.content.find(block => block.type === 'text')?.text ?? ''
    expect(injectedText).toContain('prefers pnpm')

    const event = agent.session.snapshotEvents().findLast(e => e.type === 'memory/recall')!
    expect(event.data).toMatchObject({ origin: 'pre-step', degraded: false, latencyMs: 4 })
    expect(engine.recalls[0]?.question).toBe('which package manager do I prefer')
  })

  it('skips recall when the recall is degraded, but still records it', async () => {
    const { ctx, engine } = await setup()
    engine.recallResult = { items: [], trace: [], degraded: true, latencyMs: 800 }
    const agent = agentWithSession(ctx, 'degraded-session')
    const decision = await preStep(ctx, agent, [createUserMessage({ content: [{ type: 'text', text: 'anything about me' }], source: { kind: 'user' } })])

    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('expected enter')
    expect(decision.messages).toHaveLength(1)
    expect(agent.session.snapshotEvents().findLast(e => e.type === 'memory/recall')!.data.degraded).toBe(true)
  })

  it('skips recall on later steps and for short messages', async () => {
    const { ctx, engine } = await setup()
    const agent = agentWithSession(ctx, 'skip-session')
    await preStep(ctx, agent, [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })])
    expect(engine.recalls).toHaveLength(0)
  })

  it('writes the turn text at turn end and records acceptance', async () => {
    const { ctx, engine } = await setup()
    const agent = agentWithSession(ctx, 'write-session')
    attach(ctx, agent)
    userTurn(agent, 'please use pnpm from now on')
    agent.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'understood, pnpm it is' }],
        source: { provider: 'mock', model: 'mock' },
      }),
      stream: [],
    }, { surfaceOp: 'append' })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await new Promise((resolve) => { setImmediate(resolve) })

    expect(engine.writes).toHaveLength(1)
    expect(engine.writes[0]?.messages.map(message => message.role)).toEqual(['user', 'assistant'])
    const event = agent.session.snapshotEvents().findLast(e => e.type === 'memory/write')!
    expect(event.data).toMatchObject({ batchId: 'batch-1', queued: true, origin: 'pre-step' })
  })

  it('records a refused write instead of failing the turn', async () => {
    const { ctx, engine } = await setup()
    engine.writeFails = true
    const agent = agentWithSession(ctx, 'write-fails')
    attach(ctx, agent)
    userTurn(agent, 'a message long enough to store')
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await new Promise((resolve) => { setImmediate(resolve) })

    const event = agent.session.snapshotEvents().findLast(e => e.type === 'memory/write')!
    expect(event.data).toMatchObject({ queued: false, error: 'backend down' })
  })

  it('skips recall and the write for a turn the switch muted', async () => {
    const { ctx, engine } = await setup()
    const agent = agentWithSession(ctx, 'muted-session')
    attach(ctx, agent)
    agent.session.append('memory/mute', { muted: true, origin: 'input-dock' })
    userTurn(agent, 'please use pnpm from now on')
    const messages = [createUserMessage({ content: [{ type: 'text', text: 'which package manager do I prefer' }], source: { kind: 'user' } })]
    const decision = await preStep(ctx, agent, messages)
    agent.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'understood, pnpm it is' }],
        source: { provider: 'mock', model: 'mock' },
      }),
      stream: [],
    }, { surfaceOp: 'append' })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await new Promise((resolve) => { setImmediate(resolve) })

    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('expected enter')
    expect(decision.messages).toHaveLength(1)
    expect(engine.recalls).toHaveLength(0)
    expect(engine.writes).toHaveLength(0)
    expect(agent.session.snapshotEvents().some(e => e.type === 'memory/recall')).toBe(false)
  })

  it('retires the switch after the turn it muted', async () => {
    const { ctx, engine } = await setup()
    const agent = agentWithSession(ctx, 'mute-expiry')
    attach(ctx, agent)
    agent.session.append('memory/mute', { muted: true, origin: 'input-dock' })
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    agent.session.append('turn/start', { turn: 2 })

    const messages = [createUserMessage({ content: [{ type: 'text', text: 'which package manager do I prefer' }], source: { kind: 'user' } })]
    await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { modelSelection: { provider: 'mock', model: 'mock' }, messages, turn: 2, step: 1, signal: SIGNAL },
      () => Promise.resolve({ kind: 'enter' as const, messages }),
    )

    expect(engine.recalls).toHaveLength(1)
  })

  it('shows an unmuted turn as unmuted again once the mute is switched off', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession(ctx, 'mute-toggle')
    attach(ctx, agent)
    agent.session.append('memory/mute', { muted: true, origin: 'input-dock' })
    agent.session.append('memory/mute', { muted: false, origin: 'input-dock' })
    agent.session.append('turn/start', { turn: 1 })

    const { values } = ctx.sessionProjections.snapshot(agent.session, ['memoryAutosave'])
    expect(values.memoryAutosave).toMatchObject({ muted: false, mutedTurn: null })
  })

  it('never stores or recalls with injected context', async () => {
    const { ctx, engine } = await setup()
    const agent = agentWithSession(ctx, 'injected-context')
    attach(ctx, agent)
    userTurn(agent, 'please use pnpm from now on')
    const injected = createUserMessage({
      content: [{ type: 'text', text: '<system-reminder>Current working directory: /home/someone/project</system-reminder>' }],
      source: { kind: 'runtime-context' } as never,
    })
    agent.session.append('user/message', injected, { surfaceOp: 'append' })
    const human = createUserMessage({ content: [{ type: 'text', text: 'which package manager do I prefer' }], source: { kind: 'user' } })
    await preStep(ctx, agent, [human, injected])
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await new Promise((resolve) => { setImmediate(resolve) })

    expect(engine.recalls[0]?.question).toBe('which package manager do I prefer')
    const stored = engine.writes.flatMap(write => write.messages.map(message => message.content))
    expect(stored).toEqual(['please use pnpm from now on'])
  })
})
