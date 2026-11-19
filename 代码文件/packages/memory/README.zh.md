---
description: "memory 分组索引：长期记忆能力接缝、远程 provider、模型可见工具、会话驱动的 autosave 消费方，以及会话内 agent 创建。"
kind: "package-group"
---

# memory/ — 长期记忆能力族

[English](README.md) | 中文

## 摘要

memory 分组让会话能够访问超出一个会话日志的生命周期的知识。provider 负责存储与检索持久记忆；autosave 消费方在回合前召回、回合后写入；工具包给模型显式的控制能力；agent 包从对话中组合出新的记忆型预设。接缝存在的意义是 harness 不依赖任何一家厂商的存储模型：内置 provider 对接 MemoryBear，换一个后端不需要改动任何消费方。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [维护者说明](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`memory`](memory/README.zh.md) | 定义接缝：召回、浏览、写入受理、删除、画像、可达性与错误码 | `ctx.memory` |
| [`memory-bear`](memory-bear/README.zh.md) | 对接 MemoryBear 的 provider，可用托管服务 `cloud.memorybear.ai` 或自建部署；负责 API Key、终端用户绑定与降级 | 注册到 `ctx.memory` |
| [`tool-memory`](tool-memory/README.zh.md) | 模型可见的 `memory_recall`、`memory_write` 与按需 `memory_forget` | 注册到 `ctx.tools` |
| [`memory-autosave`](memory-autosave/README.zh.md) | 回合前召回与回合后写入，以及客户端读取的 `memoryAutosave` 投影 | 注册到 `ctx.agents` 钩子 |
| [`memory-agent`](memory-agent/README.zh.md) | `memory_agent_create`：组合并注册记忆型 agent 预设 | 注册到 `ctx.tools` |

客户端表面位于 [`client/ui-memory`](../client/ui-memory/README.zh.md)。

<a id="related-documentation"></a>
## 相关文档

- [Session 投影](../../docs/subsystems/session.zh.md) — `memoryAutosave` 单元与它遵循的"模型可见即已记录"规则。


MemoryBear 的 API Key 接口提供召回、写入、已存记忆时间线与用户摘要缓存，但不提供删除：删除、反思与工作记忆都在 JWT 管理端。因此随包预设不注册 `memory_forget`，面板把删除显示为不支持。不要为 provider 拒绝的操作注册工具或展示控件。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

见本目录英文页的 Dev Note；两页内容保持一致。

</details>
