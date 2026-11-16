/**
 * Memory plugin, browser half: one right-sidebar tab type rendering this
 * session's memory state — the last recall and the items it returned — plus a
 * header action that opens it.
 *
 * The recall view reads the `memoryAutosave` session projection. The library
 * and profile views read the Session's engine through `ctx.memoryPanel`; the
 * plugin binds those operations to the Session the tab is open in.
 * @module @deepseek-ai/dsh-client-ui-memory/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { bindPanelActions } from './actions.ts'
import { MemoryDock } from './MemoryDock.tsx'
import type { MemoryDockInjected } from './MemoryDock.tsx'
import { MemoryPanel } from './MemoryPanel.tsx'
import type { MemoryPanelInjected } from './MemoryPanel.tsx'
import { MemoryHeaderAction } from './MemoryHeaderAction.tsx'
import type { MemoryHeaderInjected } from './MemoryHeaderAction.tsx'
import { en, NS, zh, type MemoryKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-api-memory-controller/client'
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

export type { MemoryDockInjected, MemoryDockProps } from './MemoryDock.tsx'
export type { MemoryPanelInjected, MemoryPanelProps } from './MemoryPanel.tsx'
export type { MemoryPanelActions, PanelOutcome } from './actions.ts'
export type { MemoryHeaderActionProps, MemoryHeaderInjected } from './MemoryHeaderAction.tsx'

/** Required services: the sidebar tab registry and navigator, slots, dictionaries, and the panel Remote. */
export const inject = ['sidebarRightTabs', 'sidebarRight', 'slots', 'locale', 'memoryPanel']

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
  // Read the service now: injected faces run on caller stacks whose dynamic
  // context has not declared it.
  const panel = ctx.memoryPanel
  const sidebar = ctx.sidebarRight
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: TAB_ID,
      locale: NS,
      inject: (sessionId: SessionId): MemoryPanelInjected => ({ actions: bindPanelActions(panel, sessionId) }),
    },
    MemoryPanel,
  )), 'ui-memory: tab body')
  // The header slot belongs to ui-conversation and is declared after this
  // plugin may apply, so the registration waits on that declaration.
  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'memory-panel',
    order: 30,
    locale: NS,
    inject: (): MemoryHeaderInjected => ({
      open: () => { sidebar.openTab('memory') },
    }),
  }, MemoryHeaderAction)), 'ui-memory: header action')
  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'memory-mute',
    order: 20,
    locale: NS,
    inject: (sessionId: SessionId): MemoryDockInjected => ({
      setMuted: async muted => (await bindPanelActions(panel, sessionId).mute(muted)).kind === 'ok',
    }),
  }, MemoryDock)), 'ui-memory: input dock switch')
}

export { MemoryDock, MemoryPanel }

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** The memory tab reads the session it is opened in; it takes no parameters. */
    memory: undefined
  }
}
