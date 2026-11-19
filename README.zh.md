# DeepSeek Harness — 记忆工作区

[English](README.md) | 中文

本 fork 包含 DeepSeek Harness 代码和记忆集成相关文档。源码位于 `代码文件/`，产品与开发文档位于 `文档/`。

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
