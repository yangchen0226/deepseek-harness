/**
 * Host memory Remote owner: exposes the `ctx.memory` seam to the client memory
 * panel over the generated `memory` namespace — browsing, profile reads, and
 * removal.
 *
 * The engine is a per-session resource. The `memory` preset mounts its
 * provider inside the Agent's isolated preset group, so each call names its
 * Session and this service reads the engine from that Agent's composition; a
 * Host-level `ctx.memory` serves only when the Session's preset supplies none.
 * A Session with no engine at all rejects `memory/unsupported`.
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

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { MemoryError } from '@deepseek-ai/dsh-memory'
import type { MemoryEngine } from '@deepseek-ai/dsh-memory'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-tool-memory/types'
import type {
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
        ...request.query === undefined ? {} : { query: request.query },
        ...request.limit === undefined ? {} : { limit: request.limit },
      })
      return { items: result.items, total: result.total ?? result.items.length, degraded: false }
    } catch (error) {
      degradeOrThrow(error, 'list')
      return { items: [], total: 0, degraded: true }
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
        request.sections === undefined ? {} : { sections: request.sections },
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
      const result = await engine.forget({ target: request.target })
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
   * Switch the Session's memory off or on for the turn it applies to.
   *
   * The setting is a session event, not client state: it decides whether the
   * turn runs with recalled text, so the log must reproduce the same answer the
   * model saw. An armed switch applies to the turn that starts next when set
   * between turns, and stops the remainder of the current turn when set during
   * one; the autosave projection retires it after that turn.
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
    agent.session.append('memory/mute', { muted: request.muted, origin: 'input-dock' })
    return { muted: request.muted }
  }

  /**
   * The engine serving one Session: its preset's, else the Host's.
   * @param sessionId - the Session the panel is open in.
   * @param operation - the calling operation, carried on the failure.
   * @returns the engine.
   */
  private engineFor(sessionId: SessionId, operation: string): MemoryEngine {
    const live = this.ctx.agents.get(sessionId)
    const scoped = live === undefined ? undefined : this.ctx.get('agentPresets')?.serviceFor(live, 'memory')
    const engine = scoped ?? this.ctx.get('memory')
    if (engine === undefined) {
      throw new RemoteError(
        'memory/unsupported',
        `session "${sessionId}" has no memory engine; select the Memory preset to enable it`,
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
