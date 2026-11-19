# Documentation index

English | [中文](README.zh.md)

## Summary

This folder holds product and design documents that can be read without the repository: the reasoning behind a proposed product surface, the decisions it rejects, and the criteria it must meet. It is deliberately separate from the code tree, and separate from `docs/`, which ships with the repository and describes what exists today.

## Contents

| Document | What it covers |
|---|---|
| [Consumer product surfaces for memory and agents](2026-11-18-consumer-memory-agent-product-design.md) | Memory, agents, the agent plaza, memory-driven evolution, execution records and evolution reports, and the knowledge base: page structure, feature design, state model, delivery order, acceptance criteria, and risks |
| [Project code guide](项目代码说明.md) | What the `dsh` code tree is, what each top-level directory owns, how packages are grouped, how a running process is assembled, and how to work in the tree |
| [Front-end development guide](前端开发文档.md) | Buildable Web client work: packages, slots, stores, page inventory, conversation surfaces, state ownership, visual design, interaction specifications, performance budgets |
| [Back-end development guide](后端开发文档.md) | Buildable Host work: capability seams, Remote namespaces, durable events, execution records, the evolution report pipeline, permissions and tenancy, provider integration |

Each document exists as an English page and a Chinese counterpart, with an `.i18n.yaml` consistency record beside them. Edit both sides together and re-record the pair; the repository's `verify-translation-pairing` gate owns the record format.

## The three documentation layers

| Layer | Where | What it is |
|---|---|---|
| Product design | This folder (`文档/`) | Proposals and designs that may not be implemented; readable without the code |
| Repository documentation | [`docs/`](../代码文件/docs/architecture.md) | Current-state documentation published with the repository and the documentation website |
| Decision records | [`.agents/notes/`](../.agents/notes/README.md) | Design decisions bound to the codebase, resolved against a fixed format and a lifecycle of proposed, implemented, and rejected |

A document moves from this folder into `.agents/notes/proposed/feature/` when it must be gated and reviewed as a repository decision rather than a product proposal.

## Dev Note

The documents here are not scanned by the Agent Note format gate, which applies only to the `.agents/notes/` tree. They are scanned by the bilingual pairing gate, because that gate covers every Markdown page in the repository.
