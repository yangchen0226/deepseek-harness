import type { MemoryScope } from '@deepseek-ai/dsh-memory'
/**
 * Session events owned by the memory integration. Declared here so every
 * consumer — the projection, the client panel, and the persistence catalog —
 * reads one definition.
 * @module @deepseek-ai/dsh-tool-memory/types
 */

/** One recalled memory as it appears in the session log. */
export interface RecalledMemory {
  /** Engine-assigned identity. */
  readonly id: string
  /** The recalled text. */
  readonly content: string
  /** The engine's storage category. */
  readonly kind: string
  /** Relevance score in `[0, 1]`. */
  readonly score: number
}

/** One retrieval step recorded for display. */
export interface RecallStageRecord {
  /** Stage name. */
  readonly stage: string
  /** Items or relations the stage contributed, when it reports a count. */
  readonly count?: number
  /** Milliseconds the stage took, when reported. */
  readonly durationMs?: number
}

/** What produced a recall: the pre-step hook or a model tool call. */
export type RecallOrigin = 'pre-step' | 'tool' | 'native'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One recall request and its outcome. The autosave consumer records the
     * recalled text as a durable `memory-recall` user-message snapshot, so
     * replay reproduces the same model-visible input; tool recalls remain
     * log-only. `degraded: true` records that the turn proceeded without
     * memory.
     */
    'memory/recall': {
      /** Collection addressed by this operation; absent on legacy records. */
      readonly scope?: MemoryScope
      /** The retrieval question that was sent. */
      readonly question: string
      /** Retrieval breadth used. */
      readonly mode: string
      /** Whether a pre-step hook or a model tool call issued it. */
      readonly origin: RecallOrigin
      /** True when the engine could not answer. */
      readonly degraded: boolean
      /** Wall-clock milliseconds the recall took. */
      readonly latencyMs: number
      /** Recalled items in the order the engine ranked them. */
      readonly items: readonly RecalledMemory[]
      /** Retrieval steps in execution order. */
      readonly trace: readonly RecallStageRecord[]
    }

    /**
     * One write batch submitted to the engine. Acceptance only: the engine
     * stores asynchronously, so a record never claims the text is indexed.
     */
    'memory/write': {
      /** Collection addressed by this operation; absent on legacy records. */
      readonly scope?: MemoryScope
      /** Per-batch identity the engine assigned, or null when it reported none. */
      readonly batchId: string | null
      /** True when the engine accepted the batch. */
      readonly queued: boolean
      /** Whether a pre-step hook or a model tool call issued it. */
      readonly origin: RecallOrigin
      /** The submitted items, as the caller wrote them. */
      readonly items: readonly { readonly content: string; readonly kind: string }[]
      /** Why the batch was refused, when `queued` is false. */
      readonly error?: string
    }

    /**
     * The human's per-turn memory switch. Recorded rather than held in client
     * state because it decides whether the turn runs with recalled text, so a
     * replay must reach the same answer the model did. The setting applies to
     * the turn it was made in and is read back as `false` once that turn ends.
     */
    /** Selected adapter capability, sampled before an eligible request. */
    'memory/capability': { readonly nativeAvailable: boolean }

    /** Persistent session memory policy; unchanged by mode or turn transitions. */
    'memory/settings': {
      /** Whether automatic and native memory operations are enabled for this session. */
      readonly enabled: boolean
    }

    /** Legacy override for one turn, retained for historical replay. */
    'memory/mute': {
      /** True when the turn runs without recall and without a write. */
      readonly muted: boolean
      /** What asked for the change; only the input dock offers it today. */
      readonly origin: 'input-dock'
    }

    /** One profile read and the sections it returned. */
    'memory/profile': {
      /** The sections the caller asked for; omitted means every supported one. */
      readonly sections?: readonly string[]
      /** Section name to the lines the engine holds under it. */
      readonly values: Readonly<Record<string, readonly string[]>>
      /** True when the engine could not answer. */
      readonly degraded: boolean
    }

    /** One removal request and what the engine removed. */
    'memory/forget': {
      /** The selector the caller named. */
      readonly target: string
      /** How many items the engine removed. */
      readonly removed: number
    }
  }
}
