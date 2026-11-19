# Agent Note: Consumer product surfaces for memory and agents

Status: proposed

English | [中文](2026-11-18-consumer-memory-agent-product-design.zh.md)

## Problem

The Web UI is still a chat box with a sidebar. A C-end user meets two capabilities the surfaces do not explain: a memory engine that recalls and writes silently, and an agent that plans, spawns subagents, calls tools, and may ask for approval. The panel in [ui-memory](../代码文件/packages/client/ui-memory/README.md) shows the last recall and the library, but only after the user knows to open it, and it carries no inline recall chip. The model runs steps, tools, and subagents with no product-visible work surface. [ui-subagent](../代码文件/packages/client/ui-subagent/README.md), approvals, and deliverables can render, but each speaks its own vocabulary.

That produces five failures a C-end user reports as one:

- **Invisibility.** Nothing on the conversation says memory was used, and nothing says the assistant remembered. A correct answer and a lucky one look identical.
- **No control.** The library is read-only against the shipped provider, writes are asynchronous batches, and a user cannot correct, forget, or re-scope anything without leaving the conversation.
- **No model.** Memories form a flat list with no provenance, no time, and no relationship to the conversation that produced them, so the library reads as an opaque database rather than the user's own knowledge.
- **Agent opacity.** Long runs look like waiting. Subagents, tool calls, and cost have no common surface, so a user cannot tell work from a stall.
- **Breakage on failure.** A degraded recall, an unreachable service, and an empty account all read as "nothing here" unless the user reaches the panel.

Adding tabs to the sidebar does not fix any of these. The failures are about what the conversation surface shows at the moment a capability acts.

## Proposal

Make memory and agent activity **conversation-native, inspectable, and correctable**. Every capability acts in the conversation; every action leaves a durable, explainable trace on the surface where it happened; every durable effect is reviewable and reversible.

### Design principles

1. **The conversation is the primary surface.** Memory and agent work surface inline at the point of use, not behind a navigation entry. A separate memory page exists for browsing and administration, never as the only place memory appears.
2. **Provenance over assertion.** Every recall carries its scope, source, and time. Every write carries its acceptance state, with unaccepted writes never shown as stored. Every library entry links back to the conversation or manual write that produced it.
3. **Memory is context, not a database.** Users reason about memory as "what the assistant knows about me and this project". Present it by time, by project, and by the decision it supported, not as a raw table.
4. **Agents show work, not waiting.** A long run renders as a step timeline with subagents, tools, approvals, and deliverables on one surface, and each item states why it exists.
5. **Progressive disclosure.** A user sees one summary line and expands into steps, recall contents, or diffs. Complexity exists on demand, never by default.
6. **Confirm what cannot be undone.** Writes to a durable store, deletions, cross-scope promotion, and dispatching background work ask before they act.
7. **Knowledge and memory are different authorities.** A recalled preference and a cited policy never render the same way, and an answer states which one it relied on. Widening access to either asks first.
8. **No evolution without a record, a report, and a person.** An agent changes because its execution records and memory made a case that the user read and approved, never because it decided to.

### Information architecture

| Page | Owns | Primary user task |
|---|---|---|
| Home | Active work, running agents, pending approvals, recent deliverables | "What is happening now?" |
| Conversation | Messages, inline memory, plan and step timeline, approvals, artifacts rail | Do the task |
| Memory center | Collections, timeline, evolution, provenance, diff review, graph, privacy | "What does it know, and do I agree?" |
| Agent center | Presets, their behavior contract, capacity, cost, memory policy, execution records, and evolution reports | Compose and trust an agent |
| Agent plaza | Discover, inspect, install, publish, and govern agents | "Is there an agent that already does this?" |
| Knowledge center | Personal, organization, and enterprise collections, promotion, sharing, and index versions | "What is authoritative, and who may see it?" |
| Artifacts and inbox | Deliverables, scheduled work, background jobs, approvals awaiting the user | Collect and review outcomes |
| Workspace home | Project facts, conventions, decisions, recent sessions | Resume a project |
| Settings | Account-level memory policy, retention, export and delete, model and cost limits | Set defaults |

Home replaces the current session list as the landing surface. The session list stays as a sidebar section, not as the product's front door.

### Conversation surface

The conversation gains four inline elements, each a projection of an existing durable event rather than a new source of truth:

