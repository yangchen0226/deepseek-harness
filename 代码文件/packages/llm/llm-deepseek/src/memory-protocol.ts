/** Opt-in complete-response framing for memory operations over text-only Messages transports. */
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { MemoryCallBlock, MemoryCallId, MemoryScope } from '@deepseek-ai/dsh-memory'

/** Reserved prefix, recognized only at the beginning of the complete assistant text. */
export const MEMORY_FRAME_START = '@@dsh-memory-v1\n'
/** Required frame terminator; trailing prose invalidates the operation. */
export const MEMORY_FRAME_END = '\n@@end-dsh-memory'

/** Validate a complete model frame before any executable block is emitted.
 * @param text - Entire assistant text, including delimiters.
 * @returns One validated memory request.
 */
export function decodeMemoryFrame(text: string): MemoryCallBlock {
  text = text.trimEnd()
  const invalid = (): never => { throw new LlmError('Invalid or incomplete memory frame', 'MALFORMED_RESPONSE') }
  if (text.length > 16_384 || !text.startsWith(MEMORY_FRAME_START) || !text.endsWith(MEMORY_FRAME_END)) return invalid()
  let raw: unknown
  try { raw = JSON.parse(text.slice(MEMORY_FRAME_START.length, -MEMORY_FRAME_END.length)) }
  catch (_invalidFrameJson) { return invalid() }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return invalid()
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id)) return invalid()
  const rawScope = value.scope
  if (typeof rawScope !== 'object' || rawScope === null || Array.isArray(rawScope)) return invalid()
  const scopeValue = rawScope as Record<string, unknown>
  let scope: MemoryScope
  if (scopeValue.kind === 'global' && Object.keys(scopeValue).length === 1) scope = { kind: 'global' }
  else if (scopeValue.kind === 'workspace' && typeof scopeValue.workspaceId === 'string' && scopeValue.workspaceId.length > 0 && Object.keys(scopeValue).length === 2) {
    scope = { kind: 'workspace', workspaceId: scopeValue.workspaceId as Extract<MemoryScope, { kind: 'workspace' }>['workspaceId'] }
  } else return invalid()
  const base = { type: 'memory-call' as const, id: value.id as MemoryCallId, scope }
  const keys = ['id', 'operation', 'scope']
  if (value.operation === 'profile' && Object.keys(value).every(key => keys.includes(key))) return { ...base, operation: 'profile' }
  const field = value.operation === 'recall' ? 'question' : value.operation === 'write' ? 'content' : undefined
  if (field === undefined || Object.keys(value).some(key => ![...keys, field].includes(key))) return invalid()
  const content = value[field]
  if (typeof content !== 'string' || content.trim().length === 0 || content.length > 8_192) return invalid()
  return value.operation === 'recall' ? { ...base, operation: 'recall', question: content } : { ...base, operation: 'write', content }
}

/** Decode reserved frames only after successful stream settlement; ordinary text remains streamed.
 * @param chunks - Validated Messages chunks.
 * @returns Native memory blocks or the original ordinary response.
 */
export async function* decodeMemoryStream(chunks: AsyncIterable<StreamChunk>): AsyncGenerator<StreamChunk> {
  let candidate: { index: number; text: string; pending: StreamChunk[] } | undefined
  let frame: MemoryCallBlock | undefined
  let frameIndex = 0
  let textBlocks = 0
  let hasTool = false
  for await (const chunk of chunks) {
    if (chunk.type === 'block-start' && chunk.blockType === 'text') {
      textBlocks++
      candidate = { index: chunk.index, text: '', pending: [chunk] }
      continue
    }
    if (chunk.type === 'block-start' && chunk.blockType === 'tool-call') hasTool = true
    if (candidate !== undefined && chunk.type === 'text-delta' && chunk.index === candidate.index) {
      candidate.text += chunk.text
      candidate.pending.push(chunk)
      if (!MEMORY_FRAME_START.startsWith(candidate.text) && !candidate.text.startsWith(MEMORY_FRAME_START)) {
        yield* candidate.pending
        candidate = undefined
      } else if (candidate.text.length > 16_384) {
        throw new LlmError('Memory frame exceeds protocol limit', 'MALFORMED_RESPONSE')
      }
      continue
    }
    if (candidate !== undefined && chunk.type === 'block-end' && chunk.index === candidate.index) {
      if (candidate.text.startsWith(MEMORY_FRAME_START)) {
        frame = decodeMemoryFrame(candidate.text)
        frameIndex = candidate.index
      } else {
        yield* candidate.pending
        yield chunk
      }
      candidate = undefined
      continue
    }
    if (chunk.type === 'finish' && frame !== undefined) {
      if (chunk.reason.kind !== 'stop' || textBlocks !== 1 || hasTool) {
        throw new LlmError('Memory frame requires a complete exclusive response', 'MALFORMED_RESPONSE')
      }
      yield { type: 'block-start', index: frameIndex, blockType: 'memory-call' }
      yield { type: 'block-end', index: frameIndex, block: frame }
      // Text replay metadata cannot describe the decoded memory block.
      yield { type: 'finish', reason: chunk.reason }
      return
    }
    yield chunk
  }
}
