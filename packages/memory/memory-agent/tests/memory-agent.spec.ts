import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

import * as plugin from '../src/index.ts'

const SIGNAL = new AbortController().signal

/** A preset registry stand-in that records registrations. */
class RegistryStub {
  readonly definitions: PresetDefinition[] = []
  readonly unregistered: string[] = []

  register(definition: PresetDefinition): Promise<() => Promise<void>> {
    this.definitions.push(definition)
    return Promise.resolve(async () => { this.unregistered.push(definition.id) })
  }
}

function agentWithSession(id = 'agent-session'): Agent & { session: Session } {
  const session = Session.create(SessionId(id))
  return {
    id: SessionId(id),
    options: {},
    session,
    model: { provider: 'mock', model: 'mock' },
    inbox: { push: () => {}, drain: () => [], close: () => {} },
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() {},
    runMaintenance: (task: (signal: AbortSignal) => Promise<void>) => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  } as unknown as Agent & { session: Session }
}

let callCounter = 0
async function setup() {
  const ctx = new Context()
  const registry = new RegistryStub()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  ctx.provide('agentPresets', registry as never)
  await ctx.plugin(plugin, {
    provider: { baseUrl: 'http://memory.invalid', apiKey: 'secret', endUserOtherId: 'user-1' },
    recallMode: 'quick',
    presetOrder: 90,
  })
  return { ctx, registry }
}

function create(ctx: Context, args: unknown, agent: Agent = agentWithSession()) {
  return executeToolFixture(ctx, {
    signal: SIGNAL,
    callId: ToolCallId(`call-${++callCounter}`),
    name: 'memory_agent_create',
    arguments: args,
    agent,
  })
}

describe('dsh-memory-agent', () => {
  it('registers a preset with the provider block and the display name', async () => {
    const { ctx, registry } = await setup()
    const agent = agentWithSession('creator')
    const result = await create(ctx, { name: 'Frontend Refactor', instructions: 'Refactor the web client.' }, agent)

    expect(result.isError).toBe(false)
    expect(registry.definitions).toHaveLength(1)
    const definition = registry.definitions[0]!
    expect(definition.id).toBe('agent-frontend-refactor')
    expect(definition.name).toBe('Frontend Refactor')
    expect(definition.order).toBe(90)
    // The provider and its consumers share one isolated group, so `memory`
    // never leaks into the root realm the registry guards.
    const group = definition.plugins.find(row => row.id === 'memory')!
    expect(group).toMatchObject({ name: 'cordis:group', group: true, isolate: { memory: true } })
    const rows = group.config as readonly { id: string; config?: unknown }[]
    expect(rows.map(row => row.id)).toEqual(['memory-bear', 'tool-memory', 'memory-autosave'])
    expect(rows[0]!.config).toMatchObject({ baseUrl: 'http://memory.invalid', endUserOtherId: 'user-1' })

    // The credential belongs to the preset, never to what the model or the log sees.
    const event = agent.session.snapshotEvents().findLast(e => e.type === 'memory/agent-created')!
    expect(event.data).toEqual({ id: 'agent-frontend-refactor', name: 'Frontend Refactor' })
    expect(result.content.map(block => block.type === 'text' ? block.text : '').join('')).not.toContain('secret')
  })

  it('rejects a duplicate name instead of overwriting the first agent', async () => {
    const { ctx } = await setup()
    await create(ctx, { name: 'Research', instructions: 'Track papers.' })
    const second = await create(ctx, { name: 'Research', instructions: 'Track papers.' })
    expect(second.isError).toBe(true)
  })

  it('unregisters every created preset when the plugin disposes', async () => {
    const { ctx, registry } = await setup()
    await create(ctx, { name: 'Docs', instructions: 'Write docs.' })
    await ctx.fiber.dispose()
    expect(registry.unregistered).toEqual(['agent-docs'])
  })
})
