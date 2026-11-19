/**
 * The memory panel's Session-bound operations and the outcome each view
 * renders. The plugin body builds one {@link MemoryPanelActions} per Session
 * from `ctx.memoryPanel`; views never see the Remote result or the Session id.
 */
import type {
  MemoryForgetValue,
  MemoryHealthValue,
  MemoryListValue,
  MemoryMuteValue,
  MemoryProfileValue,
} from '@deepseek-ai/dsh-api-memory-controller/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { MemoryScope } from '@deepseek-ai/dsh-memory'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One panel operation's outcome, already classified for rendering. */
export type PanelOutcome<T> =
  | { readonly kind: 'ok'; readonly value: T }
  /** The Session's engine cannot do this at all; the view hides the control. */
  | { readonly kind: 'unsupported' }
  /** The call failed; the view offers a retry. */
  | { readonly kind: 'failed'; readonly message: string }

/** Profile sections the panel can ask for. */
export type ProfileSection = 'basic' | 'interests' | 'habits' | 'emotions'

/** Session-bound panel operations. */
export interface MemoryPanelActions {
  /**
   * Read one page of stored memories.
   * @param request - the optional filter and page size.
   * @returns the classified outcome.
   */
  list(request: { readonly query?: string; readonly limit?: number; readonly page?: number }): Promise<PanelOutcome<MemoryListValue>>
  /**
   * Read profile sections.
   * @returns the classified outcome.
   */
  profile(refresh?: boolean): Promise<PanelOutcome<MemoryProfileValue>>
  /**
   * Remove one stored memory by id.
   * @param id - the entry id.
   * @returns the classified outcome.
   */
  forget(id: string): Promise<PanelOutcome<MemoryForgetValue>>
  /**
   * Switch this turn's memory off or on.
   * @param muted - true to run the turn without recall and without a write.
   * @returns the classified outcome.
   */
  mute(muted: boolean): Promise<PanelOutcome<MemoryMuteValue>>
  /**
   * Ask whether the collection's engine is reachable.
   * @returns the classified outcome; `unsupported` means no engine is bound.
   */
  health(): Promise<PanelOutcome<MemoryHealthValue>>
}

/** The Remote face the actions call, Session id included. */
export interface MemoryPanelRemote {
  list(request: { sessionId?: SessionId; scope?: MemoryScope; query?: string; limit?: number; page?: number }): Promise<RemoteResult<MemoryListValue>>
  profile(request: { sessionId?: SessionId; scope?: MemoryScope; refresh?: boolean }): Promise<RemoteResult<MemoryProfileValue>>
  forget(request: { sessionId?: SessionId; scope?: MemoryScope; target: string }): Promise<RemoteResult<MemoryForgetValue>>
  mute(request: { sessionId: SessionId; muted: boolean }): Promise<RemoteResult<MemoryMuteValue>>
  health(request: { sessionId?: SessionId; scope?: MemoryScope }): Promise<RemoteResult<MemoryHealthValue>>
}

/**
 * Bind the panel operations to one Session.
 * @param remote - the memory panel Remote face.
 * @param sessionId - the Session the panel is open in.
 * @returns the bound operations.
 */
export function bindPanelActions(remote: MemoryPanelRemote, sessionId: SessionId): MemoryPanelActions {
  return {
    list: async request => classify(await remote.list({ sessionId, ...request })),
    profile: async refresh => classify(await remote.profile({ sessionId, ...(refresh === undefined ? {} : { refresh }) })),
    forget: async id => classify(await remote.forget({ sessionId, target: id })),
    mute: async muted => classify(await remote.mute({ sessionId, muted })),
    health: async () => classify(await remote.health({ sessionId })),
  }
}

/**
 * Classify one Remote result for rendering.
 * @param result - the Remote result.
 * @returns the outcome a view switches on.
 */
export function classify<T>(result: RemoteResult<T>): PanelOutcome<T> {
  if (result.ok) return { kind: 'ok', value: result.value }
  if (result.error.code === 'memory/unsupported') return { kind: 'unsupported' }
  return { kind: 'failed', message: result.error.message }
}

/** Bind manual browsing to a collection without activating a session.
 * @param remote - Memory remote operations.
 * @param scope - Explicit collection.
 * @returns Bound browsing actions.
 */
export function bindScopeActions(remote: MemoryPanelRemote, scope: MemoryScope): MemoryPanelActions {
  return {
    list: async request => classify(await remote.list({ scope, ...request })),
    profile: async refresh => classify(await remote.profile({ scope, ...(refresh === undefined ? {} : { refresh }) })),
    forget: async target => classify(await remote.forget({ scope, target })),
    mute: async () => ({ kind: 'unsupported' }),
    health: async () => classify(await remote.health({ scope })),
  }
}
