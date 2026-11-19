/**
 * Session-driven memory scheduling. It runs two operations on the agent
 * lifecycle and nothing else:
 *
 * - `agent/pre-step` recalls memories for the newest user message and appends
 *   them as one snapshot-sourced user message, the same durable-injection form
 *   the request clock uses. The recall event is appended before the message, so
 *   replay reproduces both and the client memory panel reads the resulting
 *   recall view from its projection.
 * - `turn/end` submits the turn's user and assistant text as one write batch.
 *
 * A degraded recall never blocks the step. An unavailable backend never fails
 * the turn; the write path records its failure on the event instead.
 * @module @deepseek-ai/dsh-memory-autosave
 */

import { randomUUID } from 'node:crypto'
import type { MemoryActivityId, MemoryActivityEntry } from '@deepseek-ai/dsh-memory'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { installNativeMemory, nativeMemoryInstructions } from './native.ts'
import { memoryActivityDomain } from './activity.ts'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { MemoryMessage, MemoryScope, RecallMode } from '@deepseek-ai/dsh-memory'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-tool-memory/types'
import type {} from '@deepseek-ai/dsh-workspace'
import type { MemoryAutosaveState, TurnMessage } from './types.ts'

export type { MemoryAutosaveState, TurnMessage } from './types.ts'

/** The durable message source this plugin injects under. */
const SOURCE_KIND = 'memory-recall'

/** The message source of text a human typed; every other user-role source is an injection. */
const HUMAN_SOURCE_KIND = 'user'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'memory-recall': { kind: 'memory-recall' } & ContextFormed
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'memory-autosave'

/** The seam and registries this consumer reads. The agent arrives in the hook payload, so no agent registry is injected. */
export const inject = ['memory', 'sessionProjections']

/** Autosave policy. */
export interface Config {
  /** Workspace isolation for shared GUI compositions; legacy retains the configured collection. */
  scopeMode?: 'legacy' | 'workspace'
  /** Recall breadth used by the pre-step hook. */
  recallMode?: RecallMode
  /** Whether the pre-step hook recalls. False leaves only the model-facing tools. */
  recallOnTurnStart?: boolean
  /** Whether `turn/end` writes the turn's text. */
  writeOnTurnEnd?: boolean
  /** Messages shorter than this many characters are not recalled or written. */
  minMessageChars?: number
}

export const Config: z<Config> = z.object({
  scopeMode: z.union(['legacy', 'workspace']).default('legacy'),
  recallMode: z.union(['deep', 'normal', 'quick', 'express', 'meta']).default('quick'),
  recallOnTurnStart: z.boolean().default(true),
  writeOnTurnEnd: z.boolean().default(true),
  minMessageChars: z.number().default(8),
})

/** Host projection state also tracks the turn currently collecting messages. */
interface AutosaveProjectionState extends MemoryAutosaveState {
  /** The open turn number, or null after its `turn/end` event. */
  readonly activeTurn: number | null
  readonly enabled: boolean
  readonly nativeCallIds: readonly string[]
}

/** Projection state persisted in the session projection cache. */
const lastWriteSchema = zod.object({ queued: zod.boolean(), contents: zod.array(zod.string()) }).optional()
const stateSchema: ZodType<AutosaveProjectionState> = zod.object({
  nativeAvailable: zod.boolean().optional(),
  lastWrite: lastWriteSchema,
  lastRecall: zod.object({
    question: zod.string(),
    mode: zod.string(),
    degraded: zod.boolean(),
    latencyMs: zod.number(),
    items: zod.array(zod.object({
      role: zod.union([zod.literal('user'), zod.literal('assistant')]),
      content: zod.string(),
    })),
    trace: zod.array(zod.object({
      stage: zod.string(),
      count: zod.number().optional(),
      durationMs: zod.number().optional(),
    })),
  }).nullable(),
  turnText: zod.array(zod.object({
    role: zod.union([zod.literal('user'), zod.literal('assistant')]),
    content: zod.string(),
  })),
  muted: zod.boolean(),
  mutedTurn: zod.number().nullable(),
  activeTurn: zod.number().nullable(),
  enabled: zod.boolean(),
  nativeCallIds: zod.array(zod.string()),
})

