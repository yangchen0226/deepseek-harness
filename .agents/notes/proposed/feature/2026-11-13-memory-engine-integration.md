# Integrating the MemoryBear memory engine into DSH

## Problem

DSH sessions are long-lived but memory-less across sessions: the harness reconstructs context from one session log, while a user's durable knowledge — preferences, project facts, past decisions — is either re-pasted each session or lost. MemoryBear is a separate Python system (FastAPI + Neo4j + Elasticsearch + Celery) with a mature memory lifecycle (perceive, extract, associate, forget) and a retrieval-trace protocol, but no DSH consumer.

The integration must answer four product questions:

1. How does a session *show* memory — what the agent recalled, what it wrote, why.
2. How does a session *schedule* memory — recall before model requests, write after turns, forget by policy.
3. How does a user *create* a memory-enabled agent — a preset, not a hand-edited config.
4. What does the memory UI look like *inside the session window*.

## Proposal

### 1. A capability seam, not a port

MemoryBear is a remote service, not a library to embed. DSH consumes it through the standard three-role capability seam:

- **Service Definition** — `packages/memory/memory/` owns `memory` service types and the request/spec split. Methods: `recall(request)`, `remember(request)`, `forget(request)`, `profile(request)`, `graph(request)`, `health()`. Every request is explicit; defaults are resolved inside the provider, never at the call site.
- **Service Provider** — `packages/memory/memory-bear/` implements the definition over MemoryBear's HTTP API (`/v1` API key, `/api` JWT for admin surfaces). Config: `baseUrl`, `apiKey`, `workspaceId`, `endUserBinding`, `searchMode`, `writeQueue`, `timeouts`. A later `memory-local` provider (SQLite + embeddings) is possible without touching consumers.
- **Consumers** — tool package, session lifecycle hook, client UI panels, agent preset.

This keeps Python-only concepts (Neo4j node labels, Celery queues) behind the provider boundary.

### 2. Identity mapping

| DSH | MemoryBear |
| --- | --- |
| workspace / project root | `workspace_id` |
| user (`identity`) | `end_user_id` (one durable map, stored in `packages/storage`) |
| session | `conversation_id` (so per-conversation flush works) |
| turn | write batch unit; `metadata.turnId`, `metadata.agentId` |

The end-user map is a settings-level record: `{ dshUserId → { endUserId, workspaceId, createdAt } }`. Unmapped users are provisioned on first recall/write via MemoryBear's end-user endpoint.

### 3. Session behavior

**Recall (read path).** At turn start, `agent/pre-step` calls `recall` with the user's message rewritten as a retrieval question and `searchMode` from config (`quick` by default). The result is appended as `memory/recall` and surfaced to the model through a `systemPrompt.context()` entry whose text function reads the `memory.recall` projection, so a replay reproduces exactly what the model saw. There is no generic pre-request hook that appends arbitrary system content; `agent/pre-step` may not change the system prompt, and `agent/request` is deprecated and cannot mutate messages. Recall must never block forever: provider timeout returns an empty recall with `degraded: true`.

**Write (write path).** After `turn/end`, the consumer batches user + assistant + tool-summary messages and calls `remember` with `fast_write` semantics. Denial and failure are non-fatal and reported as a session event, never silently swallowed. An explicit `memory_write` tool lets the model request a write mid-turn for facts worth pinning.

**Forget.** Only through the `memory_forget` tool or the UI's forget action, both logged. Automatic forgetting is MemoryBear's own scheduled pipeline; DSH does not run a second decay policy.

### 4. Model-facing tools

Exact names and params mirror MemoryBear's existing LLM tool contract so the two stay comparable:

| Tool | Params | When the model calls it |
| --- | --- | --- |
| `memory_recall` | `question` (rewritten), `search_mode` (`deep` \| `normal` \| `quick` \| `express` \| `meta`) | User asks about a preference, past decision, or entity learned earlier; pre-turn recall missed it |
| `memory_write` | `content`, `kind` (`preference` \| `fact` \| `event` \| `relationship` \| `procedure`), `confidence` | User states a durable fact or asks to remember |
| `memory_forget` | `target` (memory id or natural-language selector) | User asks to forget; correction of a wrong memory |
| `memory_profile` | `section` (`basic` \| `interests` \| `habits` \| `emotions`) | Answering "what do you know about me" |

