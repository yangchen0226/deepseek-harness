/** Memory library view: everything the engine holds, searchable, with removal. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, IconSearchOutlineRegular, IconTrashOutlineRegular, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryListValue } from '@deepseek-ai/dsh-api-memory-controller/types'
import type { MemoryPanelActions, PanelOutcome } from './actions.ts'
import css from './MemoryPanel.module.css'

/** How long a search waits after the last keystroke. */
const SEARCH_DEBOUNCE_MS = 250

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
 * a two-press removal. The view re-reads after every removal instead of
 * dropping the row locally, so what it shows is always what the engine holds.
 * @param props - the panel operations and the dictionary.
 * @returns the library view.
 */
export function LibraryView({ actions, t }: LibraryViewProps) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<LibraryState>({ kind: 'loading' })
  const [armed, setArmed] = useState<string | undefined>(undefined)
  const [failedId, setFailedId] = useState<string | undefined>(undefined)
  const generation = useRef(0)

  const load = useCallback(async (filter: string) => {
    const mine = ++generation.current
    const outcome = await actions.list({ ...filter === '' ? {} : { query: filter }, limit: PAGE_SIZE })
    if (mine !== generation.current) return
    setState(toState(outcome))
  }, [actions])

  useEffect(() => {
    const timer = setTimeout(() => { void load(query.trim()) }, query === '' ? 0 : SEARCH_DEBOUNCE_MS)
    return () => { clearTimeout(timer) }
  }, [load, query])

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
    if (outcome.kind === 'ok') await load(query.trim())
    else setFailedId(id)
  }

  return (
    <section className={css.section}>
      <Input
        icon={<IconSearchOutlineRegular size={14} />}
        value={query}
        placeholder={t('searchPlaceholder')}
        aria-label={t('searchPlaceholder')}
        onChange={(event) => { setQuery(event.target.value) }}
      />
      {state.kind === 'loading' && <p className={css.hint} role="status">{t('loading')}</p>}
      {state.kind === 'unsupported' && <p className={css.hint} role="status">{t('libraryUnsupported')}</p>}
      {state.kind === 'failed' && (
        <div className={css.degraded} role="alert">
          <span>{t('loadFailed')}</span>
          <Button size="sm" variant="ghost" onClick={() => { void load(query.trim()) }}>{t('retry')}</Button>
        </div>
      )}
      {state.kind === 'ready' && state.value.degraded && <p className={css.degraded} role="alert">{t('degraded')}</p>}
      {state.kind === 'ready' && !state.value.degraded && (
        state.value.items.length === 0
          ? <p className={css.hint} role="status">{query.trim() === '' ? t('libraryEmpty') : t('noMatches')}</p>
          : (
            <>
              <p className={css.hint}>{t('libraryCount', { shown: state.value.items.length, total: state.value.total })}</p>
              <ul className={css.items}>
                {state.value.items.map(entry => (
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
                    <Button
                      size="sm"
                      variant={armed === entry.id ? 'outline' : 'ghost'}
                      aria-label={armed === entry.id ? t('forgetConfirm') : t('forget')}
                      onClick={() => { void onForget(entry.id) }}
                    >
                      {armed === entry.id ? t('forgetConfirm') : <IconTrashOutlineRegular size={14} />}
                    </Button>
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
