---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-16-memory-session-events

English | [中文](2026-11-16-memory-session-events.zh.md)

## Summary

Adds the memory integration's Session events (memory/recall, memory/write, memory/forget, memory/profile, memory/mute, memory/agent-created) and the memory-recall message source the autosave consumer injects recalled text under.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-16-memory-session-events
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-27-retry-control-input"
    after: "6e0e2169ea7fcf13aeb7f21f5c45dc46a1ef6b0b5ae34cd9fdcf6b9e0cbd042a"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-27-retry-control-input"
    after: "6653244ee4ac34c6c2b9ca50f9e9ce7fa066c37db25908016f6a25908310eef3"
    decision: same-version
  - root: "event:memory/agent-created"
    previous: null
    after: "9b678df5aedfcd67dbac00c448862507078808f251cdf850a79a2a20e96d425e"
    decision: same-version
  - root: "event:memory/forget"
    previous: null
    after: "92d5148a3b92e6bd4d2027721fce45ab430bf840266bdd0c1bbbf43d74495aa4"
    decision: same-version
  - root: "event:memory/mute"
    previous: null
    after: "8b35860d9cce61e4b89f879cbd849324ef75eba54f6ebf666cfdd816ad4609c0"
    decision: same-version
  - root: "event:memory/profile"
    previous: null
    after: "50c72ce73877af57cf2691b24e592add23869838568468f5e8ddffdf854c5f0e"
    decision: same-version
  - root: "event:memory/recall"
    previous: null
    after: "b29f91e46b8f006b85e3ddb168ccb87f36128044206ff4d22d21d6e84ac0956d"
    decision: same-version
  - root: "event:memory/write"
    previous: null
    after: "a9174f8352b50346fa5982309110c5b64b69639eb0c7bbed7de5be32458d86d2"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    after: "af7db5bc55f1d4b161440f836150a92ded00388002eaaf8cb5dabd2564ce93a1"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    after: "c6c99a228c92fa35341b0c25d57f7de2b24457a0e57726a4b4167ddc230cc65f"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Every change is additive, so a reader of this version interprets every earlier log unchanged. An older reader refuses any log the memory integration wrote instead of misreading it: a memory-recall message is only injected after the consumer appends memory/recall to the same log, and that event type is outside the older reader's known set without an ignorable marker, so the refusal happens before the new message source is ever interpreted.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/memory packages/api/memory-controller packages/client/ui-memory packages/bundle/web-app/tests/memory-preset.spec.ts: all tests passed. A web session using the memory preset was written, the server restarted, and the session reopened; before KNOWN_SESSION_EVENT_TYPES included these events the reopen was refused with "unknown to this harness".

<a id="dev-note"></a>
## Dev Note

None.
