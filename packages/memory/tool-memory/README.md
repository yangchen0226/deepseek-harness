---
description: "Model-facing memory tools: memory_recall, memory_write, and an opt-in memory_forget over the DSH memory seam, each appending a durable session event."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-memory

English | [中文](README.zh.md)

## Summary

`dsh-tool-memory` gives the agent explicit memory control. `memory_recall` searches durable memories with a rewritten question; `memory_write` records one affirmed fact; `memory_forget` removes one and is registered only where the backend supports removal. Every call appends a `memory/recall`, `memory/write`, or `memory/forget` event, so the transcript and the memory panel show exactly what the model did.

## Use this package

```yaml
- name: '@deepseek-ai/dsh-tool-memory'
  config:
    defaultMode: quick
    enableForget: false
```

| Field | Default | Meaning |
|---|---|---|
| `defaultMode` | `quick` | Retrieval breadth when the model omits `search_mode` |
| `enableForget` | `false` | Whether `memory_forget` is registered |

### What each call does

- `memory_recall(question, search_mode?)` calls the seam, appends `memory/recall` with items and trace, and answers with the raw items. A degraded engine returns an empty list and an instruction to continue without memory; the tool does not fail.
- `memory_write(content, kind)` submits one message, appends `memory/write` with `queued` and any batch id, and reports acceptance.
- `memory_forget(target)` calls the seam and appends `memory/forget`; an unsupported backend surfaces its error to the model.

## Understand the implementation

The tool path does not know its turn number: the execution context carries none and the session exposes no current-turn reader. The enclosing `tool/call` event already records the turn, so memory events omit it. The session id comes from the owning agent; `memory_write` rejects a caller with no session rather than inventing one.

## Known Limitations and Deferred Work

- No profile tool: the seam's profile read is unimplemented in the shipped provider, so registering a tool for it would expose a guaranteed failure.
- No batch write tool: the model writes one fact per call. A batch shape waits for evidence that models produce several durable facts in one step often enough to justify it.
