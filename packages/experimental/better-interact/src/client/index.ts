/**
 * Better-interact client plugin: the output bubble column that reports agent
 * work on the desktop, and the workbench dialog that hosts one page per
 * Workspace without the shell's side panels.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type { ShortcutBinding, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { de, en, es, fr, ja, NS, pt, ru, zh } from './locales.ts'
import { WORKBENCH_MODAL_ID, workbenchResourceProvider } from './resource.ts'
import type { WorkbenchHints, WorkbenchInjected, WorkbenchNotice } from './workbench.tsx'
import { WorkbenchConversation, WorkbenchDialog, WORKBENCH_MODAL_SIZE } from './workbench.tsx'
import { createWorkbenchPagesStore } from './workbench-pages.ts'
import type { BubblesInjected } from './bubbles.tsx'
import { BubblesLayer, BubbleStack } from './bubbles.tsx'

/** Required services: the frame seat, the carrier, the catalogs, and Workspace navigation. */
export const inject = [
  'surface', 'slots', 'locale', 'shortcuts', 'resources', 'sessions', 'workspaces', 'uiWorkspace',
]

/** Command id opening the workbench; it has a default binding and stays rebindable. */
export const WORKBENCH_COMMAND_ID = 'betterInteract.workbench'

/** Command id showing the next Workspace page. */
export const WORKBENCH_NEXT_COMMAND_ID = 'betterInteract.workbench.next'

/** Command id showing the previous Workspace page. */
export const WORKBENCH_PREVIOUS_COMMAND_ID = 'betterInteract.workbench.previous'

/** Command id creating a Workspace from a Host-picked directory. */
export const WORKBENCH_NEW_WORKSPACE_COMMAND_ID = 'betterInteract.workspace.new'

/** Command id moving keyboard focus to the active Session bookmark. */
export const WORKBENCH_SESSIONS_COMMAND_ID = 'betterInteract.workbench.sessions'

/**
 * Session the main view retains, if any.
 * @param byId - current Session catalog rows.
 * @returns the main view's Session, or undefined while it holds none.
 */
