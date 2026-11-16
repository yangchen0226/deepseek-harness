/**
 * In-session agent creation over the agent-preset registry. The model calls
 * `memory_agent_create`; the tool composes a preset from the deployment's own
 * memory provider settings plus the requested persona and skill set, registers
 * it, and reports the new preset id.
 *
 * Two boundaries are deliberate:
 * - Provider credentials never pass through the model. They come from this
 *   plugin's own configuration and are copied into the created preset.
 * - Registration is process-local. The created preset survives for the life of
 *   this plugin fiber and is removed when the plugin disposes; persisting it
 *   belongs to an editor surface, not to a model tool.
 * @module @deepseek-ai/dsh-memory-agent
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One agent preset created from a conversation. Log-only: the preset lives
     * in the process for the life of the creating plugin, and this record is
     * what lets the transcript and the client roster explain where it came from.
     */
    'memory/agent-created': {
      /** The created preset id. */
      readonly id: string
      /** The display name the user asked for. */
      readonly name: string
    }
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'memory-agent'

/** The registries these tools consume. */
export const inject = ['tools', 'agentPresets']

/** Deployment configuration; the provider block is never model-visible. */
export interface Config {
  /** MemoryBear settings copied into every created preset. */
  provider: {
    /** MemoryBear origin, e.g. `https://cloud.memorybear.ai`. */
    baseUrl: string
    /** API key carrying the `memory` scope; its workspace is the memory scope. */
    apiKey: string
    /** The memory identity every created agent shares. */
    endUserOtherId: string
    /** Upstream request deadline in milliseconds. */
    timeoutMs?: number
  }
  /** Recall breadth the created preset uses automatically. */
  recallMode?: 'deep' | 'normal' | 'quick' | 'express' | 'meta'
  /** Order prefix for created presets, keeping them below the shipped ones. */
  presetOrder?: number
}

export const Config: z<Config> = z.object({
  provider: z.object({
    baseUrl: z.string().required(),
    apiKey: z.string().role('secret').required(),
    endUserOtherId: z.string().required(),
    timeoutMs: z.number().default(8000),
  }).required(),
  recallMode: z.union(['deep', 'normal', 'quick', 'express', 'meta']).default('quick'),
  presetOrder: z.number().default(90),
})

/**
 * Turn a requested display name into a stable preset id.
 * @param wanted - the name the user asked for.
 * @returns a lower-kebab id safe for a preset key.
 */
function presetId(wanted: string): string {
  const slug = wanted.trim().toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return `agent-${slug === '' ? 'unnamed' : slug}`
}

/**
 * The persona instructions for a created agent.
 * @param name - the display name.
 * @param instructions - what the user asked this agent to focus on.
 * @returns the prefix text.
 */
function persona(name: string, instructions: string): string {
  return `You are ${name}, an agent focused on: ${instructions}. `
    + 'You have durable memory across sessions. Consult recalled memories before asking the user '
    + 'to repeat themselves, and record a fact only when the user states it plainly and it will '
    + 'matter later.'
}

/**
 * Register the creation tool.
 * @param ctx - the context carrying the tool runtime and the preset registry.
 * @param config - deployment provider settings and preset defaults.
 */
export function apply(ctx: Context, config: Config): void {
  const created = new Map<string, () => Promise<void>>()
  ctx.effect(() => () => {
    for (const unregister of created.values()) void unregister()
    created.clear()
  }, 'memory-agent: created presets')

  ctx.tools.register(defineTool({
    name: 'memory_agent_create',
    description: 'Create a new durable agent with its own memory: a focused persona, the memory '
      + 'tools, and automatic recall before each turn. Use it when the user asks for a lasting '
      + 'assistant for one area of work. The created agent appears in the agent-preset roster and '
      + 'can be started immediately; it lasts until the host restarts.',
    parameters: {
      name: { type: 'string', required: true, description: 'A short display name for the agent.' },
      instructions: { type: 'string', required: true, description: 'What this agent should focus on, in one or two sentences.' },
      recall_mode: {
        type: 'string',
        enum: ['deep', 'normal', 'quick', 'express', 'meta'],
        description: 'Retrieval breadth for the agent’s automatic recall.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Created agent "${value.name}" (preset ${value.id}). It is selectable in the agent roster now.`,
      }],
    },
    async execute(args, exec) {
      const id = presetId(args.name)
      if (created.has(id)) {
        throw new Error(`an agent named ${JSON.stringify(args.name)} already exists; pick another name`)
      }
      const definition: PresetDefinition = {
        id,
        name: args.name,
        description: args.instructions,
        ...config.presetOrder === undefined ? {} : { order: config.presetOrder },
        plugins: [
          { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: persona(args.name, args.instructions) } },
          // The provider publishes `memory` into this group's isolated realm, and the
          // registry rejects a preset whose service leaks into the root realm.
          {
            id: 'memory',
            name: 'cordis:group',
            group: true,
            isolate: { memory: true },
            config: [
              {
                id: 'memory-bear',
                name: '@deepseek-ai/dsh-memory-bear',
                config: {
                  baseUrl: config.provider.baseUrl,
                  apiKey: config.provider.apiKey,
                  endUserOtherId: config.provider.endUserOtherId,
                  timeoutMs: config.provider.timeoutMs ?? 8000,
                },
              },
              {
                id: 'tool-memory',
                name: '@deepseek-ai/dsh-tool-memory',
                config: { defaultMode: args.recall_mode ?? config.recallMode ?? 'quick' },
              },
              {
                id: 'memory-autosave',
                name: '@deepseek-ai/dsh-memory-autosave',
                config: {
                  recallMode: args.recall_mode ?? config.recallMode ?? 'quick',
                  recallOnTurnStart: true,
                  writeOnTurnEnd: true,
                },
              },
            ],
          },
          { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
          { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: { __jsExpr: "process.platform === 'win32'" } },
          { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', disabled: { __jsExpr: "process.platform !== 'win32'" } },
          { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs', config: { applyPatch: false } },
          { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search' },
          { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
        ],
      }
      const unregister = await ctx.agentPresets.register(definition)
      created.set(id, unregister)
      exec.agent?.session.append('memory/agent-created', { id, name: args.name })
      return { id, name: args.name }
    },
  }))
}
