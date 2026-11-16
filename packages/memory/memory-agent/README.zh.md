---
description: "会话内 agent 创建：由模型工具调用组合并注册一个记忆型 agent 预设，provider 凭据不会进入模型上下文。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-agent

[English](README.md) | 中文

## 概述

`dsh-memory-agent` 让一段对话产出一个长期存在的助手。用户需要一个专注某类工作的 agent 时，模型调用 `memory_agent_create`；该工具用部署方自己的记忆 provider 配置加上请求的人设组合出预设并注册。新 agent 出现在预设名册里，可以立即启动。

## 目录

- [使用](#use-this-package)
- [实现要点](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用

```yaml
- name: '@deepseek-ai/dsh-memory-agent'
  config:
    provider:
      baseUrl: https://cloud.memorybear.ai
      apiKey: <MemoryBear API key>
      endUserOtherId: alice
    recallMode: quick
    presetOrder: 90
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `provider.baseUrl` | 必填 | 复制到每个新建预设里的记忆服务地址 |
| `provider.apiKey` | 必填 | 密钥凭据；对模型不可见，也不写日志 |
| `provider.endUserOtherId` | 必填 | 新建 agent 共享的记忆身份 |
| `provider.timeoutMs` | `8000` | 复制到每个新建预设里的请求超时 |
| `recallMode` | `quick` | 新建 agent 的自动召回宽度 |
| `presetOrder` | `90` | 名册位置，让新建 agent 排在随包预设之后 |

<a id="understand-the-implementation"></a>
## 实现要点

- 凭据保存在本插件的配置里，被复制进新建预设的 provider 行。它从不出现在工具参数、工具结果或会话事件中。
- 每个新建预设包含记忆 provider、记忆工具、autosave 消费方、按请求的名称与指令生成的人设，以及常规的文件、shell 与 todo 工具。
- 注册是进程内状态。新建预设集中在一个 effect 中持有，插件释放时全部注销；持久化属于编辑器界面，不属于模型工具。
- 重名的显示名称会被拒绝，而不是覆盖已有的同名 agent。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

该工具可见时生成的 [`memory_agent_create` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-memory)。

#### Token 影响

工具可见的每个请求都有固定的 schema 开销。

#### KV Cache 影响

schema 不变时前缀稳定。

### 创建结果

#### 模型看到什么

一行文字，说明创建出的 agent 名称和注册的预设，后续回合可以据此引用。重名时报告已有预设，而不是创建第二个。

#### Token 影响

每次调用一行短文本。

#### KV Cache 影响

结果作为工具消息出现在缓存前缀之后，不使其失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制

- 新建 agent 不跨宿主重启存活；只有把预设写入磁盘的名册编辑器才能让它们持久。
- 不镜像 MemoryBear 应用：agent 只存在于本 harness，其他 MemoryBear 客户端无法运行它。
- 不做技能选择：新建 agent 得到默认工具集，而不是专门技能。

<a id="dev-note"></a>
### 开发备注

行为测试用预设注册表替身驱动真实工具管线（`tests/memory-agent.spec.ts`），断言组合出的行、凭据边界、重名拒绝与释放。
