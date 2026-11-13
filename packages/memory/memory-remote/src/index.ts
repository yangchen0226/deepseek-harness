/**
 * Remote implementation of the `ctx.memory` seam over an HTTP memory service
 * (`deploy/memory-service`). The service owns the database and the search
 * ranking; this provider owns transport, the caller identity, and degradation.
 *
 * It is deliberately service-agnostic: any HTTP endpoint implementing the same
 * five routes works, so a self-hosted deployment needs no code change here.
 * @module @deepseek-ai/dsh-memory-remote
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MemoryEngine, MemoryError } from '@deepseek-ai/dsh-memory'
import type {
  MemoryForgetRequest,
  MemoryForgetResult,
  MemoryHealth,
  MemoryItem,
  MemoryProfileRequest,
  MemoryProfileResult,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRecallStage,
  MemoryRememberRequest,
  MemoryRememberResult,
} from '@deepseek-ai/dsh-memory'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'memory-remote'

/** Provider configuration. */
export interface Config {
  /** Base URL of the memory service, without a trailing route. */
  serviceUrl: string
  /** Bearer token the service accepts. */
  token: string
  /** Workspace scope the service partitions memories by. */
  workspaceId?: string
  /** External user identity; the service resolves it to a durable user row. */
  endUserOtherId: string
  /** Request deadline in milliseconds. A recall that exceeds it degrades. */
  timeoutMs?: number
}

/** Default upstream deadline. Recall must not hold a turn longer than this. */
const DEFAULT_TIMEOUT_MS = 1500

export const Config: z<Config> = z.object({
  serviceUrl: z.string().required(),
  token: z.string().role('secret').required(),
  workspaceId: z.string().default('default'),
  endUserOtherId: z.string().required(),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
})

/** One recalled item as the service returns it. */
interface RemoteItem {
  readonly id?: string
  readonly content?: string
  readonly kind?: string
  readonly score?: number
  readonly query?: string
  readonly source?: string
}

/** The recall route's payload. */
interface RemoteRecall {
  readonly items?: readonly RemoteItem[]
  readonly trace?: readonly MemoryRecallStage[]
  readonly degraded?: boolean
  readonly latencyMs?: number
}

/** A memory engine backed by an HTTP service. */
export class RemoteMemoryEngine extends MemoryEngine {
  private readonly serviceUrl: string
  private readonly token: string
  private readonly workspaceId: string
  private readonly otherId: string
  private readonly timeoutMs: number

  /**
   * @param ctx - the context the service registers on.
   * @param config - validated provider configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.serviceUrl = config.serviceUrl.replace(/\/+$/u, '')
    this.token = config.token
    this.workspaceId = config.workspaceId ?? 'default'
    this.otherId = config.endUserOtherId
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async recall(request: MemoryRecallRequest): Promise<MemoryRecallResult> {
    if (request.question.trim().length === 0) {
      throw new MemoryError('memory recall needs a non-empty question', 'MEMORY_INVALID_REQUEST')
    }
    const started = Date.now()
    try {
      const body = await this.call<RemoteRecall>('recall', {
        question: request.question,
        mode: request.mode,
        ...request.limit === undefined ? {} : { limit: request.limit },
      })
      const items: MemoryItem[] = (body.items ?? []).map((item, index) => ({
        id: item.id ?? `remote-${String(index)}`,
        content: item.content ?? '',
        kind: item.kind ?? 'unknown',
        score: typeof item.score === 'number' ? item.score : 0,
        query: item.query ?? request.question,
        source: item.source ?? 'remote',
      }))
      return {
        items,
        trace: (body.trace ?? []).map(stage => ({ ...stage })),
        degraded: body.degraded === true,
        latencyMs: typeof body.latencyMs === 'number' ? body.latencyMs : Date.now() - started,
      }
    } catch (error) {
      if (error instanceof MemoryError && error.code === 'MEMORY_INVALID_REQUEST') throw error
      return { items: [], trace: [], degraded: true, latencyMs: Date.now() - started }
    }
  }

  async remember(request: MemoryRememberRequest): Promise<MemoryRememberResult> {
    if (request.messages.length === 0) {
      throw new MemoryError('memory write needs at least one message', 'MEMORY_INVALID_REQUEST')
    }
    const body = await this.call<{ queued?: boolean; batchId?: string }>('remember', {
      sessionId: request.sessionId,
      turn: request.turn,
      messages: request.messages.map(message => ({ role: message.role, content: message.content })),
      ...request.kinds === undefined ? {} : { kinds: [...request.kinds] },
    })
    return body.batchId === undefined
      ? { queued: body.queued === true }
      : { queued: body.queued === true, batchId: body.batchId }
  }

  async forget(request: MemoryForgetRequest): Promise<MemoryForgetResult> {
    const body = await this.call<{ removed?: number }>('forget', { target: request.target })
    return { removed: body.removed ?? 0 }
  }

  async profile(request: MemoryProfileRequest): Promise<MemoryProfileResult> {
    const body = await this.call<{ sections?: Record<string, string[]> }>('profile', {
      ...request.sections === undefined ? {} : { sections: [...request.sections] },
    })
    return { sections: body.sections ?? {} }
  }

  async health(): Promise<MemoryHealth> {
    try {
      const body = await this.call<{ reachable?: boolean; endUserId?: string }>('health', {})
      const id = body.endUserId
      return body.reachable === true
        ? (id === undefined ? { reachable: true } : { reachable: true, endUserId: id })
        : { reachable: false }
    } catch {
      return { reachable: false }
    }
  }

  /**
   * POST one route and decode its JSON body.
   * @param route - the route name appended to the service URL.
   * @param payload - the JSON body.
   * @returns the decoded response.
   */
  private async call<T>(route: string, payload: unknown): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.serviceUrl}/${route}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`,
          'x-workspace-id': this.workspaceId,
          'x-end-user-other-id': this.otherId,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new MemoryError(`memory service unreachable at ${route}`, 'MEMORY_UNAVAILABLE', { cause: error })
    }
    if (!response.ok) {
      const retryable = response.status === 401 || response.status === 403 || response.status >= 500
      throw new MemoryError(
        `memory service answered ${String(response.status)} at ${route}`,
        retryable ? 'MEMORY_UNAVAILABLE' : 'MEMORY_UPSTREAM_REJECTED',
      )
    }
    return await response.json() as T
  }
}

/**
 * Plugin body: install the remote engine as `ctx.memory`.
 * @param ctx - the context to register on.
 * @param config - validated provider configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.memory = new RemoteMemoryEngine(ctx, config)
}
