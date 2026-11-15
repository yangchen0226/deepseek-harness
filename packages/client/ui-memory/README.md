---
description: "The memory panel inside the session window: the last recall from the session log, plus the engine library and profile read over the memory Remote, opened from a session-header action."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-memory

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-memory` puts memory where the conversation is. A header action opens a right-sidebar tab with three views: **Recall** reads the `memoryAutosave` projection, so it shows exactly what the session log recorded; **Library** and **Profile** read the Session's engine through the `memory` Remote namespace, so they show what the engine holds now. A composer-dock switch turns one turn's memory off, recorded as a session event because it decides whether the turn runs with recalled text.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin alongside the memory preset and `@deepseek-ai/dsh-api-memory-controller` in a Web profile; it registers a `memory` tab type and a `conversation.session.header.actions` entry.

```yaml
- name: '@deepseek-ai/dsh-client-ui-memory'
```

<a id="understand-the-implementation"></a>
## Understand the implementation

- The tab type registers through `ctx.sidebarRightTabs.register` with kind `memory`, and its body through the keyed slot `sidebar.right.pane.tab`; both sit inside `ctx.effect` so disposal removes them.
- The header action opens the tab with `ctx.sidebarRight.openTab('memory')`; the tab is per-session because the sidebar itself is.
- A degraded recall is rendered with its notice, not hidden; the panel never claims memory worked when the event says otherwise.
- The tab's inject face binds the panel operations to the Session it is open in, because the engine lives in that Session's preset scope.
- A library removal takes two presses: the first arms the control, and it disarms after three seconds. A failed removal keeps the row and says so, because the engine never confirmed it.
- An engine that cannot list or profile reports that plainly; the panel does not present an empty library as an empty account.
- The dock switch renders only when the Session has a `memoryAutosave` projection, so a session without the memory preset gains no dead control.
- Copy goes through the `memory` locale dictionary in every visible string.

<a id="model-experience"></a>
## Model Experience

None, as the panel renders Session projections and panel Remote values in the browser and registers no prompt, schema, or result text.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Read-only: no delete, no search over stored memories, no graph or forgetting views. Those need provider endpoints the shipped backend exposes only on its management API.
- No inline recall chip in the conversation yet; the panel is the only surface.

### Dev Note

<a id="dev-note"></a>

<details>
<summary>Working context for maintainers — click to expand</summary>

Both the tab and the dock switch reach the Host through `ctx.memoryPanel`; the Session id is bound by the slot inject face, so no component touches the Remote namespace directly.

</details>
