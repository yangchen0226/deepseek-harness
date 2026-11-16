/**
 * Session-driven memory scheduling. It runs two operations on the agent
 * lifecycle and nothing else:
 *
 * - `agent/pre-step` recalls memories for the newest user message and appends
 *   them as one snapshot-sourced user message, the same durable-injection form
 *   the request clock uses. The recall event is appended before the message, so
 *   replay reproduces both and the client derives the recall chip from the log.
 * - `turn/end` submits the turn's user and assistant text as one write batch.
 *
 * A degraded recall never blocks the step. An unavailable backend never fails
 * the turn; the write path records its failure on the event instead.
 * @module @deepseek-ai/dsh-memory-autosave
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { MemoryMessage, RecallMode } from '@deepseek-ai/dsh-memory'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-tool-memory/types'
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
  recallMode: z.union(['deep', 'normal', 'quick', 'express', 'meta']).default('quick'),
  recallOnTurnStart: z.boolean().default(true),
  writeOnTurnEnd: z.boolean().default(true),
  minMessageChars: z.number().default(8),
})

/** Projection state: the last recall, and the text collected in the open turn. */
const stateSchema: ZodType<MemoryAutosaveState> = zod.object({
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
  const recallMode = config.recallMode ?? 'quick'
  const recallOnTurnStart = config.recallOnTurnStart
  const writeOnTurnEnd = config.writeOnTurnEnd
  const minChars = config.minMessageChars ?? 8

  const projectionReady = ctx.sessionProjections.register<'memoryAutosave', MemoryAutosaveState>({
    key: 'memoryAutosave',
    stateVersion: 1,
    stateSchema,
    init: () => ({ lastRecall: null, turnText: [], muted: false, mutedTurn: null }),
    apply: (state, event) => {
      // The switch lasts exactly one turn. `turn/end` cannot clear it: the write
      // path reads the same event and must still see the turn as muted. So the
      // next `turn/start` retires a switch whose turn has already run.
      if (event.type === 'turn/start') {
        const muted = state.muted && (state.mutedTurn === null || state.mutedTurn === event.data.turn)
        return {
          ...state,
          turnText: [],
          muted,
          mutedTurn: muted ? event.data.turn : null,
        }
      }
      if (event.type === 'memory/mute') {
        return { ...state, muted: event.data.muted, ...event.data.muted ? {} : { mutedTurn: null } }
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
    wire: { viewSchema: stateSchema, view: state => state, summary: false },
  })

  ctx.on('agent/pre-step', async ({ agent, step, signal }, next): Promise<PreStepDecision> => {
    const handle = await projectionReady
    ctx.fiber.assertActive()
    const decision = await next()
    if (!recallOnTurnStart || step !== 1 || decision.kind === 'reject' || signal.aborted) return decision
    if (handle.stateOf(agent.session).muted) return decision
    const question = lastUserText(decision.messages)
    if (question === undefined || question.length < minChars) return decision
    const result = await ctx.memory.recall({ question, mode: recallMode, turn: 0 })
    agent.session.append('memory/recall', {
      question,
      mode: recallMode,
      origin: 'pre-step',
      degraded: result.degraded,
      latencyMs: result.latencyMs,
      items: result.items.map(item => ({
        id: item.id,
        content: item.content,
        kind: item.kind,
        score: item.score,
      })),
      trace: result.trace.map(stage => ({ ...stage })),
    })
    if (result.items.length === 0) return decision
    const recalled = handle.stateOf(agent.session).lastRecall
    if (recalled === null) return decision
    const text = renderRecall(recalled.items.map(item => item.content))
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

  ctx.on('session/event', (session, event) => {
    if (!writeOnTurnEnd || event.type !== 'turn/end') return
    const handle = projectionReady
    void handle.then((projection) => {
      const state = projection.stateOf(session)
      if (state.muted) return
      return writeTurn(ctx, session, state.turnText, minChars)
    })
  })

  await projectionReady
}

/**
 * Submit one turn's text as a memory batch. Failures settle on a `memory/write`
 * event with `queued: false`; the turn is already over either way.
 * @param ctx - the context carrying the seam.
 * @param session - the session whose turn ended.
 * @param turnText - the text collected in that turn.
 * @param minChars - the shortest message worth storing.
 */
async function writeTurn(ctx: Context, session: Session, turnText: readonly TurnMessage[], minChars: number): Promise<void> {
  const messages: MemoryMessage[] = turnText
    .filter(message => message.content.length >= minChars)
    .map(message => ({ role: message.role, content: message.content }))
  if (messages.length === 0) return
  try {
    const result = await ctx.memory.remember({ sessionId: session.id, turn: 0, messages })
    session.append('memory/write', {
      batchId: result.batchId ?? null,
      queued: result.queued,
      origin: 'pre-step',
      items: messages.map(message => ({ content: message.content, kind: 'event' })),
    })
  } catch (error) {
    session.append('memory/write', {
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
