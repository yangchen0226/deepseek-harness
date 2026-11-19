---
description: "Memory panel Remote namespace: browsing, profile reads, and removal over the ctx.memory seam for the client memory tab."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-memory-controller

English | [中文](README.zh.md)

## Summary

Exposes the `ctx.memory` seam to the client memory panel over the generated `memory` Remote namespace. The panel's library and profile views read what the engine holds now, including memories written in other sessions; the recall view reads the session log instead.

The shared engine serves explicit global or workspace scopes without requiring a live session. Session-bound reads resolve persisted workspace membership; an omitted scope preserves legacy collection access. Missing engines reject `memory/unsupported`.

## Table of Contents

- [Routes](#routes)
- [Contracts](#contracts)
- [Client face](#client-face)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="routes"></a>
## Routes

| Route | Request | Value |
|---|---|---|
| `memory/list` | `{ sessionId, query?, limit? }` | `{ items, total, degraded, canForget }` |
| `memory/profile` | `{ sessionId, sections? }` | `{ sections, degraded }` |
| `memory/forget` | `{ sessionId, target }` | `{ removed }` |
| `memory/health` | `{ sessionId }` | `{ reachable }` |
| `memory/mute` | `{ sessionId, muted }` | `{ muted }` |

-----

<a id="contracts"></a>
## Contracts

- **Reads degrade, removal does not.** `list` and `profile` answer `degraded: true` with the empty value when the engine is unreachable, so the page still renders. `forget` rejects `memory/unavailable` instead: a removal the engine did not confirm must never render as a deletion that happened.
- **`MEMORY_UNSUPPORTED` is not a failure.** An engine that cannot list or profile rejects `memory/unsupported`, which the panel uses to say so plainly rather than presenting an empty library as an empty account.
- **Removal is opt-in.** `memory/list` includes `canForget`, copied from the provider. The panel shows a delete control only when this flag is true; the default is false, so a provider that rejects `forget` cannot expose a dead destructive action.
- **Non-engine failures propagate.** A defect inside a provider is not an engine outage; only `MemoryError` produces a degraded or unavailable answer.
- **`mute` is the exception: it appends a session event.** The switch decides whether the turn runs with recalled text, so the log must reproduce the same answer the model saw. It records the persistent `memory/settings` event; the autosave consumer reads that event and skips recall and the turn's write.
- **No session event for the rest.** Browsing, profile reads, and removal serve a human looking at the panel. Nothing they return reaches a model request, so the "model-visible ⟺ logged" rule does not apply to them. The model's own access is the `memory_*` tools, which do append events.

-----

<a id="client-face"></a>
## Client face

`./client` installs `ctx.memoryPanel`, a thin passthrough over `ctx.remote.memory`. It reads the namespace once at apply time, because injected faces run on caller stacks — a React event, a carrier retry — whose dynamic context has not declared it. UI packages inject `memoryPanel` as a service and never reach into `ctx.remote` themselves.

-----

The `save` operation accepts human-authored text for an explicit global or existing workspace scope and records the outcome in durable collection activity. Acceptance, failure, and uncertain submission are distinct; an uncertain write is not retried. Library requests forward one-based pagination. Manual browsing and saves do not inject model context.

Profile reads use the cached remote summary. An explicit profile update regenerates only the selected end user before reading again; it never requests all users. Generation failures remain visible and do not become an empty successful profile. The MemoryBear provider bounds generation with `profileTimeoutMs`.

<a id="model-experience"></a>
## Model Experience

None, as the panel Remote serves a human browsing memories, and none of its values enter a model request.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No graph route.** The seam has no relation model, so a neighbourhood graph has nothing to read. Adding one means extending `MemoryEngine` and every provider first.
- **No paging cursor.** `list` returns one bounded page and a total; a library larger than the page limit is browsable only by narrowing the search.
- **Sections are fixed.** `profile` accepts the four section names the engine derives from stored kinds; a backend that invents others cannot surface them.
- **Account identity.** The provider configuration identifies one account; global and workspace collections are separate end users under that account.

### Dev Note

<a id="dev-note"></a>

<details>
<summary>Working context for maintainers — click to expand</summary>

The engine is resolved per call rather than cached: a preset can be rebound while a Session stays open, so a cached handle would outlive the composition that supplied it.

</details>
