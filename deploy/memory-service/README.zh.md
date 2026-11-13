# 记忆服务部署

自建 HTTP 记忆服务，供 `@deepseek-ai/dsh-memory-remote` provider 调用。数据库是本机 PostgreSQL 17，进程由 systemd 托管，nginx 反向代理，凭据只存在于一个 env 文件里。

## 服务器现状

| 项 | 值 |
|---|---|
| 主机 | 124.221.105.121（`ubuntu` 用户，SSH key 登录） |
| 域名 | `memory.newpm.ai` → 124.221.105.121（Let's Encrypt，到期 2027-02-11，snap timer 自动续期） |
| PostgreSQL | 17.12，集群 `17/main`，端口 **5433**，只监听 `127.0.0.1` |
| 库 / 角色 | `memory_svc` / `memory_app`（scram-sha-256） |
| 服务 | `/opt/memory-service`，systemd 单元 `memory-service`，监听 `127.0.0.1:7180` |
| 凭据 | `/etc/memory-service/env`（`root:memory`，`0640`） |
| 反向代理 | `/etc/nginx/sites-available/memory` → `https://memory.newpm.ai` |
| 备份 | `/usr/local/bin/memory-backup.sh`，`/etc/cron.d/memory-backup` 每天 03:17 |
| 备份留存 | `/var/backups/memory-service/`，保留 14 天 |

PG 14 的集群 `14/main` 仍在 5432 上、是空的。停用它需要 root 操作，尚未执行；两个集群同时运行会各占一份内存。

## 延迟

服务端处理耗时 1–8ms，但跨境链路的 TLS 握手要 0.4–1.3s，TTFB 峰值约 2.1s（30 次采样：p50 232ms、p95 1690ms）。provider 默认 1500ms 超时会把这些正常请求判成不可用，所以 preset 里把 `timeoutMs` 设成 4000ms，并留了 `MEMORY_TIMEOUT_MS` 覆盖口子。

相应的，e2e 测试的 `timeoutMs` 用 8000ms、测试自身的 deadline 放宽到它的 4 倍 —— 因为这个用例要打好几个往返。只用 curl 观察不到这个问题：`curl` 每次新建连接，而 Node 的 fetch 复用连接池，两者延迟分布不同。

## 首次部署

```bash
# 1. 依赖与目录
sudo useradd --system --home /opt/memory-service --shell /usr/sbin/nologin memory
sudo mkdir -p /opt/memory-service /etc/memory-service

# 2. 数据库
sudo -u postgres psql -p 5433 -c "create role memory_app login password '<password>'"
sudo -u postgres psql -p 5433 -c "create database memory_svc owner memory_app encoding 'UTF8'"
sudo -u postgres psql -p 5433 -d memory_svc -v ON_ERROR_STOP=1 -f schema.sql
sudo -u postgres psql -p 5433 -d memory_svc \
  -c 'alter table memory_end_user owner to memory_app' \
  -c 'alter table memory_item owner to memory_app' \
  -c 'alter function memory_ensure_end_user(text,text) owner to memory_app' \
  -c 'alter function memory_recall(uuid,text,integer,real) owner to memory_app' \
  -c 'alter function memory_touch(uuid[]) owner to memory_app' \
  -c 'alter function memory_profile(uuid,text[],integer) owner to memory_app' \
  -c 'alter function memory_bigrams(text) owner to memory_app'

# 3. 服务
sudo cp server.mjs package.json /opt/memory-service/
sudo chown -R memory:memory /opt/memory-service
cd /opt/memory-service && sudo -u memory npm install --omit=dev

# 4. 凭据与服务单元
sudo install -o root -g memory -m 640 env.example /etc/memory-service/env   # 先填真实值
sudo cp memory-service.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now memory-service

# 5. 反向代理
sudo cp nginx-memory.conf /etc/nginx/sites-available/memory
sudo ln -s /etc/nginx/sites-available/memory /etc/nginx/sites-enabled/memory
sudo nginx -t && sudo systemctl reload nginx

# 6. 备份
sudo install -o root -g root -m 700 memory-backup.sh /usr/local/bin/
sudo install -o root -g root -m 644 memory-backup.cron /etc/cron.d/memory-backup
```

## 数据库设计

三张业务表之外全部是函数，没有视图。

| 对象 | 作用 |
|---|---|
| `memory_end_user` | 外部身份 `(workspace_id, other_id)` 映射到持久 UUID |
| `memory_item` | 一条记忆。`content_hash` 按用户去重，`tsv` 是生成列 |
| `memory_ensure_end_user` | 幂等创建/读取身份行 |
| `memory_recall` | 排序检索，返回 `score` 与 `created_at` |
| `memory_touch` | 记录被召回，供 UI 与时效性使用 |
| `memory_profile` | 按 `kind` 归类成四个画像分区 |
| `memory_bigrams` | 中文二元组，检索的核心信号 |

