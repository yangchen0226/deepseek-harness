---
description: "The memory group map: the long-term memory capability seam, its remote provider, the model-facing tools, the session-driven autosave consumer, and in-session agent creation."
kind: "package-group"
---

# memory/ — long-term memory capability family

English | [中文](README.zh.md)

## Summary

The memory group lets a session reach knowledge that outlives it. A provider stores and retrieves durable memories; the autosave consumer recalls before a turn and writes after one; the tool package gives the model explicit control; the agent package composes a new memory-enabled preset from a conversation. The seam exists so the harness never depends on one vendor's storage model: the shipped provider talks to MemoryBear, and a different backend can replace it without touching a consumer.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`memory`](memory/README.md) | Defines the seam: recall, browsing, write acceptance, removal, profile, reachability, and the failure codes | `ctx.memory` |
| [`memory-remote`](memory-remote/README.md) | Provider over the deployed HTTP memory service; owns identity headers, transport, and degradation | registers on `ctx.memory` |
| [`memory-bear`](memory-bear/README.md) | Provider for an existing MemoryBear deployment | registers on `ctx.memory` |
| [`tool-memory`](tool-memory/README.md) | Model-facing `memory_recall`, `memory_write`, and opt-in `memory_forget` | registers on `ctx.tools` |
| [`memory-autosave`](memory-autosave/README.md) | Pre-step recall and turn-end write, plus the `memoryAutosave` projection the client reads | registers on `ctx.agents` hooks |
| [`memory-agent`](memory-agent/README.md) | `memory_agent_create`: composes and registers a memory-enabled agent preset | registers on `ctx.tools` |

The client surface lives in [`client/ui-memory`](../client/ui-memory/README.md).

-----

<a id="related-documentation"></a>
## Related documentation

- [Memory service deployment](../../deploy/memory-service/README.md) — the PostgreSQL schema, the five service routes, and the client environment variables.
- [Session subsystem](../../docs/subsystems/session.md) — the event log and projection rules the `memoryAutosave` unit follows.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The shipped provider exposes recall and write only. MemoryBear keeps removal, reflection, working memory, episodic and perceptual reads behind its JWT management API, so `memory_forget` stays unregistered and profile reads reject as unsupported. Do not register a tool or show a control for an operation the provider refuses.

</details>
