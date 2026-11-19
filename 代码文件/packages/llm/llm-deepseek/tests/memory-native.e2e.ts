/** Live model framing, dedicated execution and MemoryBear continuation without tools. */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createSystemMessage, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { MemoryBearEngine } from '@deepseek-ai/dsh-memory-bear'
import { nativeMemoryInstructions } from '@deepseek-ai/dsh-memory-autosave/src/native.ts'
import { DeepSeekAdapter, resolveAdapterOptions } from '../src/index.ts'
import { assemble } from './helpers.ts'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import type { MemoryScope } from '@deepseek-ai/dsh-memory'

const key = process.env.DEEPSEEK_API_KEY
const memoryKey = process.env.DSH_MEMORYBEAR_TEST_API_KEY

describe.skipIf(!key || !memoryKey)('native memory live flow', () => {
  it('writes with an explicit frame and continues from the actual acceptance', async () => {
    const ctx = new Context()
    const model = process.env.DSH_MEMORY_NATIVE_MODEL ?? 'deepseek-v4.1-flash'
    try {
      await ctx.plugin(LlmRuntime)
      ctx.llm.registerAdapter(['deepseek-official'], new DeepSeekAdapter({
        options: () => resolveAdapterOptions({ baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/anthropic', models: [{ id: model, memoryProtocol: 'framed-json-v1' }], maxTokens: 2048 }),
        resolveAuth: async () => ({ headers: { 'x-api-key': key! } }),
        resolveUserId: () => 'dsh-memory-e2e' as AnonymousUserId,
        prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
      }))
      const memory = new MemoryBearEngine(ctx, { baseUrl: process.env.DSH_MEMORYBEAR_TEST_BASE_URL ?? 'https://cloud.memorybear.ai', apiKey: memoryKey!, endUserOtherId: process.env.DSH_MEMORY_TEST_USER ?? 'dsh-native-test', timeoutMs: 15000 })
      const scope: MemoryScope = { kind: 'workspace', workspaceId: 'test-workspace-a' as Extract<MemoryScope, { kind: 'workspace' }>['workspaceId'] }
      const marker = `native-check-${randomUUID()}`
      const messages = [
        createSystemMessage(nativeMemoryInstructions(scope, true)),
        createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `请主动调用记忆写入，记住本测试项目的发布标识是 ${marker}。写入以后据实回答提交状态。` }] }),
      ]
      const options = { provider: 'deepseek-official', model, reasoningEffort: ReasoningEffortId('off'), maxTokens: 2048, messages }
      const first = await assemble(ctx.llm.stream(options), model)
      const call = first.message.content.find(block => block.type === 'memory-call')
      expect(call).toMatchObject({ operation: 'write', scope })
      if (call?.operation !== 'write') throw new Error('Model did not request a memory write')
      expect(call.content).toContain(marker)
      expect(first.message.content.some(block => block.type === 'tool-call')).toBe(false)
      const accepted = await memory.remember({ scope, sessionId: marker, turn: 1, messages: [{ role: 'user', content: call.content }] })
      expect(accepted.queued).toBe(true)
      const second = await assemble(ctx.llm.stream({ ...options, messages: [...messages, first.message,
        createUserMessage({ source: { kind: 'memory-native' }, content: [{ type: 'memory-result', id: call.id, operation: 'write', status: 'ok', value: accepted }] }),
      ] }), model)
      expect(second.message.content.some(block => block.type === 'text' && block.text.length > 0)).toBe(true)
      expect(second.message.content.some(block => block.type === 'tool-call' || block.type === 'memory-call')).toBe(false)
    } finally { await ctx.fiber.dispose() }
  })
})
