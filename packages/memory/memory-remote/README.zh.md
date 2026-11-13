# @deepseek-ai/dsh-memory-remote

通过 HTTP 记忆服务实现 `ctx.memory`：身份头、五个路由、服务不可达时降级。

## 使用

```yaml
- name: '@deepseek-ai/dsh-memory-remote'
  config:
    serviceUrl: https://memory.example.com
    token: <服务令牌>
    workspaceId: default
    endUserOtherId: alice
    timeoutMs: 4000
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `serviceUrl` | 必填 | 服务基地址，路由追加其后 |
| `token` | 必填 | 服务接受的 Bearer 令牌，标记为 secret 字段 |
| `workspaceId` | `default` | 作为 `x-workspace-id` 发送的分区 |
| `endUserOtherId` | 必填 | 作为 `x-end-user-other-id` 发送的外部用户标识 |
| `timeoutMs` | `1500` | 单请求超时；召回超时即降级 |

远程部署要把 `timeoutMs` 调大：跨境 TLS 握手在首字节前就要 0.4–1.3 s，默认值会把健康的服务判成间歇性不可用。`memory` 预设用 4000ms。

## 实现要点

- 所有路由都是 `POST` + JSON。三个身份头由 provider 自己添加，消费方不需要构造。
- **召回降级而不抛错**：传输失败、超时、401/403/5xx 都解析为 `degraded: true` 与空列表，因为回合必须能在没有记忆的情况下继续。只有空问题会拒绝。
- **写入受理是真实的**：服务在应答前已落库，所以 `queued: true` 代表可立即召回——这与异步流水线不同，后者同一个标记只代表进入队列。
- 401/403 之外的 4xx 表示服务本身拒绝了请求，因此按 `MEMORY_UPSTREAM_REJECTED` 拒绝，而不是降级。

## 已知限制

- 每个插件实例一个身份：`endUserOtherId` 由配置固定，多用户宿主需要每用户一个实例或外层身份解析。
- 服务协议由本 provider 与随附的服务端共同定义，没有公开 schema；第三方服务需按 [`deploy/memory-service`](../../../deploy/memory-service/README.zh.md) 的路由实现。
- 令牌轮换需要重载插件；provider 在构造时读取一次。