/** Client projection state excludes the host-only active-turn marker. */
const viewSchema: ZodType<MemoryAutosaveState> = zod.object({
  nativeAvailable: zod.boolean().optional(),
  lastWrite: lastWriteSchema,
  lastRecall: zod.object({
    question: zod.string(),
    mode: zod.string(),
    degraded: zod.boolean(),
    latencyMs: zod.number(),
    items: zod.array(zod.object({
      role: zod.union([zod.literal('user'), zod.literal('assistant')]),
      content: zod.string(),
    })),
    trace: zod.array(zod.object({
      stage: zod.string(),
      count: zod.number().optional(),
      durationMs: zod.number().optional(),
    })),
  }).nullable(),
  turnText: zod.array(zod.object({
    role: zod.union([zod.literal('user'), zod.literal('assistant')]),
    content: zod.string(),
  })),
  muted: zod.boolean(),
  mutedTurn: zod.number().nullable(),
})

/**
 * Register the projection and the lifecycle hooks.
 * @param ctx - the context carrying the agent registry, the seam, and projections.
 * @param config - autosave policy.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (config.scopeMode === 'workspace') {
    ctx.inject(['workspaceRegistry', 'storageDomain'], scoped => install(scoped, config))
    return
  }
  await install(ctx, config)
}

/** Install scheduling after the configured scope's dependencies become available. */
async function install(ctx: Context, config: Config): Promise<void> {
  if (config.scopeMode === 'workspace') {
    const storage = ctx.get('storageDomain')
    if (storage === undefined) throw new Error('Workspace memory requires storageDomain')
    const domain = await storage.open(memoryActivityDomain)
    const table = domain.table('entries')
    const pending = new Set<Promise<void>>()
    let activityFailure: unknown
    ctx.effect(() => ctx.provide('memoryActivity', {
      record: async entry => { await table.put(entry.id, entry) },
      list: async (scope, limit) => {
        await Promise.all([...pending])
        if (activityFailure !== undefined) throw activityFailure
        return [...table.entries()].map(([, entry]) => entry).filter(entry =>
          entry.scope.kind === scope.kind && (scope.kind === 'global' || (entry.scope.kind === 'workspace' && entry.scope.workspaceId === scope.workspaceId)),
        ).sort((a, b) => b.time - a.time).slice(0, limit)
      },
    }), 'memory-autosave: activity reader')
    ctx.effect(function* () {
      yield async () => { await Promise.allSettled([...pending]); await domain.close() }
      yield ctx.on('session/event', (session, event) => {
        if (event.type === 'memory/result' && event.data.status === 'unknown') {
          const call = session.snapshotEvents().find(item => item.type === 'memory/call' && item.data.id === event.data.id)
          if (call?.type === 'memory/call' && call.data.operation === 'write') {
            const entry: MemoryActivityEntry = { id: `${session.id}:${event.data.id}` as MemoryActivityId,
              scope: call.data.scope, sessionId: session.id, time: event.time, operation: 'write', origin: 'native',
              status: 'unknown', contents: [call.data.content], error: event.data.message }
            const write = table.put(entry.id, entry)
            pending.add(write)
            void write.then(() => { pending.delete(write) }, error => { pending.delete(write); activityFailure = error; ctx.logger.error(error) })
          }
          return
        }
        if (event.type !== 'memory/recall' && event.type !== 'memory/write') return
        if (event.data.scope === undefined) return
        const entry: MemoryActivityEntry = {
          id: randomUUID() as MemoryActivityId, scope: event.data.scope, sessionId: session.id, time: event.time,
          origin: event.data.origin === 'native' ? 'native' : 'automatic',
          ...(event.type === 'memory/recall' ? { question: event.data.question } : event.data.error === undefined ? {} : { error: event.data.error }),
          operation: event.type === 'memory/recall' ? 'recall' : 'write',
          status: event.type === 'memory/recall' ? (event.data.degraded ? 'failed' : 'completed') : (event.data.queued ? 'accepted' : 'failed'),
          contents: event.data.items.map(item => item.content),
          ...(event.type === 'memory/write' && event.data.batchId !== null ? { batchId: event.data.batchId } : {}),
        }
        const write = table.put(entry.id, entry)
        pending.add(write)
        void write.then(() => { pending.delete(write) }, error => { pending.delete(write); activityFailure = error; ctx.logger.error(error) })
      })
    }, 'memory-autosave: durable activity')
  }
  const recallMode = config.recallMode ?? 'quick'
  const recallOnTurnStart = config.recallOnTurnStart
  const writeOnTurnEnd = config.writeOnTurnEnd
  const minChars = config.minMessageChars ?? 8
  let previousViewState: AutosaveProjectionState | undefined
  let previousView: MemoryAutosaveState | undefined

  const projectionReady = ctx.sessionProjections.register<'memoryAutosave', AutosaveProjectionState>({
    key: 'memoryAutosave',
    stateVersion: 5,
    stateSchema,
    init: () => ({ lastRecall: null, turnText: [], muted: false, mutedTurn: null, activeTurn: null, enabled: true, nativeCallIds: [] }),
    apply: (state, event) => {
      if (event.type === 'memory/call') return state.nativeCallIds.includes(event.data.id) ? state : { ...state, nativeCallIds: [...state.nativeCallIds, event.data.id] }
      if (event.type === 'memory/capability') return { ...state, nativeAvailable: event.data.nativeAvailable }
      if (event.type === 'memory/settings') {
        return { ...state, enabled: event.data.enabled, muted: !event.data.enabled, mutedTurn: null }
      }
      if (event.type === 'turn/start') {
        const muted = !state.enabled || (state.muted && (state.mutedTurn === null || state.mutedTurn === event.data.turn))
        return {
          ...state,
          turnText: [],
          muted,
          mutedTurn: state.enabled && muted ? event.data.turn : null,
          activeTurn: event.data.turn,
        }
      }
      if (event.type === 'turn/end') {
        // Keep the collected text and mute marker until the synchronous
        // turn-end listener has captured them. The next turn/start retires it.
        return state.activeTurn === event.data.turn ? { ...state, activeTurn: null } : state
      }
      if (event.type === 'memory/mute') {
        return event.data.muted
          ? { ...state, muted: true, mutedTurn: state.activeTurn }
          : { ...state, muted: false, mutedTurn: null }
      }
      if (event.type === 'memory/write') {
        return { ...state, lastWrite: { queued: event.data.queued, contents: event.data.items.map(item => item.content) } }
      }
      if (event.type === 'memory/recall') {
        return {
          ...state,
          lastRecall: {
            question: event.data.question,
            mode: event.data.mode,
            degraded: event.data.degraded,
            latencyMs: event.data.latencyMs,
            items: event.data.items.map(item => ({ role: 'user' as const, content: item.content })),
            trace: event.data.trace.map(stage => ({ ...stage })),
          },
        }
      }
      if (event.type === 'user/message') {
        // Only what a human typed is worth remembering. Context injections share
        // the user role (runtime and time context, recalled memories) and carry
        // workspace paths and clock readings that must never become memories.
        // `createMessage` clones with `structuredClone`, which drops an omitted
        // `source`; the declared type cannot express that, so read it widened.
        const source = event.data.source as { readonly kind?: string } | undefined
        if (source?.kind !== HUMAN_SOURCE_KIND) return state
        const text = textOf(event.data.content)
        return text === undefined
          ? state
          : { ...state, turnText: [...state.turnText, { role: 'user', content: text }] }
      }
      if (event.type === 'assistant/message') {
        const text = textOf(event.data.message.content)
        return text === undefined
          ? state
          : { ...state, turnText: [...state.turnText, { role: 'assistant', content: text }] }
      }
      return state
    },
    wire: {
      viewSchema,
      view: state => {
        // `activeTurn` is host-only. Reuse the previous client object when an
        // event changes only that marker, keeping projection notifications quiet.
        if (
          previousView !== undefined
          && previousViewState !== undefined
          && previousViewState.nativeAvailable === state.nativeAvailable
          && previousViewState.lastRecall === state.lastRecall
          && previousViewState.lastWrite === state.lastWrite
          && previousViewState.turnText === state.turnText
          && previousViewState.muted === state.muted
          && previousViewState.mutedTurn === state.mutedTurn
        ) return previousView
        const view: MemoryAutosaveState = {
          ...(state.nativeAvailable === undefined ? {} : { nativeAvailable: state.nativeAvailable }),
          ...(state.lastWrite && { lastWrite: state.lastWrite }),
          lastRecall: state.lastRecall,
          turnText: state.turnText,
          muted: state.muted,
          mutedTurn: state.mutedTurn,
        }
        previousViewState = state
        previousView = view
        return view
      },
      summary: false,
    },
  })

  // A provider update can unload this consumer while retaining its uid. Keep a
  // local admission bit so callbacks that already passed `next()` cannot
  // publish after this apply starts unloading.
  let stopping = false
  const pendingRecalls = new Set<Promise<unknown>>()
  const trackRecall = <T>(recall: Promise<T>): Promise<T> => {
    pendingRecalls.add(recall)
    void recall.then(
      () => { pendingRecalls.delete(recall) },
      () => { pendingRecalls.delete(recall) },
    )
    return recall
  }
  ctx.effect(function* () {
    // Remove the admission path first, then keep the memory provider alive for
    // recalls that entered the hook before disposal began.
    yield async () => {
      stopping = true
      while (pendingRecalls.size > 0) {
        await Promise.allSettled([...pendingRecalls])
      }
    }
    yield ctx.on('agent/pre-step', async ({ agent, turn, step, signal, modelSelection }, next): Promise<PreStepDecision> => {
      const handle = await projectionReady
      ctx.fiber.assertActive()
      let decision = await next()
      if (stopping || ctx.fiber.uid === null) return decision
      if (decision.kind !== 'reject' && !signal.aborted) {
        const runtime = ctx.get('llm')
        const nativeAvailable = runtime === undefined ? false : (await runtime.resolveModelInfo(modelSelection.provider, modelSelection.model, signal)).nativeMemory === true
        if (handle.stateOf(agent.session).nativeAvailable !== nativeAvailable) agent.session.append('memory/capability', { nativeAvailable })
        if (nativeAvailable) {
          const text = nativeMemoryInstructions(workspaceScope(ctx, agent.session), !handle.stateOf(agent.session).muted)
          decision = { ...decision, messages: [...decision.messages, createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: SOURCE_KIND, form: 'snapshot', sections: [{ name: 'memory-operations', text }] },
          })] }
        }
      }
      if (!recallOnTurnStart || step !== 1 || decision.kind === 'reject' || signal.aborted) return decision
      if (handle.stateOf(agent.session).muted) return decision
      const question = lastUserText(decision.messages)
      if (question === undefined || question.length < minChars) return decision
      const recall = trackRecall((async () => {
        const scope = config.scopeMode === 'workspace' ? workspaceScope(ctx, agent.session) : undefined
        const results = await Promise.all([
          ctx.memory.recall({ question, mode: recallMode, turn, ...(config.scopeMode === 'workspace' ? { scope: { kind: 'global' as const } } : {}) }),
          ...(scope === undefined ? [] : [ctx.memory.recall({ question, mode: recallMode, turn, scope })]),
        ])
        const result = {
          items: results.flatMap((value, index) => value.items.map(item => ({ ...item,
            content: config.scopeMode === 'workspace' ? `[${index === 0 ? 'Global memory' : 'Workspace memory'}] ${item.content}` : item.content,
          }))),
          trace: results.flatMap(value => value.trace),
          degraded: results.some(value => value.degraded),
          latencyMs: Math.max(...results.map(value => value.latencyMs)),
        }
        // Disposal may have started while the provider was awaiting the
        // backend. Do not append a late event to a fiber that is already gone.
        if (stopping || ctx.fiber.uid === null || signal.aborted || handle.stateOf(agent.session).muted) return undefined
        for (const [index, value] of results.entries()) {
          const recalledScope = config.scopeMode === 'workspace' ? (index === 0 ? { kind: 'global' as const } : scope) : undefined
          agent.session.append('memory/recall', {
            ...(recalledScope === undefined ? {} : { scope: recalledScope }),
            question, mode: recallMode, origin: 'pre-step',
            degraded: value.degraded, latencyMs: value.latencyMs,
            items: value.items.map(item => ({ id: item.id, content: item.content, kind: item.kind, score: item.score })),
            trace: value.trace.map(stage => ({ ...stage })),
          })
        }
        return result
      })())
      const result = await recall
      if (result === undefined || result.items.length === 0) return decision
      const text = renderRecall(result.items.map(item => item.content))
      return {
        ...decision,
        messages: [
          ...decision.messages,
          createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: SOURCE_KIND, form: 'snapshot', sections: [{ name: SOURCE_KIND, text }] },
          }),
        ],
      }
    })
  }, 'memory-autosave: pre-step recall')

  const projection = await projectionReady
  installNativeMemory(ctx, session => !projection.stateOf(session).muted, session => workspaceScope(ctx, session), (session, id) => projection.stateOf(session).nativeCallIds.includes(id))
  const pendingWrites = new Set<Promise<void>>()
  const trackWrite = (write: Promise<void>): void => {
    pendingWrites.add(write)
    void write.then(
      () => { pendingWrites.delete(write) },
      () => { pendingWrites.delete(write) },
    )
  }
  ctx.effect(function* () {
    // Register this disposer before the listener so reverse disposal removes
    // the admission path first, then waits for every write already admitted.
    yield async () => {
      stopping = true
      while (pendingWrites.size > 0) {
        await Promise.allSettled([...pendingWrites])
      }
    }
    yield ctx.on('session/event', (session, event) => {
      if (!writeOnTurnEnd || event.type !== 'turn/end') return
      // Capture synchronously at the event boundary. A deferred projection read
      // can observe the next turn after its turn/start clears turnText.
      const state = projection.stateOf(session)
      if (state.muted && (state.mutedTurn === null || state.mutedTurn === event.data.turn)) return
      trackWrite(writeTurn(ctx, session, event.data.turn, state.turnText.slice(), minChars, () => stopping, config.scopeMode === 'workspace'))
    })
  }, 'memory-autosave: turn-end writes')
}

