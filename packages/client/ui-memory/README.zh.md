---
description: "会话窗口内的记忆面板：召回视图读会话日志，记忆库与画像经 memory Remote 读引擎，另含输入区的本轮开关。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-memory

[English](README.md) | 中文

## 概述

会话窗口内的记忆面板，由会话头部入口打开，含三个视图：召回展示本会话最近一次召回的问题、命中条目、检索轨迹与降级状态；记忆库浏览引擎当前持有的全部记忆，可搜索、可删除；画像按分区展示引擎归纳出的用户信息。

## 目录

- [使用](#use-this-package)
- [实现要点](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用

在 Web profile 中与 memory 预设一同挂载；插件注册 `memory` 页签类型和 `conversation.session.header.actions` 入口。

```yaml
- name: '@deepseek-ai/dsh-client-ui-memory'
```

<a id="understand-the-implementation"></a>
## 实现要点

- 页签类型通过 `ctx.sidebarRightTabs.register` 注册（kind 为 `memory`），页签内容通过 keyed slot `sidebar.right.pane.tab` 注册；两者都包在 `ctx.effect` 中，释放即移除。
- 头部入口用 `ctx.sidebarRight.openTab('memory')` 打开；页签按会话存在，因为右侧栏本身是按会话的。
- 面板只读 `memoryAutosave` 投影，不调用记忆引擎，因此展示内容严格等于会话日志记录的内容。
- 降级召回显示为带提示的状态，而不是被当成空结果隐藏。
- 页签的注入面把面板操作绑定到它所在的会话，因为引擎位于该会话的预设作用域内。
- 记忆库的删除需要按两次：第一次确认，三秒后自动撤销；删除失败时保留该行并如实提示，因为引擎没有确认。
- 引擎不支持浏览或画像时如实说明，不把空列表当成空账户。
- 所有可见文案经过 `memory` 语言字典。

<a id="model-experience"></a>
## 模型体验

无，本包只在浏览器里渲染会话投影与面板 Remote 的值，不注册提示词、schema 或结果文本。

#### KV Cache 影响

无；本包从不组装或发送模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制

- 只读：没有删除、跨会话检索、图谱或遗忘视图。这些需要内置后端仅在管理端暴露的接口。
- 对话内还没有召回 chip，页签是唯一入口。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

页签与输入区开关都通过 `ctx.memoryPanel` 调宿主，会话 id 由插槽的注入面绑定，组件自身不接触 Remote 命名空间。

</details>
