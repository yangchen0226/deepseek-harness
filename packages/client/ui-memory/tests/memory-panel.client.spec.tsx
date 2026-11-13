// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryPanel } from '../src/client/MemoryPanel.tsx'
import type { MemoryPanelProps } from '../src/client/MemoryPanel.tsx'
// Side-effect-free, but carries the module declaration that types the `memory` namespace.
import type {} from '../src/client/index.ts'
import type { MemoryAutosaveState } from '@deepseek-ai/dsh-memory-autosave/types'
import { en, type MemoryKey } from '../src/client/locales.ts'

const t = ((key: MemoryKey) => en[key]) as MemoryPanelProps['t']

/** Render the panel with a scripted projection reader. */
function renderPanel(state: MemoryAutosaveState | undefined) {
  const useProjection = (() => state) as MemoryPanelProps['useProjection']
  // The panel reads no tab or session state; supply only what it consumes and
  // stand in for the rest of the slot's standard props.
  const Panel = MemoryPanel as unknown as (props: {
    useProjection: MemoryPanelProps['useProjection']
    t: MemoryPanelProps['t']
  }) => ReactElement
  render(<Panel useProjection={useProjection} t={t} />)
}

describe('MemoryPanel', () => {
  it('shows the empty state before any memory event', () => {
    renderPanel(undefined)
    expect(screen.getByText(en.emptyTitle)).toBeDefined()
  })

  it('shows the guidance when the session has no recall and no writes', () => {
    renderPanel({ lastRecall: null, turnText: [] })
    expect(screen.getByText(en.emptyDescription)).toBeDefined()
  })

  it('renders the recall question and its items', () => {
    renderPanel({
      lastRecall: {
        question: 'package manager',
        mode: 'quick',
        degraded: false,
        latencyMs: 12,
        items: [{ role: 'user', content: 'prefers pnpm' }],
        trace: [{ stage: 'results_merged', count: 1 }],
      },
      turnText: [],
    })
    expect(screen.getByText(en.sectionRecall)).toBeDefined()
    expect(screen.getByText('package manager')).toBeDefined()
    expect(screen.getByText('prefers pnpm')).toBeDefined()
    expect(screen.getByText(en.sectionTrace)).toBeDefined()
    expect(screen.getByText('results_merged')).toBeDefined()
  })

  it('renders a no-match recall and the turn writes', () => {
    renderPanel({
      lastRecall: {
        question: 'nothing',
        mode: 'express',
        degraded: false,
        latencyMs: 3,
        items: [],
        trace: [],
      },
      turnText: [{ role: 'assistant', content: 'understood, pnpm it is' }],
    })
    expect(screen.getByText(en.noItems)).toBeDefined()
    expect(screen.getByText(en.sectionWrites)).toBeDefined()
    expect(screen.getByText('understood, pnpm it is')).toBeDefined()
  })

  it('shows a degraded recall instead of hiding it', () => {
    renderPanel({
      lastRecall: {
        question: 'anything',
        mode: 'quick',
        degraded: true,
        latencyMs: 800,
        items: [],
        trace: [],
      },
      turnText: [],
    })
    expect(screen.getByText(en.degraded)).toBeDefined()
  })
})