Descriptions are model-perspective only: no HTTP, queue, or graph vocabulary.

### 5. Session events (Model-visible ⟺ logged)

Declared by merging into `SessionEventMap` in `packages/session/session/src/types.ts`:

- `memory/recall` — `{ question, mode, degraded, items[], trace }` where `trace` carries MemoryBear's stages (`profile_loaded`, `query_split`, `hybrid_searched`, `relation_searched`, `results_merged`, `result_ready`) and scores.
- `memory/write` — `{ batchId, items[], queued, error? }`
- `memory/forget` — `{ target, removed, error? }`
- `memory/profile` — `{ sections, items[] }`

UI and projections derive from these events only; the provider holds no UI state.

### 6. Client UI inside the session window

Eight MemoryBear pages collapse into one right-sidebar panel with tabs, because a session window has room for one panel, not a console:

| Tab | Source page(s) in MemoryBear | Content in DSH |
| --- | --- | --- |
| Memories | UserMemory, UserMemoryDetail | searchable memory list, per-item producer/score/age, delete |
| Graph | UserMemoryDetail/GraphDetail, D3Graph | entity/relation neighborhood for the current session's entities |
| Recall trace | Chat/MemoryRecall, MemoryConversation | per-turn stage timeline, hit counts, MemoryRecallIndex |
| Profile | BrainMemory, UserMemory subject detail | basic facts, interests, habits, emotion trend |
| Forgetting | ForgettingEngine, ForgetDetail | enqueued/last cycle, items in sleep/decay/clear |
| Agents | AppManagement, ApplicationConfig | list/create memory-enabled agent apps, draft run |

Conversation-surface additions: a compact recall chip above the assistant message (`recalled N memories · view trace`), a memory toggle in the composer (disable recall for this turn), and an inline card for `memory_write` results. A tab type registers through `ctx.sidebarRightTabs.register({ id, kind, title, guide })` and its body through the keyed slot `sidebar.right.pane.tab`, both inside `ctx.effect` to prove disposal; the chip registers on `conversation.chat.node` / `conversation.session.header.actions` like `ui-jobs` and `ui-goal`.

### 7. Agent creation through a session

Two paths, both preset-driven:

1. **In-session creation.** `memory_agent_create` tool (gated by an agent-preset permission) takes `name`, `role` (`standalone` \| `master` \| `sub`), `skills`, `memory` config. It writes a preset under `packages/preset/agent-preset` and, when the MemoryBear app surface is enabled, mirrors it as a MemoryBear app (`POST /api/apps` with `agent_config.memory`). The response names the created agent; the user can start it immediately.
2. **Preset selection.** A shipped `memory` preset composes tool-memory + memory-autosave + a persona with recall-first instructions. Selecting it in the session composer is the zero-config path.

Scenario doc: `docs/memory/usage-scenarios.md`.

### 8. File-level plan

Host packages (new group `packages/memory/`):

```
packages/memory/
  memory/                      service definition: types, request/spec split, brand ids
  memory-bear/                 provider: HTTP client, contract validation, retries
  memory-autosave/             consumer: agent/pre-step recall + turn/end write
  tool-memory/                 consumer: memory_recall / memory_write / memory_forget / memory_profile
```

Client packages:

