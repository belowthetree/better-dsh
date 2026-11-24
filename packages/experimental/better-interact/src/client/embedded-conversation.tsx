/** Shared fixed-Chat Conversation occurrence used by Better workbench cards. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationViewsProps, WorkspaceSelectedHandler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Fix one embedded Conversation occurrence to the Chat View.
 * @param props - Conversation View renderer supplied by the content Factory.
 * @returns the Chat-bound Conversation Session entry.
 */
export function FixedChatConversationView(props: ConversationViewsProps) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

/** Injected face shared by both workbench conversation occurrences. */
export interface EmbeddedConversationInjected {
  /** What a Workspace picked in the blank Hero does: open that Workspace's blank Session as the main Session. */
  readonly openWorkspace: WorkspaceSelectedHandler
}

/** Session and factory inputs shared by the two workbench conversation slots. */
export interface EmbeddedConversationProps extends EmbeddedConversationInjected {
  /** Bound Session identity. */
  readonly sessionId: SessionId
  /** Bound Session lifecycle source. */
  readonly useSession: PropsRuntime<'better-interact.workbench.conversation'>['useSession']
  /** Bound Conversation target source. */
  readonly useConversation: PropsRuntime<'better-interact.workbench.conversation'>['useConversation']
  /** Session catalog used to settle the blank Hero. */
  readonly useSessions: PropsRuntime<'better-interact.workbench.conversation'>['useSessions']
  /** Renderer for the shared Conversation content Factory. */
  readonly renderFactorySlot: PropsRenderFactories['renderFactorySlot']
}

/**
 * Compose the shared Conversation content without a View ring or main-panel chrome.
 * @param props - bound Session sources and Conversation Factory renderer.
 * @returns the embedded Conversation content with only its Chat View.
 */
export function EmbeddedConversation({
  sessionId, useSession, useConversation, useSessions, renderFactorySlot, openWorkspace,
}: EmbeddedConversationProps) {
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
  return renderFactorySlot('conversation.content',
    { variant: 'embedded', phase, hero, onWorkspaceSelected: openWorkspace }, {
      slots: { views: FixedChatConversationView },
    })
}
