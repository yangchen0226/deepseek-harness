/**
 * MemoryBear provider for the `ctx.memory` capability seam. It owns every
 * upstream concept — API-key scopes, the `/v1` envelope, the asynchronous
 * write backlog, and the end-user binding — so consumers see only
 * `recall`/`remember`/`profile`/`health`.
 *
 * Upstream surface used, and why:
 * - `POST /v1/memory/read/sync` — the only synchronous recall on the API-key
 *   face; returns an `answer` plus per-item `intermediate_outputs`.
 * - `POST /v1/memory/write` — accepts a message batch and returns per-message
 *   task ids without waiting for storage.
 * - `POST /v1/end_user/create` — idempotent on `other_id`; resolves the UUID
 *   every read and write needs.
 *
 * The API-key face exposes no removal, reflection, or working-memory routes,
 * so `forget` rejects with `MEMORY_UNSUPPORTED` rather than pretending to act.
 * @module @deepseek-ai/dsh-memory-bear
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MemoryEngine, MemoryError } from '@deepseek-ai/dsh-memory'
import type {
  MemoryHealth,
  MemoryItem,
  MemoryProfileRequest,
  MemoryProfileResult,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRecallStage,
  MemoryRememberRequest,
  MemoryRememberResult,
  MemoryForgetRequest,
  MemoryForgetResult,
} from '@deepseek-ai/dsh-memory'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'memory-bear'

/** Provider configuration. Every field is required or defaulted here; nothing is read from the environment. */
export interface Config {
  /** MemoryBear origin, e.g. `http://127.0.0.1:8002`. */
  baseUrl: string
  /** API key carrying the `memory` scope. Its workspace is the memory scope. */
  apiKey: string
  /** The dsh-side user identity; MemoryBear resolves it to an end-user UUID once and reuses it. */
  endUserOtherId: string
  /** Upstream request deadline in milliseconds. Recall degradation uses it; other calls reject on expiry. */
  timeoutMs?: number
  /** Upstream copy language for extracted statements. */
  language?: 'zh' | 'en'
}

/** Default upstream deadline. Recall must not hold a turn longer than this. */
const DEFAULT_TIMEOUT_MS = 800

export const Config: z<Config> = z.object({
  baseUrl: z.string().required(),
  apiKey: z.string().role('secret').required(),
  endUserOtherId: z.string().required(),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  language: z.union(['zh', 'en']).default('zh'),
})

/** The `search_switch` values the upstream `SearchStrategy` accepts. */
const SEARCH_SWITCH = {
  deep: 'deep',
  normal: 'normal',
  quick: 'quick',
  express: 'express',
  meta: 'meta',
} as const

/** Upstream `{code, msg, data, error}` envelope. */
interface Envelope<T> {
  readonly code: number
  readonly msg?: string
  readonly data?: T
  readonly error?: string
}

/** One `intermediate_outputs` entry of a read. */
interface ReadOutput {
  readonly id?: string
  readonly content?: string
  readonly source?: string
  readonly score?: number
  readonly query?: string
}

/** `POST /v1/memory/read/sync` payload. */
interface ReadResponse {
  readonly answer?: string
  readonly intermediate_outputs?: readonly ReadOutput[]
}

/** `POST /v1/memory/write` payload. */
interface WriteResponse {
  readonly task_ids?: readonly string[]
  readonly end_user_id?: string
}

/** `POST /v1/end_user/create` payload. */
interface EndUserResponse {
  readonly id?: string
  readonly other_id?: string
}

/** Upstream codes that mean the credential or quota cannot serve this call. */
const UNAVAILABLE_CODES = new Set([3009, 3012, 3014, 3015, 3016, 3017])
/** Upstream codes that mean the named end user does not exist. */
const MISSING_USER_CODES = new Set([4001])

/**
 * Translate one upstream error code into the seam's failure class.
 * @param code - the upstream envelope code.
 * @returns the matching error code.
 */
function classify(code: number): 'MEMORY_UNAVAILABLE' | 'MEMORY_UPSTREAM_REJECTED' | 'MEMORY_INVALID_REQUEST' {
  if (UNAVAILABLE_CODES.has(code)) return 'MEMORY_UNAVAILABLE'
  if (MISSING_USER_CODES.has(code)) return 'MEMORY_UPSTREAM_REJECTED'
  return 'MEMORY_INVALID_REQUEST'
}

/**
 * MemoryBear-backed memory engine.
 *
 * The end-user UUID is resolved lazily and cached for the life of the plugin
 * fiber; a failed resolution is not cached, so the next call retries.
 */
export class MemoryBearEngine extends MemoryEngine {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly otherId: string
  private readonly timeoutMs: number
  private readonly language: NonNullable<Config['language']>
  private endUserId: string | undefined

  /**
   * @param ctx - the context the service registers on.
   * @param config - resolved provider configuration.
   */
  constructor(ctx: Context, config: Required<Pick<Config, 'baseUrl' | 'apiKey' | 'endUserOtherId'>> & Config) {
    super(ctx)
    this.baseUrl = config.baseUrl.replace(/\/+$/u, '')
    this.apiKey = config.apiKey
    this.otherId = config.endUserOtherId
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.language = config.language ?? 'zh'
  }

