/**
 * Service Definition for the `ctx.memory` capability seam: durable recall and
 * write of user knowledge that outlives one session log. The MemoryBear
 * implementation lives in `@deepseek-ai/dsh-memory-bear`; consumers — the
 * `memory_*` tools, the pre-step recall, and the client panel — never see the
 * upstream service's vocabulary.
 * @module @deepseek-ai/dsh-memory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  MemoryActivityReader,
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
} from './types.ts'

export type { MemoryCallId, MemoryCallBlock, MemoryResultBlock } from './native.ts'
export { MEMORY_ERROR_CODES, MemoryError, type MemoryErrorCode } from './error.ts'
export type {
  MemoryActivityEntry,
  MemoryActivityId,
  MemoryActivityReader,
  MemoryScope,
  MemoryEntry,
  MemoryForgetRequest,
  MemoryForgetResult,
  MemoryItem,
  MemoryKind,
  MemoryListRequest,
  MemoryListResult,
  MemoryMessage,
  MemoryProfileRequest,
  MemoryProfileResult,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRecallStage,
  MemoryRememberRequest,
  MemoryRememberResult,
  MemoryHealth,
  RecallMode,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryEngine
    memoryActivity: MemoryActivityReader
  }
}

/**
 * Abstract long-term memory engine. Subclass, implement the abstract members,
 * and load the subclass as a plugin — it registers as `ctx.memory` (one
 * implementation per context; loading a second throws, which is cordis'
 * standard duplicate-service behavior).
 *
 * Implementations must honor these semantics:
 * - {@link recall} never throws for an upstream outage. It resolves with
 *   `degraded: true`, an empty `items`, and the elapsed `latencyMs`, because a
 *   turn must proceed without memory. It rejects only for a caller error such
 *   as an empty question.
 * - {@link remember} reports acceptance, not storage. Upstream writes are
 *   asynchronous, so `queued: true` means the engine accepted the batch; no
 *   result claims the batch was stored.
 * - {@link forget} removes only what the engine can address. An unimplemented
 *   backend rejects with `MemoryError('unsupported')` rather than resolving a
 *   no-op result.
 * - Every result is JSON-serializable, so a caller can append it to a session
 *   event unchanged.
 */
export abstract class MemoryEngine extends Service {
  constructor(ctx: Context) {
    super(ctx, 'memory')
  }

  /**
   * Recall durable memories relevant to one question.
   * @param request - the question, the retrieval mode, and an optional limit.
   * @returns matching items with their retrieval trace, or a degraded result.
   */
  abstract recall(request: MemoryRecallRequest): Promise<MemoryRecallResult>

  /**
   * Accept one batch of conversation messages for durable storage.
   * @param request - the messages, their session and turn origin, and the write policy.
   * @returns whether the engine accepted the batch, and any per-batch identity it assigned.
   */
  abstract remember(request: MemoryRememberRequest): Promise<MemoryRememberResult>

  /**
   * Remove memories the caller names.
   * @param request - the selector to remove.
   * @returns what was removed.
   */
  abstract forget(request: MemoryForgetRequest): Promise<MemoryForgetResult>

  /**
   * Read the user's stored profile.
   * @param request - the profile sections to read.
   * @returns the requested sections.
   */
  abstract profile(request: MemoryProfileRequest): Promise<MemoryProfileResult>

  /**
   * List stored memories for browsing rather than for answering a question.
   *
   * A backend that can only retrieve by similarity rejects with
   * `MemoryError('unsupported')` instead of returning an approximate list under
   * a browsing contract, because a caller renders what it receives as "what the
   * engine holds".
   * @param request - an optional filter and limit.
   * @returns stored memories, newest first.
   */
  abstract list(request: MemoryListRequest): Promise<MemoryListResult>

  /**
   * Report whether this provider can remove a stored memory through
   * {@link forget}. Providers must opt in explicitly because the operation is
   * destructive; the default keeps consumers from exposing a control that a
   * backend cannot honor.
   * @returns whether removal is supported by this provider.
   */
  canForget(): boolean {
    return false
  }

  /**
   * Report whether the engine can serve requests.
   * @returns reachability and the resolved scope.
   */
  abstract health(): Promise<MemoryHealth>
}
