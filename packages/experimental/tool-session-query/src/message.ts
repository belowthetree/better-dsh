/**
 * Deliver one text message to another authorized Session.
 *
 * @module @deepseek-ai/dsh-tool-session-query/message
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { brandString } from '@deepseek-ai/dsh-brand'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { ToolArgsError, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { workspaceAccess } from './workspace-access.ts'

/** Largest message accepted by one send call. */
export const MAX_SESSION_MESSAGE_CHARS = 12_000

/** Model arguments for the cross-session message tool. */
export interface SendMessageArgs {
  /** Target Session id. */
  readonly session_id: string
  /** Message text delivered as a user prompt. */
  readonly message: string
}

interface SendMessageValue {
  readonly accepted: true
  readonly session_id: string
}

/**
 * Deliver one text message to a Session the caller may access.
 * @param ctx - scoped context providing the Session Controller.
 * @param args - target Session and message text.
 * @param exec - caller identity, cancellation, and tool execution context.
 * @returns JSON text confirming that the target accepted the message.
 */
export async function executeSendMessage(
  ctx: Context,
  args: SendMessageArgs,
  exec: ToolRunContext,
): Promise<string> {
  const caller = workspaceAccess.callerOf(exec, ctx)
  const target = workspaceAccess.targetId(args, caller)
  if (target === caller.id) {
    throw new ToolArgsError(['session_id must name another session'])
  }
  const message = args.message.trim()
  if (message.length === 0) throw new ToolArgsError(['message must contain non-whitespace text'])
  if (message.length > MAX_SESSION_MESSAGE_CHARS) {
    throw new ToolArgsError([`message must be at most ${String(MAX_SESSION_MESSAGE_CHARS)} characters`])
  }
  const header = await workspaceAccess.authorizeTargetHeader(ctx, caller, target, exec.signal)
  if (header.origin === 'subagent') {
    throw new HarnessError('subagent sessions cannot receive cross-session messages', 'SESSION_MESSAGE_TOOL_SUBAGENT')
  }
  exec.signal.throwIfAborted()
  try {
    await ctx.sessionController.prompt({
      requestId: brandString<SessionRequestId>(randomUUID()),
      sessionId: target,
      mode: 'queue',
      content: [{ type: 'text', text: message }],
    }, exec.signal)
  } catch (error: unknown) {
    if (exec.signal.aborted) throw error
    throw new HarnessError(
      `session message was not accepted: ${error instanceof Error ? error.message : 'unknown failure'}`,
      'SESSION_MESSAGE_TOOL_REFUSED',
    )
  }
  const value: SendMessageValue = { accepted: true, session_id: target }
  return JSON.stringify(value)
}
