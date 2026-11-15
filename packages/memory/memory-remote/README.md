---
description: "Remote implementation of the DSH memory capability seam over the harness HTTP memory service: identity headers, five routes, and degradation when the service is unreachable."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-remote

English | [中文](README.zh.md)

## Summary

`dsh-memory-remote` connects the harness to a deployed memory service. It sends the caller's identity to the service, which owns the database and the retrieval ranking; this provider owns transport and degradation. Any HTTP endpoint implementing the same five routes works, so a self-hosted deployment needs no code change here.

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
- name: '@deepseek-ai/dsh-memory-remote'
  config:
    serviceUrl: https://memory.example.com
    token: <service token>
    workspaceId: default
    endUserOtherId: alice
    timeoutMs: 4000
```

| Field | Default | Meaning |
|---|---|---|
| `serviceUrl` | required | Service base URL; routes are appended to it |
| `token` | required | Bearer token the service accepts; stored as a secret field |
| `workspaceId` | `default` | Partition sent as `x-workspace-id` |
| `endUserOtherId` | required | External user identity sent as `x-end-user-other-id` |
| `timeoutMs` | `1500` | Per-request deadline; a recall that exceeds it degrades |

Raise `timeoutMs` for a remote deployment: a cross-border TLS handshake costs 0.4–1.3 s before the first byte, so the default turns a healthy service into an intermittent outage. The `memory` preset sets 4000 ms.

<a id="understand-the-implementation"></a>
## Understand the implementation

- Every route is `POST` with a JSON body. The provider adds the three identity headers itself, so no consumer builds one.
- **Recall degrades, never throws.** A transport failure, timeout, or 401/403/5xx resolves `degraded: true` with an empty item list, because a turn must proceed without memory. Only an empty question rejects.
- **Write acceptance is real, not optimistic.** The service commits before it answers, so `queued: true` means the batch is searchable immediately — unlike an asynchronous pipeline, where the same flag only means the batch entered a queue.
- A 4xx other than 401/403 means the service refused the request itself, so it rejects as `MEMORY_UPSTREAM_REJECTED` instead of degrading.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the provider transports recall, write, and browse requests over HTTP; dsh-memory-autosave and dsh-tool-memory own what the model sees.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- One identity per plugin instance: `endUserOtherId` is fixed by configuration, so a multi-user host needs one instance per user or an identity-resolving layer above it.
- The service protocol is defined by this provider and the shipped service together; there is no published schema, so a third-party service must follow the routes documented in [`deploy/memory-service`](../../../deploy/memory-service/README.md).
- Token rotation requires a plugin reload; the provider reads it once at construction.

### Dev Note

<a id="dev-note"></a>

Contract tests run against a local stub server (`tests/provider.spec.ts`); `tests/e2e-service.spec.ts` drives the real provider, tools, and autosave against a running service and skips unless `DSH_MEMORY_TEST_URL` is set.
