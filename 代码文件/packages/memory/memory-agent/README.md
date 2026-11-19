---
description: "In-session agent creation for the memory integration: composes and registers a memory-enabled agent preset from a model tool call, with provider credentials kept out of the model."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-agent

English | [中文](README.zh.md)

## Summary

`dsh-memory-agent` lets a conversation produce a lasting assistant. When the user asks for an agent that focuses on one area of work, the model calls `memory_agent_create`; the tool composes a preset from the deployment's own memory provider settings plus the requested persona and registers it. The new agent appears in the preset roster and is startable immediately.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```yaml
- name: '@deepseek-ai/dsh-memory-agent'
  config:
    provider:
      baseUrlEnv: MEMORYBEAR_BASE_URL
      apiKeyEnv: MEMORYBEAR_API_KEY
      endUserOtherIdEnv: MEMORY_USER
    recallMode: quick
    presetOrder: 90
```

| Field | Default | Meaning |
|---|---|---|
| `provider.baseUrl` | omitted | Explicit MemoryBear origin copied into every created preset |
| `provider.baseUrlEnv` | `MEMORYBEAR_BASE_URL` | Launch-environment variable copied as the endpoint reference |
| `provider.apiKey` | omitted | Legacy literal credential for programmatic callers |
| `provider.apiKeyEnv` | `MEMORYBEAR_API_KEY` | Credential reference copied into every created preset |
| `provider.endUserOtherId` | omitted | Explicit memory identity the created agents share |
| `provider.endUserOtherIdEnv` | `MEMORY_USER` | Launch-environment variable naming the shared memory identity |
| `provider.timeoutMs` | `8000` | Request deadline copied into every created preset |
| `recallMode` | `quick` | Automatic recall breadth for created agents |
| `presetOrder` | `90` | Roster position, keeping created agents below the shipped ones |

<a id="understand-the-implementation"></a>
## Understand the implementation

- The credential reference lives in this plugin's configuration and is copied into the created preset's provider row. The resolved credential value never appears in a tool argument, a tool result, or a session event.
- Each created preset carries the memory provider, the memory tools, the autosave consumer, a persona built from the requested name and instructions, and the ordinary file, shell, and todo tools.
- Registration is process-local. Created presets are held in one effect and unregistered when the plugin disposes; persisting them belongs to an editor surface, not to a model tool.
- A duplicate display name is rejected rather than overwriting the first agent of that name.

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The generated [`memory_agent_create` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory) while this tool is visible.

#### Token effect

Fixed schema cost on each request where the tool is visible.

#### KV Cache effect

Prefix-stable while the schema is unchanged.

### Creation result

#### What the model sees

One line naming the created agent and the preset it registered, so a later turn can refer to it. A duplicate name reports the existing preset instead of creating a second one.

#### Token effect

One short line per call.

#### KV Cache effect

The result arrives as a tool message after the cached prefix and does not invalidate it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Created agents do not survive a host restart; only a roster editor that writes the preset to disk would make them durable.
- No mirrored MemoryBear application: the agent exists in this harness only, so other MemoryBear clients cannot run it.
- No skill selection: a created agent gets the default tool set, not a specialized skill.

### Dev Note

<a id="dev-note"></a>

Behavior tests drive the real tool pipeline with a preset-registry stand-in (`tests/memory-agent.spec.ts`) and assert the composed rows, the credential boundary, duplicate rejection, and disposal.
