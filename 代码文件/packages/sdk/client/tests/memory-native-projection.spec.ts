/** SDK preserves native memory audit events independently of tool calls. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createProcessDeepSeekHarness } from '../src/api.ts'

it('preserves native memory call and result audit records', async () => {
  const expected = JSON.parse(await readFile(new URL('./expected/memory-native-projection.json', import.meta.url), 'utf8'))
  const harness = createProcessDeepSeekHarness({
    command: process.execPath,
    args: [fileURLToPath(new URL('./fake-runtime.ts', import.meta.url))],
    environment: () => ({ ...process.env, FAKE_TEXT: expected.finalResponse, FAKE_SESSION_EVENTS: JSON.stringify(expected.auditEvents) }),
    description: 'scripted native memory projection', initializeTimeoutMs: 5000,
  })
  try {
    const result = await harness.run([{ type: 'text', text: 'Recall my preferences.' }])
    expect(result.events.filter(event => event.type === 'memory/call' || event.type === 'memory/result')).toEqual(expected.auditEvents)
    expect(result.finalResponse).toBe(expected.finalResponse)
  } finally {
    await harness.close()
  }
})
