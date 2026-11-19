/**
 * Model-facing memory tools over the `ctx.memory` seam. Each tool appends one
 * durable session event before returning, so the transcript, the projection,
 * and the client panel all derive from the same record.
 *
 * Tool semantics follow the seam's contract: `memory_recall` answers with raw
 * items and never fails on an outage, `memory_write` reports acceptance rather
 * than storage, and `memory_forget` surfaces the backend's refusal instead of
 * pretending to act.
 *
 * The tool path does not know its turn number (the execution context carries
 * no turn, and the Session exposes no current-turn reader); the enclosing
 * `tool/call` event already records it, so memory events omit it.
 * @module @deepseek-ai/dsh-tool-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MemoryError } from '@deepseek-ai/dsh-memory'
import type { RecallMode } from '@deepseek-ai/dsh-memory'
import type {} from '@deepseek-ai/dsh-agent'
// Type-only: installs the `memory/*` SessionEventMap declarations this file appends.
import type {} from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-memory'

/** The capability seam these tools consume. */
export const inject = ['tools', 'memory']

/** Tool configuration. */
export interface Config {
  /** Retrieval breadth the tool exposes by default; the model may pick a wider one. */
  defaultMode?: RecallMode
  /** Whether the forget tool is registered. Backends without removal set false, the default. */
  enableForget?: boolean
  /** Whether the profile tool is registered. Backends without profile reads set false, the default. */
  enableProfile?: boolean
}

export const Config: z<Config> = z.object({
  defaultMode: z.union(['deep', 'normal', 'quick', 'express', 'meta']).default('quick'),
  enableForget: z.boolean().default(false),
  enableProfile: z.boolean().default(false),
})

const MODES = ['deep', 'normal', 'quick', 'express', 'meta'] as const

/**
 * Describe the retrieval modes for the model in one clause per mode.
 * @returns the description text appended to the recall tool.
 */
function recallModeHelp(): string {
  return 'Pick `express` for a simple lookup, `quick` for a broad keyword-and-vector sweep, '
    + '`normal` when the question needs splitting before retrieval, `deep` when it depends on '
    + 'relationships between facts, and `meta` when the answer is a profile detail about the user.'
}

/**
 * Register the memory tools on `ctx.tools`.
 * @param ctx - the context carrying `tools` and `memory`.
 * @param config - which tools to expose and the default retrieval breadth.
 */
