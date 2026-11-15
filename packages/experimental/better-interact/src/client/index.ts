/**
 * Better-interact client plugin: the output bubble column that reports agent
 * work on the desktop, and the workbench dialog that hosts the conversation
 * without the shell's side panels.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { de, en, es, fr, ja, NS, pt, ru, zh } from './locales.ts'
import { WORKBENCH_MODAL_ID, workbenchResourceProvider } from './resource.ts'
import { WorkbenchConversation, WorkbenchDialog, WORKBENCH_MODAL_SIZE } from './workbench.tsx'
import type { BubblesInjected } from './bubbles.tsx'
import { BubblesLayer, BubbleStack } from './bubbles.tsx'

/** Required services: the frame seat, the carrier, the command registry, and the Session catalog. */
export const inject = ['surface', 'slots', 'locale', 'shortcuts', 'resources', 'sessions']

/** Command id opening the workbench; it has a default binding and stays rebindable. */
export const WORKBENCH_COMMAND_ID = 'betterInteract.workbench'

/**
 * Mount the workbench dialog, its Session resource, and the launcher command.
 * @param ctx - Client context carrying Slots, Sessions, resources, shortcuts, and the carrier.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'better-interact: copy')
  ctx.effect(() => ctx.resources.register(workbenchResourceProvider(ctx.sessions)), 'better-interact: workbench resource')
  const t = ctx.locale.bind(NS)

  const openWorkbench = (): void => {
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
    resolve: () => ({ status: 'handled', run: openWorkbench }),
  }), 'better-interact: workbench command')

  ctx.effect(() => ctx.slots.inject('shell.modal', () => ctx.slots.register({
    name: 'shell.modal',
    id: WORKBENCH_MODAL_ID,
    locale: NS,
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
  const bubbles: BubblesInjected = {
    hooks: { surface },
    show: () => { ctx.surface.presentBubbles().catch(fail('presenting the bubble column')) },
    hide: () => { ctx.surface.dismissBubbles().catch(fail('dismissing the bubble column')) },
    open: () => { ctx.surface.presentModal(WORKBENCH_MODAL_ID, WORKBENCH_MODAL_SIZE).catch(fail('opening the workbench')) },
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
