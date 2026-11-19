/**
 * End-to-end proof of the memory seam against a live MemoryBear service: the
 * real provider, the real tools, and the real autosave consumer on one context.
 * It runs only when DSH_MEMORYBEAR_TEST_API_KEY names a key with the `memory`
 * scope; DSH_MEMORYBEAR_TEST_BASE_URL overrides the hosted origin.
 */
import { randomUUID } from 'node:crypto'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
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
import * as bear from '../src/index.ts'
import * as toolMemory from '@deepseek-ai/dsh-tool-memory'
import * as autosave from '@deepseek-ai/dsh-memory-autosave'

const API_KEY = process.env['DSH_MEMORYBEAR_TEST_API_KEY']
const BASE_URL = process.env['DSH_MEMORYBEAR_TEST_BASE_URL'] ?? 'https://cloud.memorybear.ai'
// The hosted read path runs retrieval upstream across a cross-border link.
const TIMEOUT_MS = Number(process.env['DSH_MEMORY_TEST_TIMEOUT_MS'] ?? 15000)
// MemoryBear stores a write asynchronously, so recall polls until extraction
// has made the fact searchable.
const INDEX_DEADLINE_MS = 120_000
const TEST_TIMEOUT_MS = INDEX_DEADLINE_MS + TIMEOUT_MS * 4

/**
 * Recall until a predicate holds or the indexing deadline passes.
 * @param recall - one recall attempt.
 * @param done - whether a result is the one awaited.
 * @returns the last result.
 */
async function recallUntil<T>(recall: () => Promise<T>, done: (result: T) => boolean): Promise<T> {
  const deadline = Date.now() + INDEX_DEADLINE_MS
  let result = await recall()
  while (!done(result) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5000))
    result = await recall()
  }
  return result
}

describe.skipIf(API_KEY === undefined)('MemoryBear end to end', () => {
  it('keeps a real workspace write out of global and other workspace recall', { timeout: TEST_TIMEOUT_MS }, async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(bear, {
      baseUrl: BASE_URL, apiKey: API_KEY!, endUserOtherId: process.env['DSH_MEMORY_TEST_USER'] ?? 'dsh-scope-e2e', timeoutMs: TIMEOUT_MS,
    })
    try {
      const scope = { kind: 'workspace' as const, workspaceId: 'test-workspace-a' as WorkspaceId }
      const marker = `scope-pnpm-${randomUUID()}`
      expect((await ctx.memory.remember({ scope, sessionId: 'scope-test', turn: 1,
        messages: [{ role: 'user', content: `此项目的包管理器固定为 ${marker}` }],
      })).queued).toBe(true)
      const result = await recallUntil(
        () => ctx.memory.recall({ scope, question: `项目包管理器 ${marker}`, mode: 'quick', turn: 2 }),
        value => value.items.some(item => item.content.includes(marker)),
      )
      expect(result.degraded).toBe(false)
      expect(result.items.some(item => item.content.includes(marker))).toBe(true)
      for (const other of [{ kind: 'global' as const }, { kind: 'workspace' as const, workspaceId: 'test-workspace-b' as WorkspaceId }]) {
        const recall = await ctx.memory.recall({ scope: other, question: marker, mode: 'quick', turn: 3 })
        expect(recall.degraded).toBe(false)
        expect(recall.items.some(item => item.content.includes(marker))).toBe(false)
        expect((await ctx.memory.list({ scope: other })).items).toHaveLength(0)
      }
      expect((await ctx.memory.list({ scope })).items.length).toBeGreaterThan(0)
      expect((await ctx.memory.profile({ scope })).sections).toBeTypeOf('object')
    } finally {
      await fiber.dispose()
    }
  })

  it('writes a turn, then recalls it in a later turn', { timeout: TEST_TIMEOUT_MS }, async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(bear, {
      baseUrl: BASE_URL,
      apiKey: API_KEY!,
      endUserOtherId: 'dsh-e2e-user',
      timeoutMs: TIMEOUT_MS,
    })
    await ctx.plugin(toolMemory, { defaultMode: 'quick', enableProfile: true })
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

    // MemoryBear rewrites stored statements during extraction, so the marker,
    // not the exact sentence, identifies this run's fact.
    const carriesMarker = (contents: readonly string[]) => contents.some(content => content.includes(marker))
    const recalled = await recallUntil(
      () => ctx.memory.recall({ question: `包管理器 ${marker}`, mode: 'quick', turn: 2 }),
      result => carriesMarker(result.items.map(item => item.content)),
    )
    expect(recalled.degraded).toBe(false)
    expect(carriesMarker(recalled.items.map(item => item.content))).toBe(true)

    const listed = await recallUntil(
      () => ctx.memory.list({ limit: 50 }),
      result => carriesMarker(result.items.map(item => item.content)),
    )
    expect(carriesMarker(listed.items.map(item => item.content))).toBe(true)

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
    } as Agent
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
    expect(text).toContain(marker)
  })
})
