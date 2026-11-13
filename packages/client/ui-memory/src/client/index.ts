/**
 * Memory plugin, browser half: one right-sidebar tab type rendering this
 * session's memory state — the last recall and the items it returned — plus a
 * header action that opens it.
 *
 * All state comes from the `memoryAutosave` session projection; the plugin
 * holds no transport state and makes no memory calls of its own.
 * @module @deepseek-ai/dsh-client-ui-memory/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { MemoryPanel } from './MemoryPanel.tsx'
import { MemoryHeaderAction } from './MemoryHeaderAction.tsx'
import type { MemoryHeaderInjected } from './MemoryHeaderAction.tsx'
import { en, NS, zh, type MemoryKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Memory panel copy. */
    memory: MemoryKey
  }
}

export type { MemoryPanelProps } from './MemoryPanel.tsx'
export type { MemoryHeaderActionProps, MemoryHeaderInjected } from './MemoryHeaderAction.tsx'

/** Required services: the sidebar tab registry, slots, and dictionaries. */
export const inject = ['sidebarRightTabs', 'slots', 'locale']

/** Stable identity of the tab type and its body registration. */
const TAB_ID = 'memory-panel'

/**
 * Client plugin body: register the dictionaries, the tab type, its body, and
 * the header action that opens it.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-memory: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: 'memory',
    title: () => t('tabTitle'),
    guide: [{
      id: 'memory',
      order: 40,
      title: () => t('guideTitle'),
      description: () => t('guideDescription'),
    }],
  }), 'ui-memory: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS },
    MemoryPanel,
  )), 'ui-memory: tab body')
  ctx.effect(() => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'memory-panel',
    order: 30,
    locale: NS,
    inject: (): MemoryHeaderInjected => ({
      open: () => { ctx.sidebarRight.openTab('memory') },
    }),
  }, MemoryHeaderAction), 'ui-memory: header action')
}

export { MemoryPanel }

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** The memory tab reads the session it is opened in; it takes no parameters. */
    memory: undefined
  }
}