/**
 * Submit one turn's text as a memory batch. Failures settle on a `memory/write`
 * event with `queued: false`; the turn is already over either way.
 * @param ctx - the context carrying the seam.
 * @param session - the session whose turn ended.
 * @param turn - the completed turn number.
 * @param turnText - the text collected in that turn.
 * @param minChars - the shortest message worth storing.
 */
async function writeTurn(
  ctx: Context,
  session: Session,
  turn: number,
  turnText: readonly TurnMessage[],
  minChars: number,
  isStopping: () => boolean,
  scoped: boolean,
): Promise<void> {
  if (isStopping() || ctx.fiber.uid === null) return
  const messages: MemoryMessage[] = turnText
    .filter(message => message.content.length >= minChars)
    .map(message => ({ role: message.role, content: message.content }))
  if (messages.length === 0) return
  const scope = scoped ? workspaceScope(ctx, session) : undefined
  try {
    // Unattached sessions have no implicit cross-workspace write destination.
    if (scoped && scope === undefined) return
    const result = await ctx.memory.remember({ sessionId: session.id, turn, messages, ...(scope === undefined ? {} : { scope }) })
    if (isStopping() || ctx.fiber.uid === null) return
    session.append('memory/write', {
      ...(scope === undefined ? {} : { scope }),
      batchId: result.batchId ?? null,
      queued: result.queued,
      origin: 'pre-step',
      items: messages.map(message => ({ content: message.content, kind: 'event' })),
    })
  } catch (error) {
    if (isStopping() || ctx.fiber.uid === null) return
    session.append('memory/write', {
      ...(scope === undefined ? {} : { scope }),
      batchId: null,
      queued: false,
      origin: 'pre-step',
      error: error instanceof Error ? error.message : String(error),
      items: messages.map(message => ({ content: message.content, kind: 'event' })),
    })
  }
}

