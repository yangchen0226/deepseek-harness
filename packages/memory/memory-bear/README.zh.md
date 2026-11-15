---
description: "MemoryBear 实现：终端用户绑定、同步召回、异步写入受理，以及服务不可达时的降级。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-bear

[English](README.md) | 中文

<a id="summary"></a>
## 概述

MemoryBear 版 `ctx.memory` 实现：end-user 绑定、同步召回、异步写入受理，服务不可达时降级。

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
- name: '@deepseek-ai/dsh-memory-bear'
  config:
    baseUrl: http://127.0.0.1:8002
    apiKey: mbr_...
    endUserOtherId: alice
    timeoutMs: 800
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `baseUrl` | 必填 | MemoryBear 地址（无尾斜杠） |
| `apiKey` | 必填 | 带 `memory` scope 的 API Key |
| `endUserOtherId` | 必填 | harness 侧用户标识，服务端映射为 end-user UUID |
| `timeoutMs` | `800` | 单请求超时；召回超时即降级 |
| `language` | `zh` | 记忆陈述的文案语言 |

workspace 作用域由 API Key 推导，provider 从不发送 workspace id。

<a id="understand-the-implementation"></a>
## 实现要点

- **end-user 绑定**惰性且幂等：首次调用按 `other_id` 创建，UUID 在插件 fiber 生命周期内缓存；创建失败不缓存，下次重试。
- **召回**走同步读接口，`deep`/`normal` 由服务端拆题并汇总，`quick`/`express` 返回原始条目。任何传输失败、超时或凭据拒绝都解析为 `degraded: true`；只有空问题会拒绝。
- **写入**只报受理：服务端返回每条消息的 task id 并后台抽取，`queued: true` 表示进入流水线，绝不表示可检索。
- **删除与画像**不支持：MemoryBear 把它们放在 JWT 管理端，本 provider 不配置该凭据。

<a id="model-experience"></a>
## 模型体验

间接，本 provider 只是替消费方转发召回与写入请求；模型看到的内容由 dsh-memory-autosave 与 dsh-tool-memory 决定。

#### KV Cache 影响

无；本包从不组装或发送模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制

- 无删除、反思触发、工作记忆、情景与感知读取；这些需要第二套凭据。
- `endUserOtherId` 是每实例一个身份；多用户宿主需要每用户一个实例或外层身份解析。
- 不区分 RAG 存储类型的工作区：它同步写入且没有图，但 provider 对两种工作区一视同仁。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

见本目录英文页的 Dev Note；两页内容保持一致。

</details>