```
packages/client/ui-memory/     right-sidebar tab type `memory://session/<id>`, six tab bodies
packages/client/ui-chat/       recall chip + composer memory toggle (existing package, additive)
packages/preset/agent-preset/  shipped `memory` preset
```

Wiring: add both host plugins to the relevant profile bundle in `packages/bundle/`; add the client plugin to the Web app composition. Session events merge into `packages/core/session/src/types.ts` consumers via the package's own `declare module`.

The hook sequence inside `memory-autosave`:

1. `agent/pre-step` (prepend) — resolve user identity, call `recall`, append `memory/recall`, append the context message.
2. `turn/end` — enqueue `remember` with the turn's user/assistant/tool-summary events; append `memory/write` on settlement.
3. `ctx.on('agent/tool-call')` (if available) for the composer toggle state — otherwise the toggle lives in per-turn config only.

### 9. Usage scenarios

**S1 — Returning to a long project.** User opens a new session in a repo they worked on three weeks ago. Pre-step recall runs `quick` on "what did we decide about the migration script". Two memory items return: the chosen approach and the rejected alternative. The chip shows `2 memories`; the model answers without re-reading the repo, and cites the decision. Trace tab shows which hybrid search hits produced them.

**S2 — Preference that must survive.** User says "以后别用 npm，用 pnpm". The model calls `memory_write(kind: preference)`. The panel's Memories tab gains an item with age `now`; a later session's recall returns it and the agent stops suggesting npm. If the user says "forget that", `memory_forget` removes it and the panel shows the removal.

**S3 — Cross-agent handoff.** A master agent delegates to a sub-agent with a different preset. Both resolve to the same `end_user_id`; the sub-agent's recall sees the master's writes. This is the MemoryBear "multi-agent data island" problem solved at the identity layer, not by copying context.

**S4 — Forgetting in practice.** User asks "what's my old phone number?" MemoryBear's forgetting pipeline has already demoted it (low strength, stale). The trace marks it `decayed`; the agent says it no longer holds that detail rather than answering stale data. The Forgetting tab shows the sleep/decay/clear bucket it's in.

**S5 — Agent creation in conversation.** User: "帮我建一个只关注前端重构的 agent，记得我的技术栈偏好". The `memory_agent_create` tool creates a preset with `memory.mode: deep`, `skills: [frontend-refactor]`, persona that recalls preferences first. It appears in the Agents tab and is startable immediately; when the app surface is enabled, the same call mirrors a MemoryBear app so the same agent is usable from other clients.

**S6 — Degraded mode.** MemoryBear is unreachable. The pre-step recall times out in 800 ms, appends `memory/recall { degraded: true }`, and the turn proceeds. The chip reads `memory unavailable`; nothing is silently dropped, and the session log records exactly what the model did not receive.

**S7 — Privacy boundary.** A user disables memory for one turn from the composer. `agent/pre-step` skips recall for that turn only; `turn/end` skips the write. The panel toggle state is derived from the session event, so replay shows the same disabled turn.

## Alternatives considered

**Embed the Python engine.** Rejected: Neo4j + ES + Celery are not embeddable in a Node harness, and would fork the upstream lifecycle.

**Client-side direct HTTP.** Rejected: bypasses the session event requirement, so nothing is replayable, and leaks credentials into the browser.

**Single monolithic `memory` package.** Rejected: the seam must have a provider split to allow a local provider and to keep Python-specific vocabulary out of consumers.

## Acceptance criteria

- A session with the memory preset recalls prior-session facts and shows the trace in the panel.
- Every recall/write/forget/profile appears in the session log and replays into the same UI.
- Provider down: recall degrades within timeout, turn proceeds, UI shows degraded state.
- Switching a provider from MemoryBear to a stub leaves consumers unchanged.
- `memory_agent_create` produces a runnable agent in-session and a matching MemoryBear app when configured.

## Risks

- **Latency**: pre-turn recall adds a network hop. Mitigation: `quick` default, parallel with context assembly, hard timeout.
- **Duplicate memory**: both DSH compaction and MemoryBear summarize. Boundary: compaction owns the session window; MemoryBear owns durable knowledge.
- **Consent/privacy**: memories leave the machine. Mitigation: explicit `memoryWrite.enabled` and per-turn toggle; the end-user map is local.
- **Version drift**: MemoryBear API is pre-1.0. Mitigation: pin the provider to its `external_api_contract.json` shape and validate responses at the wire boundary.

## Open questions

- Should recall run before every turn or only when the user message scores above a cheap heuristic?
- Is mirroring agent creation into MemoryBear apps in scope, or is DSH preset-only enough for v1?
- Who owns end-user lifecycle cleanup when a DSH user is removed?
