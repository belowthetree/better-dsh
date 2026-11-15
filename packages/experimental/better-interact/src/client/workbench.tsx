/** Workbench dialog hosting the shared conversation surface. */
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRenderFactories, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import { workbenchAddress } from './resource.ts'
import css from './Workbench.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Conversation occurrence hosted by the workbench dialog. */
    'better-interact.workbench.conversation': { kind: 'single'; scope: 'session' }
  }
}

/** Props of the `shell.modal` entry `better-interact.workbench`. */
export type WorkbenchDialogProps =
  & PropsRuntime<'shell.modal'>
  & PropsRenderSlots<'better-interact.workbench.conversation'>
  & PropsLocale<typeof NS>

/**
 * Render the current conversation inside the modal card, without the shell's side panels.
 * @param props - Session catalog, workbench resource hook, and the Conversation seat.
 * @returns the session-scoped Conversation, or its empty state.
 */
export function WorkbenchDialog({ useSessions, useResource, SessionProvider, renderSlot, t }: WorkbenchDialogProps) {
  const target = useSessions(state => state.ids[0])
  const address = workbenchAddress(target)
  const resource = useResource<'betterinteract'>(address)
  const reference = resource.value?.reference
  return <section className={css.root} data-better-interact-workbench="">
    {reference === undefined
      ? <p className={css.empty} data-better-interact-empty="">{t('workbench.empty')}</p>
      : <SessionProvider session={reference}>{renderSlot('better-interact.workbench.conversation', {})}</SessionProvider>}
  </section>
}

/** Chat view the workbench always shows, hiding the transcript's other Views. */
export function FixedWorkbenchView(props: ConversationViewsProps) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

/** Props of the session-scoped entry `better-interact.workbench.conversation`. */
export type WorkbenchConversationProps =
  & PropsRuntime<'better-interact.workbench.conversation'>
  & PropsRenderFactories

/**
 * Compose the shared Conversation content for the workbench's bound Session.
 * @param props - bound Session state, its Conversation state, and the Factory renderer.
 * @returns the conversation content rooted at the Chat view.
 */
export function WorkbenchConversation(
  { sessionId, useSession, useConversation, useSessions, renderFactorySlot }:WorkbenchConversationProps) {
  const session = useSession(value => value)
  const conversation = useConversation(value => value)
  const active = conversation.activeTargets.size > 0
    || (!session.blank && !session.awaitingFirstTurn)
    || session.running
  const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
  const summaryBlank = useSessions(state => state.byId[sessionId]?.blank)
  const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true
  const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
  const phase = settling ? 'settling' : hero ? 'hero' : 'active'
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, {
    slots: { views: FixedWorkbenchView },
  })
}
