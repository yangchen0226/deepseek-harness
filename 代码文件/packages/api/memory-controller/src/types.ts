/**
 * Wire types of the generated `memory` Remote namespace: browsing, profile
 * reads, and removal for the client memory panel. Client-safe: no Host imports.
 *
 * These are panel operations, not model-facing ones. The model reaches memory
 * through the `memory_*` tools, which append session events; a human browsing
 * the panel reads the engine directly and leaves no session event, because
 * nothing it does reaches a model request.
 * @module @deepseek-ai/dsh-api-memory-controller/types
 */

import type { MemoryScope, MemoryActivityEntry } from '@deepseek-ai/dsh-memory'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One stored memory as the panel shows it. */
export interface MemoryPanelEntry {
  /** Engine-assigned identity, used as the removal selector. */
  readonly id: string
  /** The stored text. */
  readonly content: string
  /** The storage category the engine classified it under. */
  readonly kind: string
  /** ISO-8601 creation time, when the engine reports one. */
  readonly createdAt?: string
  /** How many recalls have returned this item, when the engine counts it. */
  readonly hits?: number
}

/** Ask for one page of stored memories. */
export interface MemoryListRequest {
  /** One-based page number; omission selects the first page. */
  readonly page?: number
  /** The Session whose preset supplies the engine. */
  readonly sessionId?: SessionId
  /** Explicit collection for browsing without an open session. */
  readonly scope?: MemoryScope
  /** Substring filter; omitted or empty lists everything. */
  readonly query?: string
  /** Maximum entries to return. */
  readonly limit?: number
}

/** One page of stored memories plus the user's total. */
export interface MemoryListValue {
  /** Entries, newest first. */
  readonly items: readonly MemoryPanelEntry[]
  /** How many the engine holds in total, which can exceed `items.length`. */
  readonly total: number
  /** True when the engine could not answer and the panel must say so. */
  readonly degraded: boolean
  /** True only when the provider explicitly supports removal through `forget`. */
  readonly canForget: boolean
}

/** Ask for the profile sections to show. */
export interface MemoryProfileRequest {
  /** Explicitly regenerate the remote summary before reading it; omission reads cached data. */
  readonly refresh?: boolean
  /** The Session whose preset supplies the engine. */
  readonly sessionId?: SessionId
  /** Explicit collection for browsing without an open session. */
  readonly scope?: MemoryScope
  /** Sections to include; omitted means every supported section. */
  readonly sections?: readonly ('basic' | 'interests' | 'habits' | 'emotions')[]
}

/** The profile sections the engine holds. */
export interface MemoryProfileValue {
  /** Readable lines keyed by section name. */
  readonly sections: Readonly<Record<string, readonly string[]>>
  /** True when the engine could not answer. */
  readonly degraded: boolean
}

/** Remove one memory by its identity or a text selector. */
export interface MemoryForgetRequest {
  /** The Session whose preset supplies the engine. */
  readonly sessionId?: SessionId
  /** Explicit collection for browsing without an open session. */
  readonly scope?: MemoryScope
  /** An entry id, or text the engine resolves. */
  readonly target: string
}

/** What one removal did. */
export interface MemoryForgetValue {
  /** How many entries the engine removed. */
  readonly removed: number
}

/** Ask whether one Session's engine is reachable. */
export interface MemoryHealthRequest {
  /** The Session whose preset supplies the engine. */
  readonly sessionId?: SessionId
  /** Explicit collection for browsing without an open session. */
  readonly scope?: MemoryScope
}

/** Turn the Session's memory off or back on for the turn it applies to. */
export interface MemoryMuteRequest {
  /** The Session whose memory to switch. */
  readonly sessionId: SessionId
  /** True to run the turn without recall and without a write. */
  readonly muted: boolean
}

/** The switch as the Session recorded it. */
export interface MemoryMuteValue {
  /** The state now in effect. */
  readonly muted: boolean
}

/** Engine reachability as the panel header shows it. */
export interface MemoryHealthValue {
  /** True when the engine answered. */
  readonly reachable: boolean
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The configured engine cannot serve this operation at all. */
    'memory/unsupported': { readonly operation: string }
    /** The engine refused the call or could not be reached. */
    'memory/unavailable': { readonly operation: string }
  }
}

/** Read the collection's durable operation history. */
export interface MemoryActivityRequest {
  readonly scope: MemoryScope
  readonly limit?: number
}

/** Newest operations from persisted activity, including write acceptance. */
export interface MemoryActivityValue {
  readonly entries: readonly MemoryActivityEntry[]
}

/** Explicit human-authored addition to one memory collection. */
export interface MemorySaveRequest {
  readonly scope: MemoryScope
  readonly content: string
}

/** Submission outcome; accepted does not assert indexing. */
export interface MemorySaveValue {
  readonly status: 'accepted' | 'failed' | 'unknown'
  readonly batchId?: string
}
