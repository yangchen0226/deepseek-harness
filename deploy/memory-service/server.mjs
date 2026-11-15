/**
 * Self-hosted memory service for the dsh `memory-remote` provider.
 *
 * It implements exactly the five routes the provider calls — `health`, `recall`,
 * `remember`, `forget`, `profile` — and owns the database, ranking, and identity
 * resolution behind them. The provider owns transport and degradation; this
 * process never decides whether a turn continues.
 *
 * Configuration comes from the environment only, because a systemd unit cannot
 * read a repository file:
 *
 * - `MEMORY_DATABASE_URL` — libpq URL, required.
 * - `MEMORY_TOKEN` — the bearer token the provider sends, required.
 * - `MEMORY_PORT` — listening port, default 7180.
 * - `MEMORY_HOST` — listening address, default 127.0.0.1.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import pg from 'pg'

/** {@link pg.Pool} connections are shared per process. */
const pool = new pg.Pool({
  connectionString: requireEnv('MEMORY_DATABASE_URL'),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
})

/** Bytes of the shared secret every request must present. */
const tokenBytes = Buffer.from(requireEnv('MEMORY_TOKEN'), 'utf8')

/** Per-mode retrieval shape. `deep` and `normal` cast a wider net. */
const MODES = {
  express: { limit: 5, minScore: 0.12 },
  quick: { limit: 8, minScore: 0.08 },
  normal: { limit: 12, minScore: 0.05 },
  deep: { limit: 20, minScore: 0.03 },
  meta: { limit: 8, minScore: 0.08 },
}

/** The longest body accepted, so a malformed caller cannot exhaust memory. */
const MAX_BODY_BYTES = 512 * 1024

/** The kinds a write may declare. */
const KINDS = new Set(['preference', 'fact', 'event', 'relationship', 'procedure'])

/** The profile sections a caller may request. */
const SECTIONS = new Set(['basic', 'interests', 'habits', 'emotions'])

const port = Number(process.env.MEMORY_PORT ?? 7180)
const host = process.env.MEMORY_HOST ?? '127.0.0.1'

/**
 * Read a required environment variable.
 * @param {string} name - the variable name.
 * @returns {string} its value.
 */
function requireEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`)
  }
  return value
}

/**
 * Compare a presented bearer token against the configured one without leaking
 * length or prefix through timing.
 * @param {string | undefined} header - the raw `authorization` header.
 * @returns {boolean} whether it carries the configured token.
 */
function authorized(header) {
  if (typeof header !== 'string') return false
  const match = /^Bearer\s+(.+)$/iu.exec(header)
  if (match === null || match[1] === undefined) return false
  const presented = Buffer.from(match[1], 'utf8')
  if (presented.length !== tokenBytes.length) return false
  return timingSafeEqual(presented, tokenBytes)
}

/**
 * Decode the request body as JSON.
 * @param {import('node:http').IncomingMessage} request - the incoming request.
 * @returns {Promise<unknown>} the decoded body.
 */
async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'request body is not valid JSON')
  }
}

/** A failure that maps directly onto a status code. */
class HttpError extends Error {
  /**
   * @param {number} status - the HTTP status to answer with.
   * @param {string} message - a caller-readable description.
   */
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * Read a required string field.
 * @param {Record<string, unknown>} body - the decoded request body.
 * @param {string} field - the field name.
 * @returns {string} the trimmed value.
 */
function requireString(body, field) {
  const value = body[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, `${field} must be a non-empty string`)
  }
  return value
}

/**
 * Resolve the request's identity headers to an end-user row.
 * @param {{ workspaceId: string, otherId: string }} identity - the request identity.
 * @returns {Promise<string>} the end-user UUID.
 */
async function ensureEndUser(identity) {
  const { rows } = await pool.query('select memory_ensure_end_user($1, $2) as id', [
    identity.workspaceId,
    identity.otherId,
  ])
  const id = rows[0]?.id
  if (typeof id !== 'string') throw new HttpError(500, 'identity resolution returned no row')
  return id
}

/**
 * POST /health — reachability and the resolved end user.
 * @param {{ workspaceId: string, otherId: string }} identity - the request identity.
 * @returns {Promise<object>} the health payload.
 */
async function health(identity) {
  const endUserId = await ensureEndUser(identity)
  return { reachable: true, endUserId }
}

/**
 * POST /recall — rank this user's memories against a question.
 * @param {{ workspaceId: string, otherId: string }} identity - the request identity.
 * @param {Record<string, unknown>} body - the recall request.
 * @returns {Promise<object>} items, trace, degradation, and latency.
 */
async function recall(identity, body) {
  const started = Date.now()
  const question = requireString(body, 'question')
  const mode = typeof body.mode === 'string' && body.mode in MODES ? body.mode : 'quick'
  const shape = MODES[mode]
  const limit = typeof body.limit === 'number' && Number.isInteger(body.limit)
    ? Math.min(Math.max(body.limit, 1), 50)
    : shape.limit
  const endUserId = await ensureEndUser(identity)
  const identityMs = Date.now() - started

  const { rows } = await pool.query(
    `select id, content, kind, source, score
       from memory_recall($1, $2, $3, $4)`,
    [endUserId, question, limit, shape.minScore],
  )
  const searchedMs = Date.now() - started

  const items = rows.map(row => ({
    id: String(row.id),
    content: String(row.content),
    kind: String(row.kind),
    score: Number(row.score),
    query: question,
    source: String(row.source),
  }))

  if (items.length > 0) {
    await pool.query('select memory_touch($1::uuid[])', [items.map(item => item.id)])
  }

  return {
    items,
    trace: [
      { stage: 'identity_resolved', count: 1, durationMs: identityMs },
      { stage: 'hybrid_searched', count: items.length, durationMs: searchedMs - identityMs },
      { stage: 'results_merged', count: items.length, durationMs: Date.now() - started - searchedMs },
    ],
    degraded: false,
    latencyMs: Date.now() - started,
  }
}

/**
 * POST /remember — accept a turn's text as durable memories.
 *
 * Storage here is synchronous, so by the time this returns the batch is already
 * durable and `queued: true` reports acceptance. Duplicate content per user is
 * dropped by the unique index, which `stored` shows.
 * @param {{ workspaceId: string, otherId: string }} identity - the request identity.
 * @param {Record<string, unknown>} body - the write request.
 * @returns {Promise<object>} the batch identity and how many rows were new.
 */
async function remember(identity, body) {
  const messages = body.messages
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new HttpError(400, 'messages must be a non-empty array')
  }
  const kinds = Array.isArray(body.kinds)
    ? body.kinds.filter(kind => typeof kind === 'string' && KINDS.has(kind))
    : []
  const defaultKind = kinds[0] ?? 'event'
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null
  const turn = Number.isInteger(body.turn) ? body.turn : null
  const endUserId = await ensureEndUser(identity)

  const rows = messages
    .filter(message => message !== null && typeof message === 'object')
    .map(message => ({
      content: typeof message.content === 'string' ? message.content.trim() : '',
      kind: typeof message.kind === 'string' && KINDS.has(message.kind) ? message.kind : defaultKind,
      role: message.role === 'assistant' ? 'assistant' : 'user',
    }))
    .filter(message => message.content.length >= 8)

  const batchId = createHash('sha256')
    .update(`${identity.workspaceId}:${identity.otherId}:${String(body.sessionId ?? '')}:${String(body.turn ?? 0)}`)
    .digest('hex')
    .slice(0, 24)

  if (rows.length === 0) return { queued: true, batchId, stored: 0 }

  const values = []
  const params = []
  for (const row of rows) {
    const digest = createHash('sha256').update(row.content, 'utf8').digest()
    params.push(endUserId, row.content, digest, row.kind, `autosave:${row.role}`, sessionId, turn)
    values.push(
      `($${params.length - 6}::uuid, $${params.length - 5}::text, $${params.length - 4}::bytea,`
      + ` $${params.length - 3}::text, $${params.length - 2}::text, $${params.length - 1}::text, $${params.length}::int)`,
    )
  }

  const { rowCount } = await pool.query(
    `insert into memory_item (end_user_id, content, content_hash, kind, source, session_id, turn)
     values ${values.join(', ')}
     on conflict (end_user_id, content_hash) do nothing`,
    params,
  )

  return { queued: true, batchId, stored: rowCount ?? 0 }
}

/**
 * POST /forget — remove items by id or by matching text.
 * @param {{ workspaceId: string, otherId: string }} identity - the request identity.
 * @param {Record<string, unknown>} body - the forget request.
 * @returns {Promise<object>} how many rows were removed.
 */
async function forget(identity, body) {
  const target = requireString(body, 'target')
  const endUserId = await ensureEndUser(identity)
  const asUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

  const { rowCount } = await pool.query(
    asUuid.test(target)
      ? `update memory_item set archived = true, updated_at = now()
          where id = $1::uuid and end_user_id = $2 and not archived`
      : `update memory_item set archived = true, updated_at = now()
          where end_user_id = $1
            and not archived
            and (content ilike '%' || $2 || '%' or word_similarity($2, content) > 0.6)`,
    asUuid.test(target) ? [target, endUserId] : [endUserId, target],
  )
  return { removed: rowCount ?? 0 }
}

/**
 * POST /list — stored memories for browsing, newest first.
 * @param {{ workspaceId: string, otherId: string }} identity - the request identity.
 * @param {Record<string, unknown>} body - the list request.
 * @returns the page and the user's total.
 */
async function list(identity, body) {
  const query = typeof body.query === 'string' && body.query.trim() !== '' ? body.query.trim() : null
  const limit = Number.isInteger(body.limit) ? Math.min(Math.max(body.limit, 1), 200) : 50
  const endUserId = await ensureEndUser(identity)
  const { rows } = await pool.query(
    'select id, content, kind, created_at, hits, total from memory_list($1, $2, $3)',
    [endUserId, query, limit],
  )
  return {
    items: rows.map(row => ({
      id: String(row.id),
      content: String(row.content),
      kind: String(row.kind),
      createdAt: new Date(row.created_at).toISOString(),
      hits: Number(row.hits),
    })),
    total: rows.length === 0 ? 0 : Number(rows[0].total),
  }
}

/**
 * POST /profile — the user's items grouped into readable sections.
 * @param {{ workspaceId: string, otherId: string }} identity - the request identity.
 * @param {Record<string, unknown>} body - the profile request.
 * @returns {Promise<object>} sections keyed by name.
 */
async function profile(identity, body) {
  const requested = Array.isArray(body.sections)
    ? body.sections.filter(section => typeof section === 'string' && SECTIONS.has(section))
    : null
  const endUserId = await ensureEndUser(identity)
  const { rows } = await pool.query(
    'select section, content from memory_profile($1, $2::text[])',
    [endUserId, requested === null || requested.length === 0 ? null : requested],
  )
  /** @type {Record<string, string[]>} */
  const sections = {}
  for (const row of rows) {
    const name = String(row.section)
    sections[name] ??= []
    sections[name].push(String(row.content))
  }
  return { sections }
}

/** Route table: the six routes the provider calls. */
const ROUTES = { health, recall, remember, forget, list, profile }

const server = createServer(async (request, response) => {
  const started = Date.now()
  const url = request.url ?? '/'

  /** @param {number} status @param {unknown} payload */
  const send = (status, payload) => {
    const body = JSON.stringify(payload)
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    })
    response.end(body)
  }

  try {
    if (request.method === 'GET' && url === '/healthz') {
      await pool.query('select 1')
      send(200, { ok: true })
      return
    }
    if (request.method !== 'POST') throw new HttpError(405, 'only POST is supported')
    const route = url.replace(/^\/+/u, '').replace(/\/+$/u, '')
    const handler = Object.hasOwn(ROUTES, route) ? ROUTES[route] : undefined
    if (handler === undefined) throw new HttpError(404, `no route named ${route}`)
    if (!authorized(request.headers.authorization)) throw new HttpError(401, 'invalid bearer token')

    const workspaceId = header(request, 'x-workspace-id') ?? 'default'
    const otherId = header(request, 'x-end-user-other-id')
    if (otherId === undefined) throw new HttpError(400, 'x-end-user-other-id is required')

    const body = await readJson(request)
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'request body must be a JSON object')
    }
    const payload = await handler({ workspaceId, otherId }, body)
    send(200, payload)
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503
    const message = error instanceof Error ? error.message : String(error)
    // A 5xx is the only signal the provider degrades on, so log it loudly.
    if (status >= 500) console.error(`[${url}] ${message}`)
    send(status, { error: message })
  } finally {
    console.log(`${request.method ?? '-'} ${url} ${response.statusCode} ${Date.now() - started}ms`)
  }
})

/**
 * Read a single-valued request header.
 * @param {import('node:http').IncomingMessage} request - the incoming request.
 * @param {string} name - the lower-case header name.
 * @returns {string | undefined} the value.
 */
function header(request, name) {
  const value = request.headers[name]
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  return undefined
}

server.listen(port, host, () => {
  console.log(`memory service listening on http://${host}:${String(port)}`)
})

/** Drain connections and the pool on a stop signal. */
async function shutdown() {
  server.close()
  await pool.end()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())