- **Recall chip.** Before the first streamed token, a compact line states how many memories were recalled and from which scope. Expanding shows each item with its scope, source, and time, plus a control to exclude one for this turn. A degraded recall renders the degradation, never an empty result ([projection of the autosave activity](../代码文件/packages/memory/memory-autosave/README.md)).
- **Memory lens.** A persistent side rail for the current session lists what is in play: workspace facts in use, global preferences in use, and conflicts resolved in favor of workspace instructions. The user can mute a memory for the rest of the session with one action, and the session records the exclusion.
- **Write acceptance.** After a turn, a memory delta card states what the agent submitted, with an explicit state: queued, accepted, indexed, failed, or unknown. Unknown outcome never renders as success, and the card offers a retry only when the outcome is known to be safe.
- **Memory diff review.** For automatic extraction, the card offers accept, edit, and reject before the entry becomes regular memory. Review is on for new users and can be relaxed to accept-by-default per scope.

Agent activity uses one vocabulary across packages:

- **Step timeline.** Each model step is a row: intent summary, tools called, duration, tokens. Expanded rows show tool arguments and results with copy affordances.
- **Subagent tree.** Delegated work nests under the step that spawned it, with its own status, and a child that fails renders its failure rather than disappearing.
- **Approval card.** A blocked action states what will change, where it will change, and what happens on rejection, in the same card type for file writes, shell commands, and cross-scope memory operations.
- **Artifacts rail.** Files, plans, and deliverables produced during the turn collect on the rail and survive session reload.

### Memory center

The memory center replaces the panel-only library with four views over the same data:

- **Collections.** Workspace and global scopes as first-class collections with counts, last activity, and a health line separating off, unconfigured, unavailable, and empty.
- **Timeline.** Memory entries ordered by time, grouped by project, each expandable to provenance (the conversation turn or manual write), the decisions it informed, and a correction history. Corrections create a new version rather than overwriting silently.
- **Graph.** Relations between entries, drawn only where the provider exposes them; the graph is an exploration aid beside the list, never the default view.
- **Privacy.** Retention policy per scope, export, and delete with a stated propagation delay. Cross-scope promotion of a workspace fact into global memory requires an explicit confirmation that names both scopes.

Bulk operations act through a two-press or type-to-confirm control, and every destructive operation reports its result per entry rather than as one optimistic toast.

### Agent center

Presets become inspectable objects rather than a configuration menu. Each preset page states what it is for, which tools and memory scopes it may use, what it will ask before acting, its observed cost and duration over recent runs, and how it has evolved. A user composes a preset from an existing one; memory policy is chosen independently of the agent workflow, matching the seam in [the MemoryBear plan](../.agents/notes/proposed/feature/2026-11-13-memorybear-integration-plan.md). Creation, forking, and evolution all operate on the declarative preset the [registry](../代码文件/packages/preset/agent-preset-registry/README.md) already retains as revisions; the UI adds review and evidence, not a second composition model.

### Agent plaza

The plaza is a distribution surface for **finished agents** — a persona, a workflow, a memory policy, and the tools it may use — not a package directory. The [plugin market](../代码文件/docs/user/guide/plugin-market.md) stays the developer surface for extending runtime capability; the two never share a page.

**Discover.** Entries are grouped by the job a user has ("research a market", "maintain a codebase", "tutor a child"), not by vendor or model. Ranking uses verified evidence from real runs — sessions completed, tasks completed without a manual retry, retention after thirty days — never install counts, which reward promotion rather than usefulness. Curated collections are labelled as editorial. Search understands task phrasing and surfaces three comparable agents side by side rather than a list of near-identical clones.

**Agent detail.** Every detail page states, before the install button: the behavior contract (what it does, what it refuses), the **tool grants** it requires and which of them touch the filesystem, the network, or the shell, the **memory declaration** (which scopes it reads, which it writes, whether it writes automatically), the approval policy it cannot bypass, the model capability it needs, its cost range over recent runs, its version history with a diff between versions, and reviews that are only postable from a real session with that agent. An agent whose memory declaration is incomplete cannot be published.

**Install and activate.** Installing copies a version-pinned preset into the user's roster and shows the capability diff — tools, memory scopes, approval policy — for explicit confirmation. Updates never silently widen a grant: a version that adds a tool or a memory scope requires re-confirmation, and a version that removes one applies automatically. A user can fork an installed agent into an editable private copy; the plaza records fork lineage so attribution survives.

