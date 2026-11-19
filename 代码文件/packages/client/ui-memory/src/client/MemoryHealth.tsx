/**
 * Collection health line: which of off, unconfigured, unavailable, and empty
 * this collection is in, stated once above the views.
 *
 * The four states read very differently to a person — "you have no memories"
 * and "the service cannot be reached" are not the same fact — so the line
 * resolves them from `memory/health`'s outcome rather than from an empty page.
 */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PanelOutcome } from './actions.ts'
import type { MemoryHealthValue } from '@deepseek-ai/dsh-api-memory-controller/types'
import css from './MemoryHealth.module.css'

/** Props the page supplies. */
export interface MemoryHealthProps {
  /** Ask the selected collection's engine whether it answers. */
  readonly health: () => Promise<PanelOutcome<MemoryHealthValue>>
  /** The `memory` dictionary. */
  readonly t: PropsLocale<'memory'>['t']
  /** How many items the collection currently holds, when the page knows. */
  readonly count?: number | undefined
}

/** What the line shows; `loading` is not a health state, only an unanswered read. */
type HealthState = 'loading' | 'reachable' | 'empty' | 'unconfigured' | 'unavailable'

/** Resolve one health outcome into the state the line renders. */
function stateOf(outcome: PanelOutcome<MemoryHealthValue>, count: number | undefined): HealthState {
  if (outcome.kind === 'unsupported') return 'unconfigured'
  if (outcome.kind === 'failed') return 'unavailable'
  if (!outcome.value.reachable) return 'unavailable'
  return count === 0 ? 'empty' : 'reachable'
}

/**
 * Render the collection health line.
 *
 * A failed or refused read renders `unavailable` with a retry; it never
 * degrades into the empty-collection copy.
 * @param props - the health read, the dictionary, and the known item count.
 * @returns the line.
 */
export function MemoryHealth({ health, t, count }: MemoryHealthProps) {
  const [state, setState] = useState<HealthState>('loading')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setState('loading')
    void health().then(outcome => { if (active) setState(stateOf(outcome, count)) }, () => { if (active) setState('unavailable') })
    return () => { active = false }
  }, [health, count, revision])
  const copy = state === 'loading' ? t('healthLoading')
    : state === 'reachable' ? t('healthReachable')
      : state === 'empty' ? t('healthEmpty')
        : state === 'unconfigured' ? t('healthUnconfigured')
          : t('healthUnavailable')
  return <p className={css.line} data-health={state} role={state === 'unavailable' ? 'alert' : 'status'}>
    <span>{copy}</span>
    {(state === 'unavailable' || state === 'unconfigured') && <Button size="sm" variant="ghost" onClick={() => { setRevision(value => value + 1) }}>{t('retry')}</Button>}
  </p>
}
