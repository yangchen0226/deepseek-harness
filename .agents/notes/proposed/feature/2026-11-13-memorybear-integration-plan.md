# Agent Note: Workspace and global memory with native model calls

Status: proposed

English | [中文](2026-11-13-memorybear-integration-plan.zh.md)

## Problem

Memory is currently composed by the Memory preset. Switching modes can remove its provider and lifecycle consumers, while a visible toggle can suggest capabilities the session does not have. The provider resolves one configured end user, so workspace memory and global memory are not isolated. Successful list/profile requests and an accepted write do not establish complete integration with MemoryBear.

This proposal makes memory a mode-independent capability with native model calls, workspace navigation, and a global navigation entry. These are target behaviors, not claims about the current implementation.

## Proposal

All shipped agent modes receive the same memory capability from shared composition. Mode selection controls the agent workflow; memory policy separately controls access. The dedicated Memory preset is no longer the prerequisite. Existing sessions retain their history and receive an explicit migration of their effective memory policy.

Every mode exposes a memory switch. Proposed semantics: account and workspace settings supply defaults, a session override persists across mode changes, and an explicit turn override applies to one turn. Effective policy is resolved and recorded before model admission; it distinguishes automatic recall, automatic writing, and model-initiated operations.

Disabling memory stops new recall and write admission, including model-initiated calls. Queued remote writes are not retroactively cancelled; recalled text already present in session history is not erased. The UI explains these limits. Manual browsing remains available. An unconfigured service shows setup guidance; enabled, unavailable, and off are distinct states.

## Memory scopes

Global memory means the current user’s explicitly shared memory across their workspaces, not all users’ data or an automatic union of workspace stores. Workspace memory contains that user’s project facts, decisions, and conventions. Team-shared memory is a separate future permission model.

Recall may query global memory and the active workspace, preserving scope and source on every result. Workspace-specific instructions take precedence over conflicting general preferences, with conflicts retained for inspection. A write has exactly one target scope; project facts default to workspace scope. Cross-workspace preferences enter global memory only through an explicit user instruction or a reviewed policy.

The Host resolves an opaque stable user ID and a persisted workspace ID. Paths and display names are not identity keys. Bindings are keyed by deployment, remote tenant/workspace, user, and scope, and survive restarts and renames. Moving a local workspace to another machine requires an explicit identity binding.

MemoryBear workspace_id is selected by the API key and is not automatically a DSH workspace. The existing provider lacks a scope field. First validate whether separate end_user bindings can isolate each DSH scope across write, recall, list, and profile; otherwise extend the backend with explicit scope filtering before enabling this UI. Renaming an entry or filtering the first list page is not isolation.

Existing MEMORY_USER data remains an explicitly identified legacy collection until the user assigns its destination. Do not duplicate it into every workspace or silently promote it to global memory. Mapping changes require a reversible migration plan.

## Native model calls

The proposed runtime types are memory-call and memory-result. A call carries callId, operation (recall, write, or profile), scope, and operation-specific arguments. Results correlate by callId and carry a bounded payload, source references, and an explicit outcome. Deletion remains unavailable until the backend provides an authorized deletion API.

Memory calls are parsed as typed model output and dispatched by a dedicated memory execution service. They do not register in the ordinary tool catalog, enter the tool executor, or produce generic tool cards. A model adapter must declare and implement its encoding of requests, streaming blocks, results, and continuation. Native support is not established merely by naming a tool differently.

The current LLM protocol has no memory-call type. Define capability negotiation and validate each supported model protocol before claiming model-initiated memory works. A provider without a dedicated channel needs an explicit structured-output protocol with validated framing; do not execute memory commands extracted from arbitrary prose or tool results. Unsupported adapters retain policy-controlled automatic memory but visibly disable model-initiated memory, with no silent tool fallback.

The executor checks effective policy, allowed scope, payload limits, and call identity before dispatch. Only complete validated calls execute. Cancellation stops new admission; an interrupted remote write is reported as outcome unknown and is not blindly retried. Deduplication must cover reconnects and replay; remote idempotency must be verified before retrying writes. Reads and results are logged before reaching model continuation, and replay never repeats remote effects.

Add calls through documented extension points where possible. Any required agent-loop extension updates architecture documentation, the TypeScript and Python SDK projections, stream assembly, session reader compatibility, and an upgrade guide. The old tool-memory path is retired only after native callers and persisted history readers have replacements.

## Navigation and views

