// @vitest-environment jsdom
/**
 * The recall chip must reach the conversation through a slot the Chat flow
 * actually renders. Unit specs render the component directly, so they cannot
 * catch a registration that names a keyed slot with an entry key no block
 * carries — that registration is silently never dispatched. This spec boots
 * the web profile's real roster and asserts the chip occupies the turn-tail
 * list slot, which is the surface a completed turn renders.
 */
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'

const it = createClientTest({ roster: webApp })

/** The registration id this package contributes to the turn tail. */
const RECALL_CHIP_ID = 'memory-recall-chip'

beforeEach(() => { vi.stubEnv('DSH_CLIENT_VERSION', '0.0.0-test') })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

it('contributes the recall chip to the turn-tail slot, not to a keyed message-extension key', async ({ start }) => {
  const c = await start()
  await vi.waitFor(() => {
    const ids = c.ctx.slots.entries('conversation.chat.turnTail').map(entry => entry.options.id)
    expect(ids).toContain(RECALL_CHIP_ID)
  }, 60_000)
  const extensionKeys = c.ctx.slots.entries('conversation.chat.message.extension').map(entry => entry.options.key)
  expect(extensionKeys).not.toContain('recall-chip')
}, 120_000)
