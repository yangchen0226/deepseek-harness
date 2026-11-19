---
description: "记忆面板的 Remote 命名空间：通过 ctx.memory 接缝提供浏览、画像读取与删除，供客户端记忆页签使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-memory-controller

[English](README.md) | 中文

## 概述

共享引擎支持显式的全局范围与工作区范围，浏览无需活动会话。按会话查询时解析持久化工作区归属；没有范围的旧调用仍访问旧集合。开关写入持久的 `memory/settings` 事件。

把 `ctx.memory` 接缝暴露给客户端记忆面板，经生成的 `memory` Remote 命名空间调用。面板的记忆库与画像视图读取引擎当前的存储内容，包括其他会话写入的记忆；召回视图则读会话日志。

引擎是会话级资源。`memory` 预设把 provider 挂在 Agent 的独立预设组里，所以每次调用都带上会话 id，服务从该 Agent 的组合里取引擎；会话预设没提供时才回落到宿主级 `ctx.memory`。会话完全没有引擎时拒绝 `memory/unsupported`，面板据此隐藏需要引擎的视图。

## 目录

- [路由](#routes)
- [契约](#contracts)
- [客户端面](#client-face)
- [模型体验](#model-experience)
- [已知限制](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="routes"></a>
## 路由

| 路由 | 请求 | 返回值 |
|---|---|---|
| `memory/list` | `{ sessionId, query?, limit? }` | `{ items, total, degraded, canForget }` |
| `memory/profile` | `{ sessionId, sections? }` | `{ sections, degraded }` |
| `memory/forget` | `{ sessionId, target }` | `{ removed }` |
| `memory/health` | `{ sessionId }` | `{ reachable }` |
| `memory/mute` | `{ sessionId, muted }` | `{ muted }` |

<a id="contracts"></a>
## 契约

- **读接口降级，删除不降级。** 引擎不可达时 `list` 与 `profile` 返回 `degraded: true` 和空值，页面照常渲染；`forget` 则拒绝 `memory/unavailable`——引擎没有确认的删除绝不能渲染成"已删除"。
- **`MEMORY_UNSUPPORTED` 不是故障。** 不支持浏览或画像的引擎拒绝 `memory/unsupported`，面板据此如实说明，而不是把"不支持"显示成"什么都没有"。
- **删除需要显式能力。** `memory/list` 返回 provider 的 `canForget`；只有该值为真时面板才展示删除控件。默认值为假，拒绝 `forget` 的 provider 不会暴露失效的破坏性操作。
- **`mute` 是唯一会落会话事件的路由。** 开关决定本回合是否带召回内容运行，日志必须能重放出模型看到的同一个答案。它只记录 `memory/mute`；autosave 消费方据此跳过召回与本回合的写入。
- **非引擎故障直接抛出。** provider 内部的缺陷不等于引擎不可用；只有 `MemoryError` 才会产生降级或不可用的结果。
- **不落会话事件。** 这些操作服务的是正在看面板的人，返回值不会进入模型请求，因此"模型可见即已记录"不适用。模型自己的访问走 `memory_*` 工具，那些会落事件。

<a id="client-face"></a>
## 客户端面

`./client` 安装 `ctx.memoryPanel`，是 `ctx.remote.memory` 的薄封装。它在 apply 时读取一次命名空间，因为注入面运行在调用方栈上——一次 React 事件、一次 carrier 重试——其动态上下文并未声明该命名空间。UI 包通过注入 `memoryPanel` 服务使用它，不直接碰 `ctx.remote`。

`save` 接受用户手动填写的文本，目标必须是明确的全局范围或已存在的工作区，并将结果写入持久活动记录。已接收、失败和结果未知分别表示；结果未知的写入不会重试。记忆库请求转发从 1 开始的页码。手动浏览和保存不会注入模型上下文。

画像读取使用远端缓存摘要。显式更新画像先为当前范围对应的终端用户重新生成，再读取结果；不会请求所有用户。生成失败会显示错误，不会被当作成功的空画像。MemoryBear 提供者使用 `profileTimeoutMs` 限制生成时长。

<a id="model-experience"></a>
## 模型体验

无，面板 Remote 服务的是正在浏览记忆的人，其返回值不进入任何模型请求。

#### KV Cache 影响

无；本包从不组装或发送模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制

- **没有图谱路由。** 接缝没有关系模型，邻域图无数据可读。要加得先扩展 `MemoryEngine` 和每个 provider。
- **没有分页游标。** `list` 只返回一页和一个总数；超过页长的记忆库只能靠缩小搜索范围浏览。
- **分区固定。** `profile` 只接受引擎按 kind 推导出的四个分区名；自造分区的后端无法显示出来。
- **每实例一个身份。** 终端用户由 provider 配置固定，所以谁打开浏览器看到的都是同一份记忆。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

引擎按会话解析：`memory` 预设把 provider 挂在 Agent 的独立预设组内，所以每个路由都接收 `sessionId`，再从该 Agent 的组合里取引擎，取不到才回落到宿主级 `ctx.memory`。`mute` 是唯一会 append 会话事件的路由——开关决定本回合是否带召回内容运行，日志必须能重放出同一个答案。

</details>
