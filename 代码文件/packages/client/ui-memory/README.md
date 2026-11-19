---
description: "The memory panel inside the session window: the last recall from the session log, plus the engine library and profile read over the memory Remote, opened from a session-header action."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-memory

English | [中文](README.zh.md)

## Summary

The session header opens three views. **Memory activity** separates the latest recall from the latest write and shows whether the service accepted the submission. **Library** and **Profile** show what the memory engine currently holds. The composer switch persists for the session across turns and mode changes. Global memory and Workspace memory open independent pages with activity, library, and profile views.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin alongside the shared memory provider and `@deepseek-ai/dsh-api-memory-controller` in a Web profile; it registers a `memory` tab type and a `conversation.session.header.actions` entry.

The conversation also gains a recall chip, registered into `conversation.chat.message.extension` under the key `recall-chip`. It reads the same `memoryAutosave` projection: it counts the items the turn recalled, states that memory is off when the turn is muted, and renders a degraded recall with its cause instead of an empty result. Expanding it lists the recalled text; the panel stays the place for deep inspection.

```yaml
- name: '@deepseek-ai/dsh-client-ui-memory'
```

<a id="understand-the-implementation"></a>
## Understand the implementation

- The tab type registers through `ctx.sidebarRightTabs.register` with kind `memory`, and its body through the keyed slot `sidebar.right.pane.tab`; both sit inside `ctx.effect` so disposal removes them.
- The header action opens the tab with `ctx.sidebarRight.openTab('memory')`; the tab is per-session because the sidebar itself is.
- A degraded recall is rendered with its notice, not hidden; the panel never claims memory worked when the event says otherwise.
- The tab's inject face binds the panel operations to the Session it is open in, using persisted workspace membership.
- A library removal takes two presses only when the provider advertises `canForget`; the first press arms the control, and it disarms after three seconds. Providers without that capability render no delete control. A failed removal keeps the row and says so, because the engine never confirmed it.
- An engine that cannot list or profile reports that plainly; the panel does not present an empty library as an empty account.
- The dock switch renders only when the Session has a `memoryAutosave` projection, and shared composition supplies it in every mode.
- Copy goes through the `memory` locale dictionary in every visible string.

Collection pages support explicit human saves: global saves are shared across workspaces, while workspace saves remain in that project. The page displays write acceptance separately from indexing and disables resubmission after an unknown outcome. Activity identifies automatic, model-initiated, and manual operations. The library provides pagination, refresh, and a clearly labeled filter of the current page.

Plugin-owned assistant blocks render through the type-keyed `conversation.chat.message.extension` slot. Memory registers a dedicated operation row; the generic chat retains JSON presentation for unregistered types.

Profile reads use the cached remote summary. An explicit profile update regenerates only the selected end user before reading again; it never requests all users. Generation failures remain visible and do not become an empty successful profile. The MemoryBear provider bounds generation with `profileTimeoutMs`.

<a id="model-experience"></a>
## Model Experience

None, as the panel renders Session projections and panel Remote values in the browser and registers no prompt, schema, or result text.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The shipped MemoryBear provider is read-only in the library because its API-key surface does not expose removal; providers that implement the seam's opt-in removal capability may show the two-press delete control. Graph and forgetting views still need provider endpoints exposed only on the management API.
- No inline recall chip in the conversation yet; the panel is the only surface.

### Dev Note

<a id="dev-note"></a>

<details>
<summary>Working context for maintainers — click to expand</summary>

Both the tab and the dock switch reach the Host through `ctx.memoryPanel`; the Session id is bound by the slot inject face, so no component touches the Remote namespace directly.

</details>
