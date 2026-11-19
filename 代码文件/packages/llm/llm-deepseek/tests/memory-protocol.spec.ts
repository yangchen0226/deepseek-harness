/** Complete native memory frames, interrupted responses and ordinary text stay distinct. */
import { describe, expect, it } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import { decodeMemoryFrame, decodeMemoryStream, MEMORY_FRAME_START, MEMORY_FRAME_END } from '../src/memory-protocol.ts'
import { translate } from '../src/translate.ts'
import { adapter, assemble, chunks, end, events, MODEL, options, server, sse, start } from './helpers.ts'

const request = { id: 'remember-1', operation: 'write', scope: { kind: 'workspace', workspaceId: 'project-a' }, content: 'Use pnpm for this project.' }
const frame = MEMORY_FRAME_START + JSON.stringify(request) + MEMORY_FRAME_END
const text = (value: string) => [
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  ...[...value].map(character => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: character } })),
  { type: 'content_block_stop', index: 0 },
]

describe('native memory framing', () => {
  it('emits a single executable block only after successful settlement', async () => {
    const result = await assemble(decodeMemoryStream(translate(events([start, ...text(frame), ...end()]), MODEL)))
    expect(result.message.content).toEqual([{ type: 'memory-call', ...request }])
    expect(result.output.some(chunk => chunk.type === 'text-delta')).toBe(false)
    expect(result.message.source.replayState).toBeUndefined()
  })

  it.each([frame.slice(0, -4), frame + '\nSome prose', MEMORY_FRAME_START + '{}' + MEMORY_FRAME_END,
    MEMORY_FRAME_START + JSON.stringify({ ...request, scope: { kind: 'workspace' } }) + MEMORY_FRAME_END,
    MEMORY_FRAME_START + JSON.stringify({ ...request, extra: true }) + MEMORY_FRAME_END,
    MEMORY_FRAME_START + JSON.stringify({ ...request, content: 'x'.repeat(8193) }) + MEMORY_FRAME_END,
  ])('rejects incomplete, oversized or unexpected fields %#', value => {
    expect(() => decodeMemoryFrame(value)).toThrow()
  })

  it.each(['max_tokens', 'tool_use'])('never emits calls for %s settlement', async reason => {
    const output: StreamChunk[] = []
    await expect((async () => {
      for await (const chunk of decodeMemoryStream(translate(events([start, ...text(frame), ...end(reason)]), MODEL))) output.push(chunk)
    })()).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
    expect(output.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'memory-call')).toBe(false)
  })

  it('never interprets quoted frames or ordinary JSON as calls', async () => {
    for (const value of ['Example:\n' + frame, JSON.stringify(request), 'Normal reply']) {
      const result = await assemble(decodeMemoryStream(translate(events([start, ...text(value), ...end()]), MODEL)))
      expect(result.message.content).toEqual([{ type: 'text', text: value }])
    }
  })

  it('preserves capability through the runtime and encodes the result for continuation', async () => {
    const host = await server((response, count) => response.end(sse([start, ...text(count === 1 ? frame : 'Accepted for processing.'), ...end()])))
    const ctx = new Context()
    const fiber = await ctx.plugin(LlmRuntime)
    try {
      ctx.llm.registerAdapter(['deepseek-official'], adapter({ baseURL: host.url, models: [{ id: MODEL, memoryProtocol: 'framed-json-v1' }] }))
      expect(await ctx.llm.resolveModelInfo('deepseek-official', MODEL)).toMatchObject({ nativeMemory: true })
      const first = await assemble(ctx.llm.stream(options()))
      expect(first.message.content[0]).toMatchObject({ type: 'memory-call' })
      const call = first.message.content[0]
      if (call?.type !== 'memory-call') throw new Error('missing memory call')
      const result = createUserMessage({ source: { kind: 'memory-native' }, content: [{ type: 'memory-result', id: call.id, operation: 'write', status: 'ok', value: { queued: true } }] })
      await chunks(ctx.llm.stream(options({ messages: [...options().messages, first.message, result] })))
      expect(JSON.stringify(host.requests[1]?.body)).toContain('Memory operation result')
      expect(host.requests.every(value => !JSON.stringify(value.body).includes('tool_use'))).toBe(true)
    } finally {
      await fiber.dispose()
      await host.close()
    }
  })
})
