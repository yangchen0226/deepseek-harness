---
description: "MemoryBear 版记忆接缝实现，可用托管或自建部署：终端用户绑定、同步召回、异步写入受理、浏览、画像读取，以及服务不可达时的降级。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-bear

[English](README.md) | 中文

<a id="summary"></a>
## 概述

显式范围使用配置的账号标识和稳定工作区 UUID 解析不同的 MemoryBear 终端用户。省略范围时访问旧集合，不会自动提升为全局记忆。并发解析合并请求，失败后可以重试。

`dsh-memory-bear` 把 harness 接到 MemoryBear——托管服务 `https://cloud.memorybear.ai`，或同一 API 的自建部署。它是随包 `memory` 预设使用的 provider。它为每个配置的身份解析一个终端用户，经读接口同步召回，把对话批次提交给异步抽取，服务不可达时把召回降级为空结果，使回合永远不会无限等待记忆。

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
    baseUrlEnv: MEMORYBEAR_BASE_URL
    apiKeyEnv: MEMORYBEAR_API_KEY
    endUserOtherIdEnv: MEMORY_USER
    timeoutMs: 8000
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `baseUrl` | 省略 | 显式 MemoryBear 地址，否则使用 `baseUrlEnv` 或 `https://cloud.memorybear.ai` |
| `baseUrlEnv` | `MEMORYBEAR_BASE_URL` | 命名 MemoryBear 地址的启动环境变量 |
| `apiKey` | 省略 | 没有 `ctx.credentials` 时供编程调用方兼容使用的字面量 key |
| `apiKeyEnv` | `MEMORYBEAR_API_KEY` | 每次请求通过 `ctx.credentials` 解析的凭据引用 |
| `endUserOtherId` | 省略 | 显式 harness 侧用户标识 |
| `endUserOtherIdEnv` | `MEMORY_USER` | 命名 harness 侧用户标识的启动环境变量，缺省为 `local` |
| `timeoutMs` | `800` | 单请求超时；召回超时即降级 |
| `language` | `zh` | 记忆陈述的文案语言 |

workspace 作用域由 API Key 推导，provider 从不发送 workspace id。在 MemoryBear 控制台创建带 `memory` scope 的 key。`apiKeyEnv` 每次操作都从凭据服务解析；地址和用户标识通过不可变启动环境快照解析。使用托管服务时要调大 `timeoutMs`：它的读路径在上游执行检索，还要跨境往返，所以 `memory` 预设用 8000 ms。

<a id="understand-the-implementation"></a>
## 实现要点

- **end-user 绑定**惰性且幂等：首次调用按 `other_id` 创建，UUID 在插件 fiber 生命周期内缓存；创建失败不缓存，下次重试。
- **召回**走同步读接口，`deep`/`normal` 由服务端拆题并汇总，`quick`/`express` 返回原始条目。接缝的可选 `limit` 在解码后由 provider 本地裁剪，因为该接口没有文档化的 limit 字段。任何传输失败、超时或凭据拒绝都解析为 `degraded: true`；只有空问题会拒绝。
- **写入**只报受理：服务端返回每条消息的 task id 并后台抽取，`queued: true` 表示进入流水线，绝不表示可检索。
- **浏览**读取已存记忆时间线，按时间倒序。该接口按时间分页、没有文本过滤，所以 `query` 只筛选取回的这一页，此时 `total` 统计的也是这一页。
- **画像**把用户摘要缓存映射成分区：一句话总结与完整摘要进 `basic`，标签进 `interests`，性格进 `habits`，核心价值观进 `emotions`。MemoryBear 尚未生成摘要的用户读到的是空分区。
- **删除**不支持：MemoryBear 把它放在 JWT 管理端，本 provider 不配置该凭据，因此拒绝 `MEMORY_UNSUPPORTED`，而不是返回空操作。
- **失败**即使伴随 4xx 状态，也按上游信封分类：未知或耗尽的 API Key（`3007`、`3009`、`3012`、`3014`–`3017`）视为不可用，召回因此降级而不是让回合失败。

记忆库请求接受从 1 开始的 `page`，每页最多 100 条。查询仅筛选当前取回页，不代表全库搜索。未筛选总数用于翻页导航。写入已接收不代表提取、索引或画像更新完成。

画像读取使用远端缓存摘要。显式更新画像先为当前范围对应的终端用户重新生成，再读取结果；不会请求所有用户。生成失败会显示错误，不会被当作成功的空画像。MemoryBear 提供者使用 `profileTimeoutMs` 限制生成时长。

<a id="model-experience"></a>
## 模型体验

间接，本 provider 只是替消费方转发召回、写入、浏览与画像请求；模型看到的内容由 dsh-memory-autosave 与 dsh-tool-memory 决定。

#### KV Cache 影响

无；本包从不组装或发送模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制

- 无删除、反思触发、工作记忆、情景与感知读取；这些在管理端，需要第二套凭据。
- 没有录制的会话快照：回放离线运行，而每次召回和写入都要访问服务。设置 `DSH_MEMORYBEAR_TEST_API_KEY` 时，`tests/e2e-service.spec.ts` 会让真实 provider、工具与 autosave 对接真实服务。
- `endUserOtherId` 是每实例一个身份；多用户宿主需要每用户一个实例或外层身份解析。
- 不区分 RAG 存储类型的工作区：它同步写入且没有图，但 provider 对两种工作区一视同仁。

<a id="dev-note"></a>
### 开发备注

行为测试对本地 stub 服务器运行（`tests/provider.spec.ts`），断言请求路径、鉴权头、信封处理与降级。
