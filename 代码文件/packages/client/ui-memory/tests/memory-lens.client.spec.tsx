// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryLens } from '../src/client/MemoryLens.tsx'
import type { MemoryLensProps } from '../src/client/MemoryLens.tsx'
import type {} from '../src/client/index.ts'
import type { MemoryAutosaveState } from '@deepseek-ai/dsh-memory-autosave/types'
import { en, type MemoryKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: MemoryKey) => en[key]) as MemoryLensProps['t']

/** A projection state with the recall field the lens reads. */
function state(overrides: Partial<MemoryAutosaveState>): MemoryAutosaveState {
  return { lastRecall: null, turnText: [], muted: false, mutedTurn: null, ...overrides }
}

/** Render the lens with a scripted projection reader. */
function renderLens(value: MemoryAutosaveState | undefined) {
  const useProjection = (() => value) as MemoryLensProps['useProjection']
  const Lens = MemoryLens as (props: {
    useProjection: MemoryLensProps['useProjection']
    t: MemoryLensProps['t']
  }) => ReturnType<typeof MemoryLens>
  render(<Lens useProjection={useProjection} t={t} />)
}

describe('MemoryLens', () => {
  it('says the session has no memory when the projection is absent', () => {
    renderLens(undefined)
    expect(screen.getByText(en.lensUnavailable)).toBeDefined()
  })

  it('reports the lens is off rather than empty when memory is muted', () => {
    renderLens(state({ muted: true }))
    expect(screen.getByText(en.recallOff)).toBeDefined()
    expect(screen.queryByText(en.recallEmpty)).toBeNull()
  })

  it('states that nothing was recalled before the first recall', () => {
    renderLens(state({}))
    expect(screen.getByText(en.recallNone)).toBeDefined()
  })

  it('lists the recalled text under the turn header', () => {
    renderLens(state({
      lastRecall: {
        question: 'q', mode: 'quick', degraded: false, latencyMs: 14,
        items: [{ role: 'user', content: 'prefers pnpm' }, { role: 'user', content: 'works on dsh' }],
        trace: [],
      },
    }))
    expect(screen.getByText(en.lensTitle)).toBeDefined()
    expect(screen.getByText('prefers pnpm')).toBeDefined()
    expect(screen.getByText('works on dsh')).toBeDefined()
  })

  it('renders a degraded recall with its notice, never as an empty list', () => {
    renderLens(state({
      lastRecall: { question: 'q', mode: 'quick', degraded: true, latencyMs: 900, items: [], trace: [] },
    }))
    expect(screen.getByRole('status').textContent).toBe(en.recallDegraded)
    expect(screen.queryByText(en.recallEmpty)).toBeNull()
  })
})
