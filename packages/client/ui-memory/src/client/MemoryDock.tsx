/**
 * Memory switch in the composer dock strip: turn this turn's recall and write
 * off, without leaving the conversation.
 *
 * The state is not client-local. It comes from the `memoryAutosave` projection
 * of the `memory/mute` session event, because the switch decides whether the
 * turn runs with recalled text — a replay has to reach the same answer the
 * model did.
 */
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { MemoryAutosaveState } from '@deepseek-ai/dsh-memory-autosave/types'
import css from './MemoryDock.module.css'

/** What the plugin body binds per Session. */
export interface MemoryDockInjected {
  /**
   * Record the switch for this Session.
   * @param muted - true to run the turn without recall and without a write.
   * @returns the state the Host recorded.
   */
  readonly setMuted: (muted: boolean) => Promise<boolean>
}

/** Props the input dock slot supplies. */
export type MemoryDockProps =
  PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'memory'>
  & InjectFace<MemoryDockInjected>

/**
 * The dock strip for the memory switch. It renders nothing until the Session
 * has a memory projection, so a session running without the memory preset
 * gains no dead control.
 * @param props - the projection reader, the dictionary, and the bound switch.
 * @returns the strip, or null when this Session has no memory.
 */
export function MemoryDock({ useProjection, t, setMuted }: MemoryDockProps) {
  const state = useProjection('memoryAutosave') as MemoryAutosaveState | undefined
  if (state === undefined) return null
  return (
    <div className={css.dock} data-memory-dock>
      <div className={css.bar}>
        <span className={css.label}>{t('dockLabel')}</span>
        <Switch
          checked={state.muted}
          label={t('dockSwitchLabel')}
          onChange={(next) => { void setMuted(next) }}
        />
        <span className={css.hint}>{state.muted ? t('dockMutedHint') : t('dockActiveHint')}</span>
      </div>
    </div>
  )
}
