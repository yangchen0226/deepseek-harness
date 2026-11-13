# @deepseek-ai/dsh-client-ui-memory

会话窗口内的记忆面板：展示本会话最近一次召回的问题、命中条目、检索轨迹与降级状态，由会话头部入口打开。

## 使用

在 Web profile 中与 memory 预设一同挂载；插件注册 `memory` 页签类型和 `conversation.session.header.actions` 入口。

```yaml
- name: '@deepseek-ai/dsh-client-ui-memory'
```

## 实现要点

- 页签类型通过 `ctx.sidebarRightTabs.register` 注册（kind 为 `memory`），页签内容通过 keyed slot `sidebar.right.pane.tab` 注册；两者都包在 `ctx.effect` 中，释放即移除。
- 头部入口用 `ctx.sidebarRight.openTab('memory')` 打开；页签按会话存在，因为右侧栏本身是按会话的。
- 面板只读 `memoryAutosave` 投影，不调用记忆引擎，因此展示内容严格等于会话日志记录的内容。
- 降级召回显示为带提示的状态，而不是被当成空结果隐藏。
- 所有可见文案经过 `memory` 语言字典。

## 已知限制

- 只读：没有删除、跨会话检索、图谱或遗忘视图。这些需要内置后端仅在管理端暴露的接口。
- 对话内还没有召回 chip，页签是唯一入口。
