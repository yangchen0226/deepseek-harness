// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryPanel } from '../src/client/MemoryPanel.tsx'
import type { MemoryPanelProps } from '../src/client/MemoryPanel.tsx'
// Side-effect-free, but carries the module declaration that types the `memory` namespace.
import type {} from '../src/client/index.ts'
import type { MemoryAutosaveState } from '@deepseek-ai/dsh-memory-autosave/types'
import { en, type MemoryKey } from '../src/client/locales.ts'
import type { MemoryPanelActions } from '../src/client/actions.ts'

/** The en dictionary with `{name}` interpolation, as the locale service applies it. */
const t = ((key: MemoryKey, params?: Record<string, unknown>) =>
  en[key].replace(/\{(\w+)\}/gu, (_, name: string) => {
    const value = params?.[name]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  })) as MemoryPanelProps['t']

/** Actions whose every read answers empty; tests replace members they script. */
function idleActions(overrides: Partial<MemoryPanelActions> = {}): MemoryPanelActions {
  return {
    list: () => Promise.resolve({ kind: 'ok', value: { items: [], total: 0, degraded: false } }),
    profile: () => Promise.resolve({ kind: 'ok', value: { sections: {}, degraded: false } }),
    forget: () => Promise.resolve({ kind: 'ok', value: { removed: 1 } }),
    mute: () => Promise.resolve({ kind: 'ok', value: { muted: true } }),
    ...overrides,
  }
}

/** Render the panel with a scripted projection reader and actions. */
function renderPanel(state: MemoryAutosaveState | undefined, actions: MemoryPanelActions = idleActions()) {
  const useProjection = (() => state) as MemoryPanelProps['useProjection']
  // The panel reads no tab or session state; supply only what it consumes and
  // stand in for the rest of the slot's standard props.
  const Panel = MemoryPanel as unknown as (props: {
    useProjection: MemoryPanelProps['useProjection']
    t: MemoryPanelProps['t']
    actions: MemoryPanelActions
  }) => ReactElement
  render(<Panel useProjection={useProjection} t={t} actions={actions} />)
}

/** Switch the panel to one of its views. */
function openView(label: string) {
  fireEvent.click(screen.getByRole('tab', { name: label }))
}

afterEach(cleanup)

const EMPTY_STATE = { lastRecall: null, turnText: [], muted: false, mutedTurn: null }

const ENTRY = { id: 'm-1', content: '项目统一使用 pnpm', kind: 'preference', createdAt: '2026-11-13T08:00:00.000Z', hits: 3 }

describe('MemoryPanel', () => {
  it('shows the empty state before any memory event', () => {
    renderPanel(undefined)
    expect(screen.getByText(en.emptyTitle)).toBeDefined()
  })

  it('shows the guidance when the session has no recall and no writes', () => {
    renderPanel(EMPTY_STATE)
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
      muted: false,
      mutedTurn: null,
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
      muted: false,
      mutedTurn: null,
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
      muted: false,
      mutedTurn: null,
    })
    expect(screen.getByText(en.degraded)).toBeDefined()
  })
})

describe('MemoryPanel library', () => {
  it('lists stored memories with their total', async () => {
    renderPanel(undefined, idleActions({
      list: () => Promise.resolve({ kind: 'ok', value: { items: [ENTRY], total: 9, degraded: false } }),
    }))
    openView(en.viewLibrary)
    expect(await screen.findByText(ENTRY.content)).toBeDefined()
    expect(screen.getByText('Showing 1 of 9')).toBeDefined()
    expect(screen.getByText('Recalled 3 times')).toBeDefined()
  })

  it('sends the search text as the filter', async () => {
    const list = vi.fn<MemoryPanelActions['list']>(() =>
      Promise.resolve({ kind: 'ok', value: { items: [], total: 0, degraded: false } }))
    renderPanel(undefined, idleActions({ list }))
    openView(en.viewLibrary)
    await screen.findByText(en.libraryEmpty)
    fireEvent.change(screen.getByLabelText(en.searchPlaceholder), { target: { value: 'pnpm' } })
    await waitFor(() => { expect(list).toHaveBeenLastCalledWith({ query: 'pnpm', limit: 50 }) })
    expect(await screen.findByText(en.noMatches)).toBeDefined()
  })

  it('deletes only on the second press, then re-reads the library', async () => {
    let items = [ENTRY]
    const forget = vi.fn<MemoryPanelActions['forget']>(() => {
      items = []
      return Promise.resolve({ kind: 'ok', value: { removed: 1 } })
    })
    renderPanel(undefined, idleActions({
      list: () => Promise.resolve({ kind: 'ok', value: { items, total: items.length, degraded: false } }),
      forget,
    }))
    openView(en.viewLibrary)
    await screen.findByText(ENTRY.content)
    fireEvent.click(screen.getByRole('button', { name: en.forget }))
    expect(forget).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.forgetConfirm }))
    await waitFor(() => { expect(forget).toHaveBeenCalledWith('m-1') })
    expect(await screen.findByText(en.libraryEmpty)).toBeDefined()
  })

  it('keeps the row and says so when a delete fails', async () => {
    renderPanel(undefined, idleActions({
      list: () => Promise.resolve({ kind: 'ok', value: { items: [ENTRY], total: 1, degraded: false } }),
      forget: () => Promise.resolve({ kind: 'failed', message: 'down' }),
    }))
    openView(en.viewLibrary)
    await screen.findByText(ENTRY.content)
    fireEvent.click(screen.getByRole('button', { name: en.forget }))
    fireEvent.click(screen.getByRole('button', { name: en.forgetConfirm }))
    expect(await screen.findByText(en.forgetFailed)).toBeDefined()
    expect(screen.getByText(ENTRY.content)).toBeDefined()
  })

  it('says the backend cannot browse instead of showing an empty library', async () => {
    renderPanel(undefined, idleActions({ list: () => Promise.resolve({ kind: 'unsupported' }) }))
    openView(en.viewLibrary)
    expect(await screen.findByText(en.libraryUnsupported)).toBeDefined()
    expect(screen.queryByText(en.libraryEmpty)).toBeNull()
  })

  it('offers a retry after a failed read', async () => {
    const list = vi.fn<MemoryPanelActions['list']>()
      .mockResolvedValueOnce({ kind: 'failed', message: 'timeout' })
      .mockResolvedValue({ kind: 'ok', value: { items: [ENTRY], total: 1, degraded: false } })
    renderPanel(undefined, idleActions({ list }))
    openView(en.viewLibrary)
    fireEvent.click(await screen.findByRole('button', { name: en.retry }))
    expect(await screen.findByText(ENTRY.content)).toBeDefined()
  })
})

describe('MemoryPanel profile', () => {
  it('shows only sections that have content, in display order', async () => {
    renderPanel(undefined, idleActions({
      profile: () => Promise.resolve({
        kind: 'ok',
        value: { sections: { habits: ['先写测试'], interests: ['CSS Modules'], emotions: [] }, degraded: false },
      }),
    }))
    openView(en.viewProfile)
    expect(await screen.findByText('CSS Modules')).toBeDefined()
    const headings = screen.getAllByRole('heading').map(node => node.textContent)
    expect(headings).toEqual([en.profile_interests, en.profile_habits])
  })

  it('shows the degraded notice when the engine is unreachable', async () => {
    renderPanel(undefined, idleActions({
      profile: () => Promise.resolve({ kind: 'ok', value: { sections: {}, degraded: true } }),
    }))
    openView(en.viewProfile)
    expect(await screen.findByText(en.degraded)).toBeDefined()
  })
})
