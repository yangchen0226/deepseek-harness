// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryDock } from '../src/client/MemoryDock.tsx'
import type { MemoryDockProps } from '../src/client/MemoryDock.tsx'
import type {} from '../src/client/index.ts'
import type { MemoryAutosaveState } from '@deepseek-ai/dsh-memory-autosave/types'
import { en, type MemoryKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: MemoryKey) => en[key]) as MemoryDockProps['t']

/** Render the dock with a scripted projection reader and switch binding. */
function renderDock(state: MemoryAutosaveState | undefined, setMuted = vi.fn(() => Promise.resolve(true))) {
  const useProjection = (() => state) as MemoryDockProps['useProjection']
  const Dock = MemoryDock as unknown as (props: {
    useProjection: MemoryDockProps['useProjection']
    t: MemoryDockProps['t']
    setMuted: (muted: boolean) => Promise<boolean>
  }) => ReturnType<typeof MemoryDock> | null
  render(<Dock useProjection={useProjection} t={t} setMuted={setMuted} />)
  return setMuted
}

const STATE = { lastRecall: null, turnText: [], muted: false, mutedTurn: null }

describe('MemoryDock', () => {
  it('renders nothing for a session without the memory preset', () => {
    renderDock(undefined)
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('shows the switch on and says the turn uses memory', () => {
    renderDock(STATE)
    expect(screen.getByRole('switch', { name: en.dockSwitchLabel }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(en.dockActiveHint)).toBeDefined()
  })

  it('shows a muted session as muted', () => {
    renderDock({ ...STATE, muted: true, mutedTurn: 1 })
    expect(screen.getByRole('switch', { name: en.dockSwitchLabel }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(en.dockMutedHint)).toBeDefined()
  })

  it('asks the Host to mute when switched off', () => {
    const setMuted = renderDock(STATE)
    fireEvent.click(screen.getByRole('switch', { name: en.dockSwitchLabel }))
    expect(setMuted).toHaveBeenCalledWith(true)
  })

  it('asks the Host to unmute when switched back on', () => {
    const setMuted = renderDock({ ...STATE, muted: true, mutedTurn: 1 })
    fireEvent.click(screen.getByRole('switch', { name: en.dockSwitchLabel }))
    expect(setMuted).toHaveBeenCalledWith(false)
  })
})
