---
description: "会话窗口内的记忆面板：召回视图读会话日志，记忆库与画像经 memory Remote 读引擎，另含输入区的本轮开关。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-memory

[English](README.md) | 中文

## 概述

输入区记忆开关在会话中持续生效，跨回合和模式切换保持设置。全局记忆与工作区记忆通过独立页面展示活动、记忆库和画像，无需打开会话。

从会话头部打开记忆面板可查看三个视图。「记忆活动」分别展示最近一次召回和最近一次写入，并标明服务是否已接收写入请求。「记忆库」和「画像」展示记忆引擎当前保存的内容。输入区的开关控制本轮是否使用记忆。

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

对话内还会出现召回条，以 `recall-chip` 为键注册进 `conversation.chat.message.extension`。它读取同一份 `memoryAutosave` 投影：显示本轮召回的条数，本轮静音时明确说明记忆已关闭，召回降级时渲染降级原因而不是空结果。展开后列出被召回的内容；面板仍是深入检视的入口。

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
- 只有 provider 宣布支持 `canForget` 时，记忆库才显示删除控件。删除需要按两次：第一次确认，三秒后自动撤销；删除失败时保留该行并如实提示，因为引擎没有确认。
- 引擎不支持浏览或画像时如实说明，不把空列表当成空账户。
- 所有可见文案经过 `memory` 语言字典。

集合页面支持用户显式保存：全局保存可供所有工作区使用，工作区保存仅属于当前项目。页面区分请求已接收与实际入库，结果未知时禁用重复提交。活动标明自动、模型主动和手动来源。记忆库提供分页、刷新，以及明确标注的当前页筛选。

助手消息的插件内容通过按类型注册的 `conversation.chat.message.extension` 插槽呈现。记忆界面注册专用操作行，通用聊天界面仍为未注册类型保留 JSON 展示。

画像读取使用远端缓存摘要。显式更新画像先为当前范围对应的终端用户重新生成，再读取结果；不会请求所有用户。生成失败会显示错误，不会被当作成功的空画像。MemoryBear 提供者使用 `profileTimeoutMs` 限制生成时长。

<a id="model-experience"></a>
## 模型体验

无，本包只在浏览器里渲染会话投影与面板 Remote 的值，不注册提示词、schema 或结果文本。

#### KV Cache 影响

无；本包从不组装或发送模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制

- 随包的 MemoryBear provider 在记忆库中是只读的，因为它的 API Key 接口不提供删除；实现接缝删除能力的 provider 可以显示两次确认的删除控件。图谱与遗忘视图仍需要内置后端只在管理端暴露的接口。
- 对话内还没有召回 chip，页签是唯一入口。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

页签与输入区开关都通过 `ctx.memoryPanel` 调宿主，会话 id 由插槽的注入面绑定，组件自身不接触 Remote 命名空间。

</details>
