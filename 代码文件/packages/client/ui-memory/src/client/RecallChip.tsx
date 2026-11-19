/**
 * Recall chip above the assistant reply: what memory contributed to this turn,
 * rendered where the answer is rather than behind a panel.
 *
 * Every state comes from the `memoryAutosave` projection, so a replay shows the
 * same chip the live session did. A degraded recall renders its cause, never an
 * empty state; a muted turn says memory is off instead of implying nothing was
 * recalled.
 */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { MemoryAutosaveState } from '@deepseek-ai/dsh-memory-autosave/types'
import css from './RecallChip.module.css'

/** What the plugin body binds per Session. */
export interface RecallChipInjected {
  /**
   * Record the memory switch for this Session.
   * @param muted - true to run the turn without recall and without a write.
   * @returns the state the Host recorded.
   */
  readonly setMuted: (muted: boolean) => Promise<boolean>
  /**
   * Open the memory panel for deep inspection.
   * @returns nothing.
   */
  readonly openPanel: () => void
}

/** Props the turn-tail slot supplies. */
export type RecallChipProps =
  PropsRuntime<'conversation.chat.turnTail'>
  & PropsLocale<'memory'>
  & InjectFace<RecallChipInjected>

/** How many recalled items stay collapsed before the chip pages. */
const INLINE_ITEM_LIMIT = 3

/**
 * Render the recall chip for the turn this message belongs to.
 *
 * The chip renders nothing when the Session has no memory projection, so a
 * session running without the memory capability gains no dead control.
 * When the turn submitted a write, the acceptance line renders under the same
 * chip: both are this turn's memory activity, and `accepted` states only that
 * the service took the batch, never that it is stored.
 * @param props - the projection reader, the `memory` dictionary, and the bound switch and panel opener.
 * @returns the chip, or null when this Session has no memory.
 */
export function RecallChip({ useProjection, t, setMuted, openPanel }: RecallChipProps) {
  const state = useProjection('memoryAutosave') as MemoryAutosaveState | undefined
  const [expanded, setExpanded] = useState(false)
  if (state === undefined) return null
  const write = state.lastWrite
  return <>
    {renderRecall(state, expanded, setExpanded, t, setMuted, openPanel)}
    {write === undefined ? null : <div className={css.acceptance} data-write-state={write.queued ? 'accepted' : 'failed'} role={write.queued ? 'status' : 'alert'}>
      <span className={css.icon} aria-hidden="true">{write.queued ? '↑' : '!'}</span>
      <span className={css.summary}>{t(write.queued ? 'writeAccepted' : 'writeFailed')}</span>
      {write.queued && <span className={css.more}>{t('writeAcceptedHint')}</span>}
      <Button size="sm" variant="ghost" onClick={openPanel}>{t('recallInspect')}</Button>
    </div>}
  </>
}

/** Render the recall half of the chip for the projection's current state. */
function renderRecall(
  state: MemoryAutosaveState,
  expanded: boolean,
  setExpanded: (update: (value: boolean) => boolean) => void,
  t: RecallChipProps['t'],
  setMuted: RecallChipInjected['setMuted'],
  openPanel: RecallChipInjected['openPanel'],
) {
  const recall = state.lastRecall

  if (state.muted) {
    return <div className={css.chip} data-recall-state="off">
      <span className={css.icon} aria-hidden="true">○</span>
      <span className={css.summary}>{t('recallOff')}</span>
      <Button size="sm" variant="ghost" onClick={() => { void setMuted(false) }}>{t('recallTurnOn')}</Button>
    </div>
  }

  if (recall === null) {
    return <div className={css.chip} data-recall-state="none">
      <span className={css.icon} aria-hidden="true">○</span>
      <span className={css.summary}>{t('recallNone')}</span>
    </div>
  }

  if (recall.degraded) {
    return <div className={css.chip} data-recall-state="degraded" role="status">
      <span className={css.icon} aria-hidden="true">!</span>
      <span className={css.summary}>{t('recallDegraded')}</span>
      <Button size="sm" variant="ghost" onClick={openPanel}>{t('recallInspect')}</Button>
    </div>
  }

  const items = recall.items
  if (items.length === 0) {
    return <div className={css.chip} data-recall-state="empty">
      <span className={css.icon} aria-hidden="true">○</span>
      <span className={css.summary}>{t('recallEmpty')}</span>
    </div>
  }

  const shown = expanded ? items : items.slice(0, INLINE_ITEM_LIMIT)
  const hidden = items.length - shown.length
  return <div className={css.chip} data-recall-state="recalled">
    <button
      type="button"
      className={css.summary}
      aria-expanded={expanded}
      onClick={() => { setExpanded(value => !value) }}
    >
      <span className={css.icon} aria-hidden="true">●</span>
      {t('recallCount').replace('{count}', String(items.length))}
    </button>
    <Button size="sm" variant="ghost" onClick={openPanel}>{t('recallInspect')}</Button>
    {expanded && <ul className={css.items}>
      {shown.map(item => <li key={`${item.role}:${item.content}`} className={css.item}>{item.content}</li>)}
    </ul>}
    {!expanded && hidden > 0 && <span className={css.more}>{t('recallMore').replace('{count}', String(hidden))}</span>}
  </div>
}