**Publish.** Publishing runs gates the author cannot waive: prompt-injection and tool-scope static review, memory-declaration completeness, a sandboxed trial run over the fixture conversations of the category, and a declared support contact. Publisher identity and every later update carry an audit trail. A published agent's memory policy is declared, never inherited from the publisher's own account.

**Trust ladder.** New agents start labelled *verified* (gates passed), reach *proven* only on measured real runs, and drop a level after a reported incident. Deprecation, takedown, and report flows are one action from the detail page, and a taken-down version stops being installable without deleting copies users already forked.

### Memory-driven agent evolution

An agent's growth — persona, prompts, skills, tool habits — is driven by memory, and every change is reviewable, attributable, and revertible. The loop has five stages and never skips one.

1. **Collect.** Signals come from memory and from sessions: accepted and rejected memory diffs, repeated manual corrections, edits the user made to a model output, task outcomes with or without a retry, failure patterns across sessions, and explicit instruction ("answer this way from now on"). Each signal stays attached to the conversation and memory entry that produced it.
2. **Propose.** The system turns signals into a typed change proposal on a fixed target set — persona text, prompt section, skill template, tool preference, recall policy — each carrying a diff, the evidence citations that justify it, and its blast radius. Proposals live in a review queue on the agent center, never applied on creation.
3. **Shadow.** A proposal is evaluated against recorded past sessions with that agent before it can reach a live turn. The comparison shows where the new version would have answered differently, and a proposal that changes behavior outside its declared blast radius fails shadow review.
4. **Promote or reject.** Promotion writes a new agent version with a message, an evidence reference, and the approver. Rejection keeps the record so the same bad proposal cannot quietly recur.
5. **Roll back.** Any version restores in one action. The history is a version list, not a changelog, so restoring means selecting a point, not reverting a chain.

**Memory topology.** Three scopes keep evolution from contaminating what the user did not choose to share:

| Scope | What it is | Who it evolves | Default |
|---|---|---|---|
| Personal adaptation | This user's instance of the agent: tone, habitual formats, local preferences | Only this user's copy | On, visible on every turn card |
| Agent memory | The agent's shared behavior, inherited by every installer | Only through review and a new version | Off |
| Workspace memory | The project's facts and conventions | Never absorbed into agent memory implicitly | Read when granted, never copied |

Evolution may read workspace memory when granted, but may not promote it into agent memory; promoting a workspace fact is a user action on the memory page, not an evolution outcome.

**Approval levels.** Risk is decided by the target, not by the model's confidence:

| Change | Level | Gate |
|---|---|---|
| Personal adaptation of tone, verbosity, output format | Low | Auto-apply, notify on the turn card, one-action revert |
| Skill template, recall policy, tool preference in the personal copy | Medium | Single confirmation with diff and evidence |
| Anything in shared agent memory, anything that changes a grant | High | Forbidden to evolution; a version published by a human through the plaza review |

**Cross-user aggregation.** Shared-agent evolution can learn from aggregate signals across users — task success rates, correction frequencies, failure categories — under consent and without memory content. A behavior derived from one user's private memory never reaches another user's turn, and the product states this limit on the evolution page.

**Visibility.** The agent center's evolution view lists every proposed, applied, and rejected change with its evidence, its resulting version, and a per-change revert. The memory center's evolution view answers the reverse question: which memories of mine shaped this agent, and what would change if I deleted them.

### Knowledge base

Memory records what happened and is inferred from behaviour; a knowledge base holds what an organization has decided is **true and citable** — documents, policies, contracts, runbooks, product specs — with a version, an owner, and an effective date. The two never share a store or a citation style. Knowledge enters the harness through its own capability seam with a Service Definition, a provider, and consumers, like [memory](../代码文件/packages/memory/README.md); no consumer depends on a vendor's storage model.

#### Tiers

Three tiers differ in **who owns the content, who may read it, and who may change it**. A higher tier does not automatically inherit a lower tier's content, because an unapproved personal note must never become organizational policy by position.

