# Agent Note: MemoryBear → DSH 深度集成方案

Status: proposed

[English](2026-11-13-memorybear-integration-plan.md) | 中文

> 状态：P0 已落地并验证（2026-11-13）；P1 的召回面板已落地；其余为后续工作。

## Problem

**架构调整（2026-11-13 晚）**：记忆服务端改为自建、部署在云端，数据库用本机 PostgreSQL 17。原因是 MemoryBear 需要 Neo4j + ES + Celery 一整套进程，部署成本过高；Supabase Edge Function 路径因需要云端托管数据库而放弃。原 `memory-bear` provider 保留，默认路径改为 `memory-remote` + [`deploy/memory-service`](../../../../deploy/memory-service/README.zh.md)。

服务已在 124.221.105.121 上线：PG 17 集群 `17/main`（5433，loopback）、库 `memory_svc`、systemd 单元 `memory-service`（127.0.0.1:7180）、nginx 站点、Let's Encrypt 证书（`https://memory.newpm.ai`，到期 2027-02-11，自动续期）、每日备份。真实 provider + tool-memory + autosave 的端到端测试经 HTTPS 通过。

一次基于 gpt-6-astra 的真实 Web 会话跑通了整条链路：选择预设、回合前召回、回合后写入、模型主动调用 `memory_write`、面板三视图、输入区开关，以及服务重启后重新打开会话。这次运行发现了五个单元测试都没覆盖到的缺陷，记录在[打包与组合约束](#packaging-constraints-learned-the-hard-way)。

跨境的 TLS 握手要 0.4–1.3s，provider 默认 1500ms 超时会把健康服务判成间歇不可用，因此 preset 把 `timeoutMs` 设为 4000ms，并留 `MEMORY_TIMEOUT_MS` 覆盖口子。

| 包 / 目录 | 内容 | 测试 |
|---|---|---|
| `packages/memory/memory` | Service Definition：`ctx.memory`、请求/结果类型、`MemoryError` 错误码 | 3 |
| `packages/memory/memory-remote` | **默认 provider**：六路由 HTTP 客户端、身份头、降级 | 7 + 1 e2e |
| `packages/memory/memory-bear` | MemoryBear provider（保留，用于已有部署） | 6 |
| `packages/memory/tool-memory` | `memory_recall` / `memory_write` / `memory_forget` | 5 |
| `packages/memory/memory-autosave` | `agent/pre-step` 召回注入 + `turn/end` 批量写入 + `memoryAutosave` 投影 | 5 |
| `packages/memory/memory-agent` | `memory_agent_create`：组合并注册记忆型 agent 预设 | 3 |
| `packages/client/ui-memory` | 会话右侧记忆页签：召回 / 记忆库 / 画像三视图 + 头部入口 + 输入区开关 | 20 |
| `packages/api/memory-controller` | 面板 Remote 端点：`list` / `profile` / `forget` / `health` / `mute`，按会话解析引擎 | 9 |
| `deploy/memory-service/` | 记忆服务端：Node 服务、schema（含 `memory_list`）、systemd 单元、nginx、备份 | e2e 通过 |
| `packages/bundle/web-app/presets/memory.patch.yml` | `memory` 预设，`MEMORY_SERVICE_URL` 未设置时记忆行禁用 | — |

未实现（明确延后）：

- 图谱页签：接缝没有关系模型，无数据可读，需先扩展 `MemoryEngine` 与每个 provider。
- 遗忘页签：记忆库已支持逐条删除，但没有按衰减档位展示的只读视图。
- Agent 页签：创建出的 agent 通过既有预设选择器出现；`memory_agent_create` 已有，但不落盘、重启即失。
- 语义向量检索：当前只有词法 + pg_trgm 相似度，没有 embedding。
- 对话内召回 chip：`conversation.chat.node` 的 kind 必须由 chat 流程产出节点才会渲染，记忆插件无法自行新增。
- "本轮关闭记忆"开关已落地（`memory/mute` 会话事件 + 输入区 `conversation.input.dock`）；状态落在日志里而不是客户端，因为它决定模型能否看到召回内容，重放必须得出同一答案。
- 创建出的 agent 不落盘、不镜像到云端，重启即失。
- 录制的会话快照。回放必须离线且不需要 key，但现有 provider 都依赖远程服务，所以要做出确定性的记忆场景，得先有一个进程内引擎（即待决问题里的本地 provider）。GUI 的 GIF 已基于真实 Web 服务与真实模型轮次录制，尚未附到 pull request。
- 面板所在的会话必须处于活跃状态：对已关闭的会话，面板找不到预设作用域内的引擎，会把浏览显示为不支持。为已关闭会话获取预设作用域尚未实现。

### Packaging constraints (learned the hard way)

新包若要进入桌面安装包，**不能设 `"private": true`**：发布 family 的 `patterns` 是 `packages/*/*/package.json`，`members()` 跳过 private 清单，缺了就会在 `prepare-package-set.ts` 报 `requires unpacked package`。`files` 数组由 `scripts/check-workspace-constraints.ts` 精确规定，含运行时 `./types` 导出的包才允许 `lib/types/**/*.js`。

真实会话暴露出的组合约束，现在都有测试覆盖：

- 提供服务的预设插件必须和它的所有消费方一起放在带该服务 `isolate` 的 `cordis:group` 里，否则注册表会拒绝该预设。
- 客户端 Remote 命名空间由 `api-remotes` 统一挂载，liveshare 还必须为每个端点分类。
- 新增的 `SessionEventMap` 成员需要重新生成 `KNOWN_SESSION_EVENT_TYPES`，否则会话无法重新打开。
- 上下文注入同样是 user 角色，凡是读取“用户说了什么”的地方都必须按 `user` 来源过滤。


## Proposal

不做"把 Python 引擎搬进 dsh"，而是做一条**记忆能力 seam**（Service Definition / Provider / Consumer），把 MemoryBear 作为远程 Provider 接进来。四条产品诉求各有一个明确的宿主机制：

| 诉求 | dsh 侧机制 | 关键文件 |
|---|---|---|
| 会话体现记忆能力 | `ctx.systemPrompt.context()` 持久化召回快照 + `memory/recall` 会话事件 | [system-prompt/src/index.ts:520](../../../../packages/core/system-prompt/src/index.ts) |
| 通过会话调度记忆 | `agent/pre-step` waterfall（回合前召回）、`turn/end`（回合后写入）、工具调用 | [time-context/src/index.ts:197](../../../../packages/context/time-context/src/index.ts) |
| Agent 创建 | 预设（`PresetDefinition` = id/name/plugins 行）+ 会话内创建工具 | [agent-preset-registry/src/definition.ts:6](../../../../packages/preset/agent-preset-registry/src/definition.ts) |
| 会话窗口内 WebUI | `ctx.sidebarRightTabs.register` + keyed slot `sidebar.right.pane.tab`，对话内 chip 走 `conversation.session.header.actions` | [ui-sidebar-right/src/client/tab-registry.ts:94](../../../../packages/client/ui-sidebar-right/src/client/tab-registry.ts) |

三个必须遵守的仓库约束（已核实，不是设计偏好）：

1. **没有"每次模型请求前随意塞系统内容"的钩子。** `agent/request` 已废弃且不可改 messages。召回结果要么走 `systemPrompt.context()`（持久化、可重放），要么走 `agent.inject()`（下一条准入请求可见）。→ 召回一律走 `systemPrompt.context()`。
2. **Model-visible ⟺ logged。** 每个召回/写入/遗忘/画像都必须 `session.append('memory/...')`，类型合并进 `@deepseek-ai/dsh-session/types` 的 `SessionEventMap`。`@mode` 只用于 Cordis `Events`，`SessionEventMap` 成员只写散文 JSDoc。
3. **Provider 边界不放业务分支。** Neo4j/Celery/ES 词汇只存在于 `memory-bear` provider 内；消费方只看到 `recall/remember/forget/profile/graph`。

## Layering and package structure

```
packages/memory/
  memory/                  Service Definition: types, request/spec split, branded ids
  memory-bear/             Provider: MemoryBear HTTP client + contract checks + retries/timeouts
  memory-autosave/         Consumer: pre-step recall, turn-end write, degraded state
  tool-memory/             Consumer: memory_recall / memory_write / memory_forget / memory_profile
  memory-agent/            Consumer: in-session agent creation (preset registration + optional MemoryBear app mirror)

packages/client/
  ui-memory/               Tab type memory://session/<id>; the panel views
  ui-agent-preset/         (existing) a "memory-enabled agent" preset card, reusing the seat mechanism
```

注册位置（漏一处就启动失败，`packages/client/AGENTS.md:145-154`）：

- Host：`packages/bundle/base/cordis.patch.yml` 行 + `packages/bundle/base/package.json` `dependencies`（**这就是 resolver 清单**）+ `tsconfig.host.json` references。
- Client：`packages/bundle/web-app/cordis.patch.yml` 行 + `web-app/package.json` + `tsconfig.client.json`。

### Service Definition shape

```ts
// packages/memory/memory/src/types.ts
export interface MemoryRecallRequest { question: string; mode: RecallMode; turn: number; limit?: number }
export interface MemoryRecallResult {
  items: readonly MemoryItem[]
  trace: readonly RecallStage[]        // profile_loaded → query_split → hybrid_searched → relation_searched → results_merged → result_ready
  degraded: boolean
  latencyMs: number
}
export type RecallMode = 'deep' | 'normal' | 'quick' | 'express' | 'meta'
```

`resolve(request): Spec` 在 provider 内完成默认值（mode、limit、end_user 绑定），`run()` 不含 `?? default`。

## Identity mapping

| dsh | MemoryBear |
|---|---|
| workspace 根路径 | `workspace_id`（**不随请求传**，由 API Key 推导） |
| `identity` 用户 | `end_user.id`（UUID）；`other_id` = dsh 用户稳定标识 |
| session | `conversation_id`（写入时传，读时走 `session_id?`） |
| turn | 写入批次；`metadata.turnId / agentId` |

认证：`Authorization: Bearer <key>` 或 `X-API-Key`，scope 必须含 `memory`；基础路径 `/v1`；另需 `X-Language-Type: zh|en`，展示类接口必须 `X-Timezone`（IANA），MCP 与偏好召回必须 `X-End-User-Other-Id`。

映射表是本地非会话存储：`defineDomain({ name: 'memory-bindings', version: 1, tables: { users: ... } })`。首次使用先 `POST /v1/end_user/create { other_id }`（同 `other_id` 幂等），把返回的 UUID 写回本地表。

**契约约束（provider 必须吸收，不能外泄给消费者）：**

1. 写入异步：`/v1/memory/write` 返回 `task_ids`，无公开状态接口；落地检测用 `GET /v1/memory-display/written`。`memory/write` 事件因此只能标记 `queued`，不能标记 `stored`。
2. `/v1` 面**没有** forget/reflection/working/short-term/episodic/perceptual。遗忘只能：(a) 用管理端 JWT 调 `/api/memory/forget-memory/*`（需另一套凭据），或 (b) v1 只提供删除工具走内部端点。**P0 不实现遗忘工具**，UI 的遗忘页签只读展示（来自 `/v1/memory-display/*` 与 dashboard 统计），写入路径不可用的能力必须显式隐藏而不是给假按钮。
3. 读接口同步，`deep/normal` 含 LLM 拆题+汇总（最慢），`express` 纯关键词（最快）。默认 `express`，可配 `quick`。
4. 响应统一 `{code,msg,data,error,time}`，`code===0` 为成功；错误码 3009/3012/3014-3017（鉴权/限流）、4001（用户不存在）、1003（参数）需映射为 `HarnessError`。
5. `storage_type=rag` 的空间无图/关系/社区，写入同步完成且无 `task_ids`；provider 需按 workspace 属性分支，但对消费者暴露同一 `recall/remember` 语义。

## Session behavior

**召回。** `agent/pre-step`（prepend）里：读本轮用户消息 → 用极轻规则判断是否需要召回（短寒暄/纯工具追问跳过）→ 并行调用 provider `recall`（硬超时 800ms）→ `session.append('memory/recall', ...)` → `systemPrompt.context()` 已注册的条目在下一次装配时带上已落盘的召回内容。

注意实现顺序：`systemPrompt.context()` 的 `text` 函数在装配时读取**投影状态**（最近一次 `memory/recall`），而不是在 pre-step 里拼字符串。这样重放时内容与当时一致。

**写入。** `turn/end` 批次化：用户消息 + 助手消息 + 工具结果摘要 → `remember(fast_write)` → `session.append('memory/write', { batchId, queued })`。失败不打断回合，但必须落事件（`error` 字段），不允许静默。

**遗忘。** 只经 `memory_forget` 工具或 UI 显式动作，二者都落事件。自动衰减归 MemoryBear 自己的 pipeline，dsh 不实现第二套。

**降级。** provider 不可达 → `memory/recall { degraded: true, latencyMs }`，回合继续，UI 显示"记忆不可用"。绝不静默丢弃。

## Model-visible tool contract

名字与参数对齐 MemoryBear 已有 LLM 工具契约，便于两侧对照与迁移：

| 工具 | 参数 | 调用时机 |
|---|---|---|
| `memory_recall` | `question`（改写后的检索式）、`search_mode`（5 档） | 询问偏好/过往决策/早前实体；回合前自动召回未命中 |
| `memory_write` | `content`、`kind`（preference/fact/event/relationship/procedure）、`confidence` | 用户陈述持久事实或要求记住 |
| `memory_forget` | `target`（id 或自然语言选择器） | 用户要求遗忘；纠正错误记忆 |
| `memory_profile` | `section`（basic/interests/habits/emotions） | 回答"你了解我什么" |

描述只写模型视角，不出现 HTTP/队列/图数据库词汇。

## Client: MemoryBear pages → the session window

MemoryBear 有 8 个记忆相关页面（MemoryManagement、MemoryEngine、MemoryConversation、UserMemory、UserMemoryDetail、MemoryExtractionEngine、BrainMemory、ForgettingEngine、SelfReflectionEngine、EmotionEngine）。会话窗口只能容纳一个右侧面板，因此**合并为六个页签**，其余降级为页签内的区块：

| 页签 | 对应 MemoryBear 页面 | dsh 内呈现 |
|---|---|---|
| 记忆 | UserMemory、UserMemoryDetail | 可搜索列表；每条显示来源/分数/时效；删除 |
| 图谱 | UserMemoryDetail/GraphDetail、D3Graph | 当前会话实体的邻域图 |
| 召回轨迹 | Chat/MemoryRecall、MemoryConversation | 按回合的阶段时间线、命中数、召回指数 |
| 画像 | BrainMemory、UserMemoryDetail 主体 | 基础事实、兴趣、习惯、情绪趋势 |
| 遗忘 | ForgettingEngine、ForgetDetail | **只读**：休眠/衰减/清除三档与最近周期（`/v1` 面不可写，见 §3 约束 2） |
| Agent | ApplicationManagement、ApplicationConfig | 记忆型 agent 列表、创建、草稿试运行 |

对话面增量（全部走既有 slot，不新造机制）：

- 助手消息上方的召回 chip：`召回 3 条 · 查看轨迹`（`conversation.chat.node`，参照 ui-goal）。
- 输入区记忆开关：本轮关闭召回与写入（`conversation.input.dock`）。
- `memory_write` 结果的内联卡片（客户端从 `tool/call` + `tool/result.meta` 派生，不在宿主画 UI）。

页签注册需要两处同 `id`：`ctx.sidebarRightTabs.register({ id, kind, title, guide })` 与 `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, Body)`，都包在 `ctx.effect` 里以证明释放。

## Agent creation

**预设是唯一事实来源。** `PresetDefinition = { id, name, description, order, plugins: 行列表 }`。新增两个预设：

- `memory`：`memory-bear` + `memory-autosave` + `tool-memory` + persona（召回优先、写入克制）。
- `memory-agent-studio`：额外挂 `memory-agent`，允许会话内创建别的 agent。

**会话内创建**：`memory_agent_create` 工具（默认不挂，仅 `memory-agent-studio` 预设可用）：

```
memory_agent_create({ name, role: 'standalone'|'master'|'sub', skills, memory: { mode, writePolicy }, mirrorToMemoryBear })
```

产物：一个预设目录（与 `agent-preset` 同级）+ 若 `mirrorToMemoryBear` 则 `POST /api/apps` 创建 MemoryBear app（`agent_config.memory` 存记忆配置）。返回创建后的 agent 名称，客户端 Agent 页签即时可见。

## Real usage scenarios

**S1 回到三周前的项目。** 新会话问"迁移脚本当时怎么定的"。pre-step 以 `quick` 召回，命中"选型 A"与"否决的 B 方案"。chip 显示 2 条，模型直接回答并引用决策，无需重读仓库。轨迹页签显示两条命中来自混合检索哪一路。

**S2 跨会话偏好。** 用户说"以后用 pnpm，别用 npm"。模型调 `memory_write(kind: preference)`，记忆页签新增一条。下次会话召回命中，agent 不再建议 npm。用户改口"忘掉这个"→ `memory_forget`，页签显示删除记录。

**S3 多 agent 交接。** master 委派 sub（不同预设），两者解析到同一 `end_user_id`，sub 的召回能看到 master 的写入——这解决 MemoryBear 自己点名的"多 Agent 记忆孤岛"，靠身份层而非复制上下文。

**S4 遗忘生效。** 用户问旧手机号。MemoryBear 衰减流水线已将其降权，轨迹标记 `decayed`；agent 回答"已不掌握该信息"而不是答旧数据。遗忘页签显示它处于哪一档。

**S5 会话内建 agent。** "帮我建一个只做前端重构的 agent，记得我的技术栈偏好"→ `memory_agent_create` 建预设（`mode: deep`，`skills: [frontend-refactor]`，persona 先召回偏好）。Agent 页签可见并可立即启动；开了镜像则同一 agent 在其他客户端也能用。

**S6 降级。** MemoryBear 不可达。召回 800ms 超时，落 `degraded: true`，回合继续，chip 显示"记忆不可用"，会话日志准确记录模型没收到什么。

**S7 隐私边界。** 用户从输入区关掉本轮记忆。pre-step 跳过召回、turn/end 跳过写入，状态由事件派生，重放时同一回合仍显示为关闭。

## Implementation order

**P0（可独立评审与合并）**

1. `packages/memory/memory`：类型 + 契约测试。
2. `packages/memory/memory-bear`：HTTP provider，含 `external_api_contract` 校验、超时、重试；用本地 stub server 测试。
3. `packages/memory/tool-memory`：四个工具 + `SessionEventMap` 声明 + 投影 `memory.recall`。
4. `packages/memory/memory-autosave`：pre-step 召回 + turn/end 写入 + 降级路径。

**P1**

5. `packages/client/ui-memory`：召回轨迹页签 + 对话 chip（先做这两项，价值密度最高）。
6. 记忆页签 / 遗忘页签。
7. 图谱页签（依赖 provider 的 graph 接口）。

**P2**

8. 画像页签。
9. `memory` 预设 + `ui-agent-preset` 卡片。
10. `memory-agent` 工具与 Agent 页签。

每步同时交付：包 README、JSDoc 契约、行为测试、Loader 组合测试；P0-3 起需要录制的会话快照；UI 变更需要 GIF。

## Alternatives considered

**把 Python 引擎整个嵌进来。** 否决：Neo4j + ES + Celery 无法嵌进 Node harness，且会分叉上游的生命周期实现。

**客户端直接发 HTTP。** 否决：绕过了"模型可见即已记录"，什么都不可重放，还会把凭据泄漏到浏览器。

**只做一个单体 `memory` 包。** 否决：接缝必须有 provider 拆分，才能加入本地 provider，也才能把 Python 专有词汇挡在消费方之外。

## Acceptance criteria

- 带 `memory` 预设的会话能召回上一次会话的事实，并在面板里显示检索轨迹。
- 每次召回、写入、遗忘、画像都出现在会话日志里，并重放出同一个界面。
- provider 不可达时：召回在超时内降级，回合继续，界面显示降级状态。
- 把 provider 从 MemoryBear 换成桩实现，消费方无需改动。
- 配置开启时，`memory_agent_create` 在会话内产出一个可运行的 agent。

## Risks

- **延迟**：回合前召回多一跳网络。缓解：默认 `quick`、与上下文装配并行、硬超时。
- **记忆重复**：DSH 的压实与 MemoryBear 都会摘要。边界：压实负责会话窗口，MemoryBear 负责长期知识。
- **隐私**：记忆会离开本机。缓解：显式的写入开关与按回合开关；终端用户映射表留在本地。
- **版本漂移**：MemoryBear 的 API 尚未 1.0。缓解：provider 钉住 `external_api_contract.json` 的形态，并在 wire 边界校验响应。

## Open questions

1. **召回时机**：每回合都召回，还是用户消息过启发式阈值才召回？（方案默认后者，省延迟）
2. **Agent 镜像**：v1 是否要 `mirrorToMemoryBear`，还是只做 DSH 预设？
3. **Provider 首发形态**：只做远程 `memory-bear`，还是同时给一个本地 SQLite 的 `memory-local` 兜底？
4. **UI 合并策略**：接受六页签合并，还是坚持把 MemoryBear 的 8 个页面都进客户端？
5. **终端用户生命周期**：DSH 用户被删除时，谁负责清理 MemoryBear 侧的终端用户？
