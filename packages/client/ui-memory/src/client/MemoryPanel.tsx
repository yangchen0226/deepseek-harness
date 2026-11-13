/** Memory tab body: this session's latest recall and the items it returned. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { MemoryAutosaveState } from '@deepseek-ai/dsh-memory-autosave/types'
import css from './MemoryPanel.module.css'

/** Props the sidebar pane tab slot supplies. */
export type MemoryPanelProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'memory'>

/**
 * Render the session's memory state from the `memoryAutosave` projection.
 *
 * The panel is read-only: it never calls the memory engine, so what it shows is
 * exactly what the session log recorded. A degraded recall stays visible rather
 * than being hidden as an empty state.
 * @param props - tab runtime props and the `memory` dictionary.
 * @returns the panel.
 */
export function MemoryPanel({ useProjection, t }: MemoryPanelProps) {
  const state = useProjection('memoryAutosave') as MemoryAutosaveState | undefined
  if (state === undefined) return <div className={css.message} role="status">{t('emptyTitle')}</div>
  const recall = state.lastRecall
  const writes = state.turnText.filter(message => message.role === 'assistant')
  if (recall === null && writes.length === 0) {
    return (
      <div className={css.message} role="status">
        <p className={css.title}>{t('emptyTitle')}</p>
        <p className={css.hint}>{t('emptyDescription')}</p>
      </div>
    )
  }
  return (
    <section className={css.panel}>
      {recall !== null && (
        <section className={css.section}>
          <h3 className={css.title}>{t('sectionRecall')}</h3>
          <p className={css.question}><span className={css.label}>{t('question')}</span>{recall.question}</p>
          <p className={css.hint}>
            {`${recall.mode} · ${String(recall.latencyMs)} ${t('latencyUnit')}`}
          </p>
          {recall.degraded && <p className={css.degraded}>{t('degraded')}</p>}
          {recall.items.length === 0
            ? <p className={css.hint}>{t('noItems')}</p>
            : (
              <ul className={css.items}>
                {recall.items.map(item => (
                  <li key={`${item.role}:${item.content}`} className={css.item}>{item.content}</li>
                ))}
              </ul>
            )}
        </section>
      )}
      {recall !== null && recall.trace.length > 0 && (
        <section className={css.section}>
          <h3 className={css.title}>{t('sectionTrace')}</h3>
          <ul className={css.trace}>
            {recall.trace.map((stage, index) => (
              <li key={`trace:${String(index)}`} className={css.traceRow}>
                <span>{stage.stage}</span>
                {stage.count === undefined ? null : <span className={css.traceMeta}>{stage.count}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {writes.length > 0 && (
        <section className={css.section}>
          <h3 className={css.title}>{t('sectionWrites')}</h3>
          <ul className={css.items}>
            {writes.map((message, index) => (
              <li key={`write:${String(index)}`} className={css.item}>{message.content}</li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
