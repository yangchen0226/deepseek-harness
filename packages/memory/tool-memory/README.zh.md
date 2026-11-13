# @deepseek-ai/dsh-tool-memory

记忆接缝上的模型可见工具：`memory_recall`、`memory_write`，以及按后端能力注册的 `memory_forget`。

## 使用

```yaml
- name: '@deepseek-ai/dsh-tool-memory'
  config:
    defaultMode: quick
    enableForget: false
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `defaultMode` | `quick` | 模型未指定 `search_mode` 时的检索广度 |
| `enableForget` | `false` | 是否注册 `memory_forget` |

## 行为

- `memory_recall(question, search_mode?)`：调用接缝，落 `memory/recall` 事件（含条目与轨迹），返回原始条目。降级时返回空列表并提示继续，不报错。
- `memory_write(content, kind)`：提交一条消息，落 `memory/write` 事件（`queued` 与批次 id），回报受理。
- `memory_forget(target)`：调用接缝并落 `memory/forget`；后端不支持时把错误原样交给模型。

## 实现要点

工具路径拿不到回合号：执行上下文没有该字段，`Session` 也不暴露读取器。外层 `tool/call` 事件已记录回合，因此记忆事件不再重复。会话 id 来自所属 agent；无会话的调用者会被拒绝，而不是伪造一个。

## 已知限制

- 没有画像工具：内置 provider 的画像读取未实现，注册工具等于暴露必然失败。
- 没有批量写入工具：每次写一条事实，等有证据表明模型常在一步产出多条持久事实时再加。
