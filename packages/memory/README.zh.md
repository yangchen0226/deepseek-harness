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
| [`memory-remote`](memory-remote/README.zh.md) | 面向部署好的 HTTP 记忆服务的 provider，负责身份头、传输与降级 | 注册到 `ctx.memory` |
| [`memory-bear`](memory-bear/README.zh.md) | 对接既有 MemoryBear 部署的 provider | 注册到 `ctx.memory` |
| [`tool-memory`](tool-memory/README.zh.md) | 模型可见的 `memory_recall`、`memory_write` 与按需 `memory_forget` | 注册到 `ctx.tools` |
| [`memory-autosave`](memory-autosave/README.zh.md) | 回合前召回与回合后写入，以及客户端读取的 `memoryAutosave` 投影 | 注册到 `ctx.agents` 钩子 |
| [`memory-agent`](memory-agent/README.zh.md) | `memory_agent_create`：组合并注册记忆型 agent 预设 | 注册到 `ctx.tools` |

客户端表面位于 [`client/ui-memory`](../client/ui-memory/README.zh.md)。

<a id="related-documentation"></a>
## 相关文档

- [记忆服务部署](../../deploy/memory-service/README.zh.md) — PostgreSQL 表结构、五个服务路由与客户端环境变量。
- [Session 投影](../../docs/subsystems/session.zh.md) — `memoryAutosave` 单元与它遵循的"模型可见即已记录"规则。


内置 provider 只暴露召回与写入。MemoryBear 把删除、反思、工作记忆、情景与感知读取放在 JWT 管理端，因此 `memory_forget` 默认不注册、画像读取返回不支持。不要为 provider 拒绝的操作注册工具或展示控件。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

见本目录英文页的 Dev Note；两页内容保持一致。

</details>
