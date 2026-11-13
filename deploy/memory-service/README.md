---
description: "Self-hosted HTTP memory service backing the dsh memory-remote provider: the PostgreSQL schema, the five routes, and the deployment procedure."
kind: "package-group"
---

# memory-service — self-hosted memory backend

[中文](README.zh.md)

## Summary

An HTTP service that implements the five routes `@deepseek-ai/dsh-memory-remote` calls — `health`, `recall`, `remember`, `forget`, `profile` — over a local PostgreSQL database. It owns identity resolution, the retrieval ranking, and the profile projection; the provider owns transport and degradation, so replacing this process with another deployment needs no client change.

## Table of Contents

- [Shape](#shape)
- [Retrieval](#retrieval)
- [Deployment](#deployment)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="shape"></a>
## Shape

`server.mjs` is a single Node ES module with one dependency (`pg`). Configuration comes from the environment, because a systemd unit cannot read a repository file.

| File | Role |
|---|---|
| `server.mjs` | The service: routing, bearer auth, identity headers, the five handlers |
| `schema.sql` | Tables, indexes, and the SQL functions the handlers call |
| `memory-service.service` | systemd unit, including sandboxing and a 512 MB cap |
| `nginx-memory.conf` | Reverse proxy with TLS termination |
| `memory-backup.sh` | Nightly `pg_dump` with 14-day retention |
| `memory-backup.cron` | The cron schedule running that script |
| `env.example` | The credential file template |

The connection string lives in exactly one file on the host (`/etc/memory-service/env`); the backup script sources it rather than keeping its own copy.

-----

<a id="retrieval"></a>
## Retrieval

`memory_recall` scores four weighted terms:

```
0.35 × CJK bigram coverage
0.25 × pg_trgm word_similarity
0.25 × ts_rank_cd on the 'simple' configuration
0.15 × 30-day half-life recency
```

The bigram term exists because Chinese has no word boundaries. `to_tsvector('simple', ...)` treats a sentence as one token, and a trigram over two whole strings scores zero as soon as the question rephrases the memory — the question `前端样式用什么` and the memory `所有前端组件都用 CSS Modules` share only the bigram `前端`.

What it cannot bridge: a question naming a category (`包管理器`) and a memory naming an instance (`pnpm`) share no characters. That is the hard edge of lexical retrieval and needs embeddings.

-----

<a id="deployment"></a>
## Deployment

The deployment reference — server state, the first-deploy sequence, route contracts, client environment variables, verification, and restore — is in the [Chinese page](README.zh.md), which is the primary version for this directory.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Cross-border latency sets the timeout.** The service answers in single-digit milliseconds, but a TLS handshake from outside China costs 0.4–1.3 s, so the preset sets `timeoutMs` to 4000 ms instead of the provider's 1500 ms default.
- **No vector retrieval.** Lexical plus bigram matching only; paraphrase that shares no characters misses.
- **No rate limiting.** A leaked token is bounded only by request size and statement timeout.
- **Recall touches are not batched.** Each recall issues a second round trip for `memory_touch`.
- **The old PG 14 cluster is still running** on 5432 and empty. Stopping it needs root.
