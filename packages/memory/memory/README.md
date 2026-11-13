---
description: "The long-term memory capability seam (ctx.memory): recall, write acceptance, profile reads, and reachability over a pluggable engine, for maintainers composing a memory provider and consumers building memory tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

## Summary

`dsh-memory` defines what the harness means by long-term memory, without choosing where it lives. A provider implements the `ctx.memory` service; tools, the session lifecycle, and the client panel consume it. The definition fixes four semantics that every provider must honor: recall degrades instead of throwing when the engine is unreachable, a write reports acceptance rather than storage, removal is either real or explicitly unsupported, and every result is JSON-serializable so a caller can append it to a session event unchanged.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Consumers depend on this package for types and the abstract class; deployments depend on it to satisfy the seam.

```ts
import { MemoryEngine } from '@deepseek-ai/dsh-memory'
import type { MemoryRecallRequest, MemoryRecallResult } from '@deepseek-ai/dsh-memory'

export class MyEngine extends MemoryEngine {
  async recall(request: MemoryRecallRequest): Promise<MemoryRecallResult> { /* ... */ }
  // remember, forget, profile, health
}
```

Every request carries an explicit mode and the turn it belongs to; a provider resolves defaults inside its own `resolve` step, never at the call site.

<a id="understand-the-implementation"></a>
## Understand the implementation

- `MemoryRecallResult.degraded` is the only signal that the model is running without memory. A consumer must surface it, never treat an empty item list as "nothing matched" when `degraded` is true.
- `MemoryRememberResult.queued` is acceptance, not durability. Upstream engines store asynchronously; a consumer that needs to know a write landed must recall it.
- `MemoryForgetResult.removed` counts real removals. A provider whose backend exposes no removal rejects with `MEMORY_UNSUPPORTED`; consumers register the forget tool only where that promise holds.
- Error codes live in `MEMORY_ERROR_CODES`; route on `MemoryError.code`, not on message text.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- No local (embedded) provider ships in this package; the seam exists so one can be added without touching consumers.
- The definition has no notion of memory scopes beyond one caller identity. Cross-user or cross-workspace sharing would need a scope field and a provider that honors it.

## Dev Note

Type-only package: no runtime behavior beyond the abstract class. Structural tests live in `tests/service.spec.ts`.
