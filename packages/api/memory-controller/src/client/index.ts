/**
 * Memory panel Remote namespace, client half: one `ctx.memoryPanel` service
 * wrapping the generated `memory` namespace.
 *
 * The service exists so UI code never reaches into `ctx.remote.memory` on a
 * caller stack — a React event, a carrier retry — whose dynamic context has not
 * declared the namespace. Each method is a thin passthrough; presentation and
 * error wording belong to the panel, not here.
 * @module @deepseek-ai/dsh-api-memory-controller/client
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: the Gateway's `ctx.remote` Context merge.
import type {} from '@deepseek-ai/dsh-api-gateway/client'
// Type-only: the generated `memory` namespace on `ctx.remote`.
import type {} from '@deepseek-ai/dsh-api-memory-controller/remote'
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
} from '../types.ts'

export type * from '../types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The memory panel's Remote face. */
    memoryPanel: MemoryPanel
  }
}

/** Client service over the generated `memory` namespace. */
export class MemoryPanel extends Service {
  private readonly remote: {
    list(request: MemoryListRequest): Promise<RemoteResult<MemoryListValue>>
    profile(request: MemoryProfileRequest): Promise<RemoteResult<MemoryProfileValue>>
    forget(request: MemoryForgetRequest): Promise<RemoteResult<MemoryForgetValue>>
    health(request: MemoryHealthRequest): Promise<RemoteResult<MemoryHealthValue>>
    mute(request: MemoryMuteRequest): Promise<RemoteResult<MemoryMuteValue>>
  }

  /**
   * @param ctx - Client root Context.
   * @param remote - the generated `memory` namespace face.
   */
  constructor(ctx: Context, remote: MemoryPanel['remote']) {
    super(ctx, 'memoryPanel')
    this.remote = remote
  }

  /**
   * Read one page of stored memories.
   * @param request - the optional filter and page size.
   * @returns the page, or the Remote failure the panel renders.
   */
  list(request: MemoryListRequest): Promise<RemoteResult<MemoryListValue>> {
    return this.remote.list(request)
  }

  /**
   * Read the user's profile sections.
   * @param request - the sections to include.
   * @returns the sections, or the Remote failure the panel renders.
   */
  profile(request: MemoryProfileRequest): Promise<RemoteResult<MemoryProfileValue>> {
    return this.remote.profile(request)
  }

  /**
   * Remove one memory.
   * @param request - the entry id or text selector.
   * @returns how many entries were removed, or the Remote failure.
   */
  forget(request: MemoryForgetRequest): Promise<RemoteResult<MemoryForgetValue>> {
    return this.remote.forget(request)
  }

  /**
   * Switch this Session's memory off or on for the turn it applies to.
   * @param request - the Session and the state to record.
   * @returns the state now in effect, or the Remote failure.
   */
  mute(request: MemoryMuteRequest): Promise<RemoteResult<MemoryMuteValue>> {
    return this.remote.mute(request)
  }

  /**
   * Read engine reachability.
   * @param request - the Session whose engine to probe.
   * @returns whether the engine answered.
   */
  health(request: MemoryHealthRequest): Promise<RemoteResult<MemoryHealthValue>> {
    return this.remote.health(request)
  }
}

/** Required Client Remote services. */
export const inject = ['remote', 'remote.memory']

/**
 * Install the memory panel service.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  // Read the namespace now, not inside a component: see the module JSDoc.
  const { memory } = ctx.remote
  new MemoryPanel(ctx, memory)
}
