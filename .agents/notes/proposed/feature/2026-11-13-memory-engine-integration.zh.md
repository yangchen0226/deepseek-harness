# Agent Note: Integrating the MemoryBear memory engine into DSH

Status: proposed

[English](2026-11-13-memory-engine-integration.md) | 中文

## Problem

DSH 需要跨会话记忆，同时保持用户、工作区隔离以及模型可见内容可重放。MemoryBear 提供远程存储与检索，集成需要在 Host 管理凭据、策略和日志。

## Proposal

完整设计由[工作区与全局记忆方案](2026-11-13-memorybear-integration-plan.zh.md)维护：所有模式提供独立记忆开关，模型使用原生调用，侧边栏分别提供工作区记忆与全局记忆。范围、协议、后端能力、迁移和验收均以该方案为准。

## Alternatives considered

不嵌入 Python 引擎，不让客户端持有服务凭据，不将记忆限定在专用模式内。保留 provider 与消费方分离，使服务实现与交互方式可以独立演进。

## Acceptance criteria

按[详细方案的验收标准](2026-11-13-memorybear-integration-plan.zh.md#acceptance-criteria)验证模式独立、范围隔离、原生调用及 MemoryBear 数据一致性。

## Risks

原生协议的模型支持、远端范围隔离与异步写入状态仍需实测；未经验证时不能开放越范围访问、重试未知结果写入，或宣称已入库。旧集合迁移必须明确归属并保留恢复路径。
