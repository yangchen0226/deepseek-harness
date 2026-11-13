/**
 * End-to-end proof of the memory seam against a running HTTP service: the real
 * provider, the real tools, and the real autosave consumer on one context, with
 * the service URL supplied by the environment.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as remote from '@deepseek-ai/dsh-memory-remote'
import * as toolMemory from '@deepseek-ai/dsh-tool-memory'
import * as autosave from '@deepseek-ai/dsh-memory-autosave'

const URL = process.env['DSH_MEMORY_TEST_URL']
const TOKEN = process.env['DSH_MEMORY_TEST_TOKEN'] ?? 'demo-token'
// A remote deployment pays a cross-border TLS handshake before the first byte,
// which routinely exceeds the provider's 1500 ms default. The service itself
// answers in single-digit milliseconds, so the budget is about the link.
const TIMEOUT_MS = Number(process.env['DSH_MEMORY_TEST_TIMEOUT_MS'] ?? 8000)
// This case makes several round trips — health, write, recall, and the pre-step
// recall — so the test deadline has to clear them all, not one.
const TEST_TIMEOUT_MS = TIMEOUT_MS * 4

describe.skipIf(URL === undefined)('memory service end to end', () => {
  it('writes a turn, then recalls it in a later turn', { timeout: TEST_TIMEOUT_MS }, async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(remote, {
      serviceUrl: URL!,
      token: TOKEN,
      workspaceId: 'default',
      endUserOtherId: 'e2e-user',
      timeoutMs: TIMEOUT_MS,
    })
    await ctx.plugin(toolMemory, { defaultMode: 'quick', enableForget: true })
    await ctx.plugin(autosave, { recallMode: 'quick', recallOnTurnStart: true, writeOnTurnEnd: true })

    const health = await ctx.memory.health()
    expect(health.reachable).toBe(true)
    expect(health.endUserId).toBeTypeOf('string')

    // The service deduplicates on content, and it outlives one test run, so each
    // run writes a fact whose text no earlier run could have stored.
    const marker = `pnpm-${String(Date.now())}`
    const fact = `项目统一使用 ${marker} 管理依赖`
    const written = await ctx.memory.remember({
      sessionId: 'e2e-session',
      turn: 1,
      messages: [{ role: 'user', content: fact }],
      kinds: ['preference'],
    })
    expect(written.queued).toBe(true)

    const recalled = await ctx.memory.recall({ question: `包管理器 ${marker}`, mode: 'quick', turn: 2 })
    expect(recalled.degraded).toBe(false)
    expect(recalled.items.map(item => item.content)).toContain(fact)

    const agent = ctx.sessions.create(SessionId(`e2e-agent-${marker}`))
    const handle: Agent = {
      id: SessionId(`e2e-agent-${marker}`),
      options: {},
      session: agent,
      model: { provider: 'mock', model: 'mock' } as never,
      inbox: { push: () => {}, drain: () => [], close: () => {} } as never,
      status: 'running',
      ctx,
      send: () => {},
      followup: () => {},
      steer: () => {},
      inject: () => {},
      cancel() {},
      runMaintenance: (task: (signal: AbortSignal) => Promise<void>) => task(new AbortController().signal),
      whenIdle: () => Promise.resolve(),
    } as unknown as Agent
    ctx.agents.enter(handle)
    agent.append('turn/start', { turn: 3 })
    const question = createUserMessage({ content: [{ type: 'text', text: `我们用什么包管理器 ${marker}？` }], source: { kind: 'user' } })
    agent.append('user/message', question, { surfaceOp: 'append' })
    const decision = await agentEvents(ctx, handle).waterfall(
      'agent/pre-step',
      {
        modelSelection: { provider: 'mock', model: 'mock' },
        messages: [question],
        turn: 3,
        step: 1,
        signal: new AbortController().signal,
      },
      () => Promise.resolve({ kind: 'enter' as const, messages: [question] as never[] }),
    )
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('expected enter')
    const injected = decision.messages.find(message => message.source.kind === 'memory-recall')
    expect(injected).toBeDefined()
    const text = injected!.content.find(block => block.type === 'text')?.text ?? ''
    expect(text).toContain('pnpm')
  })
})
