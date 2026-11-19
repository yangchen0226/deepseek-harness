---
kind: upgrade-guide
description: "Web and desktop memory moves from the Memory preset to shared composition with isolated collections and a persistent switch."
---

# Shared memory collections

English | [中文](guide.zh.md)

## Change

Web and desktop load memory independently of the selected preset. The session switch persists across turns and mode changes. Automatic recall reads global plus the current workspace; model-initiated writes target only the current workspace. Legacy records remain in their original collection.

## Migration

1. Remove custom duplicate MemoryBear provider rows from the root profile when using the shipped shared provider. Configure the `memory-bear` row through the profile patch.
2. Keep `MEMORY_USER` stable. Workspace collections use the persisted workspace UUID, so retain workspace storage when moving a home directory.
3. Review the legacy collection before explicitly moving any records. No automatic copy or global promotion occurs.
4. Open Global memory and Workspace memory in the sidebar. Confirm the session memory switch survives a reload. MemoryBear must have sufficient end-user capacity for the account’s global and workspace collections.
5. To enable active memory on a qualified Messages model, set `memoryProtocol: framed-json-v1` on that model catalog entry. The harness validates complete framed calls; this does not claim a provider-native memory API. Use the collection page to save explicitly shared global preferences. Library filtering applies to the selected page.

Shared GUI composition disables whole-turn automatic writes by default. Enabled sessions still recall automatically; writes come from explicit model operations or human saves. Models without active protocol support require manual saves. Deployments retaining whole-turn ingestion can explicitly set `memory-autosave.writeOnTurnEnd: true`.
