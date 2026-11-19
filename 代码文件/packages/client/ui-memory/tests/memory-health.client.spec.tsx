// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryHealth } from '../src/client/MemoryHealth.tsx'
import type { MemoryHealthProps } from '../src/client/MemoryHealth.tsx'
import type {} from '../src/client/index.ts'
import type { PanelOutcome } from '../src/client/actions.ts'
import type { MemoryHealthValue } from '@deepseek-ai/dsh-api-memory-controller/types'
import { en, type MemoryKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: MemoryKey) => en[key]) as MemoryHealthProps['t']

/** A settled health outcome the line switches on. */
function outcome(kind: 'ok' | 'unsupported' | 'failed', reachable = true): PanelOutcome<MemoryHealthValue> {
  if (kind === 'ok') return { kind: 'ok', value: { reachable } }
  if (kind === 'unsupported') return { kind: 'unsupported' }
  return { kind: 'failed', message: 'unreachable' }
}

/** Render the line over one scripted outcome. */
function renderLine(result: PanelOutcome<MemoryHealthValue>, count?: number) {
  const health = () => Promise.resolve(result)
  const Line = MemoryHealth as (props: MemoryHealthProps) => ReturnType<typeof MemoryHealth>
  const view = render(<Line health={health} t={t} count={count} />)
  return view.container
}

describe('MemoryHealth', () => {
  it('reports a reachable collection with content', async () => {
    const container = renderLine(outcome('ok'), 3)
    await waitFor(() => { expect(container.querySelector('[data-health="reachable"]')).not.toBeNull() })
    expect(screen.getByText(en.healthReachable)).toBeDefined()
  })

  it('distinguishes an empty collection from an unreachable service', async () => {
    const container = renderLine(outcome('ok'), 0)
    await waitFor(() => { expect(container.querySelector('[data-health="empty"]')).not.toBeNull() })
    expect(screen.getByText(en.healthEmpty)).toBeDefined()
    expect(screen.queryByText(en.healthUnavailable)).toBeNull()
  })

  it('reports an unbound engine as unconfigured, not as empty', async () => {
    const container = renderLine(outcome('unsupported'))
    await waitFor(() => { expect(container.querySelector('[data-health="unconfigured"]')).not.toBeNull() })
    expect(screen.getByText(en.healthUnconfigured)).toBeDefined()
    expect(screen.queryByText(en.healthEmpty)).toBeNull()
  })

  it('treats a refused read as unavailable and alerts', async () => {
    const container = renderLine(outcome('failed'))
    await waitFor(() => { expect(container.querySelector('[data-health="unavailable"]')).not.toBeNull() })
    expect(screen.getByRole('alert').textContent).toContain(en.healthUnavailable)
    expect(screen.getByRole('button', { name: en.retry })).toBeDefined()
  })

  it('treats an unreachable engine as unavailable even when the call succeeded', async () => {
    const container = renderLine(outcome('ok', false), 5)
    await waitFor(() => { expect(container.querySelector('[data-health="unavailable"]')).not.toBeNull() })
  })
})
