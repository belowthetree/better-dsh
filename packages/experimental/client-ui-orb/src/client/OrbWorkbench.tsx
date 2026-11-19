/**
 * Dedicated workbench of the orb form: the management conversation of the
 * 大肥鱼 preset in a full-width card, without the Workspace pages and Session
 * bookmarks the general workbench hosts. The orb's quick prompt opens it after
 * accepting a prompt so the answer has a visible surface; the same card reopens
 * from the orb menu.
 */
import type { ModalSizeHint } from '@deepseek-ai/dsh-client-surface/client'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRenderFactories, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { NS } from './locales.ts'
import css from './OrbWorkbench.module.css'

/** Registered `shell.modal` entry id of the management workbench. */
export const ORB_WORKBENCH_MODAL_ID = 'orb.workbench'

/** Management workbench size: the shared wide card at most of the work-area height. */
export const ORB_WORKBENCH_MODAL_SIZE: ModalSizeHint = { heightRatio: 0.8, width: 1488 }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Conversation occurrence hosted by the management workbench. */
    'orb.workbench.conversation': { kind: 'single'; scope: 'session' }
  }
}

/** Injected face of the `shell.modal` entry `orb.workbench`. */
export interface OrbWorkbenchInjected {
  hooks: {
    /** Retained management conversation; null until the plugin resolves it. */
    reference: HostObservable<SessionReference | null>
  }
}

/** Props of the `shell.modal` entry `orb.workbench`. */
export type OrbWorkbenchProps =
  & PropsRuntime<'shell.modal'>
  & PropsRenderSlots<'orb.workbench.conversation'>
  & PropsLocale<typeof NS>
  & InjectFace<OrbWorkbenchInjected>

/**
 * Render the management workbench: one card holding only the bound Session's
 * conversation.
 * @param props - the retained management reference and the frame's slot and Session seats.
 * @returns the workbench card, or nothing until the plugin retains the conversation.
 */
export function OrbWorkbench(props: OrbWorkbenchProps) {
  const reference = props.useReference(value => value)
  if (reference === null) return null
  const { SessionProvider, renderSlot } = props
  return <section className={css.root} data-orb-workbench="" data-shell-modal-fill=""
    data-shell-modal-surface="bare" data-shell-modal-wide="">
    <div className={css.panel}>
      <SessionProvider session={reference}>{renderSlot('orb.workbench.conversation', {})}</SessionProvider>
    </div>
  </section>
}

/** Props of the session-scoped entry `orb.workbench.conversation`. */
export type OrbWorkbenchConversationProps =
  & PropsRuntime<'orb.workbench.conversation'>
  & PropsRenderFactories

/**
 * Render only the Chat view of the management conversation.
 * @param props - the view slot renderer and the bound Session's conversation context.
 * @returns the Chat view.
 */
export function FixedOrbWorkbenchView(props: ConversationViewsProps) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

/**
 * Compose the shared Conversation content for the management Session.
 * @param props - bound Session state, its Conversation state, and the Factory renderer.
 * @returns the conversation content rooted at the Chat view.
 */
export function OrbWorkbenchConversation(
  { sessionId, useSession, useConversation, useSessions, renderFactorySlot }: OrbWorkbenchConversationProps,
) {
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
    slots: { views: FixedOrbWorkbenchView },
  })
}
