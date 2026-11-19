/**
 * Session projection declared by the memory autosave consumer. The client
 * memory panel's recall view reads it instead of replaying events itself.
 * @module @deepseek-ai/dsh-memory-autosave/types
 */

import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection'

/** One text message collected during the open turn. */
export interface TurnMessage {
  /** Who produced it. */
  readonly role: 'user' | 'assistant'
  /** The message text. */
  readonly content: string
}

/** One retrieval step recorded for display. */
export interface RecallStage {
  /** Stage name, e.g. `requested`, `results_merged`. */
  readonly stage: string
  /** Items or relations the stage contributed, when it reports a count. */
  readonly count?: number | undefined
  /** Milliseconds the stage took, when reported. */
  readonly durationMs?: number | undefined
}

/** Autosave projection state: the last recall, and the text collected in the open turn. */
export interface MemoryAutosaveState {
  /** Whether the latest selected adapter supports native memory blocks. */
  readonly nativeAvailable?: boolean | undefined
  /** Most recent recorded write outcome; absent before the first write. */
  readonly lastWrite?: { readonly queued: boolean; readonly contents: readonly string[] } | undefined
  /** The newest recall in this session, or null before the first one. */
  readonly lastRecall: {
    readonly question: string
    readonly mode: string
    readonly degraded: boolean
    readonly latencyMs: number
    readonly items: readonly TurnMessage[]
    readonly trace: readonly RecallStage[]
  } | null
  /** User and assistant text appended since the last `turn/start`, in order. */
  readonly turnText: readonly TurnMessage[]
  /** True while persistent session policy or a legacy per-turn override disables memory. */
  readonly muted: boolean
  /** The turn the armed switch applied to, or null when no turn was muted. */
  readonly mutedTurn: number | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Memory state the session window renders: the last recall (question and
     * recalled texts) and the text collected in the open turn for the write
     * path. Reset per turn; excluded from Session summaries.
     */
    memoryAutosave: SessionProjectionSummaryExcluded<MemoryAutosaveState>
  }
}
