# @deepseek-ai/dsh-memory-autosave

由会话驱动的记忆调度：回合前召回并注入一条持久快照消息，回合结束后提交写入批次；同时维护客户端面板读取的 `memoryAutosave` 投影。

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

## 实现要点

- 召回在回合第 1 步执行：先落 `memory/recall`，再在候选消息后追加一条 `source.kind` 为 `memory-recall` 的用户消息。这与请求时钟使用同一种持久注入形式，重放时事件与文本都能复现。
- 召回文本只由召回条目渲染，绝不回灌会话自身历史。
- 回合结束的写入读取 `memoryAutosave` 投影的 `turnText`，它收集自上次 `turn/start` 以来的用户与助手文本，并跳过插件自己注入的消息。
- 写入路径的任何失败都落在 `memory/write` 事件上（`queued: false` 与 `error`）；回合已经结束，钩子内不重试。

## 已知限制

- 每个合格回合都会召回，没有相关性启发式；希望更少召回的部署可设 `recallOnTurnStart: false`，改由模型工具触发。
- 写入提交的是完整的用户与助手消息，不包含工具输出；只通过工具调用获得的事实不会被记住，除非助手复述。
