/** Collection browser independent of a live conversation. */
import { useEffect, useMemo, useState } from 'react'
import { Button, IconListPenOutlineRegular, Input, SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { MemoryActivityEntry, MemoryScope } from '@deepseek-ai/dsh-memory'
import type { MemoryPanelActions } from './actions.ts'
import type { createMemoryNavigation } from './navigation.ts'
import { LibraryView } from './LibraryView.tsx'
import { MemoryHealth } from './MemoryHealth.tsx'
import { MemoryTimeline } from './MemoryTimeline.tsx'
import { ProfileView } from './ProfileView.tsx'
import css from './MemoryPage.module.css'

/** Browser operations resolved for the selected collection. */
export interface MemoryPageInjected {
  readonly collection: (scope: MemoryScope) => MemoryPanelActions
  readonly save: (scope: MemoryScope, content: string) => Promise<'accepted' | 'failed' | 'unknown'>
  readonly global: boolean
  readonly activity: (scope: MemoryScope) => Promise<readonly MemoryActivityEntry[]>
}

/** Slot-derived page props. */
type PageProps = PropsRuntime<'main'> & PropsLocale<'memory'> & PropsStore<ReturnType<typeof createMemoryNavigation>> & InjectFace<MemoryPageInjected>

/** Render the selected collection's library and profile. */
export function MemoryPage({ t, useStore, collection, global, activity, save }: PageProps) {
  const selection = useStore(state => state.scope)
  const scope = useMemo<MemoryScope>(() => global ? { kind: 'global' } : selection, [global, selection])
  const actions = useMemo(() => collection(scope), [collection, scope])
  const [view, setView] = useState<'activity' | 'timeline' | 'library' | 'profile'>('activity')
  const [revision, setRevision] = useState(0)
  return <main className={css.page}>
    <header className={css.header}>
      <h1>{t(scope.kind === 'global' ? 'globalMemory' : 'workspaceMemory')}</h1>
      <p>{t(scope.kind === 'global' ? 'globalDescription' : 'workspaceDescription')}</p>
    </header>
    <MemoryHealth health={actions.health} t={t} />
    <MemoryComposer key={scope.kind === 'global' ? 'global' : scope.workspaceId} scope={scope} save={save} t={t} onSaved={() => { setRevision(value => value + 1) }} />
    <SegmentedTabs size="sm" label={t('viewsLabel')} value={view} onChange={setView} items={[
      { value: 'activity', label: t('viewRecall'), id: 'collection-activity-tab', panelId: 'collection-activity' },
      { value: 'timeline', label: t('viewTimeline'), id: 'collection-timeline-tab', panelId: 'collection-timeline' },
      { value: 'library', label: t('viewLibrary'), id: 'collection-library-tab', panelId: 'collection-library' },
      { value: 'profile', label: t('viewProfile'), id: 'collection-profile-tab', panelId: 'collection-profile' },
    ]} />
    <section className={css.content} key={`${scope.kind === 'global' ? 'global' : scope.workspaceId}:${revision}`}>
      {view === 'activity' ? <CollectionActivity scope={scope} activity={activity} t={t} /> : view === 'timeline' ? <MemoryTimeline scope={scope} activity={activity} t={t} /> : view === 'library' ? <LibraryView t={t} actions={actions} /> : <ProfileView t={t} actions={actions} workspace={scope.kind === 'workspace'} />}
    </section>
  </main>
}

/** Sidebar-owned global navigation glyph. */
export function MemoryNavigationIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconListPenOutlineRegular size={size} />
}

/** Workspace navigation callback bound at registration. */
export interface WorkspaceMemoryInjected {
  readonly open: (scope: MemoryScope) => void
}

/** Open memory for the workspace containing this row. */
export function WorkspaceMemoryLink({ workspaceId, open, t }: PropsRuntime<'sidebar.workspace.navigation'> & PropsLocale<'memory'> & InjectFace<WorkspaceMemoryInjected>) {
  return <button type="button" className={css.workspaceLink} onClick={() => { open({ kind: 'workspace', workspaceId }) }}>
    <IconListPenOutlineRegular size={16} /><span>{t('workspaceMemory')}</span>
  </button>
}

