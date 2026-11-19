/**
 * Host memory Remote owner: exposes the `ctx.memory` seam to the client memory
 * panel over the generated `memory` namespace — browsing, profile reads, and
 * removal.
 *
 * The shared engine serves explicit global and workspace collections. Session
 * reads resolve persisted workspace membership; legacy unscoped calls retain
 * the configured legacy identity.
 *
 * These are panel operations. They read and mutate the engine on a human's
 * behalf and append no session event, because nothing they return reaches a
 * model request; the model's own access is the `memory_*` tools, which do log.
 *
 * The seam's degradation contract carries through: a `list` or `profile` that
 * cannot reach the engine answers `degraded: true` with the empty value rather
 * than failing the page, while `forget` rejects — a removal the engine did not
 * confirm must never read as success.
 * @module @deepseek-ai/dsh-api-memory-controller
 */

import { randomUUID } from 'node:crypto'
import type { MemoryActivityId } from '@deepseek-ai/dsh-memory'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { MemoryError } from '@deepseek-ai/dsh-memory'
import type {} from '@deepseek-ai/dsh-workspace'
import type { MemoryEngine, MemoryScope } from '@deepseek-ai/dsh-memory'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-tool-memory/types'
import type {
  MemorySaveRequest,
  MemorySaveValue,
  MemoryActivityRequest,
  MemoryActivityValue,
  MemoryForgetRequest,
  MemoryForgetValue,
  MemoryHealthRequest,
  MemoryHealthValue,
  MemoryListRequest,
  MemoryListValue,
  MemoryMuteRequest,
  MemoryMuteValue,
  MemoryProfileRequest,
  MemoryProfileValue,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host memory Remote namespace owner. */
    memoryController: MemoryController
  }
}

/** Host service backing the generated `ctx.remote.memory` namespace. */
export class MemoryController extends TypertRemoteService {
  static inject = ['agents', 'typert']

  /**
   * @param ctx - Host context carrying the Agent registry.
   */
  constructor(ctx: Context) {
    super(ctx, 'memoryController', { namespace: 'memory' })
  }

  /** Save text explicitly supplied by the human to the selected collection.
   * @param request - Target collection and content.
   * @returns Acceptance or an uncertain submission; never retries a write.
   */
  @Remote('save')
  async save(request: MemorySaveRequest): Promise<MemorySaveValue> {
    const { scope } = this.scopeFor(request)
    if (scope === undefined || request.content.trim().length === 0 || request.content.length > 8192) {
      throw new RemoteError('memory/unsupported', 'Memory content must contain between 1 and 8192 characters', { operation: 'save' })
    }
    const activity = this.ctx.get('memoryActivity')
    if (activity === undefined) throw new RemoteError('memory/unsupported', 'Memory activity is unavailable', { operation: 'save' })
    const engine = this.engineFor(undefined, 'save')
    const id = randomUUID() as MemoryActivityId
    await activity.record({ id, scope, sessionId: '', time: Date.now(), operation: 'write', origin: 'manual',
      status: 'unknown', contents: [request.content.trim()],
    })
    let result: MemorySaveValue
    let detail: string | undefined
    try {
      const value = await engine.remember({ scope, sessionId: `manual-${id}`, turn: 0, messages: [{ role: 'user', content: request.content.trim() }] })
      result = { status: value.queued ? 'accepted' : 'failed', ...(value.batchId === undefined ? {} : { batchId: value.batchId }) }
    } catch (error) {
      result = { status: error instanceof MemoryError && error.code !== 'MEMORY_UNAVAILABLE' ? 'failed' : 'unknown' }
      detail = error instanceof Error ? error.message : String(error)
    }
    await activity.record({ id, scope, sessionId: '', time: Date.now(), operation: 'write', origin: 'manual',
      status: result.status, contents: [request.content.trim()], ...(result.batchId === undefined ? {} : { batchId: result.batchId }),
      ...(detail === undefined ? {} : { error: detail }),
    })
    return result
  }

  /** Read collection activity without opening a session.
   * @param request - Collection and maximum number of entries.
   * @returns Persisted operations, newest first.
   */
  @Remote('activity')
  async activity(request: MemoryActivityRequest): Promise<MemoryActivityValue> {
    this.scopeFor(request)
    const reader = this.ctx.get('memoryActivity')
    if (reader === undefined) throw new RemoteError('memory/unsupported', 'Memory activity is unavailable', { operation: 'activity' })
    const limit = request.limit ?? 100
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RemoteError('memory/unsupported', 'Activity limit must be between 1 and 100', { operation: 'activity' })
    return { entries: await reader.list(request.scope, limit) }
  }

  /**
   * One page of the Session's stored memories, newest first, optionally
   * substring-filtered. A backend that cannot list rejects
   * `memory/unsupported`, so the panel hides the library instead of showing an
   * empty one.
   * @param request - the Session, the optional filter, and the page size.
   * @returns the page and the user's total.
   */
  @Remote('list')
  async list(request: MemoryListRequest): Promise<MemoryListValue> {
    const engine = this.engineFor(request.sessionId, 'list')
    try {
      const result = await engine.list({
        ...this.scopeFor(request),
        ...request.page === undefined ? {} : { page: request.page },
        ...request.query === undefined ? {} : { query: request.query },
        ...request.limit === undefined ? {} : { limit: request.limit },
      })
      return {
        items: result.items,
        total: result.total ?? result.items.length,
        degraded: false,
        canForget: engine.canForget(),
      }
    } catch (error) {
      degradeOrThrow(error, 'list')
      return { items: [], total: 0, degraded: true, canForget: false }
    }
  }

