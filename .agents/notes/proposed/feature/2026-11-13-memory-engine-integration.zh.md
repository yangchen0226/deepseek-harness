# Agent Note: Integrating the MemoryBear memory engine into DSH

Status: proposed

[English](2026-11-13-memory-engine-integration.md) | 中文

## Problem

DSH 的会话可以很长，但跨会话是没有记忆的：harness 只从一个会话日志里重建上下文，而用户的长期知识——偏好、项目事实、过往决策——要么每个会话重新粘贴一遍，要么丢失。MemoryBear 是一个独立的 Python 系统（FastAPI + Neo4j + Elasticsearch + Celery），有成熟的记忆生命周期（感知、抽取、关联、遗忘）和一套检索轨迹协议，但没有任何 DSH 消费方。

这次集成必须回答四个产品问题：

1. 会话如何*展示*记忆——agent 召回了什么、写入了什么、为什么。
2. 会话如何*调度*记忆——模型请求前召回、回合结束后写入、按策略遗忘。
3. 用户如何*创建一个具备记忆的 agent*——用预设，而不是手改配置。
4. 记忆界面在*会话窗口之内*长什么样。

## Proposal

### 1. A capability seam, not a port

MemoryBear 是远程服务，不是要嵌进来的库。DSH 通过标准的三角色能力接缝消费它：

- **Service Definition** — `packages/memory/memory/` 拥有 `memory` 服务的类型与请求/规格拆分。方法为 `recall(request)`、`remember(request)`、`forget(request)`、`profile(request)`、`graph(request)`、`health()`。每个请求都是显式的；默认值在 provider 内部解析，绝不在调用点解析。
- **Service Provider** — `packages/memory/memory-bear/` 基于 MemoryBear 的 HTTP API 实现该定义（`/v1` 走 API key，管理面 `/api` 走 JWT）。配置项：`baseUrl`、`apiKey`、`workspaceId`、`endUserBinding`、`searchMode`、`writeQueue`、`timeouts`。后续可以再加一个 `memory-local` provider（SQLite + embedding），不需要改动任何消费方。
- **Consumers** — 工具包、会话生命周期钩子、客户端 UI 面板、agent 预设。

这样 Python 专有的概念（Neo4j 节点标签、Celery 队列）就被挡在 provider 边界之内。

### 2. Identity mapping

| DSH | MemoryBear |
| --- | --- |
| workspace / 项目根目录 | `workspace_id` |
| 用户（`identity`） | `end_user_id`（一张持久映射表，存储在 `packages/storage`） |
| 会话 | `conversation_id`（这样按会话刷新才成立） |
| 回合 | 写入批次的单位；`metadata.turnId`、`metadata.agentId` |

终端用户映射表是设置级记录：`{ dshUserId → { endUserId, workspaceId, createdAt } }`。未映射的用户在第一次召回或写入时通过 MemoryBear 的 end-user 接口按需创建。

### 3. Session behavior

**召回（读路径）。** 回合开始时，`agent/pre-step` 以用户消息改写成的检索问题调用 `recall`，`searchMode` 取配置值（默认 `quick`）。结果以 `memory/recall` 落事件，并通过一条 `systemPrompt.context()` 条目呈现给模型；该条目的 text 函数读取 `memory.recall` 投影，因此重放能复现模型当时看到的内容。不存在"请求前随意追加系统内容"的通用钩子；`agent/pre-step` 不得修改系统提示词，`agent/request` 已废弃且不能改 messages。召回绝不能无限阻塞：provider 超时即返回空召回并标记 `degraded: true`。

**写入（写路径）。** `turn/end` 之后，消费方把用户消息、助手消息与工具结果摘要批量化，以 `fast_write` 语义调用 `remember`。拒绝与失败都不致命，但必须作为会话事件记录，绝不静默吞掉。显式的 `memory_write` 工具让模型可以在回合中途为值得钉住的事实主动请求写入。

**遗忘。** 只经由 `memory_forget` 工具或界面的遗忘动作，两者都落事件。自动遗忘是 MemoryBear 自己的定时流水线；DSH 不实现第二套衰减策略。

### 4. Model-facing tools

名字与参数严格对齐 MemoryBear 已有的 LLM 工具契约，保证两侧可以对照：

