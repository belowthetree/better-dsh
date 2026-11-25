/** Shared embedded Conversation occurrence used by both workbench cards. */
import type { WorkspaceSelectedHandler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'

/** Injected face shared by both workbench conversation occurrences. */
export interface EmbeddedConversationInjected {
  /** What a Workspace picked in the blank Hero does: open that Workspace's blank Session as the main Session. */
  readonly openWorkspace: WorkspaceSelectedHandler
}

/**
 * Compose the reusable embedded Conversation occurrence for one workbench Session.
 * @param props - the injected Workspace handler and the embedded Conversation Factory renderer.
 * @returns the Conversation content rooted at the Chat view.
 */
export function EmbeddedConversation(props: EmbeddedConversationInjected & PropsRenderFactories) {
  return props.renderFactorySlot('conversation.embedded', { onWorkspaceSelected: props.openWorkspace })
}
