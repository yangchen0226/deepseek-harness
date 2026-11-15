---
description: "Session-driven memory scheduling: a pre-step recall injected as a durable snapshot message and a turn-end write batch, with the memoryAutosave projection the client panel reads."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-autosave

English | [中文](README.zh.md)

## Summary

`dsh-memory-autosave` makes memory happen without the model asking. At the start of each turn it recalls memories for the newest user message and adds them as one snapshot-sourced user message, then records the recall on the session log. When the turn ends it submits the turn's user and assistant text as one write batch. Nothing here blocks a turn: a degraded recall proceeds without memory, and a refused write is recorded rather than thrown.

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
- name: '@deepseek-ai/dsh-memory-autosave'
  config:
    recallMode: quick
    recallOnTurnStart: true
    writeOnTurnEnd: true
    minMessageChars: 8
```

| Field | Default | Meaning |
|---|---|---|
| `recallMode` | `quick` | Retrieval breadth for the automatic recall |
| `recallOnTurnStart` | `true` | Whether the pre-step hook recalls at all |
| `writeOnTurnEnd` | `true` | Whether a finished turn is submitted |
| `minMessageChars` | `8` | Messages shorter than this are not recalled or stored |

<a id="understand-the-implementation"></a>
## Understand the implementation

- The recall runs on step 1 of a turn. It appends `memory/recall` first, then returns the proposed messages plus one user message whose `source.kind` is `memory-recall`. That is the same durable-injection form the request clock uses, so a replay reproduces both the event and the text.
- Recall text is rendered from the recalled items, never from the session's own history, so the model cannot be fed its own earlier output as memory.
- The turn-end write reads the `memoryAutosave` projection's `turnText`, which collects user and assistant text since the last `turn/start` and skips the plugin's own injected message.
- Every failure on the write path lands on a `memory/write` event with `queued: false` and an `error`; the turn is already over, so nothing is retried inside the hook.

<a id="model-experience"></a>
## Model Experience

### Recalled context message

#### What the model sees

Before the first step of a turn, the consumer appends one user-role message carrying the recalled memories under a fixed heading. The message is sourced `memory-recall`, so a later step can tell it apart from what the human typed.

##### Recall block

```markdown
Relevant memories from earlier sessions:
- <recalled memory text>
```

#### Token effect

Proportional to the number of recalled items and their length; the consumer's `recallMode` bounds how many the engine returns.

#### KV Cache effect

The block is a message, not a prompt section, so it appends to the conversation instead of rewriting the cached prefix. A turn with no recall adds nothing.

### Turn-end write

#### What the model sees

Nothing. The batch is submitted after the turn ends and appends a `memory/write` event the model never reads.

#### Token effect

None; no write outcome enters a subsequent request.

#### KV Cache effect

The write happens after the turn ends and contributes nothing to any later request, so no cached prefix depends on it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Recall runs on every eligible turn rather than behind a relevance heuristic; a deployment that wants fewer recalls sets `recallOnTurnStart: false` and relies on the model-facing tool.
- The write path submits whole user and assistant messages. Tool output is not stored, so a fact learned only through a tool call is lost unless the assistant restates it.

### Dev Note

<a id="dev-note"></a>

The projection `memoryAutosave` is the client's only data source; behavior tests drive the real `agent/pre-step` waterfall and a real session store.