/**
 * The newest human-typed text among the messages entering a step. Injected
 * context shares the user role, so the source kind decides, not the role.
 * @param messages - the step's claimed messages.
 * @returns the text, or undefined when none qualifies.
 */
function lastUserText(messages: readonly { role: string; content: unknown; source?: { kind: string } }[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message === undefined || message.role !== 'user') continue
    if (message.source?.kind !== HUMAN_SOURCE_KIND) continue
    const text = textOf(message.content)
    if (text !== undefined) return text
  }
  return undefined
}

/**
 * Flatten message content into plain text.
 * @param content - a message's content blocks or string.
 * @returns concatenated text, or undefined when empty.
 */
function textOf(content: unknown): string | undefined {
  if (typeof content === 'string') return content.trim() === '' ? undefined : content
  if (!Array.isArray(content)) return undefined
  const parts = content
    .filter((block): block is { type: string; text?: string } => typeof block === 'object' && block !== null)
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text ?? '')
  const joined = parts.join('\n').trim()
  return joined === '' ? undefined : joined
}

/**
 * Render recalled items as the text the model receives.
 * @param contents - recalled item texts, already ranked.
 * @returns the presented block.
 */
function renderRecall(contents: readonly string[]): string {
  return ['Relevant memories from earlier sessions:', ...contents.map(content => `- ${content}`)].join('\n')
}

/** Resolve the persisted workspace membership without deriving identity from a path. */
function workspaceScope(ctx: Context, session: Session): MemoryScope | undefined {
  const workspace = ctx.get('workspaceRegistry')?.list().find(item => item.sessionIds.includes(session.id))
  return workspace === undefined ? undefined : { kind: 'workspace', workspaceId: workspace.id }
}