  /**
   * The Session user's profile sections.
   * @param request - the Session and the sections to include.
   * @returns the sections, or a degraded empty set.
   */
  @Remote('profile')
  async profile(request: MemoryProfileRequest): Promise<MemoryProfileValue> {
    const engine = this.engineFor(request.sessionId, 'profile')
    try {
      const result = await engine.profile(
        { ...this.scopeFor(request), ...(request.refresh === undefined ? {} : { refresh: request.refresh }), ...(request.sections === undefined ? {} : { sections: request.sections }) },
      )
      return { sections: result.sections, degraded: false }
    } catch (error) {
      degradeOrThrow(error, 'profile')
      return { sections: {}, degraded: true }
    }
  }

  /**
   * Remove one memory by id or text selector. Unlike the reads, every failure
   * rejects: a removal the engine did not confirm must never render as a
   * deletion that happened.
   * @param request - the Session and the entry id or text the engine resolves.
   * @returns how many entries were removed.
   */
  @Remote('forget')
  async forget(request: MemoryForgetRequest): Promise<MemoryForgetValue> {
    const engine = this.engineFor(request.sessionId, 'forget')
    try {
      const result = await engine.forget({ target: request.target, ...this.scopeFor(request) })
      return { removed: result.removed }
    } catch (error) {
      degradeOrThrow(error, 'forget')
      throw new RemoteError('memory/unavailable', error.message, { operation: 'forget' })
    }
  }

  /**
   * Engine reachability for the panel header.
   * @param request - the Session whose engine to probe.
   * @returns whether the engine answered.
   */
  @Remote('health')
  async health(request: MemoryHealthRequest): Promise<MemoryHealthValue> {
    const result = await this.engineFor(request.sessionId, 'health').health()
    return { reachable: result.reachable }
  }

  /**
   * Persist the Session's memory switch across turns and mode changes.
   * @param request - the Session and the state to record.
   * @returns the state now in effect.
   */
  @Remote('mute')
  mute(request: MemoryMuteRequest): MemoryMuteValue {
    const agent = this.ctx.agents.get(request.sessionId)
    if (agent === undefined) {
      throw new RemoteError(
        'memory/unavailable',
        `session "${request.sessionId}" is not live; open it before switching memory`,
        { operation: 'mute' },
      )
    }
    agent.session.append('memory/settings', { enabled: !request.muted })
    return { muted: request.muted }
  }

  /** Validate an explicit workspace or resolve the session's persisted membership. */
  private scopeFor(request: { sessionId?: SessionId; scope?: MemoryScope }): { scope?: MemoryScope } {
    const registry = this.ctx.get('workspaceRegistry')
    if (request.scope?.kind === 'workspace') {
      const workspaceId = request.scope.workspaceId
      if (!registry?.list().some(workspace => workspace.id === workspaceId)) {
        throw new RemoteError('memory/unsupported', 'Workspace memory is unavailable', { operation: 'scope' })
      }
      return { scope: request.scope }
    }
    if (request.scope !== undefined) return { scope: request.scope }
    const workspace = registry?.list().find(item => request.sessionId !== undefined && item.sessionIds.includes(request.sessionId))
    return workspace === undefined ? {} : { scope: { kind: 'workspace', workspaceId: workspace.id } }
  }

  /**
   * The engine serving one Session: its preset's, else the Host's.
   * @param sessionId - the Session the panel is open in.
   * @param operation - the calling operation, carried on the failure.
   * @returns the engine.
   */
  private engineFor(sessionId: SessionId | undefined, operation: string): MemoryEngine {
    const live = sessionId === undefined ? undefined : this.ctx.agents.get(sessionId)
    const scoped = live === undefined ? undefined : this.ctx.get('agentPresets')?.serviceFor(live, 'memory')
    const engine = scoped ?? this.ctx.get('memory')
    if (engine === undefined) {
      throw new RemoteError(
        'memory/unsupported',
        `session "${sessionId}" has no memory engine; configure the shared memory provider`,
        { operation },
      )
    }
    return engine
  }
}

/**
 * Classify one engine failure for a panel operation. `MEMORY_UNSUPPORTED`
 * becomes `memory/unsupported`; any non-engine failure is a defect and
 * propagates unchanged. Returning means the engine failed in a way the caller
 * may degrade or report as unavailable.
 * @param error - the caught failure.
 * @param operation - the calling operation, carried on the failure.
 */
function degradeOrThrow(error: unknown, operation: string): asserts error is MemoryError {
  if (!(error instanceof MemoryError)) throw error
  if (error.code === 'MEMORY_UNSUPPORTED') {
    throw new RemoteError('memory/unsupported', error.message, { operation })
  }
}

export default MemoryController
