---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-18-scoped-memory-policy

English | [中文](2026-11-18-scoped-memory-policy.zh.md)

## Summary

Adds persistent memory policy, explicit collection scope, capability reporting, and native call/result discriminators.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-18-scoped-memory-policy
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-16-memory-session-events"
    after: "ef9c37fcbcc1acccb80d13034532f829f0239603494fad115baf7b825695c473"
    decision: same-version
  - root: "event:assistant/attempt"
    previous: "2026-09-16-session-format-v4"
    after: "cbe53b5476e7a0582692e0bdcf6b76c24e5fa3bc204a2b1ef170c7b5010ec412"
    decision: same-version
  - root: "event:assistant/message"
    previous: "2026-09-16-session-format-v4"
    after: "11f9da2717ef51140810384168565142abdfaf08cc177f67d97105585d1a605c"
    decision: same-version
  - root: "event:compaction/summary"
    previous: "2026-09-16-session-format-v4"
    after: "35e389ba82fbed16168c3eead3139f8459d02498d0e009b95119b401ea5f8f6e"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-16-memory-session-events"
    after: "e792e913d1dc6be1fed100841ffc44c9dcb9c61daa8500dc46a37396186dbfe7"
    decision: same-version
  - root: "event:memory/call"
    previous: null
    after: "e54e3dd2b9f20f546115ab810bf12ea4afeb1dac5f52f0dbc01a44ed4109961d"
    decision: same-version
  - root: "event:memory/capability"
    previous: null
    after: "2973092085eed81c312d14b5cc240b0f0a8dc7326e3b0baa8fa94b4f511e7254"
    decision: same-version
  - root: "event:memory/recall"
    previous: "2026-11-16-memory-session-events"
    after: "4023d6688c5e138d6b4106d82b303646af4d71ac36ac42a7d1b3cdb5c841d2bd"
    decision: same-version
  - root: "event:memory/result"
    previous: null
    after: "02e047c39859e2e77065bdc46a23fd984a21b4ed611f0e869e6b105950e1e208"
    decision: same-version
  - root: "event:memory/settings"
    previous: null
    after: "832bd2f8a7a7d51b2c675cb24b8cf3dc8c609d4efa8b5ff64d1deb7d9bb69f4f"
    decision: same-version
  - root: "event:memory/write"
    previous: "2026-11-16-memory-session-events"
    after: "84fee265bfa826b70491b690b4ea211c65d3df006c2ef8056dfdaea9290bdf90"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-16-memory-session-events"
    after: "e7c9c56dda6ae49884a6aab61d2256fdb4f589d67a9627e98f36563d86556d4d"
    decision: same-version
  - root: "event:system/message"
    previous: "2026-09-16-session-format-v4"
    after: "024e96946bf4f6ebb092b8a373137bfc42dd22470f591c6ceaad2849eacf4688"
    decision: same-version
  - root: "event:team/message/queued"
    previous: "2026-09-16-session-format-v4"
    after: "d26e16ee1f6642652feb87d795e1953b5880f56c7b1d011324834210ff516299"
    decision: same-version
  - root: "event:tool/ptc-dispatch"
    previous: "2026-10-05-ptc-operation-metadata"
    after: "2380bea4272ee84fae9eb3788d76bd40d5b1eed8f68f96b18211f8b97d7e0c5d"
    decision: same-version
  - root: "event:tool/result"
    previous: "2026-09-16-session-format-v4"
    after: "698774b6049a458f668808e39d497287cf5fb4741251d4baa40614b10dccc93e"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-16-memory-session-events"
    after: "78919ebe48b4186e98a699ab4dc80c50b50db2432e30f80a39936fd9ac137765"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing events retain their discriminators and per-turn mute semantics; optional scope absence identifies the legacy collection. New required settings, calls, results and native message blocks have distinct discriminators: older readers must reject unknown required events instead of silently executing or dropping them. Native execution occurs only on committed live assistant operations, never on replay. No adapter advertises nativeMemory without transport support.

<a id="verification"></a>
## Verification

120 focused tests passed across memory, UI, agent-loop interception and TypeScript SDK. The Python SDK native-memory projection passed. A live MemoryBear test verified scoped write, recall, list, profile and isolation. The full build passed all 10 gates.

<a id="dev-note"></a>
## Dev Note

None.
