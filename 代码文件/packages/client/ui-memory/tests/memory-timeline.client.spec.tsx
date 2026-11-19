// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryTimeline } from '../src/client/MemoryTimeline.tsx'
import type { MemoryTimelineProps } from '../src/client/MemoryTimeline.tsx'
import type {} from '../src/client/index.ts'
import type { MemoryActivityEntry } from '@deepseek-ai/dsh-memory'
import { en, type MemoryKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: MemoryKey) => en[key]) as MemoryTimelineProps['t']
const scope = { kind: 'global' as const }

/** One recorded operation of the shape the durable index returns. */
function entry(overrides: Partial<MemoryActivityEntry> & Pick<MemoryActivityEntry, 'id' | 'time'>): MemoryActivityEntry {
  return {
    scope, sessionId: 's1', operation: 'recall', status: 'completed',
    origin: 'automatic', contents: [], ...overrides,
  } as MemoryActivityEntry
}

/** Render the timeline over a scripted index read. */
function renderTimeline(entries: readonly MemoryActivityEntry[] | Error) {
  const activity = () => entries instanceof Error ? Promise.reject(entries) : Promise.resolve(entries)
  const Timeline = MemoryTimeline as (props: MemoryTimelineProps) => ReturnType<typeof MemoryTimeline>
  const view = render(<Timeline scope={scope} activity={activity} t={t} />)
  return view.container
}

/** A fixed local timestamp so grouping is stable across machines. */
const AT = new Date(2026, 10, 19, 10, 30, 0).getTime()
const NEXT_DAY = new Date(2026, 10, 18, 22, 15, 0).getTime()

describe('MemoryTimeline', () => {
  it('groups entries under one heading per day, newest first', async () => {
    const container = renderTimeline([
      entry({ id: 'a', time: AT, contents: ['today fact'] }),
      entry({ id: 'b', time: NEXT_DAY, contents: ['yesterday fact'] }),
    ])
    await waitFor(() => { expect(container.querySelectorAll('section')).toHaveLength(2) })
    expect(screen.getByText('today fact')).toBeDefined()
    expect(screen.getByText('yesterday fact')).toBeDefined()
  })

  it('labels each entry with its operation and origin', async () => {
    const container = renderTimeline([
      entry({ id: 'a', time: AT, operation: 'write', status: 'accepted', origin: 'manual', contents: ['saved'] }),
    ])
    await waitFor(() => { expect(container.querySelector('[data-operation="write"]')).not.toBeNull() })
    expect(screen.getByText(en.timelineWrite)).toBeDefined()
    expect(screen.getByText(en.originManual)).toBeDefined()
    expect(screen.getByText(en.queued)).toBeDefined()
  })

  it('keeps a failed entry visibly failed rather than reading as complete', async () => {
    const container = renderTimeline([
      entry({ id: 'a', time: AT, operation: 'write', status: 'unknown', contents: ['maybe'] }),
    ])
    await waitFor(() => { expect(container.querySelector('[data-status="unknown"]')).not.toBeNull() })
    expect(screen.getByText(en.writeUnknown)).toBeDefined()
    expect(screen.queryByText(en.activityCompleted)).toBeNull()
  })

  it('states an empty index instead of rendering an empty frame', async () => {
    renderTimeline([])
    await waitFor(() => { expect(screen.getByText(en.timelineEmpty)).toBeDefined() })
  })

  it('reports a failed read with a retry', async () => {
    renderTimeline(new Error('down'))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(en.timelineFailed) })
    expect(screen.getByRole('button', { name: en.retry })).toBeDefined()
  })
})