export function apply(ctx: Context, config: Config): void {
  const defaultMode = config.defaultMode ?? 'quick'
  ctx.tools.register(defineTool({
    name: 'memory_recall',
    description: 'Search durable memories from earlier sessions: preferences, decisions, facts '
      + `about the user or their projects. ${recallModeHelp()} Rewrite the question into a `
      + 'retrieval form that names the entity and the fact sought. Empty results mean no matching '
      + 'memory, not an error.',
    parameters: {
      question: { type: 'string', required: true, description: 'The retrieval question, rewritten with keywords.' },
      search_mode: { type: 'string', enum: [...MODES], description: `Retrieval breadth; defaults to ${defaultMode}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                content: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                score: { type: 'number', required: true },
              },
            },
          },
          degraded: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.degraded
          ? 'Memory is unavailable this turn; continue without it and say so if the user asks about past context.'
          : value.items.length === 0
            ? 'No matching memory.'
            : value.items.map(item => `- ${item.content}`).join('\n'),
      }],
    },
    async execute(args, exec) {
      const mode = args.search_mode ?? defaultMode
      const result = await ctx.memory.recall({ question: args.question, mode, turn: 0 })
      const items = result.items.map(item => ({
        id: item.id,
        content: item.content,
        kind: item.kind,
        score: item.score,
      }))
      exec.agent?.session.append('memory/recall', {
        question: args.question,
        mode,
        origin: 'tool',
        degraded: result.degraded,
        latencyMs: result.latencyMs,
        items,
        trace: result.trace.map(stage => ({ ...stage })),
      })
      return { items, degraded: result.degraded }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_write',
    description: 'Record one durable fact the user stated: a preference, a decision, an event, a '
      + 'relationship, or a procedure worth recalling in a later session. Write only what the user '
      + 'affirmed; do not summarize the conversation. Success means the memory was accepted for '
      + 'indexing.',
    parameters: {
      content: { type: 'string', required: true, description: 'The fact, as one self-contained sentence.' },
      kind: {
        type: 'string',
        required: true,
        enum: ['preference', 'fact', 'event', 'relationship', 'procedure'],
        description: 'The category the fact belongs to.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          queued: { type: 'boolean', required: true },
          batchId: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.queued ? 'Memory accepted.' : 'Memory was not accepted.',
      }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new MemoryError('memory_write requires an owning agent session', 'MEMORY_INVALID_REQUEST')
      }
      const result = await ctx.memory.remember({
        sessionId: agent.session.id,
        turn: 0,
        messages: [{ role: 'user', content: args.content }],
        kinds: [args.kind],
      })
      agent.session.append('memory/write', {
        batchId: result.batchId ?? null,
        queued: result.queued,
        origin: 'tool',
        items: [{ content: args.content, kind: args.kind }],
      })
      return result.batchId === undefined
        ? { queued: result.queued }
        : { queued: result.queued, batchId: result.batchId }
    },
  }))

  if (config.enableProfile === true) ctx.tools.register(profileTool(ctx))
  if (config.enableForget !== true) return
  ctx.tools.register(defineTool({
    name: 'memory_forget',
    description: 'Remove a memory the user asked to delete or corrected. Pass an exact memory id '
      + 'from a recall result when you have one.',
    parameters: {
      target: { type: 'string', required: true, description: 'A memory id, or a natural-language selector.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { removed: { type: 'number', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Removed ${String(value.removed)} memories.` }],
    },
    async execute(args, exec) {
      try {
        const result = await ctx.memory.forget({ target: args.target })
        exec.agent?.session.append('memory/forget', { target: args.target, removed: result.removed })
        return result
      } catch (error) {
        if (error instanceof MemoryError) throw error
        throw new MemoryError('memory removal failed', 'MEMORY_UNAVAILABLE', { cause: error })
      }
    },
  }))
}

/** Section names the engine derives from stored memory kinds. */
const PROFILE_SECTIONS = ['basic', 'interests', 'habits', 'emotions'] as const

/**
 * Build the profile tool. It reads what the engine has already concluded about
 * the user rather than searching for it, so the model uses it when the question
 * is "what do you know about me" instead of a topic lookup.
 * @param ctx - the context carrying `tools` and `memory`.
 * @returns the tool definition.
 */
function profileTool(ctx: Context) {
  return defineTool({
    name: 'memory_profile',
    description: 'Read what durable memory already holds about the user, grouped into sections: '
      + 'basic facts, interests, habits, and relationships. Use it when the user asks what you '
      + 'know about them. An empty section means nothing has been stored under it yet.',
    parameters: {
      sections: {
        type: 'array',
        items: { type: 'string', enum: [...PROFILE_SECTIONS] },
        description: 'Sections to read; omit for every supported section.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sections: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: Object.fromEntries(PROFILE_SECTIONS.map(name => [
              name,
              { type: 'array', required: true, items: { type: 'string' } },
            ])),
          },
          degraded: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.degraded
          ? 'Memory is unavailable this turn; you cannot read the stored profile right now.'
          : renderSections(value.sections),
      }],
    },
    async execute(args, exec) {
      const requested = args.sections === undefined || args.sections.length === 0 ? undefined : args.sections
      const result = await ctx.memory.profile(requested === undefined ? {} : { sections: requested })
      const sections = Object.fromEntries(PROFILE_SECTIONS.map(name => [name, [...(result.sections[name] ?? [])]]))
      exec.agent?.session.append('memory/profile', {
        ...requested === undefined ? {} : { sections: requested },
        values: sections,
        degraded: false,
      })
      return { sections, degraded: false }
    },
  })
}

/**
 * Render profile sections as the text the model reads.
 * @param sections - section name to its lines.
 * @returns the presented block, or a notice when every section is empty.
 */
function renderSections(sections: Record<string, readonly string[]>): string {
  const lines = PROFILE_SECTIONS.flatMap((name) => {
    const entries = sections[name] ?? []
    return entries.length === 0 ? [] : [`${name}:`, ...entries.map(entry => `- ${entry}`)]
  })
  return lines.length === 0 ? 'No profile information has been stored yet.' : lines.join('\n')
}
