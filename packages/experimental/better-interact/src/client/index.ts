/**
 * Better-interact client plugin: the workbench dialog that hosts the current
 * conversation without the shell's side panels, plus its launcher command.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type {} from '@deepseek-ai/dsh-client-surface/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { de, en, es, fr, ja, NS, pt, ru, zh } from './locales.ts'
import { WORKBENCH_MODAL_ID, workbenchResourceProvider } from './resource.ts'
import { WorkbenchConversation, WorkbenchDialog } from './workbench.tsx'

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
    ctx.surface.presentModal(WORKBENCH_MODAL_ID).catch((error: unknown) => {
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
}
