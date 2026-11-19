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
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { MemoryEngine, MemoryError } from '@deepseek-ai/dsh-memory'
import type {
  MemoryScope,
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

const DEFAULT_BASE_URL = 'https://cloud.memorybear.ai'
const DEFAULT_API_KEY_ENV = 'MEMORYBEAR_API_KEY'
const DEFAULT_BASE_URL_ENV = 'MEMORYBEAR_BASE_URL'
const DEFAULT_USER_ENV = 'MEMORY_USER'

/** Provider configuration. Secrets are references resolved from the credential service per operation. */
export interface Config {
  /** Optional literal origin override, retained for programmatic callers; omitted values use {@link baseUrlEnv}. */
  baseUrl?: string
  /** Launch-environment variable naming the MemoryBear origin. */
  baseUrlEnv?: string
  /** Optional legacy literal key for programmatic callers; shipped compositions use {@link apiKeyEnv}. */
  apiKey?: string
  /** Credential reference resolved through `ctx.credentials` for every operation. */
  apiKeyEnv?: string
  /** The dsh-side user identity; MemoryBear resolves it to an end-user UUID once and reuses it. */
  endUserOtherId?: string
  /** Launch-environment variable naming the dsh-side user identity. */
  endUserOtherIdEnv?: string
  /** Upstream request deadline in milliseconds. Recall degradation uses it; other calls reject on expiry. */
  timeoutMs?: number
  /** Upstream copy language for extracted statements. */
  language?: 'zh' | 'en'
  /** Maximum time for an explicit profile regeneration, in milliseconds. */
  profileTimeoutMs?: number
}

/** Default upstream deadline. Recall must not hold a turn longer than this. */
const DEFAULT_TIMEOUT_MS = 800

export const Config: z<Config> = z.object({
  baseUrl: z.string().default(''),
  baseUrlEnv: z.string().default(DEFAULT_BASE_URL_ENV),
  apiKey: z.string().role('secret').default(''),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  endUserOtherId: z.string().default(''),
  endUserOtherIdEnv: z.string().default(DEFAULT_USER_ENV),
  timeoutMs: z.number().step(1).min(1).max(2_147_483_647).default(DEFAULT_TIMEOUT_MS),
  language: z.union(['zh', 'en']).default('zh'),
  profileTimeoutMs: z.number().step(1).min(1).max(300000).default(120000),
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

/** One endpoint-specific decoder for the untrusted JSON `data` field. */
type WireDecoder<T> = (value: unknown, path: string) => T

/** Return whether a decoded JSON value is a non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Build one stable failure for malformed data returned by MemoryBear. */
function invalidWire(path: string): MemoryError {
  return new MemoryError(`memory backend returned invalid data at ${path}`, 'MEMORY_UPSTREAM_REJECTED')
}

/** Require an object at one wire path. */
function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalidWire(path)
  return value
}

/** Read an optional string field, rejecting malformed present values. */
function optionalString(record: Record<string, unknown>, key: string, path: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw invalidWire(`${path}.${key}`)
  return value
}

/** Read an optional nullable string field used by the summary endpoint. */
function optionalNullableString(record: Record<string, unknown>, key: string, path: string): string | null | undefined {
  const value = record[key]
  if (value === undefined || value === null) return value
  if (typeof value !== 'string') throw invalidWire(`${path}.${key}`)
  return value
}

/** Read an optional finite numeric field, rejecting malformed present values. */
function optionalNumber(record: Record<string, unknown>, key: string, path: string): number | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidWire(`${path}.${key}`)
  return value
}

/** Decode one read response while preserving optional fields the provider uses. */
function decodeReadResponse(value: unknown, path: string): ReadResponse {
  const record = recordAt(value, path)
  const result: { answer?: string; intermediate_outputs?: ReadOutput[] } = {}
  const answer = optionalString(record, 'answer', path)
  if (answer !== undefined) result.answer = answer
  const outputs = record.intermediate_outputs
  if (outputs !== undefined) {
    if (!Array.isArray(outputs)) throw invalidWire(`${path}.intermediate_outputs`)
    result.intermediate_outputs = outputs.map((output, index) => {
      const itemPath = `${path}.intermediate_outputs[${String(index)}]`
      const item = recordAt(output, itemPath)
      const decoded: { id?: string; content?: string; source?: string; query?: string; score?: number } = {}
      const id = optionalString(item, 'id', itemPath)
      const content = optionalString(item, 'content', itemPath)
      const source = optionalString(item, 'source', itemPath)
      const query = optionalString(item, 'query', itemPath)
      const score = optionalNumber(item, 'score', itemPath)
      if (id !== undefined) decoded.id = id
      if (content !== undefined) decoded.content = content
      if (source !== undefined) decoded.source = source
      if (query !== undefined) decoded.query = query
      if (score !== undefined) decoded.score = score
      return decoded
    })
  }
  return result
}

/** Decode the asynchronous write response. */
function decodeWriteResponse(value: unknown, path: string): WriteResponse {
  const record = recordAt(value, path)
  const result: { task_ids?: string[]; end_user_id?: string } = {}
  const taskIds = record.task_ids
  if (taskIds !== undefined) {
    if (!Array.isArray(taskIds) || !taskIds.every(taskId => typeof taskId === 'string')) {
      throw invalidWire(`${path}.task_ids`)
    }
    result.task_ids = taskIds
  }
  const endUserId = optionalString(record, 'end_user_id', path)
  if (endUserId !== undefined) result.end_user_id = endUserId
  return result
}

/** Decode the end-user creation response. */
function decodeEndUserResponse(value: unknown, path: string): EndUserResponse {
  const record = recordAt(value, path)
  const result: { id?: string; other_id?: string } = {}
  const id = optionalString(record, 'id', path)
  const otherId = optionalString(record, 'other_id', path)
  if (id !== undefined) result.id = id
  if (otherId !== undefined) result.other_id = otherId
  return result
}

/** Decode one item returned by the memory display route. */
function decodeWrittenItem(value: unknown, path: string): WrittenItem {
  const record = recordAt(value, path)
  const result: { id?: string; memory_id?: string; memory_type?: string; name?: string; content?: string; occurred_at?: number } = {}
  const id = optionalString(record, 'id', path)
  const memoryId = optionalString(record, 'memory_id', path)
  const memoryType = optionalString(record, 'memory_type', path)
  const name = optionalString(record, 'name', path)
  const content = optionalString(record, 'content', path)
  const occurredAt = optionalNumber(record, 'occurred_at', path)
  if (id !== undefined) result.id = id
  if (memoryId !== undefined) result.memory_id = memoryId
  if (memoryType !== undefined) result.memory_type = memoryType
  if (name !== undefined) result.name = name
  if (content !== undefined) result.content = content
  if (occurredAt !== undefined) result.occurred_at = occurredAt
  return result
}

/** Decode the paged memory display response. */
function decodeWrittenPage(value: unknown, path: string): WrittenPage {
  const record = recordAt(value, path)
  const result: { items?: WrittenItem[]; page?: { total?: number } } = {}
  const items = record.items
  if (items !== undefined) {
    if (!Array.isArray(items)) throw invalidWire(`${path}.items`)
    result.items = items.map((item, index) => decodeWrittenItem(item, `${path}.items[${String(index)}]`))
  }
  const page = record.page
  if (page !== undefined) {
    const pageRecord = recordAt(page, `${path}.page`)
    const total = optionalNumber(pageRecord, 'total', `${path}.page`)
    result.page = total === undefined ? {} : { total }
  }
  return result
}

/** Decode the cached user summary response. */
function decodeUserSummary(value: unknown, path: string): UserSummary {
  const record = recordAt(value, path)
  const result: { one_sentence?: string | null; user_summary?: string | null; personality?: string | null; core_values?: string | null; tags?: readonly (string | { readonly name?: string; readonly tag?: string })[] | null } = {}
  const oneSentence = optionalNullableString(record, 'one_sentence', path)
  const userSummary = optionalNullableString(record, 'user_summary', path)
  const personality = optionalNullableString(record, 'personality', path)
  const coreValues = optionalNullableString(record, 'core_values', path)
  if (oneSentence !== undefined) result.one_sentence = oneSentence
  if (userSummary !== undefined) result.user_summary = userSummary
  if (personality !== undefined) result.personality = personality
  if (coreValues !== undefined) result.core_values = coreValues
  const tags = record.tags
  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags)) throw invalidWire(`${path}.tags`)
    result.tags = tags.map((tag, index) => {
      if (typeof tag === 'string') return tag
      const tagRecord = recordAt(tag, `${path}.tags[${String(index)}]`)
      const name = optionalString(tagRecord, 'name', `${path}.tags[${String(index)}]`)
      const tagValue = optionalString(tagRecord, 'tag', `${path}.tags[${String(index)}]`)
      return name === undefined && tagValue === undefined ? {} : { ...(name === undefined ? {} : { name }), ...(tagValue === undefined ? {} : { tag: tagValue }) }
    })
  } else if (tags === null) {
    result.tags = null
  }
  return result
}

