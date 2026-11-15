---
description: "Self-hosted HTTP memory service backing the dsh memory-remote provider: server state, deployment, the PostgreSQL schema, the six routes, and operations."
kind: "package-group"
---

# memory-service — self-hosted memory backend

English | [中文](README.zh.md)

A self-hosted HTTP memory service for the `@deepseek-ai/dsh-memory-remote` provider. The database is a local PostgreSQL 17, the process runs under systemd, nginx terminates TLS, and the credentials exist in one env file.

## Server state

| Item | Value |
|---|---|
| Host | 124.221.105.121 (`ubuntu`, SSH key login) |
| Domain | `memory.newpm.ai` → 124.221.105.121 (Let's Encrypt, expires 2027-02-11, snap timer renews) |
| PostgreSQL | 17.12, cluster `17/main`, port **5433**, loopback only |
| Database / role | `memory_svc` / `memory_app` (scram-sha-256) |
| Service | `/opt/memory-service`, systemd unit `memory-service`, listening on `127.0.0.1:7180` |
| Credentials | `/etc/memory-service/env` (`root:memory`, `0640`) |
| Reverse proxy | `/etc/nginx/sites-available/memory` → `https://memory.newpm.ai` |
| Backup | `/usr/local/bin/memory-backup.sh`, `/etc/cron.d/memory-backup` daily at 03:17 |
| Retention | `/var/backups/memory-service/`, 14 days |

The PG 14 cluster `14/main` still runs on 5432 and is empty. Stopping it needs root and has not been done; two clusters running at once each hold their own memory.

## Latency

The service answers in 1–8 ms, but a cross-border TLS handshake costs 0.4–1.3 s and TTFB peaks near 2.1 s (30 samples: p50 232 ms, p95 1690 ms). The provider's 1500 ms default timeout turns those healthy requests into an intermittent outage, so the preset sets `timeoutMs` to 4000 ms and leaves `MEMORY_TIMEOUT_MS` as an override.

The e2e test uses 8000 ms and stretches its own deadline to four times that, because the case makes several round trips. `curl` alone never shows the problem: it opens a fresh connection each time, while Node's fetch reuses the pool, so the two see different latency distributions.

## First deploy

```bash
# 1. Dependencies and directories
sudo useradd --system --home /opt/memory-service --shell /usr/sbin/nologin memory
sudo mkdir -p /opt/memory-service /etc/memory-service

# 2. Database
sudo -u postgres psql -p 5433 -c "create role memory_app login password '<password>'"
sudo -u postgres psql -p 5433 -c "create database memory_svc owner memory_app encoding 'UTF8'"
sudo -u postgres psql -p 5433 -d memory_svc -v ON_ERROR_STOP=1 -f schema.sql
sudo -u postgres psql -p 5433 -d memory_svc \
  -c 'alter table memory_end_user owner to memory_app' \
  -c 'alter table memory_item owner to memory_app' \
  -c 'alter function memory_ensure_end_user(text,text) owner to memory_app' \
  -c 'alter function memory_recall(uuid,text,integer,real) owner to memory_app' \
  -c 'alter function memory_touch(uuid[]) owner to memory_app' \
  -c 'alter function memory_profile(uuid,text[],integer) owner to memory_app' \
  -c 'alter function memory_bigrams(text) owner to memory_app'

# 3. Service
sudo cp server.mjs package.json /opt/memory-service/
sudo chown -R memory:memory /opt/memory-service
cd /opt/memory-service && sudo -u memory npm install --omit=dev

# 4. Credentials and unit
sudo install -o root -g memory -m 640 env.example /etc/memory-service/env   # fill in real values first
sudo cp memory-service.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now memory-service

# 5. Reverse proxy
sudo cp nginx-memory.conf /etc/nginx/sites-available/memory
sudo ln -s /etc/nginx/sites-available/memory /etc/nginx/sites-enabled/memory
sudo nginx -t && sudo systemctl reload nginx

# 6. Backup
sudo install -o root -g root -m 700 memory-backup.sh /usr/local/bin/
sudo install -o root -g root -m 644 memory-backup.cron /etc/cron.d/memory-backup
```

## Database design

Everything except two business tables is a function; there are no views.

| Object | Role |
|---|---|
| `memory_end_user` | Maps an external `(workspace_id, other_id)` identity to a durable UUID |
| `memory_item` | One memory. `content_hash` deduplicates per user; `tsv` is a generated column |
| `memory_ensure_end_user` | Creates or reads the identity row idempotently |
| `memory_recall` | Ranked retrieval, returning `score` and `created_at` |
| `memory_list` | Browsing: newest first, substring filter, with a total |
| `memory_touch` | Records a recall, for the UI and the recency term |
| `memory_profile` | Groups items by `kind` into four profile sections |
| `memory_bigrams` | CJK character bigrams, the core retrieval signal |

Scoring is a four-term weighted sum:

```
0.35 × CJK bigram coverage
0.25 × pg_trgm word_similarity
0.25 × ts_rank_cd ('simple' full text)
0.15 × 30-day half-life recency
```

`memory_item_trgm` and `memory_item_tsv` are GIN indexes; `memory_item_user_recent` is a partial index over unarchived rows.

### Why bigrams

Chinese has no word boundaries. `to_tsvector('simple', ...)` treats a whole sentence as one token, and trigram `word_similarity` drops to zero the moment the question rephrases the memory. Bigram coverage fixes that: the question `前端样式用什么` and the memory `所有前端组件都用 CSS Modules` share `前端`, an overlap a whole-string trigram never sees.

What it cannot fix: the question's `包管理器` and the memory's `pnpm` share no characters. That is the hard edge of lexical retrieval, and only embeddings cross it; none are implemented today.

## Routes

All six routes are `POST` and need `authorization: Bearer <token>`, `x-workspace-id`, and `x-end-user-other-id`. A separate `GET /healthz` serves systemd and monitoring without a token.

| Route | Request | Response |
|---|---|---|
| `/health` | `{}` | `{ reachable, endUserId }` |
| `/recall` | `{ question, mode, limit? }` | `{ items, trace, degraded, latencyMs }` |
| `/remember` | `{ sessionId, turn, messages, kinds? }` | `{ queued, batchId, stored }` |
| `/forget` | `{ target }` | `{ removed }` |
| `/list` | `{ query?, limit? }` | `{ items, total }` |
| `/profile` | `{ sections? }` | `{ sections }` |

`mode` selects retrieval breadth and the minimum score: `express` 5/0.12, `quick` 8/0.08, `normal` 12/0.05, `deep` 20/0.03, `meta` 8/0.08.

`queued: true` means the batch was accepted. Writes here are synchronous, so acceptance means the rows are already stored; `stored` reports how many were new, and it is shorter than `messages` when the unique index dropped duplicates.

`list` serves the panel rather than a question: it orders by creation time, filters by substring, and does not rank. `total` counts the filtered set and can exceed the returned rows.

`forget` archives by id when `target` is a UUID, otherwise matches content (`ilike` or `word_similarity > 0.6`). It archives rather than deletes, and `removed` reports the affected rows.

## Client configuration

The desktop app reads `~/.dsh/.env` (`DSH_` prefixes are rejected; use `MEMORY_`):

```
MEMORY_SERVICE_URL=https://memory.newpm.ai
MEMORY_SERVICE_TOKEN=<token>
MEMORY_WORKSPACE=default
MEMORY_USER=<your stable identity>
MEMORY_AGENT_STUDIO=1
```

An optional `MEMORY_TIMEOUT_MS` overrides the preset's 4000 ms. When `MEMORY_SERVICE_URL` is unset, every memory row in the `memory` preset stays disabled and sessions keep working.

## Verification

```bash
# The service itself
curl -s https://memory.newpm.ai/healthz
curl -s -X POST https://memory.newpm.ai/health \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <token>' \
  -H 'x-workspace-id: default' \
  -H 'x-end-user-other-id: probe' -d '{}'

# The real provider, tools, and autosave
DSH_MEMORY_TEST_URL=https://memory.newpm.ai DSH_MEMORY_TEST_TOKEN=<token> \
  npx vitest run packages/memory/memory-remote/tests/e2e-service.spec.ts
```

## Operations

```bash
sudo systemctl status memory-service
sudo journalctl -u memory-service -n 50 --no-pager
sudo -u postgres psql -p 5433 -d memory_svc
sudo /usr/local/bin/memory-backup.sh          # manual backup
sudo ls -lh /var/backups/memory-service/
```

Restore:

```bash
sudo systemctl stop memory-service
sudo -u postgres /usr/lib/postgresql/17/bin/pg_restore \
  --clean --if-exists --no-owner -d memory_svc /var/backups/memory-service/<dump>
sudo systemctl start memory-service
```

`/usr/lib/postgresql/14/bin/pg_dump` refuses a 17 server, so the script names the 17 binary.

## Resources

The host has 3.7 GB of memory. The service caps at 512 MB, and PG 17 is configured with 768 MB `shared_buffers`, 2 GB `effective_cache_size`, and 60 `max_connections`. Two codebear nginx sites and `share-conversation` also run on this machine; the deployment did not touch them.