  async recall(request: MemoryRecallRequest): Promise<MemoryRecallResult> {
    if (request.question.trim().length === 0) {
      throw new MemoryError('memory recall needs a non-empty question', 'MEMORY_INVALID_REQUEST')
    }
    const started = Date.now()
    try {
      const endUserId = await this.resolveEndUser()
      const body = await this.post<ReadResponse>('/v1/memory/read/sync', {
        message: request.question,
        search_switch: SEARCH_SWITCH[request.mode],
        end_user_id: endUserId,
        enable_rerank: false,
      })
      const outputs = body.intermediate_outputs ?? []
      const items: readonly MemoryItem[] = outputs.map((output, index) => ({
        id: output.id ?? `bear-${String(index)}`,
        content: output.content ?? '',
        kind: output.source ?? 'unknown',
        score: output.score ?? 0,
        query: output.query ?? request.question,
        source: output.source ?? 'unknown',
      }))
      const trace: readonly MemoryRecallStage[] = [
        { stage: 'requested', count: 1 },
        { stage: 'results_merged', count: items.length },
      ]
      return { items, trace, degraded: false, latencyMs: Date.now() - started }
    } catch (error) {
      if (error instanceof MemoryError && error.code === 'MEMORY_INVALID_REQUEST') throw error
      return { items: [], trace: [], degraded: true, latencyMs: Date.now() - started }
    }
  }

  async remember(request: MemoryRememberRequest): Promise<MemoryRememberResult> {
    if (request.messages.length === 0) {
      throw new MemoryError('memory write needs at least one message', 'MEMORY_INVALID_REQUEST')
    }
    const endUserId = await this.resolveEndUser()
    const body = await this.post<WriteResponse>('/v1/memory/write', {
      messages: request.messages.map(message => ({
        role: message.role,
        content: message.content,
        ...(message.at === undefined ? {} : { dialog_at: message.at }),
      })),
      end_user_id: endUserId,
      conversation_id: request.sessionId,
    })
    const batchId = body.task_ids?.[0]
    return batchId === undefined ? { queued: true } : { queued: true, batchId }
  }

  forget(_request: MemoryForgetRequest): Promise<MemoryForgetResult> {
    return Promise.reject(new MemoryError(
      'this memory backend exposes no removal on its API-key surface; remove the item from the memory panel instead',
      'MEMORY_UNSUPPORTED',
    ))
  }

  profile(_request: MemoryProfileRequest): Promise<MemoryProfileResult> {
    return Promise.reject(new MemoryError(
      'profile reads need the MemoryBear management surface, which this provider does not configure',
      'MEMORY_UNSUPPORTED',
    ))
  }

  async health(): Promise<MemoryHealth> {
    try {
      const endUserId = await this.resolveEndUser()
      return { reachable: true, endUserId }
    } catch {
      return { reachable: false }
    }
  }

  /**
   * Resolve the upstream end-user UUID for the configured `other_id`, creating
   * it on first use. `POST /v1/end_user/create` is idempotent on `other_id`.
   * @returns the upstream UUID.
   */
  private async resolveEndUser(): Promise<string> {
    if (this.endUserId !== undefined) return this.endUserId
    const body = await this.post<EndUserResponse>('/v1/end_user/create', {
      other_id: this.otherId,
      other_name: this.otherId,
    })
    const id = body.id
    if (typeof id !== 'string' || id.length === 0) {
      throw new MemoryError('memory backend returned no end-user id', 'MEMORY_UPSTREAM_REJECTED')
    }
    this.endUserId = id
    return id
  }

  /**
   * Send one JSON request and unwrap the upstream envelope.
   * @param path - the absolute path, beginning with `/v1`.
   * @param payload - the JSON body.
   * @returns the envelope's `data`.
   */
  private async post<T>(path: string, payload: unknown): Promise<T> {
    const signal = AbortSignal.timeout(this.timeoutMs)
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          'x-language-type': this.language,
        },
        body: JSON.stringify(payload),
        signal,
      })
    } catch (error) {
      throw new MemoryError(`memory backend unreachable at ${path}`, 'MEMORY_UNAVAILABLE', { cause: error })
    }
    if (!response.ok) {
      throw new MemoryError(
        `memory backend answered ${String(response.status)} at ${path}`,
        response.status === 401 || response.status === 403 ? 'MEMORY_UNAVAILABLE' : 'MEMORY_UPSTREAM_REJECTED',
      )
    }
    const envelope = await response.json() as Envelope<T>
    if (envelope.code !== 0) {
      throw new MemoryError(
        `memory backend rejected ${path}: ${envelope.error ?? envelope.msg ?? `code ${String(envelope.code)}`}`,
        classify(envelope.code),
      )
    }
    return envelope.data as T
  }
}

/**
 * Plugin body: replace the seam's implementation with the MemoryBear engine.
 * @param ctx - the context to register on.
 * @param config - validated provider configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = Config(config) as Config & Required<Pick<Config, 'baseUrl' | 'apiKey' | 'endUserOtherId'>>
  ctx.memory = new MemoryBearEngine(ctx, resolved)
}