| Tool | Params | When the model calls it |
| --- | --- | --- |
| `memory_recall` | `question`（改写后的检索式）、`search_mode`（`deep` \| `normal` \| `quick` \| `express` \| `meta`） | 用户询问偏好、过往决策或早前学到过的实体；回合前召回没有命中 |
| `memory_write` | `content`、`kind`（`preference` \| `fact` \| `event` \| `relationship` \| `procedure`）、`confidence` | 用户陈述了一条持久事实，或要求记住某事 |
| `memory_forget` | `target`（记忆 id 或自然语言选择器） | 用户要求遗忘；纠正一条错误的记忆 |
| `memory_profile` | `section`（`basic` \| `interests` \| `habits` \| `emotions`） | 回答"你了解我什么" |

描述只写模型视角：不出现 HTTP、队列或图数据库词汇。

### 5. Session events (Model-visible ⟺ logged)

通过合并进 `packages/session/session/src/types.ts` 的 `SessionEventMap` 来声明：

- `memory/recall` — `{ question, mode, degraded, items[], trace }`，其中 `trace` 携带 MemoryBear 的各阶段（`profile_loaded`、`query_split`、`hybrid_searched`、`relation_searched`、`results_merged`、`result_ready`）与分数。
- `memory/write` — `{ batchId, items[], queued, error? }`
- `memory/forget` — `{ target, removed, error? }`
- `memory/profile` — `{ sections, items[] }`

界面与投影只从这些事件派生；provider 不持有任何界面状态。

### 6. Client UI inside the session window

MemoryBear 的八个页面收敛成一个带页签的右侧面板，因为会话窗口只容得下一个面板，容不下一个控制台：

| Tab | Source page(s) in MemoryBear | Content in DSH |
| --- | --- | --- |
| Memories | UserMemory、UserMemoryDetail | 可搜索的记忆列表，每条显示来源/分数/时效，可删除 |
| Graph | UserMemoryDetail/GraphDetail、D3Graph | 当前会话实体的实体/关系邻域图 |
| Recall trace | Chat/MemoryRecall、MemoryConversation | 按回合的阶段时间线、命中数、MemoryRecallIndex |
| Profile | BrainMemory、UserMemory 的主体详情 | 基础事实、兴趣、习惯、情绪趋势 |
| Forgetting | ForgettingEngine、ForgetDetail | 入队情况/最近一次周期，以及处于休眠/衰减/清除档的条目 |
| Agents | AppManagement、ApplicationConfig | 列出、创建具备记忆的 agent 应用，并做草稿试运行 |

对话面增量：助手消息上方一个紧凑的召回 chip（`召回了 N 条记忆 · 查看轨迹`），输入区一个记忆开关（本轮关闭召回），以及 `memory_write` 结果的内联卡片。页签类型通过 `ctx.sidebarRightTabs.register({ id, kind, title, guide })` 注册，其正文通过 keyed slot `sidebar.right.pane.tab` 注册，两者都包在 `ctx.effect` 里以证明释放；chip 像 `ui-jobs` 与 `ui-goal` 那样注册到 `conversation.chat.node` / `conversation.session.header.actions`。

### 7. Agent creation through a session

两条路径，都由预设驱动：

1. **会话内创建。** `memory_agent_create` 工具（由 agent 预设权限控制）接收 `name`、`role`（`standalone` \| `master` \| `sub`）、`skills`、`memory` 配置。它在 `packages/preset/agent-preset` 下写出一个预设；当 MemoryBear 的应用面开启时，再镜像成一个 MemoryBear 应用（`POST /api/apps`，`agent_config.memory` 存记忆配置）。响应里给出创建出的 agent 名称，用户可以立刻启动它。
2. **预设选择。** 随包提供的 `memory` 预设组合了 tool-memory、memory-autosave 与一个以召回为先的人设。在会话输入区选中它就是零配置路径。

场景文档：`docs/memory/usage-scenarios.md`。

### 8. File-level plan

Host 侧包（新分组 `packages/memory/`）：

```
packages/memory/
  memory/                      service definition: types, request/spec split, brand ids
  memory-bear/                 provider: HTTP client, contract validation, retries
  memory-autosave/             consumer: agent/pre-step recall + turn/end write
  tool-memory/                 consumer: memory_recall / memory_write / memory_forget / memory_profile
```

Client 侧包：

