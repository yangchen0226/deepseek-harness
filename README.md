# DeepSeek Harness + MemoryBear

English | [中文](README.zh.md)

This fork integrates MemoryBear with DeepSeek Harness so conversations can recall earlier preferences, project conventions, and decisions across sessions. DSH provides the conversation UI and memory controls; MemoryBear provides the remote memory service for extraction, storage, retrieval, and user profiles. Source code lives in `代码文件/`; product and development documents live in `文档/`.

## Memory in conversations

| Capability | What you can do |
|---|---|
| Automatic recall | Bring relevant global and current-workspace memories into eligible conversation turns |
| Automatic submission | Submit completed user and assistant turns for memory processing in the current workspace |
| Global memory | Explicitly save personal facts and preferences for use across workspaces |
| Workspace memory | Keep project facts, conventions, and preferences scoped to one workspace |
| Visible recall | See recalled items in the conversation and distinguish memory being off from a degraded recall |
| Memory center | Browse activity, stored memories, and profiles; save facts manually and request a profile update |

The conversation memory switch persists across turns. Write status distinguishes a request accepted by the service from a memory that has finished extraction and indexing. If recall fails or times out, the conversation can continue with a visible degraded state.

## Connecting MemoryBear

The Web application connects through the [MemoryBear provider](代码文件/packages/memory/memory-bear/README.md). It supports the hosted service and a self-hosted instance exposing the same API. The self-hosted console for this project is [memory.newpm.ai](https://memory.newpm.ai); installing the service alone does not configure its model channels or API credentials.

| Setting | Purpose |
|---|---|
| `MEMORYBEAR_BASE_URL` | MemoryBear origin; use `https://memory.newpm.ai` for this deployment. If unset, the provider uses `https://cloud.memorybear.ai` |
| `MEMORYBEAR_API_KEY` | Credential reference for a MemoryBear API key with the `memory` scope; managed through DSH credentials |
| `MEMORY_USER` | Stable user identity used to bind MemoryBear end users; defaults to `local` |

The service operator must finish model-channel configuration and issue the API key. Endpoint and user identity are read from the launch environment; the key is resolved for each operation. A missing or rejected key leaves memory unavailable. No credentials are included in this repository.

MemoryBear processes writes asynchronously. “Accepted” does not mean searchable yet, and a profile can remain empty until generated. Library filtering applies to the fetched page. Memory deletion is not supported by the current MemoryBear provider.

## Memory implementation

| Component | Responsibility |
|---|---|
| [MemoryBear provider](代码文件/packages/memory/memory-bear/README.md) | Service requests, scoped identities, retrieval, write acceptance, and profiles |
| [Automatic memory](代码文件/packages/memory/memory-autosave/README.md) | Turn-start recall, turn-end submission, and durable activity records |
| [Memory UI](代码文件/packages/client/ui-memory/README.md) | Conversation indicators, memory controls, global and workspace pages |
| [Memory API](代码文件/packages/api/memory-controller/README.md) | Memory operations exposed to the client |

## Repository guide

| Entry | Contents |
|---|---|
| [Source code](代码文件/) | Applications, plugins, scripts, and workspace configuration |
| [Project introduction](代码文件/README.md) | DeepSeek Harness overview and usage |
| [Documentation index](文档/README.md) | Product design, code guide, and front-end and back-end development guides |
| [Development guide](代码文件/docs/development.md) | Source setup, build commands, and development workflow |
| [Memory UI](代码文件/packages/client/ui-memory/README.md) | Conversation recall indicators, memory activity, library, and profile views |

## Working with the source

Run the source project's installation, build, and development commands from `代码文件/`, which contains `package.json` and `pnpm-workspace.yaml`. Follow the [development guide](代码文件/docs/development.md) for prerequisites and commands.

The [product design documents](文档/README.md) include proposals. Consult the code and package documentation for implemented behavior.

## Upstream and license

DeepSeek Harness is developed by [DeepSeek AI](https://github.com/deepseek-ai/deepseek-harness). This personal fork contains the `feat/memory-service-deployment` branch.

Read the [safety notice](代码文件/SAFETY.md) before running the project. See the [MIT license](代码文件/LICENSE), [third-party notices](代码文件/THIRD_PARTY_NOTICES.md), and [contribution guide](代码文件/CONTRIBUTING.md).
