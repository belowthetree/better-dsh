/**
 * Dedicated workbench of the orb form: the management conversation of the
 * 大肥鱼 preset in a full-width card, without the Workspace pages and Session
 * bookmarks the general workbench hosts. The orb's quick prompt opens it after
 * accepting a prompt so the answer has a visible surface; the same card reopens
 * from the orb menu.
 */
import type { ModalSizeHint } from '@deepseek-ai/dsh-client-surface/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRenderFactories, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { NS } from './orb-locales.ts'
import css from './OrbWorkbench.module.css'
import { EmbeddedConversation } from './embedded-conversation.tsx'
import type { EmbeddedConversationInjected } from './embedded-conversation.tsx'

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
  & InjectFace<EmbeddedConversationInjected>

/** Compose the same fixed-Chat Conversation occurrence as the general workbench. */
export function OrbWorkbenchConversation(props: OrbWorkbenchConversationProps) {
  return <EmbeddedConversation {...props} />
}
