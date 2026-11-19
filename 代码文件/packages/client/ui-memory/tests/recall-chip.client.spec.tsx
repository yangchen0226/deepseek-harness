// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RecallChip } from '../src/client/RecallChip.tsx'
import type { RecallChipProps } from '../src/client/RecallChip.tsx'
import type {} from '../src/client/index.ts'
import type { MemoryAutosaveState } from '@deepseek-ai/dsh-memory-autosave/types'
import { en, type MemoryKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: MemoryKey) => en[key]) as RecallChipProps['t']

/** One recalled item of the shape the projection publishes. */
function item(content: string) {
  return { role: 'user' as const, content }
}

/** A projection state with the recall field the chip reads. */
function state(overrides: Partial<MemoryAutosaveState>): MemoryAutosaveState {
  return { lastRecall: null, turnText: [], muted: false, mutedTurn: null, ...overrides }
}

/** Render the chip with scripted bindings. */
function renderChip(value: MemoryAutosaveState | undefined) {
  const setMuted = vi.fn(() => Promise.resolve(true))
  const openPanel = vi.fn()
  const useProjection = (() => value) as RecallChipProps['useProjection']
  const Chip = RecallChip as (props: {
    useProjection: RecallChipProps['useProjection']
    t: RecallChipProps['t']
    setMuted: RecallChipProps['setMuted']
    openPanel: RecallChipProps['openPanel']
  }) => ReturnType<typeof RecallChip> | null
  const view = render(<Chip useProjection={useProjection} t={t} setMuted={setMuted} openPanel={openPanel} />)
  return { setMuted, openPanel, container: view.container }
}

describe('RecallChip', () => {
  it('renders nothing for a session without the memory projection', () => {
    const { container } = renderChip(undefined)
    expect(container.querySelector('[data-recall-state]')).toBeNull()
  })

  it('states that memory is off and offers to turn it on', async () => {
    const { setMuted, container } = renderChip(state({ muted: true }))
    expect(container.querySelector('[data-recall-state="off"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.recallTurnOn }))
    expect(setMuted).toHaveBeenCalledWith(false)
  })

  it('never renders a degraded recall as an empty result', () => {
    const { container, openPanel } = renderChip(state({
      lastRecall: { question: 'q', mode: 'quick', degraded: true, latencyMs: 12, items: [], trace: [] },
    }))
    expect(container.querySelector('[data-recall-state="degraded"]')).not.toBeNull()
    expect(screen.getByText(en.recallDegraded)).toBeDefined()
    expect(screen.queryByText(en.recallEmpty)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.recallInspect }))
    expect(openPanel).toHaveBeenCalled()
  })

  it('distinguishes an empty recall from a degraded one', () => {
    const { container } = renderChip(state({
      lastRecall: { question: 'q', mode: 'quick', degraded: false, latencyMs: 8, items: [], trace: [] },
    }))
    expect(container.querySelector('[data-recall-state="empty"]')).not.toBeNull()
  })

  it('counts recalled items and expands them on demand', () => {
    const { container } = renderChip(state({
      lastRecall: {
        question: 'q', mode: 'quick', degraded: false, latencyMs: 9,
        items: [item('uses pnpm'), item('prefers Chinese'), item('works on dsh'), item('likes terse replies')],
        trace: [],
      },
    }))
    expect(container.querySelector('[data-recall-state="recalled"]')).not.toBeNull()
    expect(screen.getByText(en.recallCount.replace('{count}', '4'))).toBeDefined()
    expect(screen.getByText(en.recallMore.replace('{count}', '1'))).toBeDefined()
    expect(screen.queryByText('uses pnpm')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.recallCount.replace('{count}', '4') }))
    expect(screen.getByText('uses pnpm')).toBeDefined()
    expect(screen.getByText('likes terse replies')).toBeDefined()
    expect(screen.queryByText(en.recallMore.replace('{count}', '1'))).toBeNull()
  })

  it('reports the switch state as an accessible expansion control', () => {
    const { container } = renderChip(state({
      lastRecall: { question: 'q', mode: 'quick', degraded: false, latencyMs: 9, items: [item('a')], trace: [] },
    }))
    const summary = container.querySelector('[aria-expanded]')
    expect(summary?.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(summary as Element)
    expect(summary?.getAttribute('aria-expanded')).toBe('true')
  })

  it('states that an accepted write is not stored yet', () => {
    const { container } = renderChip(state({
      lastWrite: { queued: true, contents: ['uses pnpm'] },
    }))
    expect(container.querySelector('[data-write-state="accepted"]')).not.toBeNull()
    expect(screen.getByText(en.writeAccepted)).toBeDefined()
    expect(screen.getByText(en.writeAcceptedHint)).toBeDefined()
    expect(screen.queryByText(en.writeFailed)).toBeNull()
  })

  it('renders a refused write as an alert, not as accepted', () => {
    const { container } = renderChip(state({
      lastWrite: { queued: false, contents: ['uses pnpm'] },
    }))
    expect(container.querySelector('[data-write-state="failed"]')).not.toBeNull()
    expect(screen.getByRole('alert').textContent).toContain(en.writeFailed)
    expect(screen.queryByText(en.writeAccepted)).toBeNull()
  })

  it('renders no acceptance line before this turn submitted a write', () => {
    const { container } = renderChip(state({}))
    expect(container.querySelector('[data-write-state]')).toBeNull()
  })
})
