# DeepSeek Harness + 记忆熊（MemoryBear）

[English](README.md) | 中文

本 fork 将记忆熊（MemoryBear）接入 DeepSeek Harness，让对话能够跨会话召回用户偏好、项目约定和历史决策。DSH 提供对话界面与记忆控制，记忆熊作为远端记忆服务，负责提取、存储、检索和用户画像。源码位于 `代码文件/`，产品与开发文档位于 `文档/`。

## 对话中的记忆能力

| 能力 | 可以做什么 |
|---|---|
| 自动召回 | 在符合条件的对话回合中引入相关的全局记忆和当前工作区记忆 |
| 自动提交 | 将已完成回合的用户与助手文本提交给记忆服务，在当前工作区处理 |
| 全局记忆 | 显式保存个人事实与偏好，供多个工作区使用 |
| 工作区记忆 | 将项目事实、约定和偏好限定在一个工作区内 |
| 可见的召回 | 在对话中查看召回内容，区分记忆关闭与召回降级 |
| 记忆中心 | 浏览活动、记忆库和画像，手动保存事实并请求更新画像 |

对话中的记忆开关会跨回合保持。写入状态区分服务已接收请求与记忆已完成提取、索引。召回失败或超时时，对话仍可继续，界面会显示降级状态。

## 接入记忆熊

Web 应用通过[记忆熊提供者](代码文件/packages/memory/memory-bear/README.md)连接服务，支持官方托管服务和提供相同 API 的自托管实例。本项目的自托管控制台为 [memory.newpm.ai](https://memory.newpm.ai)；安装服务本身并不包含模型渠道与 API 凭据配置。

| 配置项 | 用途 |
|---|---|
| `MEMORYBEAR_BASE_URL` | 记忆熊服务地址；本部署使用 `https://memory.newpm.ai`，未设置时使用 `https://cloud.memorybear.ai` |
| `MEMORYBEAR_API_KEY` | 具有 `memory` 权限范围的记忆熊 API Key 凭据引用，由 DSH 凭据服务管理 |
| `MEMORY_USER` | 用于绑定记忆熊终端用户的稳定身份，默认为 `local` |

服务维护者需要完成模型渠道配置并签发 API Key。服务地址和用户身份从启动环境读取，密钥在每次操作时解析。密钥缺失或被拒绝时，记忆不可用。仓库中不包含凭据。

记忆熊异步处理写入：“已接收”不代表立即可检索，画像在生成前也可能为空。记忆库筛选仅作用于当前获取的页面。当前记忆熊提供者不支持删除记忆。

## 记忆功能实现

| 组件 | 职责 |
|---|---|
| [记忆熊提供者](代码文件/packages/memory/memory-bear/README.md) | 服务请求、范围隔离的用户身份、检索、写入接收与画像 |
| [自动记忆](代码文件/packages/memory/memory-autosave/README.md) | 回合开始时召回、回合结束时提交，以及持久化活动记录 |
| [记忆界面](代码文件/packages/client/ui-memory/README.md) | 对话提示、记忆控制、全局与工作区页面 |
| [记忆 API](代码文件/packages/api/memory-controller/README.md) | 向客户端提供记忆操作 |

## 仓库导航

| 入口 | 内容 |
|---|---|
| [源代码](代码文件/) | 应用、插件、脚本和工作区配置 |
| [项目介绍](代码文件/README.md) | DeepSeek Harness 概览与使用说明 |
| [文档索引](文档/README.md) | 产品设计、代码说明、前端与后端开发文档 |
| [开发指南](代码文件/docs/development.md) | 源码环境、构建命令与开发流程 |
| [记忆界面](代码文件/packages/client/ui-memory/README.md) | 对话召回提示、记忆活动、记忆库与画像视图 |

## 使用源码

源码项目的安装、构建和开发命令均在 `代码文件/` 下执行，该目录包含 `package.json` 和 `pnpm-workspace.yaml`。环境要求和命令见[开发指南](代码文件/docs/development.md)。

[产品设计文档](文档/README.md)包含提案。已实现的行为请以代码和各包文档为准。

## 上游与许可证

DeepSeek Harness 由 [DeepSeek AI](https://github.com/deepseek-ai/deepseek-harness) 开发。本个人 fork 包含 `feat/memory-service-deployment` 分支。

运行项目前请阅读[安全说明](代码文件/SAFETY.md)。另见 [MIT 许可证](代码文件/LICENSE)、[第三方声明](代码文件/THIRD_PARTY_NOTICES.md)和[贡献指南](代码文件/CONTRIBUTING.md)。
