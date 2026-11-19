/**
 * Wire types of the `ctx.memory` capability seam. Consumers append recall and
 * write results to session events, so every type here is JSON-serializable.
 * @module @deepseek-ai/dsh-memory/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Explicit user collection; omitted scopes address only the legacy collection. */
export type MemoryScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'workspace'; readonly workspaceId: WorkspaceId }

/** Retrieval breadth. `deep` and `normal` summarize; `quick` and `express` return raw items. */
export type RecallMode = 'deep' | 'normal' | 'quick' | 'express' | 'meta'

/** The durable categories a write may declare. */
export type MemoryKind = 'preference' | 'fact' | 'event' | 'relationship' | 'procedure'

/** One recalled memory. */
export interface MemoryItem {
  /** Engine-assigned identity, stable for this item's lifetime. */
  readonly id: string
  /** The recalled text. */
  readonly content: string
  /** The storage category the engine classified it under. */
  readonly kind: string
  /** Relevance score in `[0, 1]`. */
  readonly score: number
  /** The question that produced this item. */
  readonly query: string
  /** Engine-specific source label a consumer may display but must not interpret. */
  readonly source: string
}

/** One step of a recall's retrieval trace, in the order the engine performed it. */
export interface MemoryRecallStage {
  /** Stage name, e.g. `profile_loaded`, `hybrid_searched`, `results_merged`. */
  readonly stage: string
  /** Items or relations this stage contributed, when it reports a count. */
  readonly count?: number
  /** Milliseconds this stage took, when the engine reports it. */
  readonly durationMs?: number
}

/** The outcome of one recall. */
export interface MemoryRecallResult {
  /** Matching items, highest score first. Empty when degraded. */
  readonly items: readonly MemoryItem[]
  /** Retrieval steps in execution order. */
  readonly trace: readonly MemoryRecallStage[]
  /** True when the engine could not answer and the caller must proceed without memory. */
  readonly degraded: boolean
  /** Wall-clock milliseconds the recall took, including upstream latency. */
  readonly latencyMs: number
}

/** One recall request. */
export interface MemoryRecallRequest {
  /** Collection to access; omission preserves the legacy user collection. */
  readonly scope?: MemoryScope
  /** The retrieval question, rewritten to carry keywords and context. */
  readonly question: string
  /** Retrieval breadth the caller wants. */
  readonly mode: RecallMode
  /** The turn the question belongs to, for trace correlation. */
  readonly turn: number
  /** Maximum items to return; the engine's own cap applies when omitted. */
  readonly limit?: number
}

/** One listing request. */
export interface MemoryListRequest {
  /** One-based page number; omission selects the first page. */
  readonly page?: number
  /** Collection to access; omission preserves the legacy user collection. */
  readonly scope?: MemoryScope
  /** Free-text filter; an empty or omitted value lists everything. */
  readonly query?: string
  /** Maximum items to return; the engine's own cap applies when omitted. */
  readonly limit?: number
}

/** One stored memory as a browsing caller sees it. */
export interface MemoryEntry {
  /** Engine-assigned identity. */
  readonly id: string
  /** The stored text. */
  readonly content: string
  /** The storage category the engine classified it under. */
  readonly kind: string
  /** ISO-8601 creation time, when the engine reports one. */
  readonly createdAt?: string
  /** How many times a recall returned this item, when the engine counts it. */
  readonly hits?: number
}

/** The outcome of one listing. */
export interface MemoryListResult {
  /** Stored memories, newest first. */
  readonly items: readonly MemoryEntry[]
  /** Total the engine holds for this user, which may exceed `items.length`. */
  readonly total?: number
}

/** One message submitted for durable storage. */
export interface MemoryMessage {
  /** Who produced the message. */
  readonly role: 'user' | 'assistant'
  /** The message text. */
  readonly content: string
  /** ISO-8601 production time, when known. */
  readonly at?: string
}

/** One accepted write batch. */
export interface MemoryRememberRequest {
  /** Collection to access; omission preserves the legacy user collection. */
  readonly scope?: MemoryScope
  /** The session the messages came from. */
  readonly sessionId: string
  /** The turn that produced them. */
  readonly turn: number
  /** Messages in conversation order. */
  readonly messages: readonly MemoryMessage[]
  /** What the caller believes the batch is about; the engine may reclassify. */
  readonly kinds?: readonly MemoryKind[]
}

/** The outcome of one write submission. */
export interface MemoryRememberResult {
  /** True when the engine accepted the batch for eventual storage. */
  readonly queued: boolean
  /** Per-batch identity the engine assigned, when it reports one. */
  readonly batchId?: string
}

/** What to remove. */
export interface MemoryForgetRequest {
  /** Collection to access; omission preserves the legacy user collection. */
  readonly scope?: MemoryScope
  /** An engine item id, or a natural-language selector the engine resolves. */
  readonly target: string
}

/** The outcome of one removal. */
export interface MemoryForgetResult {
  /** How many items the engine removed. */
  readonly removed: number
}

/** Which profile sections to read. */
export interface MemoryProfileRequest {
  /** Explicitly regenerate the remote summary before reading it; omission reads cached data. */
  readonly refresh?: boolean
  /** Collection to access; omission preserves the legacy user collection. */
  readonly scope?: MemoryScope
  /** Sections to include; omitted means every supported section. */
  readonly sections?: readonly ('basic' | 'interests' | 'habits' | 'emotions')[]
}

/** The outcome of one profile read. */
export interface MemoryProfileResult {
  /** Readable sections keyed by section name. */
  readonly sections: Readonly<Record<string, readonly string[]>>
}

/** Engine reachability and the scope it resolved. */
export interface MemoryHealth {
  /** True when the engine answered its own health probe. */
  readonly reachable: boolean
  /** The end-user identity the engine resolved for this workspace, when bound. */
  readonly endUserId?: string
}

/** Stable identity of one recorded memory operation. */
export type MemoryActivityId = Branded<'MemoryActivityId'>

/** A completed read or a submitted write, never an assertion of remote indexing. */
export interface MemoryActivityEntry {
  readonly id: MemoryActivityId
  readonly scope: MemoryScope
  readonly sessionId: string
  readonly time: number
  readonly operation: 'recall' | 'write'
  readonly status: 'completed' | 'accepted' | 'failed' | 'unknown'
  /** Operation initiator; absent on older index entries. */
  readonly origin?: 'automatic' | 'native' | 'manual' | undefined
  /** Recall question, when recorded. */
  readonly question?: string | undefined
  /** Failure detail, when recorded. */
  readonly error?: string | undefined
  readonly contents: readonly string[]
  readonly batchId?: string | undefined
}

/** Cross-session query over the durable memory audit index. */
export interface MemoryActivityReader {
  /** Persist a manual operation independently of a chat.
   * @param entry - Operation outcome, with a stable id.
   * @returns Completion after durable storage.
   */
  record(entry: MemoryActivityEntry): Promise<void>
  /** Read newest entries in one collection.
   * @param scope - Collection to inspect.
   * @param limit - Maximum number of entries.
   * @returns Persisted operations, newest first.
   */
  list(scope: MemoryScope, limit: number): Promise<readonly MemoryActivityEntry[]>
}