/** Read the durable audit index and render reads and writes separately. */
function CollectionActivity({ scope, activity, t }: Pick<MemoryPageInjected, 'activity'> & { scope: MemoryScope } & PropsLocale<'memory'>) {
  const [entries, setEntries] = useState<readonly MemoryActivityEntry[]>()
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setFailed(false)
    setEntries(undefined)
    void activity(scope).then(value => { if (active) setEntries(value) }, () => { if (active) setFailed(true) })
    return () => { active = false }
  }, [scope, activity, revision])
  if (failed) return <div role="alert">{t('loadFailed')}<Button size="sm" onClick={() => { setRevision(value => value + 1) }}>{t('retry')}</Button></div>
  if (entries === undefined) return <p role="status">{t('loading')}</p>
  return <div className={css.activities}><div><Button size="sm" variant="ghost" onClick={() => { setRevision(value => value + 1) }}>{t('refresh')}</Button><p>{t('acceptedHint')}</p></div>{(['recall', 'write'] as const).map(operation => {
    const rows = entries.filter(entry => entry.operation === operation)
    return <section key={operation}>
      <h2>{t(operation === 'recall' ? 'sectionRecall' : 'sectionWrites')}</h2>
      {rows.length === 0 ? <p>{t(operation === 'recall' ? 'emptyRecall' : 'emptyWrite')}</p> : rows.map(entry => <article key={entry.id}>
        <p><time dateTime={new Date(entry.time).toISOString()}>{new Date(entry.time).toLocaleString()}</time> · {t(entry.status === 'accepted' ? 'queued' : entry.status === 'unknown' ? 'writeUnknown' : entry.status === 'failed' ? 'refused' : 'activityCompleted')}</p>
        <p>{t(entry.origin === 'native' ? 'originNative' : entry.origin === 'manual' ? 'originManual' : 'originAutomatic')}</p>
        {entry.question === undefined ? null : <p>{t('question')}: {entry.question}</p>}
        {entry.contents.map((content, index) => <p key={index}>{content}</p>)}
      </article>)}
    </section>
  })}</div>
}

/** Human writes use the visible collection and retain the draft on failure. */
function MemoryComposer({ scope, save, t, onSaved }: Pick<MemoryPageInjected, 'save'> & { scope: MemoryScope; onSaved: () => void } & PropsLocale<'memory'>) {
  const [draft, setDraft] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'accepted' | 'failed' | 'unknown'>('idle')
  const submit = async () => {
    if (state === 'saving' || state === 'unknown' || draft.trim() === '') return
    setState('saving')
    let result: 'accepted' | 'failed' | 'unknown'
    try { result = await save(scope, draft.trim()) }
    catch (_submissionOutcomeUnavailable) { result = 'unknown' }
    setState(result)
    if (result === 'accepted') { setDraft(''); onSaved() }
  }
  return <div className={css.composer}>
    <label>{t(scope.kind === 'global' ? 'saveGlobalHint' : 'saveWorkspaceHint')}</label>
    <div className={css.composerRow}>
      <Input value={draft} maxLength={8192} aria-label={t('memoryContent')} placeholder={t('memoryContent')} disabled={state === 'saving' || state === 'unknown'} onChange={event => { setDraft(event.target.value); setState('idle') }} />
      <Button size="sm" disabled={draft.trim() === '' || state === 'saving' || state === 'unknown'} onClick={() => { void submit() }}>{t(state === 'saving' ? 'saving' : 'saveMemory')}</Button>
    </div>
    {state === 'accepted' ? <p role="status">{t('queued')}</p> : state === 'failed' || state === 'unknown' ? <p role="alert">{t(state === 'unknown' ? 'writeUnknown' : 'refused')}</p> : null}
  </div>
}

/** Render the model's memory intent independently of generic tool cards. */
export function NativeMemoryCall({ block, t }: PropsRuntime<'conversation.chat.message.extension'> & PropsLocale<'memory'>) {
  if (typeof block !== 'object' || block === null || !('operation' in block)) return null
  const operation = block.operation
  return <details className={css.nativeCall}>
    <summary>{t('originNative')} · {t(operation === 'write' ? 'sectionWrites' : operation === 'profile' ? 'viewProfile' : 'sectionRecall')}</summary>
    {'question' in block && typeof block.question === 'string' ? <p>{block.question}</p> : null}
    {'content' in block && typeof block.content === 'string' ? <p>{block.content}</p> : null}
  </details>
}
