/**
 * Collection timeline: every recorded memory operation in one collection, in
 * time order and grouped by day, so a reader can see when the engine learned
 * something instead of browsing an unordered library.
 *
 * The view reads the durable activity index through the page's bound
 * operations. It shows what the index recorded — origin, status, and text —
 * and never fills a gap with a guess: a failed or unknown write keeps its own
 * label rather than reading as a success.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryActivityEntry, MemoryScope } from '@deepseek-ai/dsh-memory'
import css from './MemoryTimeline.module.css'

/** Props the page supplies. */
export interface MemoryTimelineProps {
  /** The collection whose activity the timeline reads. */
  readonly scope: MemoryScope
  /** Read the collection's durable activity index, newest first. */
  readonly activity: (scope: MemoryScope) => Promise<readonly MemoryActivityEntry[]>
  /** The `memory` dictionary. */
  readonly t: PropsLocale<'memory'>['t']
}

/** One day's entries, in the order the index reported them. */
interface DayGroup {
  /** Local calendar day key, `YYYY-MM-DD`. */
  readonly day: string
  /** The day as the page renders it. */
  readonly label: string
  /** Entries recorded that day. */
  readonly entries: readonly MemoryActivityEntry[]
}

/** Group entries by local calendar day, preserving newest-first order. */
function groupByDay(entries: readonly MemoryActivityEntry[], locale: string | undefined): DayGroup[] {
  const groups = new Map<string, MemoryActivityEntry[]>()
  for (const entry of entries) {
    const date = new Date(entry.time)
    const day = `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const existing = groups.get(day)
    if (existing === undefined) groups.set(day, [entry])
    else existing.push(entry)
  }
  return [...groups].map(([day, dayEntries]) => ({
    day,
    label: new Date(dayEntries[0]?.time ?? Date.now()).toLocaleDateString(locale),
    entries: dayEntries,
  }))
}

/**
 * Render the collection timeline.
 * @param props - the collection, its activity reader, and the dictionary.
 * @returns the timeline, or its own failure and empty states.
 */
export function MemoryTimeline({ scope, activity, t }: MemoryTimelineProps) {
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

  const groups = useMemo(() => entries === undefined ? [] : groupByDay(entries, undefined), [entries])

  if (failed) {
    return <div className={css.state} role="alert">
      <span>{t('timelineFailed')}</span>
      <Button size="sm" onClick={() => { setRevision(value => value + 1) }}>{t('retry')}</Button>
    </div>
  }
  if (entries === undefined) return <p className={css.state} role="status">{t('loading')}</p>
  if (entries.length === 0) return <p className={css.state}>{t('timelineEmpty')}</p>

  return <div className={css.timeline}>
    <div className={css.toolbar}>
      <Button size="sm" variant="ghost" onClick={() => { setRevision(value => value + 1) }}>{t('refresh')}</Button>
    </div>
    {groups.map(group => <section key={group.day} className={css.group}>
      <h2 className={css.day}>{group.label}</h2>
      <ol className={css.entries}>
        {group.entries.map(entry => <li key={entry.id} className={css.entry} data-operation={entry.operation} data-status={entry.status}>
          <div className={css.meta}>
            <time dateTime={new Date(entry.time).toISOString()}>{new Date(entry.time).toLocaleTimeString()}</time>
            <span>{t(entry.operation === 'recall' ? 'timelineRecall' : 'timelineWrite')}</span>
            <span className={css.status}>{t(entry.status === 'accepted' ? 'queued' : entry.status === 'unknown' ? 'writeUnknown' : entry.status === 'failed' ? 'refused' : 'activityCompleted')}</span>
            <span className={css.muted}>{t(entry.origin === 'native' ? 'originNative' : entry.origin === 'manual' ? 'originManual' : 'originAutomatic')}</span>
          </div>
          {entry.question === undefined ? null : <p className={css.question}>{entry.question}</p>}
          {entry.contents.length === 0 ? null : <ul className={css.contents}>
            {entry.contents.map((content, index) => <li key={index}>{content}</li>)}
          </ul>}
        </li>)}
      </ol>
    </section>)}
  </div>
}