| Tier | Owner | Content | Default read | Default write |
|---|---|---|---|---|
| Personal | One user | Notes, drafts, personal references, saved answers | Only the owner | Only the owner |
| Organization | Team or department within one tenant, with a named maintainer | Procedures, decisions, conventions, product and project knowledge | Team members | Named maintainers, with an audit trail |
| Enterprise | The tenant, governed by a policy owner | Policies, contracts, legal and compliance text, security rules, org-wide standards | Everyone in the tenant | Policy owner only, with a review before it becomes effective |

Team-level sharing is a **sharing unit inside the organization tier**, not a fourth tier. Enterprise content is the authority a lower tier cites; it never absorbs lower-tier content automatically.

#### Upgrade strategy

"Upgrade" names three distinct operations that must never be conflated in the UI.

**Tier promotion** — content moves up an ownership tier:

- A promotion is an explicit proposal with a named destination, an approver, a redaction requirement, and the source item's link. The original stays where it was and the promoted copy records its source (copy-on-promote); the source is never silently moved or deleted.
- Bulk promotion is forbidden. An item whose sensitivity cannot be classified cannot be promoted, and a promotion that changes behavior of an enterprise policy needs a policy-owner review, not only a tier approver.
- After promotion the two copies are linked for provenance but not synchronized: later personal edits do not change the organizational copy, and a changed organizational copy does not overwrite the personal draft. Revoking an enterprise copy follows a stated review path rather than deleting the item.
- **Knowledge is never promoted by the agent.** Evolution may propose that a knowledge item be created from a repeated pattern, but the proposal targets the personal tier at most; every cross-tier move is a user action by someone authorized for the destination tier.

**Index upgrade** — the embedding model, chunker, or parser changes:

- Indexes are versioned side by side. A new index is built while the old one keeps serving, evaluated against a fixed query set for recall and ranking regressions, and cut over atomically with the previous version retained for rollback.
- The upgrade states its cost, its duration, and the queries whose answers would change, and a query whose answer changes is shown as a diff before cutover.

**Entitlement upgrade** — a tenant moves to a tier or plan that changes capacity, retention, or which knowledge features are available. It never changes content ownership or visibility on its own; visibility is a separate decision with its own confirmation.

#### Sharing strategy

Sharing is decided by two orthogonal axes, because conflating them is what produces leaks:

