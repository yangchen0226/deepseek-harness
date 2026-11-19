import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { memoryActivityDomain } from '../src/activity.ts'
import type { MemoryActivityId } from '@deepseek-ai/dsh-memory'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { installNativeMemory } from '../src/native.ts'
import type { MemoryCallBlock, MemoryCallId } from '@deepseek-ai/dsh-memory'
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolver) => { resolve = resolver })
  return { promise, resolve }
}

/** A seam the test scripts; recall and write outcomes are per-test. */
class ScriptedEngine extends MemoryEngine {
  readonly recalls: MemoryRecallRequest[] = []
  readonly writes: MemoryRememberRequest[] = []
  readonly recallStarted = deferred<void>()
  readonly rememberStarted = deferred<void>()
  recallResult: MemoryRecallResult = { items: [], trace: [], degraded: false, latencyMs: 3 }
  recallGate: Promise<void> | undefined
  writeFails = false
  rememberGate: Promise<void> | undefined

  async recall(request: MemoryRecallRequest): Promise<MemoryRecallResult> {
    this.recalls.push(request)
    this.recallStarted.resolve(undefined)
    if (this.recallGate !== undefined) await this.recallGate
    return this.recallResult
  }

  async remember(request: MemoryRememberRequest): Promise<MemoryRememberResult> {
    this.writes.push(request)
    this.rememberStarted.resolve(undefined)
    if (this.rememberGate !== undefined) await this.rememberGate
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
  const memoryFiber = await ctx.plugin(ScriptedEngine)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  const fiber = await ctx.plugin(autosave, config)
  return { ctx, engine: ctx.memory as ScriptedEngine, fiber, memoryFiber }
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
    expect(engine.recalls[0]?.turn).toBe(1)
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
    expect(engine.writes[0]?.turn).toBe(1)
  })

  it('captures the ended turn before the next turn clears the projection', async () => {
    const { ctx, engine } = await setup()
    const agent = agentWithSession(ctx, 'turn-end-race')
    attach(ctx, agent)
    userTurn(agent, 'remember this message from turn one')
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    // This used to race the deferred projection read and clear turnText first.
    agent.session.append('turn/start', { turn: 2 })

    await new Promise((resolve) => { setImmediate(resolve) })

    expect(engine.writes).toHaveLength(1)
    expect(engine.writes[0]?.turn).toBe(1)
    expect(engine.writes[0]?.messages.map(message => message.content)).toEqual(['remember this message from turn one'])
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

  it('mutes the remainder of a turn when switched off mid-turn', async () => {
    const { ctx, engine } = await setup()
    const agent = agentWithSession(ctx, 'mid-turn-mute')
    attach(ctx, agent)
    userTurn(agent, 'a message before memory is muted')
    agent.session.append('memory/mute', { muted: true, origin: 'input-dock' })
    agent.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'this response must not be stored' }],
        source: { provider: 'mock', model: 'mock' },
      }),
      stream: [],
    }, { surfaceOp: 'append' })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await new Promise((resolve) => { setImmediate(resolve) })

    expect(engine.writes).toHaveLength(0)
  })

  it('does not append a write result after the autosave fiber is disposed', async () => {
    const { ctx, engine, fiber } = await setup()
    const gate = deferred<void>()
    engine.rememberGate = gate.promise
    const agent = agentWithSession(ctx, 'disposed-write')
    attach(ctx, agent)
    userTurn(agent, 'a message waiting for the memory backend')
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await engine.rememberStarted.promise

    let disposed = false
    const disposing = fiber.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    gate.resolve(undefined)
    await disposing
    await new Promise((resolve) => { setImmediate(resolve) })

    expect(agent.session.snapshotEvents().some(event => event.type === 'memory/write')).toBe(false)
  })

  it('waits for an in-flight recall before disposing the autosave fiber', async () => {
    const { ctx, engine, fiber } = await setup()
    const gate = deferred<void>()
    engine.recallGate = gate.promise
    const agent = agentWithSession(ctx, 'disposed-recall')
    const pending = preStep(ctx, agent, [createUserMessage({
      content: [{ type: 'text', text: 'a question waiting for the memory backend' }],
      source: { kind: 'user' },
    })])
    await engine.recallStarted.promise

    let disposed = false
    const disposing = fiber.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    gate.resolve(undefined)
    await pending
    await disposing

    expect(agent.session.snapshotEvents().some(event => event.type === 'memory/recall')).toBe(false)
  })

  it('stops a pre-step that is waiting in next when the memory provider unloads', async () => {
    const { ctx, engine, memoryFiber } = await setup()
    const nextStarted = deferred<void>()
    const nextGate = deferred<void>()
    const agent = agentWithSession(ctx, 'provider-unload')
    const messages = [createUserMessage({
      content: [{ type: 'text', text: 'a question waiting for provider unload' }],
      source: { kind: 'user' },
    })]
    const pending = agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { modelSelection: { provider: 'mock', model: 'mock' }, messages, turn: 1, step: 1, signal: SIGNAL },
      async () => {
        nextStarted.resolve(undefined)
        await nextGate.promise
        return { kind: 'enter' as const, messages }
      },
    )
    await nextStarted.promise

    // Disposing the provider unloads its memory consumer while the listener is
    // suspended in `next()`. Releasing the gate afterwards exercises the
    // callback that already passed its active-fiber check.
    await memoryFiber.dispose()
    nextGate.resolve(undefined)
    const decision = await pending

    expect(decision.kind).toBe('enter')
    expect(engine.recalls).toHaveLength(0)
    expect(agent.session.snapshotEvents().some(event => event.type === 'memory/recall')).toBe(false)
  })

  it('keeps the session switch off across turns until explicitly enabled', async () => {
    const { ctx, engine } = await setup()
    const agent = agentWithSession(ctx, 'persistent-memory-switch')
    attach(ctx, agent)
    agent.session.append('memory/settings', { enabled: false })
    for (const turn of [1, 2]) {
      agent.session.append('turn/start', { turn })
      await preStep(ctx, agent, [createUserMessage({ content: [{ type: 'text', text: 'remember my package manager preference' }], source: { kind: 'user' } })])
      agent.session.append('turn/end', { turn, reason: { kind: 'completed' } })
      expect(ctx.sessionProjections.snapshot(agent.session, ['memoryAutosave']).values.memoryAutosave).toMatchObject({ muted: true })
    }
    expect(engine.recalls).toHaveLength(0)
    expect(engine.writes).toHaveLength(0)
    agent.session.append('memory/settings', { enabled: true })
    expect(ctx.sessionProjections.snapshot(agent.session, ['memoryAutosave']).values.memoryAutosave).toMatchObject({ muted: false })
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

describe('durable memory activity', () => {
  it('retains scope and write acceptance when the domain is reopened', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory' })
    const domain = await facility.open(memoryActivityDomain)
    const id = 'activity-1' as MemoryActivityId
    const entry = { id, scope: { kind: 'workspace' as const, workspaceId: 'workspace-1' as WorkspaceId },
      sessionId: 'session-1', time: 1, operation: 'write' as const, status: 'accepted' as const, contents: ['uses pnpm'], batchId: 'batch-1' }
    await domain.table('entries').put(id, entry)
    await domain.close()
    const reopened = await facility.open(memoryActivityDomain)
    expect(reopened.table('entries').get(id)).toEqual(entry)
    await reopened.close()
  })
})

describe('native memory execution', () => {
  it('executes typed recall without tools and logs its result before continuation', async () => {
    const ctx = new Context()
    await ctx.plugin(ScriptedEngine)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    ctx.provide('llm', { resolveModelInfo: async () => ({ nativeMemory: true }) } as never)
    const agent = agentWithSession(ctx, 'native-session')
    Object.defineProperty(agent, 'model', { value: { current: () => ({ provider: 'mock', model: 'native' }) } })
    attach(ctx, agent)
    const scope = { kind: 'workspace' as const, workspaceId: 'workspace-a' as WorkspaceId }
    installNativeMemory(ctx, () => true, () => scope)
    const call: MemoryCallBlock = { type: 'memory-call', id: 'native-1' as MemoryCallId, scope, operation: 'recall', question: 'package manager' }
    const message = createAssistantMessage({ source: { provider: 'mock', model: 'native' }, content: [call] })
    const contexts = await agentEvents(ctx, agent).waterfall('agent/assistant-operations', { message, turn: 1, step: 1, signal: SIGNAL }, async () => [])
    expect((ctx.memory as ScriptedEngine).recalls).toEqual([{ scope, question: 'package manager', mode: 'quick', turn: 1 }])
    expect(agent.session.snapshotEvents().filter(event => event.type.startsWith('memory/')).map(event => event.type)).toEqual(['memory/call', 'memory/recall', 'memory/result'])
    expect(contexts[0]?.content[0]).toMatchObject({ type: 'memory-result', id: call.id, status: 'ok' })
    expect(agent.session.snapshotEvents().some(event => event.type === 'tool/call')).toBe(false)
  })

  it('rejects foreign workspace writes, global promotion and durable duplicate ids', async () => {
    const { ctx, engine } = await setup()
    ctx.provide('llm', { resolveModelInfo: async () => ({ nativeMemory: true }) } as never)
    const agent = agentWithSession(ctx, 'native-scope-policy')
    attach(ctx, agent)
    try {
      for (const call of [
        { type: 'memory-call' as const, id: 'foreign' as MemoryCallId, scope: { kind: 'workspace' as const, workspaceId: 'foreign' as WorkspaceId }, operation: 'write' as const, content: 'must not escape' },
        { type: 'memory-call' as const, id: 'global' as MemoryCallId, scope: { kind: 'global' as const }, operation: 'write' as const, content: 'must not promote' },
      ]) {
        const message = createAssistantMessage({ source: { provider: 'mock', model: 'native' }, content: [call] })
        await agentEvents(ctx, agent).waterfall('agent/assistant-operations', { message, turn: 1, step: 1, signal: SIGNAL }, async () => [])
        await agentEvents(ctx, agent).waterfall('agent/assistant-operations', { message, turn: 1, step: 2, signal: SIGNAL }, async () => [])
      }
      expect(engine.writes).toHaveLength(0)
      expect(agent.session.snapshotEvents().filter(event => event.type === 'memory/call')).toHaveLength(2)
      expect(agent.session.snapshotEvents().filter(event => event.type === 'memory/result').map(event => event.data.status)).toEqual(['failed', 'failed', 'unsupported', 'failed'])
    } finally { await ctx.fiber.dispose() }
  })

  it('does not execute native calls for disabled policy or unsupported transport', async () => {
    for (const supported of [false, true]) {
      const ctx = new Context()
      await ctx.plugin(ScriptedEngine)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(SessionStore)
      await ctx.plugin(AgentRegistry)
      ctx.provide('llm', { resolveModelInfo: async () => ({ nativeMemory: supported }) } as never)
      const agent = agentWithSession(ctx, `native-disabled-${String(supported)}`)
      Object.defineProperty(agent, 'model', { value: { current: () => ({ provider: 'mock', model: 'native' }) } })
      attach(ctx, agent)
      installNativeMemory(ctx, () => false, () => undefined)
      const message = createAssistantMessage({ source: { provider: 'mock', model: 'native' }, content: [{ type: 'memory-call', id: 'disabled-1' as MemoryCallId, scope: { kind: 'global' }, operation: 'recall', question: 'preferences' }] })
      const contexts = await agentEvents(ctx, agent).waterfall('agent/assistant-operations', { message, turn: 1, step: 1, signal: SIGNAL }, async () => [])
      expect((ctx.memory as ScriptedEngine).recalls).toHaveLength(0)
      if (supported) expect(contexts[0]?.content[0]).toMatchObject({ type: 'memory-result', status: 'disabled' })
      else expect(contexts).toHaveLength(0)
    }
  })
})