```
packages/client/ui-memory/     right-sidebar tab type `memory://session/<id>`, six tab bodies
packages/client/ui-chat/       recall chip + composer memory toggle (existing package, additive)
packages/preset/agent-preset/  shipped `memory` preset
```

接线：把两个 host 插件加进 `packages/bundle/` 下相关 profile bundle；把 client 插件加进 Web 应用组合。会话事件通过各包自己的 `declare module` 合并进 `packages/core/session/src/types.ts` 的消费方。

`memory-autosave` 内部的钩子顺序：

1. `agent/pre-step`（prepend）——解析用户身份、调用 `recall`、落 `memory/recall`、追加上下文消息。
2. `turn/end`——以本回合的用户/助手/工具摘要事件入队 `remember`；结算后落 `memory/write`。
3. `ctx.on('agent/tool-call')`（若存在）用于输入区开关的状态——否则该开关只存在于按回合配置中。

### 9. Usage scenarios

**S1 —— 回到一个长期项目。** 用户在三周前做过事的仓库里开一个新会话。pre-step 以 `quick` 对"迁移脚本当时是怎么定的"做召回，返回两条记忆：选定的方案与被否决的替代方案。chip 显示 `2 条记忆`；模型无需重读仓库就作答，并引用该决策。轨迹页签显示这两条来自哪几次混合检索命中。

**S2 —— 必须留存的偏好。** 用户说"以后别用 npm，用 pnpm"。模型调用 `memory_write(kind: preference)`。面板的记忆页签新增一条，时效为 `now`；之后的会话召回会命中它，agent 不再建议 npm。如果用户说"忘掉这个"，`memory_forget` 删除它，面板显示这次删除。

**S3 —— 跨 agent 交接。** 一个 master agent 委派给使用不同预设的 sub agent。两者解析到同一个 `end_user_id`，因此 sub agent 的召回能看到 master 写入的内容。这就是在身份层解决 MemoryBear 自己点名的"多 agent 数据孤岛"，而不是靠复制上下文。

**S4 —— 遗忘在实践中生效。** 用户问"我以前的手机号是多少？"MemoryBear 的遗忘流水线已经把它降权（强度低、陈旧）。轨迹把它标记为 `decayed`；agent 会说自己已不掌握该细节，而不是回答陈旧数据。遗忘页签显示它处于休眠/衰减/清除的哪一档。

**S5 —— 在对话中创建 agent。** 用户说："帮我建一个只关注前端重构的 agent，记得我的技术栈偏好"。`memory_agent_create` 工具创建出一个预设，`memory.mode: deep`、`skills: [frontend-refactor]`、人设以召回偏好为先。它出现在 Agents 页签里并可立即启动；应用面开启时，同一次调用还会镜像出一个 MemoryBear 应用，让同一个 agent 在其他客户端也能用。

**S6 —— 降级模式。** MemoryBear 不可达。pre-step 召回在 800ms 超时，落 `memory/recall { degraded: true }`，回合继续。chip 显示 `记忆不可用`；没有任何东西被静默丢弃，会话日志准确记录了模型没收到什么。

**S7 —— 隐私边界。** 用户从输入区为本轮关闭记忆。`agent/pre-step` 只在这一回合跳过召回；`turn/end` 跳过写入。面板的开关状态由会话事件派生，因此重放时这一回合同样显示为关闭。

## Alternatives considered

**把 Python 引擎整个嵌进来。** 否决：Neo4j + ES + Celery 无法嵌进 Node harness，而且会分叉上游的生命周期实现。

**客户端直接发 HTTP。** 否决：绕过了会话事件的要求，什么都不可重放，还会把凭据泄漏到浏览器。

**只做一个单体 `memory` 包。** 否决：接缝必须有 provider 拆分，才能接入本地 provider，也才能把 Python 专有词汇挡在消费方之外。

## Acceptance criteria

- 带 memory 预设的会话能召回上一次会话的事实，并在面板里显示检索轨迹。
- 每次召回、写入、遗忘、画像都出现在会话日志里，并重放出同一个界面。
- provider 不可达时：召回在超时内降级，回合继续，界面显示降级状态。
- 把 provider 从 MemoryBear 换成桩实现，消费方无需改动。
- 配置开启时，`memory_agent_create` 在会话内产出一个可运行的 agent，并生成对应的 MemoryBear 应用。

## Risks

- **延迟**：回合前召回多一跳网络。缓解：默认 `quick`、与上下文装配并行、硬超时。
- **记忆重复**：DSH 的压实与 MemoryBear 都会做摘要。边界：压实负责会话窗口，MemoryBear 负责长期知识。
- **同意与隐私**：记忆会离开本机。缓解：显式的 `memoryWrite.enabled` 与按回合开关；终端用户映射表留在本地。
- **版本漂移**：MemoryBear 的 API 尚未 1.0。缓解：把 provider 钉在 `external_api_contract.json` 的形态上，并在 wire 边界校验响应。

## Open questions

- 召回是每回合都跑，还是只在用户消息通过某个廉价启发式阈值时才跑？
- 把 agent 创建镜像成 MemoryBear 应用是否在范围内，还是 v1 只做 DSH 预设就够了？
- DSH 用户被删除时，谁负责清理 MemoryBear 侧的终端用户？
