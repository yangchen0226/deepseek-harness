# @deepseek-ai/dsh-memory

长期记忆能力接缝（`ctx.memory`）：召回、写入受理、画像读取与可达性检查，具体引擎可插拔。

## 摘要

`dsh-memory` 定义 harness 眼中"长期记忆"的含义，不决定它存在哪里。Provider 实现 `ctx.memory` 服务；工具、会话生命周期和客户端面板消费它。定义固定了四条语义：引擎不可达时召回降级而不抛错；写入报告"已受理"而非"已存储"；删除要么真实完成，要么显式声明不支持；结果必须可 JSON 序列化，调用方可原样写入会话事件。

## 使用

消费者依赖本包获取类型与抽象类；部署方依赖它满足接缝。

```ts
import { MemoryEngine } from '@deepseek-ai/dsh-memory'

export class MyEngine extends MemoryEngine {
  // recall / remember / forget / profile / health
}
```

## 已知限制

- 本包不附带本地（内嵌）provider；接缝存在正是为了在不改动消费方的前提下新增实现。
- 定义只支持单一调用方身份的记忆范围；跨用户或跨工作区共享需要新增作用域字段并由 provider 支持。
