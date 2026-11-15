---
description: "Memory panel Remote namespace: browsing, profile reads, and removal over the ctx.memory seam for the client memory tab."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-memory-controller

English | [中文](README.zh.md)

## Summary

Exposes the `ctx.memory` seam to the client memory panel over the generated `memory` Remote namespace. The panel's library and profile views read what the engine holds now, including memories written in other sessions; the recall view reads the session log instead.

The engine is per-session: the `memory` preset mounts its provider inside the Agent's isolated preset group, so every call names its Session and the service reads the engine from that Agent's composition, falling back to a Host-level `ctx.memory`. A Session with none rejects `memory/unsupported`.

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
| `memory/list` | `{ sessionId, query?, limit? }` | `{ items, total, degraded }` |
| `memory/profile` | `{ sessionId, sections? }` | `{ sections, degraded }` |
| `memory/forget` | `{ sessionId, target }` | `{ removed }` |
| `memory/health` | `{ sessionId }` | `{ reachable }` |
| `memory/mute` | `{ sessionId, muted }` | `{ muted }` |

-----

<a id="contracts"></a>
## Contracts

- **Reads degrade, removal does not.** `list` and `profile` answer `degraded: true` with the empty value when the engine is unreachable, so the page still renders. `forget` rejects `memory/unavailable` instead: a removal the engine did not confirm must never render as a deletion that happened.
- **`MEMORY_UNSUPPORTED` is not a failure.** An engine that cannot list or profile rejects `memory/unsupported`, which the panel uses to say so plainly rather than presenting an empty library as an empty account.
- **Non-engine failures propagate.** A defect inside a provider is not an engine outage; only `MemoryError` produces a degraded or unavailable answer.
- **`mute` is the exception: it appends a session event.** The switch decides whether the turn runs with recalled text, so the log must reproduce the same answer the model saw. It records `memory/mute` and nothing else; the autosave consumer reads that event and skips recall and the turn's write.
- **No session event for the rest.** Browsing, profile reads, and removal serve a human looking at the panel. Nothing they return reaches a model request, so the "model-visible ⟺ logged" rule does not apply to them. The model's own access is the `memory_*` tools, which do append events.

-----

<a id="client-face"></a>
## Client face

`./client` installs `ctx.memoryPanel`, a thin passthrough over `ctx.remote.memory`. It reads the namespace once at apply time, because injected faces run on caller stacks — a React event, a carrier retry — whose dynamic context has not declared it. UI packages inject `memoryPanel` as a service and never reach into `ctx.remote` themselves.

-----

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
- **One identity per instance.** The end user is fixed by the provider's configuration, so the panel shows the same memory regardless of who is looking at the browser.

### Dev Note

<a id="dev-note"></a>

<details>
<summary>Working context for maintainers — click to expand</summary>

The engine is resolved per call rather than cached: a preset can be rebound while a Session stays open, so a cached handle would outlive the composition that supplied it.

</details>
