/** Memory profile view: the user's stored facts grouped into readable sections. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryProfileValue } from '@deepseek-ai/dsh-api-memory-controller/types'
import type { MemoryPanelActions, PanelOutcome } from './actions.ts'
import css from './MemoryPanel.module.css'

/** Sections in display order; a section the engine does not return is omitted. */
const SECTION_ORDER = ['basic', 'interests', 'habits', 'emotions'] as const

/** Props for {@link ProfileView}. */
export interface ProfileViewProps {
  /** Session-bound panel operations. */
  readonly actions: MemoryPanelActions
  /** The `memory` dictionary. */
  readonly workspace?: boolean
  readonly t: TranslateNS<'memory'>
}

/**
 * Render the profile sections the engine derives from stored memories. The
 * view shows only sections the engine returned with content; it never pads an
 * empty section with placeholder text.
 * @param props - the panel operations and the dictionary.
 * @returns the profile view.
 */
export function ProfileView({ actions, t, workspace = false }: ProfileViewProps) {
  const [outcome, setOutcome] = useState<PanelOutcome<MemoryProfileValue> | undefined>(undefined)

  const generation = useRef(0)
  const load = useCallback(async (refresh = false) => {
    const mine = ++generation.current
    setOutcome(undefined)
    const value = await actions.profile(refresh)
    if (mine === generation.current) setOutcome(value)
  }, [actions])

  useEffect(() => { void load(); return () => { generation.current++ } }, [load])

  if (outcome === undefined) return <p className={css.hint} role="status">{t('loading')}</p>
  if (outcome.kind === 'unsupported') return <p className={css.hint} role="status">{t('profileUnsupported')}</p>
  if (outcome.kind === 'failed') {
    return (
      <div className={css.degraded} role="alert">
        <span>{t('loadFailed')}</span>
        <Button size="sm" variant="ghost" onClick={() => { void load() }}>{t('retry')}</Button>
      </div>
    )
  }
  if (outcome.value.degraded) return <p className={css.degraded} role="alert">{t('degraded')}</p>
  const sections = SECTION_ORDER.filter(name => (outcome.value.sections[name]?.length ?? 0) > 0)
  const update = <Button size="sm" variant="ghost" onClick={() => { void load(true) }}>{t('refreshProfile')}</Button>
  if (sections.length === 0) return <div><p className={css.hint} role="status">{t('profileEmpty')}</p>{update}</div>
  return (
    <>
      {update}
      {sections.map(name => (
        <section key={name} className={css.section}>
          <h3 className={css.title}>{t(workspace ? (name === 'basic' ? 'workspaceProfileBasic' : name === 'interests' ? 'workspaceProfileInterests' : name === 'habits' ? 'workspaceProfileHabits' : 'workspaceProfileValues') : `profile_${name}`)}</h3>
          <ul className={css.items}>
            {(outcome.value.sections[name] ?? []).map((line, index) => (
              <li key={`${name}:${String(index)}`} className={css.item}>{line}</li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}
