---
description: "模型可见的记忆工具：memory_recall、memory_write，以及按需的 memory_forget 与 memory_profile，每个都落持久会话事件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-memory

[English](README.md) | 中文

<a id="summary"></a>
## 概述

记忆接缝上的模型可见工具：`memory_recall`、`memory_write`，以及按后端能力注册的 `memory_forget` 与 `memory_profile`。

## 目录

- [概述](#summary)
- [使用](#use-this-package)
- [行为](#what-each-call-does)
- [实现要点](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用

```yaml
- name: '@deepseek-ai/dsh-tool-memory'
  config:
    defaultMode: quick
    enableForget: false
    enableProfile: false
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `defaultMode` | `quick` | 模型未指定 `search_mode` 时的检索广度 |
| `enableForget` | `false` | 是否注册 `memory_forget` |
| `enableProfile` | `false` | 是否注册 `memory_profile` |

<a id="what-each-call-does"></a>
### 行为

- `memory_recall(question, search_mode?)`：调用接缝，落 `memory/recall` 事件（含条目与轨迹），返回原始条目。降级时返回空列表并提示继续，不报错。
- `memory_write(content, kind)`：提交一条消息，落 `memory/write` 事件（`queued` 与批次 id），回报受理。
- `memory_forget(target)`：调用接缝并落 `memory/forget`；后端不支持时把错误原样交给模型。
- `memory_profile(sections?)`：读取已存画像并落 `memory/profile`。它回答记忆已经归纳出的内容，而不是去检索，所以空分区表示那里还没有存过东西。

<a id="understand-the-implementation"></a>
## 实现要点

工具路径拿不到回合号：执行上下文没有该字段，`Session` 也不暴露读取器。外层 `tool/call` 事件已记录回合，因此记忆事件不再重复。会话 id 来自所属 agent；无会话的调用者会被拒绝，而不是伪造一个。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

这组工具可见时生成的 [`memory_recall`、`memory_write` 与 `memory_forget` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-memory)。`memory_forget` 只在 `enableForget` 为 `true` 时出现。

#### Token 影响

工具可见的每个请求都有固定的 schema 开销；`memory_forget` 仅在启用时增加自己的 schema。

#### KV Cache 影响

工具定义与可见性不变时前缀稳定。注册或释放该工具集会从第一个变化的 schema token 起使复用失效。

### 结果

#### 模型看到什么

`memory_recall` 每条命中一行，带类别与相关度；没有命中时明说。召回降级时说明记忆服务不可达，而不是报告"搜索为空"。`memory_write` 报告受理而非存储，因为引擎是异步落库的。`memory_forget` 报告删除了多少条。

#### Token 影响

与命中条数及其长度成正比；调用方的 `limit` 给出上界。

#### KV Cache 影响

结果作为工具消息出现在缓存前缀之后，扩展对话而不使前缀失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制

- 没有画像工具：内置 provider 的画像读取未实现，注册工具等于暴露必然失败。
- 没有批量写入工具：每次写一条事实，等有证据表明模型常在一步产出多条持久事实时再加。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

见本目录英文页的 Dev Note；两页内容保持一致。

</details>
