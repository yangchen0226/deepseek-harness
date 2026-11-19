/**
 * Memory tab body: three views of the Session's memory.
 *
 * - **Memory activity** shows the latest recorded recall and write outcome.
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
import { MemoryLens } from './MemoryLens.tsx'
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
type View = 'recall' | 'lens' | 'library' | 'profile'

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
      {state?.nativeAvailable !== true && <p className={css.hint}>{t('nativeUnavailable')}</p>}
      <SegmentedTabs<View>
        size="sm"
        label={t('viewsLabel')}
        value={view}
        onChange={setView}
        items={[
          { value: 'recall', label: t('viewRecall'), id: 'memory-view-recall', panelId: 'memory-panel-recall' },
          { value: 'lens', label: t('viewLens'), id: 'memory-view-lens', panelId: 'memory-panel-lens' },
          { value: 'library', label: t('viewLibrary'), id: 'memory-view-library', panelId: 'memory-panel-library' },
          { value: 'profile', label: t('viewProfile'), id: 'memory-view-profile', panelId: 'memory-panel-profile' },
        ]}
      />
      <div id={`memory-panel-${view}`} role="tabpanel" aria-labelledby={`memory-view-${view}`} className={css.view}>
        {view === 'recall' && <RecallView state={state} t={t} />}
        {view === 'lens' && <LensView state={state} t={t} />}
        {view === 'library' && <LibraryView actions={actions} t={t} />}
        {view === 'profile' && <ProfileView actions={actions} t={t} />}
      </div>
    </section>
  )
}

/**
 * The lens view inside the panel: the same content the right-rail lens shows,
 * composed from the panel's projection state.
 * @param props - the projection state and the dictionary.
 * @returns the lens view.
 */
function LensView({ state, t }: { readonly state: MemoryAutosaveState | undefined; readonly t: MemoryPanelProps['t'] }) {
  const useProjection = (() => state) as MemoryPanelProps['useProjection']
  return <MemoryLens useProjection={useProjection} t={t} />
}

/**
 * The session's latest recall and this turn's writes, from the projection.
 * A degraded recall stays visible rather than collapsing into the empty state.
 * @param props - the projection state and the dictionary.
 * @returns the recall view.
 */
function RecallView({ state, t }: { readonly state: MemoryAutosaveState | undefined; readonly t: MemoryPanelProps['t'] }) {
  const recall = state?.lastRecall ?? null
  const write = state?.lastWrite
  return (
    <>
        <section className={css.activity}>
          <h3 className={css.title}>{t('sectionRecall')}</h3>
          {recall === null ? <p className={css.hint}>{t('emptyRecall')}</p> : <>
          <p className={css.question}><span className={css.label}>{t('question')}</span>{recall.question}</p>
          <p className={css.hint}>{`${recall.mode} · ${String(recall.latencyMs)} ${t('latencyUnit')}`}</p>
          {recall.degraded && <p className={css.degraded}>{t('degraded')}</p>}
          {!recall.degraded && (recall.items.length === 0
            ? <p className={css.hint}>{t('noItems')}</p>
            : (
              <ul className={css.items}>
                {recall.items.map(item => (
                  <li key={`${item.role}:${item.content}`} className={css.item}>{item.content}</li>
                ))}
              </ul>
            ))}
      {recall.trace.length > 0 && (
        <details className={css.details}>
          <summary>{t('sectionTrace')}</summary>
          <ul className={css.trace}>
            {recall.trace.map((stage, index) => (
              <li key={`trace:${String(index)}`} className={css.traceRow}>
                <span>{stage.stage}</span>
                {stage.count === undefined ? null : <span className={css.traceMeta}>{stage.count}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
          </>}
        </section>
        <section className={css.activity}>
          <h3 className={css.title}>{t('sectionWrites')}</h3>
          {write === undefined ? <p className={css.hint}>{t('emptyWrite')}</p> : <>
          <p className={css.hint}>{t(write.queued ? 'queued' : 'refused')}</p>
          <ul className={css.items}>
            {write.contents.map((content, index) => (
              <li key={`write:${String(index)}`} className={css.item}>{content}</li>
            ))}
          </ul>
          </>}
        </section>
    </>
  )
}
