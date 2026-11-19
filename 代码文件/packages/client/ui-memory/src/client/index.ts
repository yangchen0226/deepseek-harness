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
import type { MemoryPageInjected, WorkspaceMemoryInjected } from './MemoryPage.tsx'
import { MemoryPage, MemoryNavigationIcon, WorkspaceMemoryLink, NativeMemoryCall } from './MemoryPage.tsx'
import { createMemoryNavigation } from './navigation.ts'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { bindScopeActions, bindPanelActions } from './actions.ts'
import { MemoryDock } from './MemoryDock.tsx'
import type { MemoryDockInjected } from './MemoryDock.tsx'
import { MemoryPanel } from './MemoryPanel.tsx'
import type { MemoryPanelInjected } from './MemoryPanel.tsx'
import { MemoryHeaderAction } from './MemoryHeaderAction.tsx'
import type { MemoryHeaderInjected } from './MemoryHeaderAction.tsx'
import { RecallChip } from './RecallChip.tsx'
import type { RecallChipInjected } from './RecallChip.tsx'
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
export const inject = ['sidebarRightTabs', 'sidebarRight', 'slots', 'locale', 'memoryPanel', 'layout']

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
  ctx.effect(() => ctx.slots.inject('conversation.chat.message.extension', () => ctx.slots.register({
    name: 'conversation.chat.message.extension', key: 'memory-call', locale: NS,
  }, NativeMemoryCall)), 'ui-memory: native call presentation')
  const panel = ctx.memoryPanel
  const activity: MemoryPageInjected['activity'] = async scope => {
    const result = await panel.activity({ scope })
    if (!result.ok) throw new Error(result.error.message)
    return result.value.entries
  }
  const save: MemoryPageInjected['save'] = async (scope, content) => {
    const result = await panel.save({ scope, content })
    return result.ok ? result.value.status : 'unknown'
  }
  const globalId = 'global-memory' as MainPanelId
  const workspaceId = 'workspace-memory' as MainPanelId
  const layout = ctx.layout
  const navigation = createMemoryNavigation()
  const instance = navigation.create()
  const store: typeof navigation = { ...navigation, create: () => instance }
  ctx.effect(() => ctx.slots.inject('main', function* () {
    yield ctx.slots.register({ name: 'main', key: globalId, locale: NS, store,
      inject: (): MemoryPageInjected => ({ global: true, activity, save, collection: (scope) => bindScopeActions(panel, scope) }),
    }, MemoryPage)
    yield ctx.slots.register({ name: 'main', key: workspaceId, locale: NS, store,
      inject: (): MemoryPageInjected => ({ global: false, activity, save, collection: (scope) => bindScopeActions(panel, scope) }),
    }, MemoryPage)
  }), 'ui-memory: collection pages')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: globalId, order: 20, locale: NS, label: () => t('globalMemory'),
  }, MemoryNavigationIcon)), 'ui-memory: global navigation')
  ctx.effect(() => ctx.slots.inject('sidebar.workspace.navigation', () => ctx.slots.register({
    name: 'sidebar.workspace.navigation', id: 'memory', locale: NS,
    inject: (): WorkspaceMemoryInjected => ({ open: (scope) => { instance.actions.select(scope); layout.selectPanel(workspaceId) } }),
  }, WorkspaceMemoryLink)), 'ui-memory: workspace navigation')
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
  ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: 'memory-recall-chip',
    order: 30,
    locale: NS,
    inject: (sessionId: SessionId): RecallChipInjected => ({
      setMuted: async muted => (await bindPanelActions(panel, sessionId).mute(muted)).kind === 'ok',
      openPanel: () => { sidebar.openTab('memory') },
    }),
  }, RecallChip)), 'ui-memory: recall chip')
}

export { MemoryDock, MemoryPanel }

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** The memory tab reads the session it is opened in; it takes no parameters. */
    memory: undefined
  }
}