评分是四项加权：

```
0.35 × CJK 二元组覆盖率
0.25 × pg_trgm word_similarity
0.25 × ts_rank_cd（'simple' 全文）
0.15 × 30 天半衰期时效项
```

`memory_item_trgm` 与 `memory_item_tsv` 是 GIN 索引，`memory_item_user_recent` 是活跃项的部分索引。

### 为什么需要二元组

中文没有词边界，`to_tsvector('simple', ...)` 把整句当一个词，三字组的 `word_similarity` 在"问题换了个说法"时归零。二元组覆盖率修的是这一点：问题 `前端样式用什么` 与记忆 `所有前端组件都用 CSS Modules` 共享 `前端`，整串三元组永远看不到这个重叠。

它修不了的：问题里的「包管理器」和记忆里的「pnpm」没有任何共同字符。这是词法检索的硬边界，只能靠向量检索解决，当前没有实现。

## 路由

五个路由全部是 `POST`，需要 `authorization: Bearer <token>`、`x-workspace-id`、`x-end-user-other-id`。另有 `GET /healthz` 供 systemd/监控使用，不要 token。

| 路由 | 请求 | 响应 |
|---|---|---|
| `/health` | `{}` | `{ reachable, endUserId }` |
| `/recall` | `{ question, mode, limit? }` | `{ items, trace, degraded, latencyMs }` |
| `/remember` | `{ sessionId, turn, messages, kinds? }` | `{ queued, batchId, stored }` |
| `/forget` | `{ target }` | `{ removed }` |
| `/profile` | `{ sections? }` | `{ sections }` |

`mode` 决定检索宽度与最低分：`express` 5/0.12，`quick` 8/0.08，`normal` 12/0.05，`deep` 20/0.03，`meta` 8/0.08。

`queued: true` 表示批次已被受理。本服务同步写入，所以受理时数据已落库；`stored` 报告实际新增行数，重复内容被唯一索引丢弃时小于 `messages` 长度。

`forget` 的 `target` 是 UUID 时按 id 归档，否则按内容匹配（`ilike` 或 `word_similarity > 0.6`）。归档而非物理删除，`removed` 报告影响行数。

## 客户端配置

桌面端从 `~/.dsh/.env` 读取（`DSH_` 前缀会被拒绝，必须用 `MEMORY_`）：

```
MEMORY_SERVICE_URL=https://memory.newpm.ai
MEMORY_SERVICE_TOKEN=<token>
MEMORY_WORKSPACE=default
MEMORY_USER=<你的稳定标识>
MEMORY_AGENT_STUDIO=1
```

可选的 `MEMORY_TIMEOUT_MS` 覆盖 provider 的 4000ms 超时。`MEMORY_SERVICE_URL` 未设置时，`memory` 预设里的记忆行全部禁用，会话照常可用。

## 验证

```bash
# 服务自身
curl -s https://memory.newpm.ai/healthz
curl -s -X POST https://memory.newpm.ai/health \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <token>' \
  -H 'x-workspace-id: default' \
  -H 'x-end-user-other-id: probe' -d '{}'

# 真实 provider + 工具 + autosave
DSH_MEMORY_TEST_URL=https://memory.newpm.ai DSH_MEMORY_TEST_TOKEN=<token> \
  npx vitest run packages/memory/memory-remote/tests/e2e-service.spec.ts
```

## 运维

```bash
sudo systemctl status memory-service
sudo journalctl -u memory-service -n 50 --no-pager
sudo -u postgres psql -p 5433 -d memory_svc
sudo /usr/local/bin/memory-backup.sh          # 手动备份
sudo ls -lh /var/backups/memory-service/
```

恢复：

```bash
sudo systemctl stop memory-service
sudo -u postgres /usr/lib/postgresql/17/bin/pg_restore \
  --clean --if-exists --no-owner -d memory_svc /var/backups/memory-service/<dump>
sudo systemctl start memory-service
```

`/usr/lib/postgresql/14/bin/pg_dump` 会拒绝 17 的服务端，脚本里已指定 17 的二进制。

## 资源

服务器共 3.7GB 内存，服务上限 512MB，PG 17 已配 768MB `shared_buffers` / 2GB `effective_cache_size` / 60 `max_connections`。这台机器上还跑着 nginx 的两个 codebear 站点和 `share-conversation`，部署没有改动它们。