| Axis | Options | Who sets it |
|---|---|---|
| Access | Private, specific people, team, organization, enterprise | The item owner, within what the tier permits |
| Purpose | Reference (agents may cite), edit (collaborators may change), publish (eligible to become an agent's knowledge grant) | The destination tier's owner |

Rules the UI and backend enforce together:

- Access narrows by default and widening always asks. Widening a tier's read population, adding a person, and allowing an agent to cite an item are three separate confirmations, each naming the resulting audience in people, not in tier names.
- **Revocation is immediate for new requests and stated for materialized copies**: an agent that already cited a document shows which turns hold the citation, and those citations remain visible as historical facts with a revoked notice rather than disappearing.
- External sharing — anyone outside the tenant — is off by default for organization and enterprise tiers, requires the policy owner, carries an expiry, and produces an audit entry. An item shared externally cannot be promoted back without a review of what was disclosed.
- Every item carries a sensitivity class; a class change re-evaluates existing shares and surfaces the resulting narrowing rather than applying it silently.
- An agent's knowledge grant is declarative — which tiers and which collections — never a list of individual documents, so a document added to a collection later is governed by the collection's own access, not by the agent's install-time snapshot.

#### Conversation and agent integration

- A knowledge citation renders as its own chip, separate from the memory recall chip: the collection, the item, its version and effective date, and the tier it came from. A cited document that has since changed renders as a stale citation with both versions linked.
- When knowledge and memory conflict, the surface states which won and why: tiered authority beats recalled personal preference, and the conflict stays visible on the turn card rather than being resolved invisibly.
- An agent that refuses to answer because its granted knowledge does not cover the question says so, and names the collection that would cover it. An empty retrieval is never rendered as "no such information exists".
- The knowledge center lists collections, their tier, their maintainers, their sharing state, and the agents that currently cite them; a collection with no maintainer or an expired external share is flagged on the home page.

### Agent execution records

Every activation of an agent writes a durable **execution record**: one entry per turn that an agent drove, not one per session. A record is the evidence base for evolution and the audit trail for everything else, so it is append-only and immutable once closed. Correction happens by appending a successor, never by editing history.

A record states:

- **Identity and version.** Which agent, which version, which personal adaptation revision was active — the exact behaviour that ran, not just the name.
- **Input class.** The working directory, whether a subagent or a scheduled job drove it, the user's claimed intent as a category, and nothing that copies private content out of the session.
- **Outcome.** Completed, completed after a manual retry, abandoned, failed with a cause class, or interrupted. An outcome is only `completed` when the work reached the state the user asked for, not when the last model step returned.
- **Cost and duration.** Tokens by phase, tool calls by tool, elapsed time, and approval wait time separated from work time.
- **Signals.** Corrections the user made, tool failures, approval denials, memory recall hits and misses, knowledge citations, and degradations that were rendered.
- **Provenance.** Links to the session events that produced each field, so a claim in an evolution report resolves to a real turn.

**Privacy of records.** A record stores measures, not transcripts: counts, categories, and references. Any field that would quote private memory or knowledge content stays unread until the user opens the turn it references. Records follow the retention policy of their tier, and a user can see, export, and delete their own records — deletion removes measures and keeps the existence of the execution so cost and audit totals stay correct.

**Access.** The agent's owner sees their own records. A team sees aggregate records for agents it shares; it never sees an individual's transcript content. Enterprise policy can require records of enterprise-registered agents to be retained for a declared period, and the UI states when a record is under such a hold.

### Evolution report

The evolution report is the object a user approves. It aggregates execution records and memory signals into a proposal about how an agent should change, and it is deliberately a **document with a decision**, not a silent background change.

**Generation.** A report is generated on request, on a schedule the user sets, or when a threshold of new records arrives — never continuously in the background without a visible pending item. Generation states which record window, which memory scope, and which version it read. A report that cannot cite enough records says so and proposes nothing.

**Contents.** Every report carries:

- **What the records show.** Success, retry, abandonment and failure rates over the window, with the trend against the previous window, and the categories where the agent underperforms.
- **What the memory explains.** Which recalled memories supported successful runs and which corrections recurred; a correction pattern that repeats is the strongest evidence a report can carry.
- **Proposals.** Each a typed change with its target, diff, evidence citations, expected effect, blast radius, and confidence. A proposal without a citation does not appear.
- **What it will not change.** Grants, memory scopes, and knowledge access are declared out of scope on every report, so approval can never be read as a permission change.
- **Risk and rollback.** Which risk level each proposal carries, and the version to which each can be reverted.

**Review and approval.** A report moves through generated → in review → approved or rejected → applied. The reviewer can accept the report whole, accept individual proposals, edit a proposal's text, or reject with a reason that stays recorded. A rejected report keeps its evidence so the same conclusion cannot silently recur. The user approves; **the agent never approves itself.** A report authored by the agent that would change that agent is marked as such, and the approval control states plainly who the decision belongs to.

**Application.** Approval writes a new agent version with the report as its justification, runs the shadow evaluation before any live turn uses it, and then activates. A report whose shadow evaluation fails returns to review rather than applying partially. Every proposal in an applied version links back to the report and to the records that produced it.

**After the fact.** Each applied version watches a comparison window against the version it replaced, and the evolution view shows whether the report's expected effect actually happened. A version that failed to improve — or regressed — is flagged for rollback with the measured comparison, and that outcome is itself recorded as evidence for the next report.

### State model

Memory, agent, and service state share one vocabulary on every surface:

| State | What it means | What the user sees |
|---|---|---|
| Off | The user turned the capability off for this scope or turn | A quiet line that memory is off, with a one-action turn-on |
| Unconfigured | No provider is bound | Setup guidance, with what will happen after setup |
| Degraded | Recall failed or timed out; the turn continued | The failure cause class, not an empty result, and a retry |
| Unavailable | The service is unreachable | A service-health banner on the affected scope |
| Unknown outcome | A write was submitted and its result is unconfirmed | An explicit unknown state with no success claim |

A toggle that shows "on" while the service is degraded is a defect in every state model above.

### Backend prerequisites

The UI follows what the provider can prove. Inline recall chips, write acceptance, and timeline views read the session log and the existing activity endpoint. Deletion, graph, and forgetting require provider endpoints the shipped MemoryBear key does not expose; the pages stay hidden until a provider advertises the capability, consistent with the existing `canForget` behavior in [ui-memory](../代码文件/packages/client/ui-memory/README.md).

### Delivery order

1. **Trust:** inline recall chip, write acceptance card, unified state vocabulary, and service health in the conversation. No new backend capability.
2. **Control:** memory lens, diff review, timeline with provenance, per-scope retention and export.
3. **Capability:** deletion, graph, forgetting, cross-scope promotion, and proactive memory proposals surfaced in Home.
4. **Distribution:** agent plaza browsing and detail pages, install with capability diff and grant re-confirmation, fork lineage.
5. **Evolution:** signal collection, typed proposals, shadow review, version promotion and rollback, personal and shared scopes with their approval levels. Low-risk personal adaptation ships first; shared-agent evolution follows the plaza's publish gates.
6. **Governance:** publish review, trust ladder, reports and takedowns, aggregate-signal consent controls.
7. **Knowledge:** citation chips with tier and version, personal collections with their own retrieval seam, tier promotion as a reviewed proposal.
8. **Shared knowledge:** organization and enterprise tiers, the access and purpose axes, external-sharing controls with expiry and audit, index-version upgrade with rollback.
9. **Records and reports:** execution records with outcomes, cost, signals and provenance; the evolution report with evidence citations and per-proposal approval; the post-application comparison window and its rollback flag.

## Alternatives considered

A standalone memory application is rejected because it separates memory from the conversation that gives it meaning. Pure chat with invisible agents is rejected because it cannot earn or repair trust. Hiding controls in settings is rejected for discoverability, and a settings-only policy is rejected because policy is chosen in context. A graph-first memory page is rejected because browsing a graph is not the user's task. Fully autonomous write-and-forget is rejected because it cannot be explained, corrected, or rolled back.

Keep the memory capability independent of the agent workflow, and keep the UI a projection of durable events rather than a second store. Keep the panel for deep inspection while removing it as the only surface. Keep the plaza separate from the plugin market because a bundled runtime package and a finished agent with declared grants are different objects with different review. Reject autonomous self-modification of shared agents: evolution proposes, a human promotes, and the rollback path is a version list. Keep knowledge as a capability seam beside memory rather than a memory scope, because a cited policy and an inferred preference need different authority, different retention, and different sharing controls. Reject a hierarchical tier model whose higher tier inherits lower-tier content automatically: that is how an unapproved note becomes policy. Reject in-place promotion and automatic two-way sync between a promoted copy and its source, because both make disclosure and revocation untraceable. Reject continuous background self-evolution and self-approval in every form: the report is the review object, a person approves it, and an agent that would change itself is never the approver.

## Acceptance criteria

- A first-time user can find the memory switch and explain why a given memory was recalled without opening a documentation page.
- Every model-visible memory read and write has a matching inline surface state, including degraded, unavailable, and unknown outcomes; no surface claims success without evidence.
- A user can forget one memory, correct one memory, and mute memory for one turn from the conversation alone.
- Workspace scopes stay isolated in the UI: an entry never appears in a scope the provider did not return it for.
- Every library entry resolves to its provenance, and every correction keeps the previous version.
- A long agent run renders steps, subagents, approvals, and artifacts on one surface, and a failed child appears as a failure.
- All five state values render distinctly on each surface, with locale-owned copy.
- An agent's detail page states every tool grant and every memory scope before install, and an update that adds either requires re-confirmation; one that removes either applies without one.
- A plaza entry cannot be published with an incomplete memory declaration, and a taken-down version is no longer installable.
- Every evolution change resolves to its evidence, its target, its approval level, and its version; a high-level change cannot be applied without a human-published version.
- A shadow failure blocks promotion, and rolling back any agent version restores the previous behavior in one action.
- Deleting a memory that shaped an agent shows which proposals lose their evidence; no proposal survives with evidence the user deleted.
- An answer that relies on a knowledge item renders a citation with its collection, tier, version, and effective date, and a changed document renders as a stale citation with both versions linked.
- A personal item cannot reach an organization or enterprise collection without a reviewed promotion by someone authorized for the destination; a promotion leaves the source in place and unmodified.
- Widening either axis of sharing — access population or citation purpose — asks first, names the resulting audience in people, and produces an audit entry; an external share carries an expiry.
- Revoking access stops new requests immediately and marks existing citations as revoked without deleting them, and an agent's grant follows its collection rather than an install-time snapshot.
- Every agent-driven turn appends exactly one immutable execution record carrying identity, version, outcome, cost, signals, and provenance; correcting one appends a successor instead of editing it.
- No agent version is created, activated, or widened without an evolution report the user approved, with every proposal resolving to at least one cited record; a report whose shadow evaluation fails cannot apply.
- Every applied version has a comparison window against the version it replaced, and a version that regressed is flagged for rollback with the measured comparison rather than silently kept.
- An agent cannot author and approve the report that changes itself; the approval control names the person the decision belongs to.
- An index upgrade runs against the previous index, reports the queries whose answers change, cuts over atomically, and rolls back to the retained version.
- An empty knowledge retrieval renders as "not covered by the granted collections" and names the collection that would cover it, never as "no such information".
- GUI changes satisfy the repository's real-server verification and recording rules, and both layouts work at a phone width.

## Open questions

Whether automatic writes default to diff review or accept-by-default remains a product decision. Whether Home becomes the default landing page for new installs affects onboarding and needs measured abandonment data. The deletion and forgetting pages depend on a provider capability decision documented in the MemoryBear integration plan. Cost display per turn needs a token-accounting seam decision before it can be promised on the conversation surface.

For the plaza: whether ranking exposes raw evidence or just the trust level, how a publisher proves a support contact, and whether forked agents may be republished with attribution remain open. For evolution: whether shadow review runs against the user's own sessions only or a category fixture set, how long evidence must accumulate before a low-risk adaptation may apply, and whether a user can export an evolved agent while leaving their personal memory behind all need product decisions. For knowledge: the sensitivity taxonomy and whether it is classifier-driven or declared, whether a promotion may ever be one-way synchronized, who counts as a maintainer when a team is renamed or dissolved, how enterprise legal text is redacted before promotion, and whether the enterprise tier's authority extends to overriding an organization collection on conflict all need decisions. For records and reports: how many records a window needs before a report may propose anything, whether the comparison window is measured in turns or weeks, whether a user may approve a report with zero risk indications without reading it, and how a record's retention interacts with an enterprise hold all remain open. None of these blocks the trust or distribution stages.

## Risks

An in-acceptance state report can expose backend latency the product cannot control; the UI must show unknown outcomes honestly rather than smoothing them into success. Graph and forgetting pages will be empty or hidden for the shipped provider until endpoints exist. A rich step timeline can overwhelm non-technical users; progressive disclosure is a requirement, not a polish step. Surface text risks leaking personal memory content on shared screens; sensitive entries need masking by default. Automatic memory needs an easy opt-out, and an unclear autonomy boundary erodes trust faster than a missing feature does.

Plaza risks: a marketplace of near-identical agents rewards whoever publishes most, install counts are trivially gamed, and a listed agent's tool grants can drift between the reviewed version and what installs. Reviews can be manufactured. A takedown cannot recall forked copies, so the discipline must be granting least privilege at install and re-confirming on widening, not trust in the listing alone.

Evolution risks: adaptation creates a filter bubble where the agent optimizes for this user's past and stops surfacing what they need next; evidence attached to deleted memory can be misread as current; shadow review only measures recorded behaviour, so a proposal can pass without evidence of improvement; and personalization compounds silently into an agent whose behavior the user never chose. Every proposal therefore needs a counterfactual line and a visible "what this agent would do without your adaptation" comparison, and adaptation must never change grants.

Knowledge risks: promotion is the highest-risk operation in this document, because it converts private text into authority that other people's agents cite; a mis-scoped collection is a disclosure that no per-item UI can undo, and an over-broad sensitivity class makes the feature unusable until people route around it. Stale citations are more dangerous than missing ones, because a confident answer built on a superseded policy looks exactly like a correct one; effective dates and stale markers are mandatory, not decorative. An index upgrade silently changing answer quality, a dissolved team leaving orphaned collections readable, and an agent's grant outliving the audience it was approved for are all failure modes that need standing monitors rather than one-time review.

Record and report risks: an outcome measure that counts a returned step as success will make every agent look like it is improving, and a user who approves reports without reading them has given self-modification a rubber stamp. A comparison window on a small number of turns will show noise as improvement or regression; the UI must refuse to assert a trend it cannot measure. Records also accumulate into a second, quieter copy of behaviour data, so retention and deletion must be real and testable, not policy prose. Finally, an agent that learns to produce reports its users approve — rather than changes that help — is optimizing the approval rather than the work, and only the post-application comparison can detect it.
