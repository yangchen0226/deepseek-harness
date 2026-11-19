/** Memory library view: everything the engine holds, searchable, with removal. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, IconSearchOutlineRegular, IconTrashOutlineRegular, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryListValue } from '@deepseek-ai/dsh-api-memory-controller/types'
import type { MemoryPanelActions, PanelOutcome } from './actions.ts'
import css from './MemoryPanel.module.css'

/** How long an armed removal waits for its confirming press. */
const FORGET_ARM_MS = 3_000

/** Entries one page asks for. */
const PAGE_SIZE = 50

/** What the library currently shows. */
type LibraryState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: MemoryListValue }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'failed'; readonly message: string }

/** Props for {@link LibraryView}. */
export interface LibraryViewProps {
  /** Session-bound panel operations. */
  readonly actions: MemoryPanelActions
  /** The `memory` dictionary. */
  readonly t: TranslateNS<'memory'>
}

/**
 * List the user's stored memories, newest first, with a substring search and
 * an opt-in two-press removal. The view re-reads after every removal instead
 * of dropping the row locally, so what it shows is always what the engine
 * holds. Providers must advertise removal support before this view renders a
 * destructive control.
 * @param props - the panel operations and the dictionary.
 * @returns the library view.
 */
export function LibraryView({ actions, t }: LibraryViewProps) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [state, setState] = useState<LibraryState>({ kind: 'loading' })
  const [armed, setArmed] = useState<string | undefined>(undefined)
  const [failedId, setFailedId] = useState<string | undefined>(undefined)
  const generation = useRef(0)

  const load = useCallback(async () => {
    const mine = ++generation.current
    const outcome = await actions.list({ limit: PAGE_SIZE, page })
    if (mine !== generation.current) return
    const next = toState(outcome)
    setState(next)
  }, [actions, page])

  useEffect(() => {
    void load()
    return () => { generation.current++ }
  }, [load])

  useEffect(() => {
    if (armed === undefined) return
    const timer = setTimeout(() => { setArmed(undefined) }, FORGET_ARM_MS)
    return () => { clearTimeout(timer) }
  }, [armed])

  const onForget = async (id: string) => {
    if (armed !== id) {
      setArmed(id)
      setFailedId(undefined)
      return
    }
    setArmed(undefined)
    const outcome = await actions.forget(id)
    if (outcome.kind === 'ok') await load()
    else setFailedId(id)
  }

  const visibleItems = state.kind === 'ready' ? state.value.items.filter(entry => entry.content.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : []

  return (
    <section className={css.section}>
      <Input
        icon={<IconSearchOutlineRegular size={14} />}
        value={query}
        placeholder={t('searchPlaceholder')}
        aria-label={t('searchPlaceholder')}
        onChange={(event) => { setQuery(event.target.value) }}
      />
      <p className={css.hint}>{t('pageSearchHint')}</p>
      <div className={css.entryMeta}>
        <Button size="sm" variant="ghost" onClick={() => { void load() }}>{t('refresh')}</Button>
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => { setPage(value => value - 1) }}>{t('previousPage')}</Button>
        <span>{t('pageNumber', { page })}</span>
        <Button size="sm" variant="ghost" disabled={state.kind !== 'ready' || page * PAGE_SIZE >= state.value.total} onClick={() => { setPage(value => value + 1) }}>{t('nextPage')}</Button>
      </div>
      {state.kind === 'loading' && <p className={css.hint} role="status">{t('loading')}</p>}
      {state.kind === 'unsupported' && <p className={css.hint} role="status">{t('libraryUnsupported')}</p>}
      {state.kind === 'failed' && (
        <div className={css.degraded} role="alert">
          <span>{t('loadFailed')}</span>
          <Button size="sm" variant="ghost" onClick={() => { void load() }}>{t('retry')}</Button>
        </div>
      )}
      {state.kind === 'ready' && state.value.degraded && <p className={css.degraded} role="alert">{t('degraded')}</p>}
      {state.kind === 'ready' && !state.value.degraded && (
        visibleItems.length === 0
          ? <p className={css.hint} role="status">{query.trim() === '' ? t('libraryEmpty') : t('noMatches')}</p>
          : (
            <>
              <p className={css.hint}>{t('libraryCount', { shown: visibleItems.length, total: state.value.total })}</p>
              <ul className={css.items}>
                {visibleItems.map(entry => (
                  <li key={entry.id} className={css.entry}>
                    <div className={css.entryBody}>
                      <span className={css.entryText}>{entry.content}</span>
                      <span className={css.entryMeta}>
                        <Tag>{entry.kind}</Tag>
                        {entry.createdAt === undefined ? null : <span>{entry.createdAt.slice(0, 10)}</span>}
                        {entry.hits === undefined || entry.hits === 0 ? null : <span>{t('hits', { count: entry.hits })}</span>}
                        {failedId === entry.id ? <span className={css.entryError}>{t('forgetFailed')}</span> : null}
                      </span>
                    </div>
                    {state.value.canForget && (
                      <Button
                        size="sm"
                        variant={armed === entry.id ? 'outline' : 'ghost'}
                        aria-label={armed === entry.id ? t('forgetConfirm') : t('forget')}
                        onClick={() => { void onForget(entry.id) }}
                      >
                        {armed === entry.id ? t('forgetConfirm') : <IconTrashOutlineRegular size={14} />}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )
      )}
    </section>
  )
}

/**
 * Map one list outcome to the view state.
 * @param outcome - the panel operation's result.
 * @returns the state to render.
 */
function toState(outcome: PanelOutcome<MemoryListValue>): LibraryState {
  if (outcome.kind === 'ok') return { kind: 'ready', value: outcome.value }
  if (outcome.kind === 'unsupported') return { kind: 'unsupported' }
  return { kind: 'failed', message: outcome.message }
}
