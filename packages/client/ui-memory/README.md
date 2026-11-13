---
description: "The memory panel inside the session window: the last recall and its items from the memoryAutosave projection, opened from a session-header action."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-memory

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-memory` puts memory where the conversation is. A header action opens a right-sidebar tab that shows what the current session recalled — the question it asked, the items it got back, and the assistant text the turn will store. The panel reads the `memoryAutosave` projection only; it makes no memory calls, so what it shows is exactly what the session log recorded.

## Use this package

Mount the plugin alongside the memory preset in a Web profile; it registers a `memory` tab type and a `conversation.session.header.actions` entry.

```yaml
- name: '@deepseek-ai/dsh-client-ui-memory'
```

## Understand the implementation

- The tab type registers through `ctx.sidebarRightTabs.register` with kind `memory`, and its body through the keyed slot `sidebar.right.pane.tab`; both sit inside `ctx.effect` so disposal removes them.
- The header action opens the tab with `ctx.sidebarRight.openTab('memory')`; the tab is per-session because the sidebar itself is.
- A degraded recall is rendered as the panel's empty state with its hint, not hidden; the panel never claims memory worked when the event says otherwise.
- Copy goes through the `memory` locale dictionary in every visible string.

## Known Limitations and Deferred Work

- Read-only: no delete, no search over stored memories, no graph or forgetting views. Those need provider endpoints the shipped backend exposes only on its management API.
- No inline recall chip in the conversation yet; the panel is the only surface.
