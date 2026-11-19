/** Shared viewing selection for the workspace memory page. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { MemoryScope } from '@deepseek-ai/dsh-memory'

type NavigationState = { scope: MemoryScope }
type NavigationActions = { select: (draft: NavigationState, scope: MemoryScope) => void }

/** Create the registration-owned collection selection.
 * @returns The page navigation store handle.
 */
export function createMemoryNavigation(): EngineStoreHandle<NavigationState, NavigationActions> {
  return defineStore({
    init: (): { scope: MemoryScope } => ({ scope: { kind: 'global' } }),
    actions: {
      select: (draft, scope: MemoryScope) => { draft.scope = scope },
    },
  })
}