The main sidebar gains a Global memory entry outside workspace groups. Each workspace gains a Workspace memory entry under its own group. Both open a full memory page independent of any live session. The session sidebar remains a compact Memory activity inspector with links to the relevant collection.

Each memory page has Activity, Library, and Profile views with its scope permanently visible. Global profile describes the user’s shared preferences; workspace profile describes project conventions and context. Workspace pages do not present project summaries as personal traits.

Activity separates recall and write records and identifies automatic or model-initiated origin, session, scope, and time. Recall shows query, matches, source references, and degradation. Writes distinguish accepted, processing when observable, indexed when confirmed, failed, and outcome unknown. No processing or indexed state is inferred from an accepted task ID.

Library reads the actual scoped MemoryBear collection with pagination, detail access, and honest search semantics. The existing provider only filters one fetched page; full-library search requires a backend search endpoint or an explicitly bounded alternative. Profile shows the corresponding backend summary and its observable freshness. Empty, loading, unauthorized, unavailable, and unsupported states are distinct.

Cross-session activity needs a durable index keyed by user and scope, with event references and a replayable rebuild strategy. Live agents cannot own the only copy. Session activity is derived from its durable events; browsing a library or profile does not inject those contents into a model or append false session operations.

## MemoryBear integration

The provider owns credential resolution, workspace authorization, scoped end-user bindings, HTTP validation, timeouts, and backend capability detection. Credentials remain on the Host. The current /v1 API supports write, recall, list, and profile; an accepted write is asynchronous, and no public task-status or deletion API has been established for this integration.

End-to-end completion requires the same scoped record to be observable in both DSH and the MemoryBear console, including asynchronous extraction and profile refresh. Polling must be bounded and cancellable. If no reliable write-to-record correlation exists, retain accepted status and offer an explicit refresh instead of declaring success from a similar text match.

## Implementation order

1. Define scope identity, permissions, switch semantics, migration, and the provider capability matrix. Validate isolation on the real deployment before creating scope-specific pages.

2. Move memory composition out of presets and provide the switch in every mode. Preserve history, avoid duplicate autosave listeners, and test old and new sessions across mode changes.

3. Implement native calls and adapter capability negotiation, policy enforcement, durable events, and SDK projections. Qualify a real model end to end before enabling model-initiated memory.

4. Add workspace and global navigation, durable activity browsing, scoped library and profile pages, and backend-correlated write feedback. Verify rendered states in light/dark themes and constrained widths.

5. Complete recorded offline replay, real-service tests, restart recovery, cross-scope negative tests, and upgrade documentation. Graphs, forgetting management, and persistent Agent creation remain separately scoped follow-ups.

## Alternatives considered

A memory-only preset is rejected because it couples independent choices. Identical global and workspace pages backed by one end user are rejected because labels cannot enforce isolation. Ordinary memory tools are rejected for the target model interaction. Arbitrary prose parsing is rejected because it cannot distinguish an executable call from quoted content.

Keep MemoryBear remote instead of embedding its Python stack. Keep a Service Definition, Provider, and dedicated Consumers so backend details do not enter agent modes or client components. Automatic memory and native model calls share policy and service execution but keep distinct activity origins.

## Acceptance criteria

- Every shipped mode exposes memory control; switching modes preserves effective policy. Turning memory off blocks new automatic and model-initiated operations.

- Workspace A cannot read workspace B facts. Explicit global preferences are available in both. Renaming, restarting, and opening pages without a live session preserve the same scoped data.

- A real model emits a native call, receives its result, and continues. Streaming interruption, malformed frames, denied scope, and replay cause no unintended write; no ordinary memory tool appears.

- DSH activity, stored memories, and profile updates reconcile with MemoryBear for a dedicated test user. Accepted writes are never labelled indexed without evidence. Authentication failure is never displayed as an empty library.

- Compatibility checks cover old sessions and both SDKs; recorded replay is offline and deterministic. Changes to GUI behavior have real-server visual verification, and a GUI PR includes the required recording.

## Open questions

Default-on policy, separate read/write controls, and whether explicit global writes require confirmation remain product decisions. Native transport support must be qualified per configured model. Separate end-user bindings versus backend scope fields must be decided from isolation evidence. None of these is resolved by adding a sidebar label.

## Risks

Native model protocol support, remote scope isolation, and asynchronous write visibility need real validation. Until verified, do not allow cross-scope access, retry writes with unknown outcomes, or claim indexing succeeded. Legacy migration needs explicit ownership and a recovery path.
