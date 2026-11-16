# Agent Note: Deep MemoryBear integration plan

Status: proposed

English | [中文](2026-11-13-memorybear-integration-plan.zh.md)

> Status: P0 has landed and is verified (2026-11-13); the P1 recall panel has landed; the rest is follow-up work.

## Problem

**Architecture (2026-11-16).** Every memory operation depends on the hosted MemoryBear service at `https://cloud.memorybear.ai`, reached by the `memory-bear` provider over MemoryBear's API-key surface (`/v1`). An interim self-hosted HTTP service on local PostgreSQL and its `memory-remote` provider were removed: two backends with different semantics would leave the shipped default ambiguous, and nothing consumed the second. A self-hosted MemoryBear remains possible by pointing `MEMORYBEAR_BASE_URL` at it.

The `memory` preset enables its memory rows only when `MEMORYBEAR_API_KEY` names a key with the `memory` scope, created in the MemoryBear console. The hosted `/v1` surface serves recall, writes, end-user binding, the stored-memory timeline (`/v1/memory-display/written`), and the cached user summary (`/v1/memory/analytics/user_summary`); it has no removal route, so the preset does not register `memory_forget`.

A real web session on gpt-6-astra exercised the whole path — preset selection, pre-step recall, turn-end write, a model `memory_write`, the three panel views, the dock switch, and reopening the session after a restart. That run found five defects no unit suite reached; [packaging and composition constraints](#packaging-constraints-learned-the-hard-way) records them. That run used the interim self-hosted service; the hosted MemoryBear path is verified against a stub of its `/v1` routes and a live unauthenticated probe of `cloud.memorybear.ai`, and its end-to-end test waits on a MemoryBear API key.

The hosted read path runs retrieval upstream across a cross-border link, so the provider's 800 ms default would degrade healthy recalls; the preset sets `timeoutMs` to 8000 ms and leaves `MEMORY_TIMEOUT_MS` as an override.

| Package / directory | Contents | Tests |
|---|---|---|
| `packages/memory/memory` | Service Definition: `ctx.memory`, request/result types, `MemoryError` codes | 3 |
| `packages/memory/memory-bear` | **Default provider**: hosted MemoryBear — recall, write, browse, profile, degradation | 9 + 1 e2e |
| `packages/memory/tool-memory` | `memory_recall` / `memory_write` / `memory_forget` | 5 |
| `packages/memory/memory-autosave` | `agent/pre-step` recall injection + `turn/end` batch write + the `memoryAutosave` projection | 5 |
| `packages/memory/memory-agent` | `memory_agent_create`: composes and registers a memory-enabled agent preset | 3 |
| `packages/client/ui-memory` | Right-sidebar memory tab: recall / library / profile views, header entry, dock switch | 20 |
| `packages/api/memory-controller` | Panel Remote endpoints: `list` / `profile` / `forget` / `health` / `mute`, resolving the engine per Session | 9 |
| `packages/bundle/web-app/presets/memory.patch.yml` | The `memory` preset; memory rows stay disabled while `MEMORY_SERVICE_URL` is unset | — |

Not implemented (explicitly deferred):

- Graph tab: the seam has no relation model, so there is nothing to read; it first needs `MemoryEngine` and every provider extended.
- Forget tab: the library deletes individual memories, but no read-only view groups them by decay stage.
- Agent tab: created agents appear through the existing preset picker; `memory_agent_create` exists, but the preset is not persisted and dies with the process.
- Semantic vector retrieval: only lexical plus pg_trgm similarity today, with no embeddings.
- In-conversation recall chip: a `conversation.chat.node` kind renders only when the chat flow produces the node, which a memory plugin cannot add on its own.
- The per-turn memory switch has landed (`memory/mute` session event plus the `conversation.input.dock` switch); its state lives in the log rather than the client, because it decides whether the model sees recalled text and a replay must reach the same answer.
- A created agent is neither persisted nor mirrored to the cloud, so it is gone after a restart.
- A recorded session snapshot. Replay must run offline and keyless, but every shipped provider needs a remote service, so a deterministic memory scenario first needs an in-process engine (the local provider in the open questions). The GUI GIF is recorded from a real web server and real model rounds; it is not yet attached to a pull request.
- A Session the panel is opened in must be live: for a closed Session the panel finds no preset-scoped engine and reports browsing as unsupported. Acquiring the preset scope for a closed Session is not implemented.

### Packaging constraints (learned the hard way)

A new package cannot enter the desktop installer with `"private": true`: the release family's `patterns` are `packages/*/*/package.json`, `members()` skips private manifests, and a missing member fails in `prepare-package-set.ts` with `requires unpacked package`. The `files` array is prescribed exactly by `scripts/check-workspace-constraints.ts`; only a package with a runtime `./types` export may ship `lib/types/**/*.js`.

Composition constraints a real session exposed, each now covered by a test:

- A preset plugin that provides a service must sit in a `cordis:group` with `isolate` for that service, together with every consumer; otherwise the registry refuses the preset.
- Client Remote namespaces are mounted centrally by `api-remotes`, and liveshare must classify every endpoint.
- New `SessionEventMap` members need the generated `KNOWN_SESSION_EVENT_TYPES`; without it a session cannot be reopened.
- Context injections share the user role, so anything that reads "what the user said" must filter on the `user` source kind.

## Proposal

Do not port the Python engine into dsh. Build a **memory capability seam** (Service Definition / Provider / Consumer) and bring MemoryBear in as a remote provider. Each of the four product requirements has a host mechanism behind it:

| Requirement | dsh mechanism | Key file |
|---|---|---|
| A session shows memory | `ctx.systemPrompt.context()` persists the recall snapshot + the `memory/recall` session event | [system-prompt/src/index.ts:520](../../../../packages/core/system-prompt/src/index.ts) |
| A session schedules memory | The `agent/pre-step` waterfall (recall before a turn), `turn/end` (write after one), and tool calls | [time-context/src/index.ts:197](../../../../packages/context/time-context/src/index.ts) |
| Agent creation | A preset (`PresetDefinition` = id/name/plugins rows) plus an in-session creation tool | [agent-preset-registry/src/definition.ts:6](../../../../packages/preset/agent-preset-registry/src/definition.ts) |
| WebUI inside the session window | `ctx.sidebarRightTabs.register` plus the keyed slot `sidebar.right.pane.tab`; the in-conversation chip uses `conversation.session.header.actions` | [ui-sidebar-right/src/client/tab-registry.ts:94](../../../../packages/client/ui-sidebar-right/src/client/tab-registry.ts) |

Three repository constraints apply (verified, not design preferences):

1. **No hook injects arbitrary system content before every model request.** `agent/request` is deprecated and cannot change messages. Recall reaches the model through `systemPrompt.context()` (durable and replayable) or `agent.inject()` (visible to the next admitted request). Recall therefore always uses `systemPrompt.context()`.
2. **Model-visible ⟺ logged.** Every recall, write, forget, and profile read appends a `memory/...` session event, with its type merged into `SessionEventMap` in `@deepseek-ai/dsh-session/types`. `@mode` applies only to Cordis `Events`; `SessionEventMap` members carry prose JSDoc.
3. **No business branches at the provider boundary.** Neo4j, Celery, and ES vocabulary stays inside the `memory-bear` provider; consumers see only `recall/remember/forget/profile/graph`.

## Layering and package structure

```
packages/memory/
  memory/                  Service Definition: types, request/spec split, branded ids
  memory-bear/             Provider: MemoryBear HTTP client + contract checks + retries/timeouts
  memory-autosave/         Consumer: pre-step recall, turn-end write, degraded state
  tool-memory/             Consumer: memory_recall / memory_write / memory_forget / memory_profile
  memory-agent/            Consumer: in-session agent creation (preset registration + optional MemoryBear app mirror)

packages/client/
  ui-memory/               Tab type memory://session/<id>; the panel views
  ui-agent-preset/         (existing) a "memory-enabled agent" preset card, reusing the seat mechanism
```

Registration points (missing one fails at startup, `packages/client/AGENTS.md:145-154`):

- Host: a `packages/bundle/base/cordis.patch.yml` row + `packages/bundle/base/package.json` `dependencies` (**that file is the resolver manifest**) + `tsconfig.host.json` references.
- Client: a `packages/bundle/web-app/cordis.patch.yml` row + `web-app/package.json` + `tsconfig.client.json`.

### Service Definition shape

```ts
// packages/memory/memory/src/types.ts
export interface MemoryRecallRequest { question: string; mode: RecallMode; turn: number; limit?: number }
export interface MemoryRecallResult {
  items: readonly MemoryItem[]
  trace: readonly RecallStage[]        // profile_loaded → query_split → hybrid_searched → relation_searched → results_merged → result_ready
  degraded: boolean
  latencyMs: number
}
export type RecallMode = 'deep' | 'normal' | 'quick' | 'express' | 'meta'
```

`resolve(request): Spec` fills defaults (mode, limit, end-user binding) inside the provider; `run()` contains no `?? default`.

## Identity mapping

| dsh | MemoryBear |
|---|---|
| workspace root | `workspace_id` (**not sent per request**; derived from the API key) |
| the `identity` user | `end_user.id` (UUID); `other_id` is dsh's stable user identifier |
| session | `conversation_id` (sent on writes; reads go through `session_id?`) |
| turn | the write batch; `metadata.turnId / agentId` |

Authentication: `Authorization: Bearer <key>` or `X-API-Key` with a scope containing `memory`; base path `/v1`; also `X-Language-Type: zh|en`, `X-Timezone` (IANA) for display routes, and `X-End-User-Other-Id` for MCP and preference recall.

The mapping table is local non-session storage: `defineDomain({ name: 'memory-bindings', version: 1, tables: { users: ... } })`. First use calls `POST /v1/end_user/create { other_id }` (idempotent on `other_id`) and writes the returned UUID back into the local table.

**Contract constraints the provider must absorb, never leak to consumers:**

1. Writes are asynchronous: `/v1/memory/write` returns `task_ids` with no public status route; landing is checked with `GET /v1/memory-display/written`. A `memory/write` event therefore reports `queued`, never `stored`.
2. The `/v1` surface has **no** forget, reflection, working, short-term, episodic, or perceptual routes. Forgetting requires either (a) the management JWT against `/api/memory/forget-memory/*` (a second credential), or (b) a v1 delete tool on an internal endpoint. **P0 does not implement a forget tool**; the UI's forget tab renders read-only data (`/v1/memory-display/*` and dashboard counts), and an unavailable write path is hidden rather than shown as a dead button.
3. Reads are synchronous; `deep`/`normal` include LLM question-splitting and summarization (slowest), `express` is pure keywords (fastest). The default is `express`, configurable to `quick`.
4. Responses share the envelope `{code,msg,data,error,time}` with `code===0` for success; error codes 3009/3012/3014-3017 (auth, rate limit), 4001 (unknown user), and 1003 (bad parameter) map to `HarnessError`.
5. A `storage_type=rag` space has no graph, relations, or communities, and writes complete synchronously without `task_ids`; the provider branches on the workspace attribute while consumers keep one `recall/remember` meaning.

## Session behavior

**Recall.** In `agent/pre-step` (prepend): read the turn's user message → apply a very cheap rule for whether recall is worth it (skip short greetings and pure tool follow-ups) → call the provider's `recall` in parallel with a hard timeout → `session.append('memory/recall', ...)`. The `systemPrompt.context()` entry registered earlier carries the persisted recall into the next assembly.

Order matters: the `text` function of `systemPrompt.context()` reads **projection state** (the latest `memory/recall`) at assembly time rather than building a string inside pre-step, so a replay matches what the model actually saw.

**Write.** `turn/end` batches the user message, the assistant messages, and a summary of tool results into `remember(fast_write)` and appends `session.append('memory/write', { batchId, queued })`. A failure never interrupts the turn, but it must be recorded (the `error` field); silence is not allowed.

**Forget.** Only through the `memory_forget` tool or an explicit UI action, both logged. Automatic decay belongs to MemoryBear's own pipeline; dsh does not run a second policy.

**Degradation.** An unreachable provider produces `memory/recall { degraded: true, latencyMs }`, the turn continues, and the UI says memory is unavailable. It is never silently dropped.

## Model-visible tool contract

Names and parameters follow MemoryBear's existing LLM tool contract so the two sides stay comparable:

| Tool | Parameters | When the model calls it |
|---|---|---|
| `memory_recall` | `question` (rewritten retrieval form), `search_mode` (5 levels) | User asks about a preference, a past decision, or an earlier entity; pre-turn recall missed it |
| `memory_write` | `content`, `kind` (preference/fact/event/relationship/procedure), `confidence` | User states a durable fact or asks to remember |
| `memory_forget` | `target` (id or natural-language selector) | User asks to forget; correcting a wrong memory |
| `memory_profile` | `section` (basic/interests/habits/emotions) | Answering "what do you know about me" |

Descriptions stay in the model's voice: no HTTP, queue, or graph-database vocabulary.

## Client: MemoryBear pages → the session window

MemoryBear has eight memory-related pages (MemoryManagement, MemoryEngine, MemoryConversation, UserMemory, UserMemoryDetail, MemoryExtractionEngine, BrainMemory, ForgettingEngine, SelfReflectionEngine, EmotionEngine). The session window holds one right-side panel, so the pages **merge into a small tab set** and the rest become sections inside a tab:

| Tab | MemoryBear pages | Presentation in dsh |
|---|---|---|
| Library | UserMemory, UserMemoryDetail | Searchable list; each entry shows kind, date, and recall count; delete |
| Graph | UserMemoryDetail/GraphDetail, D3Graph | Neighbourhood graph of the current session's entities |
| Recall trace | Chat/MemoryRecall, MemoryConversation | Per-turn stage timeline, hit counts, retrieval trace |
| Profile | BrainMemory, the body of UserMemoryDetail | Basic facts, interests, habits, relationship notes |
| Forget | ForgettingEngine, ForgetDetail | **Read-only**: dormant/decayed/cleared stages and the last cycle (`/v1` cannot write; see §3 constraint 2) |
| Agent | ApplicationManagement, ApplicationConfig | Memory-enabled agent list, creation, draft dry run |

Conversation-surface additions (all through existing slots, no new mechanism):

- A recall chip above the assistant message: `recalled 3 memories · view trace` (`conversation.chat.node`, following ui-goal).
- A memory switch in the input dock that turns recall and writing off for the turn (`conversation.input.dock`).
- An inline card for `memory_write` results, derived by the client from `tool/call` plus `tool/result.meta` rather than rendered by the host.

A tab registration needs the same `id` twice: `ctx.sidebarRightTabs.register({ id, kind, title, guide })` and `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, Body)`, both inside `ctx.effect` to prove disposal.

## Agent creation

**The preset is the single source of truth.** `PresetDefinition = { id, name, description, order, plugins: rows }`. Two presets ship:

- `memory`: `memory-bear` + `memory-autosave` + `tool-memory` + persona (recall generously, write sparingly).
- An agent-studio variant that also mounts `memory-agent`, allowing creation of further agents from a conversation.

**In-session creation.** The `memory_agent_create` tool (mounted only by the studio preset) takes the name, the role, optional skills, and the memory mode:

```
memory_agent_create({ name, role: 'standalone'|'master'|'sub', skills, memory: { mode, writePolicy }, mirrorToMemoryBear })
```

It produces a registered preset beside the shipped ones and returns the agent's name, so the preset picker shows it immediately. Persisting presets and mirroring them to a MemoryBear application are deferred.

## Real usage scenarios

**S1 Returning to a project from three weeks ago.** A new session asks "how did we settle the migration script?". Pre-step recalls with `quick` and hits "option A" plus the rejected "option B". The chip shows 2 entries, the model answers and cites the decision without re-reading the repository, and the trace tab shows which retrieval lane produced each hit.

**S2 A cross-session preference.** The user says "use pnpm from now on, not npm". The model calls `memory_write(kind: preference)` and the library gains an entry. A later session recalls it, so the agent stops suggesting npm. The user changes their mind, says "forget that", and `memory_forget` removes it; the library shows the removal.

**S3 Multi-agent handoff.** A master delegates to a sub-agent on a different preset; both resolve to the same `end_user_id`, so the sub-agent's recall sees what the master wrote. This addresses the "multi-agent memory silo" MemoryBear itself names, through the identity layer rather than by copying context.

**S4 Forgetting takes effect.** The user asks about an old phone number. MemoryBear's decay pipeline already down-weighted it, the trace marks it `decayed`, and the agent answers that it no longer holds that information instead of quoting stale data.

**S5 Building an agent inside a conversation.** "Build me an agent that only does frontend refactors, and remember my stack preferences" produces `memory_agent_create` with `mode: deep`, a focused persona, and recall-first behaviour. The agent is startable immediately.

**S6 Degradation.** MemoryBear is unreachable. Recall times out, the turn proceeds with `degraded: true`, the panel says memory is unavailable, and the session log records exactly what the model did not receive.

**S7 Privacy boundary.** The user switches memory off in the input dock. Pre-step skips recall, turn-end skips the write, the state is derived from the event, and a replay shows the same turn as muted.

## Implementation order

**P0 (reviewable and mergeable on its own)**

1. `packages/memory/memory`: types plus contract tests.
2. `packages/memory/memory-bear`: the MemoryBear provider, with timeouts and degradation, tested against a local stub server.
3. `packages/memory/tool-memory`: the tools plus `SessionEventMap` declarations.
4. `packages/memory/memory-autosave`: pre-step recall, turn-end write, the degraded path.

**P1**

5. `packages/client/ui-memory`: the recall view and the header entry.
6. The library and profile views.
7. `packages/api/memory-controller`: the panel Remote endpoints.

**P2**

8. The per-turn switch and the dock.
9. Agent creation and the preset.
10. The graph and forget tabs, which need seam extensions first.

Every step also delivers a package README, JSDoc contracts, behaviour tests, and a Loader composition test; from P0 step 3 on it needs recorded session snapshots, and a UI change needs a GIF.

## Alternatives considered

**Embed the Python engine.** Rejected: Neo4j, ES, and Celery cannot be embedded in a Node harness, and it would fork the upstream lifecycle.

**Direct HTTP from the client.** Rejected: it bypasses the "model-visible ⟺ logged" rule, so nothing is replayable, and it leaks credentials into the browser.

**One monolithic `memory` package.** Rejected: the seam needs a provider split to admit a local provider and to keep Python-specific vocabulary out of consumers.

## Acceptance criteria

- A session with the `memory` preset recalls facts from earlier sessions and shows the retrieval trace in the panel.
- Every recall, write, forget, and profile read appears in the session log and replays into the same UI.
- With the provider down, recall degrades within its timeout, the turn proceeds, and the UI shows the degraded state.
- Swapping the provider for a stub leaves every consumer unchanged.
- With configuration enabling it, `memory_agent_create` produces a runnable agent in-session.

## Risks

- **Latency.** Pre-turn recall adds a network hop. Mitigation: `quick` by default, run beside context assembly, hard timeout.
- **Duplicated memory.** Both dsh compaction and MemoryBear summarize. Boundary: compaction owns the session window, MemoryBear owns durable knowledge.
- **Privacy.** Memories leave the machine. Mitigation: an explicit per-turn switch; the end-user map stays local.
- **Version drift.** MemoryBear's API is pre-1.0. Mitigation: pin the provider to its `external_api_contract.json` and validate responses at the wire boundary.

## Open questions

1. **Recall timing.** Recall every turn, or only when the user message clears a cheap heuristic? (The plan defaults to the latter, to save latency.)
2. **Agent mirroring.** Should v1 mirror created agents into MemoryBear applications, or is a dsh preset enough?
3. **First provider.** Remote only, or also a local SQLite `memory-local` fallback?
4. **UI merge policy.** Accept the merged tab set, or insist on all eight MemoryBear pages in the client?
5. **End-user lifecycle.** When a dsh user is removed, who cleans up the MemoryBear end user?
