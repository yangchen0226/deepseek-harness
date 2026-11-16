---
description: "MemoryBear-backed implementation of the DSH memory capability seam, hosted or self-hosted: end-user binding, synchronous recall, asynchronous write acceptance, browsing, profile reads, and degradation when the service is unreachable."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-bear

English | [中文](README.zh.md)

## Summary

`dsh-memory-bear` connects the harness to MemoryBear — the hosted service at `https://cloud.memorybear.ai`, or a self-hosted deployment of the same API. It is the provider the shipped `memory` preset uses. It resolves one end user per configured identity, recalls memories synchronously through the read endpoint, submits conversation batches for asynchronous extraction, and degrades a recall to an empty result when the service is unreachable so a turn never waits on memory forever.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```yaml
- name: '@deepseek-ai/dsh-memory-bear'
  config:
    baseUrl: https://cloud.memorybear.ai
    apiKey: <MemoryBear API key>
    endUserOtherId: alice
    timeoutMs: 8000
```

| Field | Default | Meaning |
|---|---|---|
| `baseUrl` | required | MemoryBear origin without a trailing slash |
| `apiKey` | required | API key carrying the `memory` scope |
| `endUserOtherId` | required | The harness-side user identity; MemoryBear maps it to an end-user UUID |
| `timeoutMs` | `800` | Per-request deadline; a recall that exceeds it degrades |
| `language` | `zh` | Copy language the service uses for extracted statements |

The API key's workspace is the memory scope. The provider never sends a workspace id: MemoryBear derives it from the credential. Create the key in the MemoryBear console with the `memory` scope. Raise `timeoutMs` for the hosted service: its read path runs retrieval upstream across a cross-border link, so the `memory` preset uses 8000 ms.

<a id="understand-the-implementation"></a>
## Understand the implementation

- **End-user binding** is lazy and idempotent: the first call creates the end user by `other_id`, and the UUID is cached for the life of the plugin fiber. A failed creation is not cached, so the next call retries.
- **Recall** uses the synchronous read endpoint with the caller's `search_mode`. `deep` and `normal` ask the service to split the question and summarize; `quick` and `express` return raw items. Any transport failure, timeout, or credential rejection resolves `degraded: true`; only an empty question rejects.
- **Writes** are acceptance-only. The service returns per-message task ids and extracts in the background, so `queued: true` means the batch entered the pipeline, never that it is searchable.
- **Browsing** reads the stored-memory timeline, newest first. The route pages by time and has no text filter, so a `query` narrows the fetched page only and `total` then counts that page.
- **Profile reads** map the cached user summary into sections: the one-sentence and full summary into `basic`, tags into `interests`, personality into `habits`, and core values into `emotions`. A user whose summary MemoryBear has not generated yet reads as empty sections.
- **Removal** is unsupported: MemoryBear exposes it on its JWT management surface, which this provider does not configure. It rejects with `MEMORY_UNSUPPORTED` instead of returning a no-op.
- **Failures** are classified from the upstream envelope even beside a 4xx status: an unknown or exhausted API key (`3007`, `3009`, `3012`, `3014`–`3017`) is unavailable, so recall degrades rather than failing the turn.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the provider transports recall, write, browse, and profile requests for its consumers; dsh-memory-autosave and dsh-tool-memory own what the model sees.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- No delete, reflection trigger, working-memory, episodic, or perceptual reads; those live behind the management API and would need a second credential.
- No recorded session snapshot: replay runs offline, and every recall and write reaches the service. `tests/e2e-service.spec.ts` drives the real provider, tools, and autosave against a live service when `DSH_MEMORYBEAR_TEST_API_KEY` is set.
- `endUserOtherId` is one identity per plugin instance. Multi-user hosts need one provider instance per user or an identity-resolving layer around it.
- The RAG-storage workspace variant is not distinguished: it writes synchronously and has no graph, but the provider treats every workspace alike.

### Dev Note

<a id="dev-note"></a>

Behavior tests run against a local stub server (`tests/provider.spec.ts`) and assert the request paths, auth header, envelope handling, and degradation.
