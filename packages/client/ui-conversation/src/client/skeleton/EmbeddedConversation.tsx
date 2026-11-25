/** Reusable embedded Conversation occurrence: shared content, derived phase, and the Chat View. */
import type { ConversationEmbeddedProps, ConversationViewsProps } from '../contract/slots.ts'
import { conversationPhase } from '../contract/snapshot.ts'

/** Fixed Chat selection for one embedded Conversation occurrence. */
export function EmbeddedChatView({ renderSlot }: ConversationViewsProps) {
  return renderSlot('conversation.session', { view: 'chat' })
}

/**
 * Derive one embedded occurrence's presentation from its bound Session and render the shared content.
 * @param props - bound Session sources, the Workspace handler, and the content Factory renderer.
 * @returns the embedded Conversation content with only its Chat View.
 */
export function EmbeddedConversation(props: ConversationEmbeddedProps) {
  const { sessionId, useSession, useConversation, useSessions, renderFactorySlot, onWorkspaceSelected, headline } = props
  const session = useSession(value => value)
  const conversation = useConversation(value => value)
  const shellPhase = conversationPhase(session, conversation)
  const summaryBlank = useSessions(state => state.byId[sessionId]?.blank)
  const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true
  const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
  const phase = settling ? 'settling' : hero ? 'hero' : 'active'
  return renderFactorySlot('conversation.content', {
    variant: 'embedded', phase, hero, onWorkspaceSelected, headline,
  }, {
    slots: { views: EmbeddedChatView },
  })
}
