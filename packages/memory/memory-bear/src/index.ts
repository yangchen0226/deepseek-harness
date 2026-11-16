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
 * - `GET /v1/memory-display/written` — the stored-memory timeline, newest
 *   first, which backs `list`.
 * - `GET /v1/memory/analytics/user_summary` — the cached user summary, which
 *   backs `profile`.
 *
 * The same surface serves a self-hosted deployment and the hosted service at
 * `https://cloud.memorybear.ai`. It exposes no removal, reflection, or
 * working-memory routes, so `forget` rejects with `MEMORY_UNSUPPORTED` rather
 * than pretending to act.
 * @module @deepseek-ai/dsh-memory-bear
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MemoryEngine, MemoryError } from '@deepseek-ai/dsh-memory'
import type {
  MemoryEntry,
  MemoryHealth,
  MemoryItem,
  MemoryListRequest,
  MemoryListResult,
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

/** One `GET /v1/memory-display/written` item. */
interface WrittenItem {
  readonly id?: string
  readonly memory_id?: string
  readonly memory_type?: string
  readonly name?: string
  readonly content?: string
  readonly occurred_at?: number
}

/** `GET /v1/memory-display/written` payload. */
interface WrittenPage {
  readonly items?: readonly WrittenItem[]
  readonly page?: { readonly total?: number }
}

/** `GET /v1/memory/analytics/user_summary` payload. */
interface UserSummary {
  readonly one_sentence?: string | null
  readonly user_summary?: string | null
  readonly personality?: string | null
  readonly core_values?: string | null
  readonly tags?: readonly (string | { readonly name?: string; readonly tag?: string })[] | null
}

/** The largest page the display route serves. */
const MAX_PAGE_SIZE = 100

/** `POST /v1/end_user/create` payload. */
interface EndUserResponse {
  readonly id?: string
  readonly other_id?: string
}

/** Upstream codes that mean the credential or quota cannot serve this call. */
const UNAVAILABLE_CODES = new Set([3007, 3009, 3012, 3014, 3015, 3016, 3017])
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
  /** IANA zone the display and analytics routes require. */
  private readonly timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
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

  async profile(request: MemoryProfileRequest): Promise<MemoryProfileResult> {
    const endUserId = await this.resolveEndUser()
    const summary = await this.send<UserSummary>('GET', '/v1/memory/analytics/user_summary', { query: { end_user_id: endUserId } })
    const text = (value: string | null | undefined): string[] =>
      typeof value === 'string' && value.trim() !== '' ? [value.trim()] : []
    const all: Record<string, string[]> = {
      basic: [...text(summary.one_sentence), ...text(summary.user_summary)],
      interests: (summary.tags ?? []).flatMap(tag => typeof tag === 'string' ? text(tag) : text(tag.name ?? tag.tag)),
      habits: text(summary.personality),
      emotions: text(summary.core_values),
    }
    const wanted = request.sections ?? ['basic', 'interests', 'habits', 'emotions']
    return { sections: Object.fromEntries(wanted.map(name => [name, all[name] ?? []])) }
  }

  /**
   * The display route pages by time and offers no text filter, so a `query`
   * narrows the returned page only; `total` then counts that narrowed page
   * rather than every match the backend holds.
   */
  async list(request: MemoryListRequest): Promise<MemoryListResult> {
    const endUserId = await this.resolveEndUser()
    const pagesize = Math.min(Math.max(request.limit ?? 50, 1), MAX_PAGE_SIZE)
    const page = await this.send<WrittenPage>('GET', '/v1/memory-display/written', {
      query: { end_user_id: endUserId, page: '1', pagesize: String(pagesize) },
    })
    const entries: MemoryEntry[] = (page.items ?? []).map((item, index) => ({
      id: item.memory_id ?? item.id ?? `bear-${String(index)}`,
      content: item.content ?? item.name ?? '',
      kind: item.memory_type ?? 'unknown',
      ...typeof item.occurred_at === 'number' ? { createdAt: new Date(item.occurred_at).toISOString() } : {},
    }))
    const query = request.query?.trim()
    if (query === undefined || query === '') {
      return { items: entries, total: page.page?.total ?? entries.length }
    }
    const matched = entries.filter(entry => entry.content.includes(query))
    return { items: matched, total: matched.length }
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
   * POST one JSON body and unwrap the upstream envelope.
   * @param path - the absolute path, beginning with `/v1`.
   * @param payload - the JSON body.
   * @returns the envelope's `data`.
   */
  private post<T>(path: string, payload: unknown): Promise<T> {
    return this.send<T>('POST', path, { body: payload })
  }

  /**
   * Send one request and unwrap the upstream envelope. The upstream reports
   * business failures, including an unknown API key, as an envelope beside a
   * 4xx status, so the envelope's code decides the failure class whenever the
   * body carries one.
   * @param method - the HTTP method.
   * @param path - the absolute path, beginning with `/v1`.
   * @param options - query parameters, or a JSON body.
   * @returns the envelope's `data`.
   */
  private async send<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { readonly query?: Readonly<Record<string, string>>; readonly body?: unknown },
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value)
    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers: {
          ...method === 'POST' ? { 'content-type': 'application/json' } : {},
          authorization: `Bearer ${this.apiKey}`,
          'x-language-type': this.language,
          'x-timezone': this.timezone,
        },
        ...method === 'POST' ? { body: JSON.stringify(options.body ?? {}) } : {},
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new MemoryError(`memory backend unreachable at ${path}`, 'MEMORY_UNAVAILABLE', { cause: error })
    }
    const envelope = await response.json().catch(() => undefined) as Envelope<T> | undefined
    if (envelope !== undefined && typeof envelope.code === 'number' && envelope.code !== 0) {
      throw new MemoryError(
        `memory backend rejected ${path}: ${envelope.error ?? envelope.msg ?? `code ${String(envelope.code)}`}`,
        classify(envelope.code),
      )
    }
    if (!response.ok || envelope === undefined) {
      throw new MemoryError(
        `memory backend answered ${String(response.status)} at ${path}`,
        response.status === 401 || response.status === 403 || response.status >= 500 ? 'MEMORY_UNAVAILABLE' : 'MEMORY_UPSTREAM_REJECTED',
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
