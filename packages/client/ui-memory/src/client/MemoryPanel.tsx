/**
 * Memory tab body: three views of the Session's memory.
 *
 * - **Recall** reads the `memoryAutosave` projection, so it shows exactly what
 *   the session log recorded reaching the model.
 * - **Library** and **Profile** read the engine through the panel Remote, so
 *   they show what the engine holds now, including memories from other
 *   sessions. Neither appends a session event; nothing they show reaches a
 *   model request.
 */
import { useState } from 'react'
import { SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { MemoryAutosaveState } from '@deepseek-ai/dsh-memory-autosave/types'
import type { MemoryPanelActions } from './actions.ts'
import { LibraryView } from './LibraryView.tsx'
import { ProfileView } from './ProfileView.tsx'
import css from './MemoryPanel.module.css'

/** What the plugin body binds per Session. */
export interface MemoryPanelInjected {
  /** Session-bound engine operations for the library and profile views. */
  readonly actions: MemoryPanelActions
}

/** Props the sidebar pane tab slot supplies. */
export type MemoryPanelProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'memory'>
  & InjectFace<MemoryPanelInjected>

/** The panel's views. */
type View = 'recall' | 'library' | 'profile'

/**
 * Render the memory tab with its view switcher.
 * @param props - tab runtime props, the `memory` dictionary, and the bound actions.
 * @returns the panel.
 */
export function MemoryPanel({ useProjection, t, actions }: MemoryPanelProps) {
  const [view, setView] = useState<View>('recall')
  const state = useProjection('memoryAutosave') as MemoryAutosaveState | undefined
  return (
    <section className={css.panel}>
      <SegmentedTabs<View>
        size="sm"
        label={t('viewsLabel')}
        value={view}
        onChange={setView}
        items={[
          { value: 'recall', label: t('viewRecall'), id: 'memory-view-recall', panelId: 'memory-panel-recall' },
          { value: 'library', label: t('viewLibrary'), id: 'memory-view-library', panelId: 'memory-panel-library' },
          { value: 'profile', label: t('viewProfile'), id: 'memory-view-profile', panelId: 'memory-panel-profile' },
        ]}
      />
      <div id={`memory-panel-${view}`} role="tabpanel" aria-labelledby={`memory-view-${view}`} className={css.view}>
        {view === 'recall' && <RecallView state={state} t={t} />}
        {view === 'library' && <LibraryView actions={actions} t={t} />}
        {view === 'profile' && <ProfileView actions={actions} t={t} />}
      </div>
    </section>
  )
}

/**
 * The session's latest recall and this turn's writes, from the projection.
 * A degraded recall stays visible rather than collapsing into the empty state.
 * @param props - the projection state and the dictionary.
 * @returns the recall view.
 */
function RecallView({ state, t }: { readonly state: MemoryAutosaveState | undefined; readonly t: MemoryPanelProps['t'] }) {
  const recall = state?.lastRecall ?? null
  const writes = state?.turnText.filter(message => message.role === 'assistant') ?? []
  if (recall === null && writes.length === 0) {
    return (
      <div className={css.message} role="status">
        <p className={css.title}>{t('emptyTitle')}</p>
        <p className={css.hint}>{t('emptyDescription')}</p>
      </div>
    )
  }
  return (
    <>
      {recall !== null && (
        <section className={css.section}>
          <h3 className={css.title}>{t('sectionRecall')}</h3>
          <p className={css.question}><span className={css.label}>{t('question')}</span>{recall.question}</p>
          <p className={css.hint}>{`${recall.mode} · ${String(recall.latencyMs)} ${t('latencyUnit')}`}</p>
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
    </>
  )
}
