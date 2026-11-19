---
description: "长期记忆能力接缝（ctx.memory）：召回、写入受理、浏览、画像读取与可达性，面向组合 provider 的维护者与构建记忆工具的消费方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

[English](README.md) | 中文

## 概述

请求可以指定全局或工作区集合；省略范围只访问旧集合。全局指当前配置账号主动共享的记忆；工作区使用持久化 UUID。

`dsh-memory` 定义 harness 眼中"长期记忆"的含义，不决定它存在哪里。Provider 实现 `ctx.memory` 服务；工具、会话生命周期和客户端面板消费它。定义固定了四条语义：引擎不可达时召回降级而不抛错；写入报告"已受理"而非"已存储"；删除要么真实完成，要么显式声明不支持；结果必须可 JSON 序列化，调用方可原样写入会话事件。

## 目录

- [使用](#use-this-package)
- [实现要点](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用

消费者依赖本包获取类型与抽象类；部署方依赖它满足接缝。

```ts
import { MemoryEngine } from '@deepseek-ai/dsh-memory'
import type {
  MemoryForgetRequest,
  MemoryForgetResult,
  MemoryHealth,
  MemoryListRequest,
  MemoryListResult,
  MemoryProfileRequest,
  MemoryProfileResult,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRememberRequest,
  MemoryRememberResult,
} from '@deepseek-ai/dsh-memory'

export class MyEngine extends MemoryEngine {
  async recall(_request: MemoryRecallRequest): Promise<MemoryRecallResult> {
    return { items: [], trace: [], degraded: true, latencyMs: 0 }
  }
  async remember(_request: MemoryRememberRequest): Promise<MemoryRememberResult> {
    return { queued: false }
  }
  async forget(_request: MemoryForgetRequest): Promise<MemoryForgetResult> {
    return { removed: 0 }
  }
  async profile(_request: MemoryProfileRequest): Promise<MemoryProfileResult> {
    return { sections: {} }
  }
  async list(_request: MemoryListRequest): Promise<MemoryListResult> {
    return { items: [] }
  }
  async health(): Promise<MemoryHealth> {
    return { reachable: false }
  }
}
```

<a id="understand-the-implementation"></a>
## 实现要点

- `MemoryRecallResult.degraded` 是"模型正在没有记忆的情况下运行"的唯一信号。消费方必须把它暴露出来；`degraded` 为真时，不能把空列表当成"没有命中"。
- `MemoryRememberResult.queued` 表示受理，不表示已落库。上游引擎异步存储；需要确认写入成功的消费方必须再召回一次。
- `MemoryForgetResult.removed` 统计真实删除。后端不提供删除的 provider 拒绝 `MEMORY_UNSUPPORTED`；消费方只在这个承诺成立的地方注册遗忘工具。
- `MemoryEngine.canForget()` 默认是 `false`。Provider 必须显式声明支持，面板等面向人的消费方才会展示有破坏性的删除控件；最终仍以 `forget` 的结果为准。
- 错误码在 `MEMORY_ERROR_CODES` 中；按 `MemoryError.code` 路由，不要匹配消息文本。

集合活动可以使用 `unknown` 表示无法确定远端结果的写入。可选的来源、检索问题和错误字段保留操作上下文；缺少这些字段的旧记录仍可读取。用户显式保存通过活动写入器记录，不依赖活跃会话。

<a id="model-experience"></a>
## 模型体验

无，接缝只声明引擎接口与 wire 类型，所有面向模型的用法都属于调用它的消费方。

#### KV Cache 影响

无；本包从不组装或发送模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制

- 本包不附带本地（内嵌）provider；接缝存在正是为了在不改动消费方的前提下新增实现。
- 定义只支持单一调用方身份的记忆范围；跨用户或跨工作区共享需要新增作用域字段并由 provider 支持。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

见本目录英文页的 Dev Note；两页内容保持一致。

</details>