function mainViewSession(byId: Readonly<Record<SessionId, SessionSummary>>): SessionId | undefined {
  return Object.values(byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id
}

/**
 * Mount the workbench dialog, its Session resource, and the launcher commands.
 * @param ctx - Client context carrying Slots, catalogs, resources, shortcuts, and the carrier.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'better-interact: copy')
  ctx.effect(() => ctx.resources.register(workbenchResourceProvider(ctx.sessions)), 'better-interact: workbench resource')
  const t = ctx.locale.bind(NS)
  const navigation: UiWorkspace = ctx.uiWorkspace
  const fail = (step: string) => (error: unknown): void => {
    console.error(`better-interact: ${step} failed`, error)
  }
  const pages = createWorkbenchPagesStore()
  const notice = createSnapshotStore<WorkbenchNotice | null>(null)
  const focus = createSnapshotStore(0)
  const workspaces = (): readonly WorkspaceView[] => ctx.workspaces.list.getSnapshot().items
  const workspaceOf = (sessionId: SessionId): WorkspaceView | undefined =>
    workspaces().find(item => item.sessionIds.includes(sessionId))

  /** Session a Workspace page shows: its recorded Session, else its newest. */
  const sessionOf = (workspace: WorkspaceView): SessionId | undefined => {
    const byId = ctx.sessions.list.getSnapshot().byId
    const mapped = pages.store.getSnapshot().sessions[workspace.workspaceId]
    if (mapped !== undefined && workspace.sessionIds.includes(mapped) && byId[mapped] !== undefined) return mapped
    let newest: SessionId | undefined
    for (const sessionId of workspace.sessionIds) {
      const row = byId[sessionId]
      if (row === undefined) continue
      if (newest === undefined || row.updatedAt > (byId[newest]?.updatedAt ?? 0)) newest = sessionId
    }
    return newest
  }

  /** Show one Workspace page, opening its Session or connecting its blank. */
  const showPage = (workspaceId: WorkspaceId): void => {
    const workspace = workspaces().find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) return
    notice.set(null)
    pages.select(workspaceId)
    const sessionId = sessionOf(workspace)
    if (sessionId === undefined) {
      void navigation.openWorkspace(workspaceId).catch(fail('opening the workspace page'))
      return
    }
    pages.setSession(workspaceId, sessionId)
    navigation.openSession(sessionId)
  }

  /** Workspace the launcher falls back to: the main view's, else the most recently updated. */
  const recentWorkspace = (): WorkspaceId | undefined => {
    const current = mainViewSession(ctx.sessions.list.getSnapshot().byId)
    if (current !== undefined) {
      const workspace = workspaceOf(current)
      if (workspace !== undefined) return workspace.workspaceId
    }
    let newest: WorkspaceView | undefined
    for (const workspace of workspaces()) {
      if (workspace.sessionIds.length === 0) continue
      if (newest === undefined || workspace.updatedAt > newest.updatedAt) newest = workspace
    }
    return (newest ?? workspaces()[0])?.workspaceId
  }

  /** Present the workbench dialog through the carrier. */
  const presentWorkbench = (): void => {
    ctx.surface.presentModal(WORKBENCH_MODAL_ID, WORKBENCH_MODAL_SIZE).catch((error: unknown) => {
      console.error('better-interact: opening the workbench failed', error)
    })
  }

  /** Open the dialog on the most recently used Workspace page. */
  const openWorkbench = (): void => {
    notice.set(null)
    const ordered = workspaces().map(item => item.workspaceId)
    const chosen = pages.ensure(ordered, recentWorkspace())
    if (chosen !== undefined) showPage(chosen)
    presentWorkbench()
  }

  /** Open the dialog on the Workspace page holding one Session. */
  const showSession = (sessionId: SessionId): void => {
    notice.set(null)
    const workspace = workspaceOf(sessionId)
    if (workspace !== undefined) {
      pages.select(workspace.workspaceId)
      pages.setSession(workspace.workspaceId, sessionId)
      navigation.openSession(sessionId)
    }
    presentWorkbench()
  }

  /** Pick a directory on the Host and open it as a Workspace page. */
  const createFromDirectory = async (): Promise<void> => {
    notice.set(null)
    let path: string | null
    try {
      path = await navigation.pickDirectory()
    } catch (error) {
      fail('picking the workspace directory')(error)
      notice.set('workbench.createFailed')
      presentWorkbench()
      return
    }
    if (path === null) return
    let workspace: WorkspaceView
    try {
      workspace = await ctx.workspaces.create({ path })
    } catch (error) {
      fail('creating the workspace')(error)
      notice.set('workbench.createFailed')
      presentWorkbench()
      return
    }
    pages.select(workspace.workspaceId)
    try {
      await navigation.openWorkspace(workspace.workspaceId)
    } catch (error) {
      fail('opening the workspace page')(error)
      notice.set('workbench.createFailed')
    }
    presentWorkbench()
  }

  /** Cycle the Workspace pages while the dialog is open. */
  const cyclePages = (delta: 1 | -1): void => {
    const next = pages.cycle(workspaces().map(item => item.workspaceId), delta)
    if (next !== undefined) showPage(next)
  }

  ctx.effect(() => ctx.shortcuts.register({
    id: WORKBENCH_COMMAND_ID as ShortcutCommandId,
    label: () => t('command.open'),
    // Searchable terms, not rendered copy: the localized label above is what the settings list shows.
    aliases: ['workbench', 'interact', 'chat', 'conversation'],
    defaults: {
      'desktop:windows': { code: 'KeyW', modifiers: ['control', 'alt'] },
      'desktop:macos': { code: 'KeyW', modifiers: ['control', 'alt'] },
    },
    regions: ['page'],
    modals: [WORKBENCH_MODAL_ID],
    scope: 'system',
    resolve: () => ({ status: 'handled', run: () => { openWorkbench() } }),
  }), 'better-interact: workbench command')

  const registerCycle = (id: string, label: 'command.next' | 'command.previous', delta: 1 | -1,
    modifiers: ShortcutBinding['modifiers']): void => {
    ctx.effect(() => ctx.shortcuts.register({
      id: id as ShortcutCommandId,
      label: () => t(label),
      aliases: delta > 0 ? ['next workbench', 'next workspace'] : ['previous workbench', 'previous workspace'],
      defaults: {
        'desktop:windows': { code: 'Tab', modifiers },
        'desktop:macos': { code: 'Tab', modifiers },
      },
      regions: ['page'],
      modals: [WORKBENCH_MODAL_ID],
      resolve: context => context.modal === WORKBENCH_MODAL_ID
        ? { status: 'handled', run: () => { cyclePages(delta) } }
        : { status: 'pass' },
    }), `better-interact: ${id}`)
  }
  registerCycle(WORKBENCH_NEXT_COMMAND_ID, 'command.next', 1, ['control'])
  registerCycle(WORKBENCH_PREVIOUS_COMMAND_ID, 'command.previous', -1, ['control', 'shift'])

  ctx.effect(() => ctx.shortcuts.register({
    id: WORKBENCH_NEW_WORKSPACE_COMMAND_ID as ShortcutCommandId,
    label: () => t('command.newWorkspace'),
    aliases: ['new workspace', 'open folder', 'create workspace'],
    defaults: {
      'desktop:windows': { code: 'KeyN', modifiers: ['control', 'alt'] },
      'desktop:macos': { code: 'KeyN', modifiers: ['control', 'alt'] },
    },
    regions: ['page'],
    modals: [WORKBENCH_MODAL_ID],
    scope: 'system',
    resolve: () => ({ status: 'handled', run: () => { void createFromDirectory() } }),
  }), 'better-interact: new workspace command')

  ctx.effect(() => ctx.shortcuts.register({
    id: WORKBENCH_SESSIONS_COMMAND_ID as ShortcutCommandId,
    label: () => t('command.sessions'),
    aliases: ['focus sessions', 'session tabs', 'sessions'],
    defaults: {
      'desktop:windows': { code: 'KeyQ', modifiers: ['control'] },
      'desktop:macos': { code: 'KeyQ', modifiers: ['control'] },
    },
    regions: ['page', 'editable'],
    modals: [WORKBENCH_MODAL_ID],
    resolve: context => context.modal === WORKBENCH_MODAL_ID
      ? { status: 'handled', run: () => { focus.set(focus.getSnapshot() + 1) } }
      : { status: 'pass' },
  }), 'better-interact: session focus command')

  const hints = createSnapshotStore<WorkbenchHints>({ sessions: [], pageNext: [], pagePrevious: [] })
  const refreshHints = (): void => {
    const rows = ctx.shortcuts.catalog.getSnapshot()
    const keys = (id: string): readonly string[] => rows.find(row => row.id === id)?.keys ?? []
    hints.set({
      sessions: keys(WORKBENCH_SESSIONS_COMMAND_ID),
      pageNext: keys(WORKBENCH_NEXT_COMMAND_ID),
      pagePrevious: keys(WORKBENCH_PREVIOUS_COMMAND_ID),
    })
  }
  ctx.effect(() => {
    refreshHints()
    return ctx.shortcuts.catalog.subscribe(refreshHints)
  }, 'better-interact: shortcut hints')

  const workbench: WorkbenchInjected = {
    hooks: { pages: pages.store, notice, focus, hints },
    select: (workspaceId) => { showPage(workspaceId) },
    selectSession: (sessionId) => { showSession(sessionId) },
  }
  ctx.effect(() => ctx.slots.inject('shell.modal', () => ctx.slots.register({
    name: 'shell.modal',
    id: WORKBENCH_MODAL_ID,
    locale: NS,
    inject: () => workbench,
    children: { 'better-interact.workbench.conversation': { kind: 'single', scope: 'session' } },
  }, WorkbenchDialog)), 'better-interact: workbench dialog')

  ctx.effect(() => ctx.slots.inject('better-interact.workbench.conversation', () => ctx.slots.register({
    name: 'better-interact.workbench.conversation',
  }, WorkbenchConversation)), 'better-interact: workbench conversation')

  const surface = createSnapshotStore<SurfaceSnapshot>(ctx.surface.snapshot())
  ctx.effect(() => {
    const lifetime = new AbortController()
    void (async (): Promise<void> => {
      try {
        for await (const snapshot of ctx.surface.follow(lifetime.signal)) surface.set(snapshot)
      } catch (error) {
        // Aborting ends the iteration without throwing; anything else is a defect worth reporting.
        fail('observing the carrier')(error)
      }
    })()
    return () => { lifetime.abort() }
  }, 'better-interact: surface observation')

  // Pages follow the catalogs: a Workspace or Session that leaves takes its page
  // and its recorded Session with it.
  ctx.effect(() => {
    const reconcile = (): void => {
      pages.retain(
        new Set(workspaces().map(item => item.workspaceId)),
        new Set(ctx.sessions.list.getSnapshot().ids),
      )
    }
    const offWorkspaces = ctx.workspaces.list.subscribe(reconcile)
    const offSessions = ctx.sessions.list.subscribe(reconcile)
    reconcile()
    return () => {
      offWorkspaces()
      offSessions()
    }
  }, 'better-interact: workbench pages follow the catalogs')

  // The page records the main view's Session; while the dialog is open a change
  // in the Workspace (New Session, a bubble, a navigation) selects its page.
  ctx.effect(() => {
    const reconcile = (): void => {
      const current = mainViewSession(ctx.sessions.list.getSnapshot().byId)
      if (current === undefined) return
      const workspace = workspaceOf(current)
      if (workspace === undefined) return
      pages.setSession(workspace.workspaceId, current)
      if (surface.getSnapshot().modal !== WORKBENCH_MODAL_ID) return
      if (pages.store.getSnapshot().active !== workspace.workspaceId) pages.select(workspace.workspaceId)
    }
    const offSessions = ctx.sessions.list.subscribe(reconcile)
    const offWorkspaces = ctx.workspaces.list.subscribe(reconcile)
    return () => {
      offSessions()
      offWorkspaces()
    }
  }, 'better-interact: Workspace page follows the main view')

  const bubbles: BubblesInjected = {
    hooks: { surface },
    show: () => { ctx.surface.presentBubbles().catch(fail('presenting the bubble column')) },
    hide: () => { ctx.surface.dismissBubbles().catch(fail('dismissing the bubble column')) },
    open: (sessionId) => { showSession(sessionId) },
    pointerInside: (inside) => { ctx.surface.setPointerInside(inside) },
  }

  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'better-interact.bubbles',
    locale: NS,
    inject: () => bubbles,
    children: { 'better-interact.bubbles.stack': { kind: 'single', scope: 'session' } },
  }, BubblesLayer)), 'better-interact: bubble column')

  ctx.effect(() => ctx.slots.inject('better-interact.bubbles.stack', () => ctx.slots.register({
    name: 'better-interact.bubbles.stack',
    locale: NS,
    inject: () => bubbles,
  }, BubbleStack)), 'better-interact: bubble stack')
}