/** Decode the common upstream envelope without trusting a type assertion. */
function decodeEnvelope(value: unknown, path: string): Envelope<unknown> {
  const record = recordAt(value, path)
  const code = record.code
  if (typeof code !== 'number' || !Number.isFinite(code)) throw invalidWire(`${path}.code`)
  const result: { code: number; msg?: string; data?: unknown; error?: string } = { code }
  const msg = record.msg
  if (msg !== undefined && msg !== null) {
    if (typeof msg !== 'string') throw invalidWire(`${path}.msg`)
    result.msg = msg
  }
  if (record.data !== undefined) result.data = record.data
  const error = record.error
  if (error !== undefined && error !== null) {
    if (typeof error !== 'string') throw invalidWire(`${path}.error`)
    result.error = error
  }
  return result
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

/** Reject a non-finite caller limit before it reaches a URL or array helper. */
function finiteLimit(value: number): number {
  if (!Number.isFinite(value)) {
    throw new MemoryError(
      `memory request limit must be finite, got ${String(value)}`,
      'MEMORY_INVALID_REQUEST',
    )
  }
  return Math.floor(value)
}

/** Apply the recall limit's non-negative lower bound after finite validation. */
function recallLimit(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.max(0, finiteLimit(value))
}

/** Apply the display endpoint's page bounds after finite validation. */
function pageSize(value: number | undefined): number {
  return value === undefined ? 50 : Math.min(Math.max(finiteLimit(value), 1), MAX_PAGE_SIZE)
}

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
  private readonly configuredBaseUrl: string
  private readonly baseUrlEnv: string
  private readonly configuredApiKey: string
  private readonly apiKeyEnv: CredentialRef
  private readonly context: Context
  private readonly otherId: string
  private readonly timeoutMs: number
  private readonly profileTimeoutMs: number
  private readonly language: NonNullable<Config['language']>
  /** IANA zone the display and analytics routes require. */
  private readonly timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  private readonly endUsers = new Map<string, Promise<string>>()

  /**
   * @param ctx - the context the service registers on.
   * @param config - resolved provider configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.context = ctx
    this.configuredBaseUrl = config.baseUrl?.trim() ?? ''
    if (this.configuredBaseUrl !== '') this.validatedBaseUrl(this.configuredBaseUrl)
    this.baseUrlEnv = config.baseUrlEnv?.trim() || DEFAULT_BASE_URL_ENV
    this.configuredApiKey = config.apiKey?.trim() ?? ''
    this.apiKeyEnv = credentialRef(config.apiKeyEnv?.trim() || DEFAULT_API_KEY_ENV)
    const configuredOtherId = config.endUserOtherId?.trim() ?? ''
    const otherIdEnv = config.endUserOtherIdEnv?.trim() || DEFAULT_USER_ENV
    this.otherId = configuredOtherId || launchEnvironmentOf(ctx).get(otherIdEnv)?.value?.trim() || 'local'
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.profileTimeoutMs = config.profileTimeoutMs ?? 120000
    this.language = config.language ?? 'zh'
  }

  async recall(request: MemoryRecallRequest): Promise<MemoryRecallResult> {
    if (request.question.trim().length === 0) {
      throw new MemoryError('memory recall needs a non-empty question', 'MEMORY_INVALID_REQUEST')
    }
    const limit = recallLimit(request.limit)
    const started = Date.now()
    try {
      const endUserId = await this.resolveEndUser(request.scope)
      const body = await this.post('/v1/memory/read/sync', {
        message: request.question,
        search_switch: SEARCH_SWITCH[request.mode],
        end_user_id: endUserId,
        enable_rerank: false,
      }, decodeReadResponse)
      const outputs = body.intermediate_outputs ?? []
      // The read endpoint has no documented result-limit field. Apply the
      // seam's optional limit after decoding instead of sending an unknown
      // upstream parameter. A negative or fractional caller value cannot
      // expand the result set.
      const limitedOutputs = limit === undefined
        ? outputs
        : outputs.slice(0, limit)
      const items: readonly MemoryItem[] = limitedOutputs.map((output, index) => ({
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
    const endUserId = await this.resolveEndUser(request.scope)
    const body = await this.post('/v1/memory/write', {
      messages: request.messages.map(message => ({
        role: message.role,
        content: message.content,
        ...(message.at === undefined ? {} : { dialog_at: message.at }),
      })),
      end_user_id: endUserId,
      conversation_id: request.sessionId,
    }, decodeWriteResponse)
    const batchId = body.task_ids?.[0]
    return batchId === undefined ? { queued: true } : { queued: true, batchId }
  }

  forget(_request: MemoryForgetRequest): Promise<MemoryForgetResult> {
    return Promise.reject(new MemoryError(
      'this memory backend exposes no removal on its API-key surface; remove the item from the memory panel instead',
      'MEMORY_UNSUPPORTED',
    ))
  }

  /** The API-key surface has no removal route, so clients must hide destructive controls. */
  override canForget(): boolean {
    return false
  }

  async profile(request: MemoryProfileRequest): Promise<MemoryProfileResult> {
    const endUserId = await this.resolveEndUser(request.scope)
    if (request.refresh === true) {
      await this.send('POST', '/v1/memory/analytics/generate_cache', { body: { end_user_id: endUserId } }, (value, path) => {
        const result = recordAt(value, path)
        if (result.summary_success !== true) throw new MemoryError('Profile generation did not complete; refresh later', 'MEMORY_UPSTREAM_REJECTED')
        return true
      }, this.profileTimeoutMs)
    }
    const summary = await this.send('GET', '/v1/memory/analytics/user_summary', { query: { end_user_id: endUserId } }, decodeUserSummary)
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
    const pagesize = pageSize(request.limit)
    const pageNumber = request.page ?? 1
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) throw new MemoryError('Memory page must be a positive integer', 'MEMORY_INVALID_REQUEST')
    const endUserId = await this.resolveEndUser(request.scope)
    const page = await this.send('GET', '/v1/memory-display/written', {
      query: { end_user_id: endUserId, page: String(pageNumber), pagesize: String(pagesize) },
    }, decodeWrittenPage)
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
  private resolveEndUser(scope?: MemoryScope): Promise<string> {
    const otherId = scope === undefined ? this.otherId : JSON.stringify([
      'dsh-memory-v1', this.otherId, scope.kind,
      ...(scope.kind === 'workspace' ? [scope.workspaceId] : []),
    ])
    const cached = this.endUsers.get(otherId)
    if (cached !== undefined) return cached
    const pending = this.post('/v1/end_user/create', {
      other_id: otherId,
      other_name: otherId,
    }, decodeEndUserResponse).then(body => {
      if (typeof body.id !== 'string' || body.id.length === 0) {
        throw new MemoryError('memory backend returned no end-user id', 'MEMORY_UPSTREAM_REJECTED')
      }
      return body.id
    })
    this.endUsers.set(otherId, pending)
    void pending.catch(() => { this.endUsers.delete(otherId) })
    return pending
  }

  /**
   * POST one JSON body and unwrap the upstream envelope.
   * @param path - the absolute path, beginning with `/v1`.
   * @param payload - the JSON body.
   * @returns the envelope's `data`.
   */
  private post<T>(path: string, payload: unknown, decode: WireDecoder<T>): Promise<T> {
    return this.send('POST', path, { body: payload }, decode)
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
    decode: WireDecoder<T>,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    let url: URL
    try {
      url = new URL(`${this.baseUrl()}${path}`)
      for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value)
    } catch (error) {
      if (error instanceof MemoryError) throw error
      throw new MemoryError(`memory backend has an invalid endpoint for ${path}`, 'MEMORY_INVALID_REQUEST', { cause: error })
    }
    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers: {
          ...method === 'POST' ? { 'content-type': 'application/json' } : {},
          authorization: `Bearer ${await this.apiKey()}`,
          'x-language-type': this.language,
          'x-timezone': this.timezone,
        },
        ...method === 'POST' ? { body: JSON.stringify(options.body ?? {}) } : {},
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new MemoryError(`memory backend unreachable at ${path}`, 'MEMORY_UNAVAILABLE', { cause: error })
    }
    let raw: unknown
    try {
      raw = await response.json()
    } catch (error) {
      throw new MemoryError(
        `memory backend returned invalid JSON at ${path}`,
        response.status === 401 || response.status === 403 || response.status >= 500 ? 'MEMORY_UNAVAILABLE' : 'MEMORY_UPSTREAM_REJECTED',
        { cause: error },
      )
    }
    const envelope = decodeEnvelope(raw, path)
    if (envelope.code !== 0) {
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
    if (envelope.data === undefined) throw invalidWire(`${path}.data`)
    return decode(envelope.data, `${path}.data`)
  }

  /** Resolve the endpoint from the explicit setting or this launch's immutable environment snapshot. */
  private baseUrl(): string {
    const value = this.configuredBaseUrl
      || launchEnvironmentOf(this.context).get(this.baseUrlEnv)?.value
      || DEFAULT_BASE_URL
    return this.validatedBaseUrl(value).replace(/\/+$/u, '')
  }

  /** Validate an endpoint before it can appear in a request or error report. */
  private validatedBaseUrl(value: string): string {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch (error) {
      throw new MemoryError('memory baseUrl must be a valid HTTP(S) origin', 'MEMORY_INVALID_REQUEST', { cause: error })
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new MemoryError('memory baseUrl must be an HTTP(S) origin without credentials, path, query, or fragment', 'MEMORY_INVALID_REQUEST')
    }
    return parsed.href
  }

  /** Resolve the current API key through credentials, with the legacy literal as a programmatic fallback. */
  private async apiKey(): Promise<string> {
    const credentials = this.context.get('credentials')
    const resolved = credentials === undefined
      ? launchEnvironmentOf(this.context).get(this.apiKeyEnv)?.value
      : (await credentials.resolve(this.apiKeyEnv))?.value
    const value = resolved?.trim() || (credentials === undefined ? this.configuredApiKey : '')
    if (value.length === 0) {
      throw new MemoryError(`memory backend has no credential for ${this.apiKeyEnv}`, 'MEMORY_UNAVAILABLE')
    }
    return value
  }
}

/**
 * Plugin body: replace the seam's implementation with the MemoryBear engine.
 * @param ctx - the context to register on.
 * @param config - validated provider configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.memory = new MemoryBearEngine(ctx, Config(config))
}
