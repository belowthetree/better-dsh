/**
 * Better-interact client plugin: the output bubble column that reports agent
 * work on the desktop, and the workbench dialog that hosts the conversation
 * without the shell's side panels.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type { ShortcutBinding, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { de, en, es, fr, ja, NS, pt, ru, zh } from './locales.ts'
import { WORKBENCH_MODAL_ID, workbenchResourceProvider } from './resource.ts'
import type { WorkbenchInjected } from './workbench.tsx'
import { WorkbenchConversation, WorkbenchDialog, WORKBENCH_MODAL_SIZE } from './workbench.tsx'
import { createWorkbenchTabsStore } from './workbench-tabs.ts'
import type { BubblesInjected } from './bubbles.tsx'
import { BubblesLayer, BubbleStack } from './bubbles.tsx'

/** Required services: the frame seat, the carrier, the command registry, and the Session catalog. */
export const inject = ['surface', 'slots', 'locale', 'shortcuts', 'resources', 'sessions']

/** Command id opening the workbench; it has a default binding and stays rebindable. */
export const WORKBENCH_COMMAND_ID = 'betterInteract.workbench'

/** Command id showing the next workbench card. */
export const WORKBENCH_NEXT_COMMAND_ID = 'betterInteract.workbench.next'

/** Command id showing the previous workbench card. */
export const WORKBENCH_PREVIOUS_COMMAND_ID = 'betterInteract.workbench.previous'

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
 * @param ctx - Client context carrying Slots, Sessions, resources, shortcuts, and the carrier.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'better-interact: copy')
  ctx.effect(() => ctx.resources.register(workbenchResourceProvider(ctx.sessions)), 'better-interact: workbench resource')
  const t = ctx.locale.bind(NS)
  const tabs = createWorkbenchTabsStore()
  const firstSession = (): SessionId | undefined => ctx.sessions.list.getSnapshot().ids[0]

  /**
   * Show a workbench, restoring the most recently used one when no Session is named.
   * @param sessionId - Session whose card the dialog should show.
   */
  const openWorkbench = (sessionId?: SessionId): void => {
    if (sessionId === undefined) tabs.ensure(firstSession())
    else tabs.select(sessionId)
    ctx.surface.presentModal(WORKBENCH_MODAL_ID, WORKBENCH_MODAL_SIZE).catch((error: unknown) => {
      console.error('better-interact: opening the workbench failed', error)
    })
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
      aliases: delta > 0 ? ['next workbench', 'next tab'] : ['previous workbench', 'previous tab'],
      defaults: {
        'desktop:windows': { code: 'Tab', modifiers },
        'desktop:macos': { code: 'Tab', modifiers },
      },
      regions: ['page'],
      modals: [WORKBENCH_MODAL_ID],
      resolve: context => context.modal === WORKBENCH_MODAL_ID
        ? { status: 'handled', run: () => { tabs.cycle(delta, firstSession()) } }
        : { status: 'pass' },
    }), `better-interact: ${id}`)
  }
  registerCycle(WORKBENCH_NEXT_COMMAND_ID, 'command.next', 1, ['control'])
  registerCycle(WORKBENCH_PREVIOUS_COMMAND_ID, 'command.previous', -1, ['control', 'shift'])

  const workbench: WorkbenchInjected = {
    hooks: { tabs: tabs.store },
    select: (sessionId) => { tabs.select(sessionId) },
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

  const fail = (step: string) => (error: unknown): void => {
    console.error(`better-interact: ${step} failed`, error)
  }
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

  // Cards follow the catalog: a Session that leaves it takes its card with it.
  ctx.effect(() => {
    const reconcile = (): void => {
      const state = ctx.sessions.list.getSnapshot()
      if (state.phase !== 'ready') return
      tabs.retain(new Set(state.ids))
    }
    const off = ctx.sessions.list.subscribe(reconcile)
    reconcile()
    return off
  }, 'better-interact: workbench cards follow the catalog')

  // New Session moves the main view; while the dialog is open that Session is a
  // new workbench, so the strip follows it instead of reopening a hidden blank.
  ctx.effect(() => {
    let last = mainViewSession(ctx.sessions.list.getSnapshot().byId)
    const reconcile = (): void => {
      const candidates = Object.values(ctx.sessions.list.getSnapshot().byId)
        .filter(row => (row.retainedBy.mainView ?? 0) > 0)
      const next = candidates.find(row => row.id !== last)?.id ?? candidates[0]?.id
      const changed = next !== last
      last = next
      if (!changed || next === undefined) return
      if (surface.getSnapshot().modal !== WORKBENCH_MODAL_ID) return
      tabs.select(next)
    }
    return ctx.sessions.list.subscribe(reconcile)
  }, 'better-interact: new workbench behind the dialog')

  const bubbles: BubblesInjected = {
    hooks: { surface },
    show: () => { ctx.surface.presentBubbles().catch(fail('presenting the bubble column')) },
    hide: () => { ctx.surface.dismissBubbles().catch(fail('dismissing the bubble column')) },
    open: (sessionId) => { openWorkbench(sessionId) },
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
