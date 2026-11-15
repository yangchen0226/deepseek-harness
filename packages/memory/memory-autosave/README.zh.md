---
description: "会话驱动的记忆调度：回合前召回注入为持久快照消息，回合后写入为批次，并提供客户端读取的 memoryAutosave 投影。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-autosave

[English](README.md) | 中文

<a id="summary"></a>
## 概述

由会话驱动的记忆调度：回合前召回并注入一条持久快照消息，回合结束后提交写入批次；同时维护客户端面板读取的 `memoryAutosave` 投影。

## 目录

- [概述](#summary)
- [使用](#use-this-package)
- [实现要点](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用

```yaml
- name: '@deepseek-ai/dsh-memory-autosave'
  config:
    recallMode: quick
    recallOnTurnStart: true
    writeOnTurnEnd: true
    minMessageChars: 8
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `recallMode` | `quick` | 自动召回的检索广度 |
| `recallOnTurnStart` | `true` | 是否在回合开始召回 |
| `writeOnTurnEnd` | `true` | 是否提交已结束的回合 |
| `minMessageChars` | `8` | 短于此长度的消息既不召回也不写入 |

<a id="understand-the-implementation"></a>
## 实现要点

- 召回在回合第 1 步执行：先落 `memory/recall`，再在候选消息后追加一条 `source.kind` 为 `memory-recall` 的用户消息。这与请求时钟使用同一种持久注入形式，重放时事件与文本都能复现。
- 召回文本只由召回条目渲染，绝不回灌会话自身历史。
- 回合结束的写入读取 `memoryAutosave` 投影的 `turnText`，它收集自上次 `turn/start` 以来的用户与助手文本，并跳过插件自己注入的消息。
- 写入路径的任何失败都落在 `memory/write` 事件上（`queued: false` 与 `error`）；回合已经结束，钩子内不重试。

<a id="model-experience"></a>
## 模型体验

### 召回上下文消息

#### 模型看到什么

回合第一步之前，消费方追加一条 user 角色的消息，在固定标题下列出召回到的记忆。该消息的 source 是 `memory-recall`，后续步骤据此把它和用户输入区分开。

##### 召回块

```markdown
Relevant memories from earlier sessions:
- <recalled memory text>
```

#### Token 影响

与命中条数及其长度成正比；消费方的 `recallMode` 决定引擎返回多少条。

#### KV Cache 影响

这个块是一条消息而不是提示词小节，所以它追加到对话末尾，不重写已缓存的前缀。没有召回的回合不追加任何内容。

### 回合结束写入

#### 模型看到什么

什么也看不到。批次在回合结束后提交，只落一条 `memory/write` 事件，模型从不读取。

#### Token 影响

无；写入结果不进入后续请求。

#### KV Cache 影响

写入发生在回合结束之后，对之后任何请求都没有贡献，因此没有缓存前缀依赖它。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制

- 每个合格回合都会召回，没有相关性启发式；希望更少召回的部署可设 `recallOnTurnStart: false`，改由模型工具触发。
- 写入提交的是完整的用户与助手消息，不包含工具输出；只通过工具调用获得的事实不会被记住，除非助手复述。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

见本目录英文页的 Dev Note；两页内容保持一致。

</details>
