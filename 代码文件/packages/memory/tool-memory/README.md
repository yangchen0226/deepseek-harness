---
description: "Model-facing memory tools: memory_recall, memory_write, and opt-in memory_forget and memory_profile over the DSH memory seam, each appending a durable session event."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-memory

English | [中文](README.zh.md)

## Summary

`dsh-tool-memory` gives the agent explicit memory control. `memory_recall` searches durable memories with a rewritten question; `memory_write` records one affirmed fact; `memory_forget` removes one and `memory_profile` reads what the engine has already concluded about the user; both are registered only where the backend supports them. Every call appends a `memory/recall`, `memory/write`, or `memory/forget` event, so the transcript and the memory panel show exactly what the model did.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [What each call does](#what-each-call-does)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```yaml
- name: '@deepseek-ai/dsh-tool-memory'
  config:
    defaultMode: quick
    enableForget: false
    enableProfile: false
```

| Field | Default | Meaning |
|---|---|---|
| `defaultMode` | `quick` | Retrieval breadth when the model omits `search_mode` |
| `enableForget` | `false` | Whether `memory_forget` is registered |
| `enableProfile` | `false` | Whether `memory_profile` is registered |

### What each call does

- `memory_recall(question, search_mode?)` calls the seam, appends `memory/recall` with items and trace, and answers with the raw items. A degraded engine returns an empty list and an instruction to continue without memory; the tool does not fail.
- `memory_write(content, kind)` submits one message, appends `memory/write` with `queued` and any batch id, and reports acceptance.
- `memory_forget(target)` calls the seam and appends `memory/forget`; an unsupported backend surfaces its error to the model.
- `memory_profile(sections?)` reads the stored profile and appends `memory/profile`. It answers what memory already concluded instead of searching, so an empty section means nothing is stored under it.

<a id="understand-the-implementation"></a>
## Understand the implementation

The tool path does not know its turn number: the execution context carries none and the session exposes no current-turn reader. The enclosing `tool/call` event already records the turn, so memory events omit it. The session id comes from the owning agent; `memory_write` rejects a caller with no session rather than inventing one.

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The generated [`memory_recall`, `memory_write`, `memory_forget`, and `memory_profile` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory) while this tool set is visible. `memory_forget` and `memory_profile` appear only when their flags are `true`.

#### Token effect

Fixed schema cost on each request where the tools are visible; `memory_forget` and `memory_profile` add their own schemas only when enabled.

#### KV Cache effect

Prefix-stable while tool definitions and visibility are unchanged. Registering or disposing the tool set invalidates reuse from the first changed schema token.

### Results

#### What the model sees

`memory_recall` lists each hit as one line with its kind and relevance, or states that nothing matched. A degraded recall says the memory service was unreachable rather than reporting an empty search. `memory_write` reports acceptance, not storage, because the engine stores asynchronously. `memory_forget` reports how many memories it removed. `memory_profile` lists each non-empty section under its name, or states that nothing has been stored yet.

#### Token effect

Proportional to the number of recalled items and their length; the caller's `limit` bounds it.

#### KV Cache effect

Results arrive as tool messages after the cached prefix, so they extend the conversation without invalidating the prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- No profile tool: the seam's profile read is unimplemented in the shipped provider, so registering a tool for it would expose a guaranteed failure.
- No batch write tool: the model writes one fact per call. A batch shape waits for evidence that models produce several durable facts in one step often enough to justify it.

### Dev Note

<a id="dev-note"></a>

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
