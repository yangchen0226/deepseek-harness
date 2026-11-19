/**
 * Memory lens: what memory contributed to the Session's latest turn, listed
 * beside the conversation instead of behind a click into the library.
 *
 * The lens reads the `memoryAutosave` projection, which retains each recalled
 * item's text only; the engine's per-item source label and score are not
 * projected. The lens therefore lists the recalled text and the recall's mode
 * and latency, and leaves per-item provenance to the library view. It appends
 * no event; muting stays the composer switch's job.
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { MemoryAutosaveState } from '@deepseek-ai/dsh-memory-autosave/types'
import css from './MemoryLens.module.css'

/** Props the panel supplies: the Session projection reader and the `memory` dictionary. */
export interface MemoryLensProps {
  /** Host-computed projection values addressed by key. */
  readonly useProjection: (key: 'memoryAutosave') => MemoryAutosaveState | undefined
  /** The `memory` dictionary. */
  readonly t: PropsLocale<'memory'>['t']
}

/**
 * Render the lens for the Session's latest recall.
 *
 * A degraded recall renders its own notice and an empty list, never the
 * "nothing was recalled" state, because those two facts differ for the reader.
 * @param props - the projection reader and the `memory` dictionary.
 * @returns the lens.
 */
export function MemoryLens({ useProjection, t }: MemoryLensProps) {
  const state = useProjection('memoryAutosave') as MemoryAutosaveState | undefined
  if (state === undefined) {
    return <section className={css.lens}><p className={css.hint}>{t('lensUnavailable')}</p></section>
  }
  if (state.muted) {
    return <section className={css.lens}><p className={css.hint}>{t('recallOff')}</p></section>
  }
  const recall = state.lastRecall
  if (recall === null) {
    return <section className={css.lens}><p className={css.hint}>{t('recallNone')}</p></section>
  }
  return <section className={css.lens}>
    <header className={css.header}>
      <h3 className={css.title}>{t('lensTitle')}</h3>
      <p className={css.meta}>{`${recall.mode} · ${String(recall.latencyMs)} ${t('latencyUnit')}`}</p>
    </header>
    {recall.degraded && <p className={css.degraded} role="status">{t('recallDegraded')}</p>}
    {!recall.degraded && (recall.items.length === 0
      ? <p className={css.hint}>{t('recallEmpty')}</p>
      : <ul className={css.items}>
        {recall.items.map(item => <li key={`${item.role}:${item.content}`} className={css.item}>
          <p className={css.content}>{item.content}</p>
        </li>)}
      </ul>)}
  </section>
}
