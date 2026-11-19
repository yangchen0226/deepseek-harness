# Agent Note: Integrating the MemoryBear memory engine into DSH

Status: proposed

English | [中文](2026-11-13-memory-engine-integration.zh.md)

## Problem

DSH needs cross-session memory with user and workspace isolation and replayable model-visible content. MemoryBear provides remote storage and retrieval; the Host must own credentials, policy, and logging.

## Proposal

The [workspace and global memory plan](2026-11-13-memorybear-integration-plan.md) owns the complete design: every mode has independent memory control, models use native calls, and the sidebar exposes workspace and global memory. That plan defines scopes, protocol, backend capabilities, migration, and acceptance.

## Alternatives considered

Do not embed the Python engine, expose service credentials to the client, or restrict memory to a dedicated mode. Keep the provider separate from consumers so storage implementation and interaction can evolve independently.

## Acceptance criteria

Use the [detailed acceptance criteria](2026-11-13-memorybear-integration-plan.md#acceptance-criteria) to verify mode independence, scope isolation, native calls, and consistency with MemoryBear.

## Risks

Native model protocol support, remote scope isolation, and asynchronous write visibility need real validation. Until verified, do not allow cross-scope access, retry writes with unknown outcomes, or claim indexing succeeded. Legacy migration needs explicit ownership and a recovery path.
