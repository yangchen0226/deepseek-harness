import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MemoryEngine, MemoryError } from '@deepseek-ai/dsh-memory'
import type {
  MemoryHealth,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRememberRequest,
  MemoryRememberResult,
  MemoryForgetRequest,
  MemoryForgetResult,
  MemoryProfileRequest,
  MemoryProfileResult,
} from '@deepseek-ai/dsh-memory'

/** A definition-only engine: every abstract member answers a fixed value the test inspects. */
class StubEngine extends MemoryEngine {
  readonly recalls: MemoryRecallRequest[] = []

  async recall(request: MemoryRecallRequest): Promise<MemoryRecallResult> {
    this.recalls.push(request)
    return { items: [], trace: [], degraded: false, latencyMs: 0 }
  }

  async remember(_request: MemoryRememberRequest): Promise<MemoryRememberResult> {
    return { queued: true }
  }

  async forget(_request: MemoryForgetRequest): Promise<MemoryForgetResult> {
    return { removed: 0 }
  }

  async profile(_request: MemoryProfileRequest): Promise<MemoryProfileResult> {
    return { sections: {} }
  }

  async health(): Promise<MemoryHealth> {
    return { reachable: true }
  }
}

describe('memory service definition', () => {
  it('registers as ctx.memory and dispatches to the implementation', async () => {
    const ctx = new Context()
    await ctx.plugin(StubEngine)
    const engine = ctx.memory
    await engine.recall({ question: 'q', mode: 'express', turn: 1 })
    expect(engine).toBeInstanceOf(StubEngine)
    expect((engine as StubEngine).recalls).toHaveLength(1)
  })

  it('rejects a second implementation on the same context', async () => {
    const ctx = new Context()
    await ctx.plugin(StubEngine)
    await expect(ctx.plugin(StubEngine)).rejects.toThrow()
  })

  it('carries the routable code on MemoryError', () => {
    const error = new MemoryError('unreachable', 'MEMORY_UNAVAILABLE')
    expect(error.code).toBe('MEMORY_UNAVAILABLE')
    expect(error).toBeInstanceOf(Error)
  })
})
