---
description: "The memory group map: the long-term memory capability seam, its MemoryBear provider, the model-facing tools, the session-driven autosave consumer, and in-session agent creation."
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
| [`memory-bear`](memory-bear/README.md) | Provider for MemoryBear, hosted at `cloud.memorybear.ai` or self-hosted; owns the API key, end-user binding, and degradation | registers on `ctx.memory` |
| [`tool-memory`](tool-memory/README.md) | Model-facing `memory_recall`, `memory_write`, and opt-in `memory_forget` | registers on `ctx.tools` |
| [`memory-autosave`](memory-autosave/README.md) | Pre-step recall and turn-end write, plus the `memoryAutosave` projection the client reads | registers on `ctx.agents` hooks |
| [`memory-agent`](memory-agent/README.md) | `memory_agent_create`: composes and registers a memory-enabled agent preset | registers on `ctx.tools` |

The client surface lives in [`client/ui-memory`](../client/ui-memory/README.md).

-----

<a id="related-documentation"></a>
## Related documentation

- [Session subsystem](../../docs/subsystems/session.md) — the event log and projection rules the `memoryAutosave` unit follows.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

MemoryBear's API-key surface serves recall, writes, the stored-memory timeline, and the cached user summary, but no removal: deletion, reflection, and working memory sit behind its JWT management API. The shipped preset therefore leaves `memory_forget` unregistered, and the panel reports removal as unsupported. Do not register a tool or show a control for an operation the provider refuses.

</details>
