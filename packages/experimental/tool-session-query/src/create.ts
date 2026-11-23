/**
 * Create one new Session inside the caller's workspace, optionally prompting it.
 *
 * @module @deepseek-ai/dsh-tool-session-query/create
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { brandString } from '@deepseek-ai/dsh-brand'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { ToolArgsError, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { workspaceAccess } from './workspace-access.ts'

/** Largest first message accepted by one create call. */
export const MAX_SESSION_CREATE_MESSAGE_CHARS = 12_000

/** Model arguments for the session creation tool. */
export interface CreateSessionArgs {
  /** Optional first user prompt delivered to the new Session. */
  readonly message?: string
}

interface CreateSessionValue {
  /** The created Session id. */
  readonly session_id: string
  /** Preset the new Session runs, when the deployment composes a preset roster. */
  readonly agent_preset?: string
  /** Whether the first message was delivered. */
  readonly prompted: boolean
}

/**
 * Create one new Session in the caller's workspace and optionally send its first prompt.
 * @param ctx - scoped context providing the Session Controller.
 * @param args - optional first message.
 * @param exec - caller identity, cancellation, and tool execution context.
 * @returns JSON text naming the new Session.
 */
export async function executeCreateSession(
  ctx: Context,
  args: CreateSessionArgs,
  exec: ToolRunContext,
): Promise<string> {
  const caller = workspaceAccess.callerOf(exec, ctx)
  const cwd = caller.header.cwd
  if (cwd === undefined) {
    throw new HarnessError(
      'session creation requires a caller Session that owns a workspace directory',
      'SESSION_CREATE_TOOL_NO_WORKSPACE',
    )
  }
  const message = args.message?.trim()
  if (message !== undefined && message.length > MAX_SESSION_CREATE_MESSAGE_CHARS) {
    throw new ToolArgsError([`message must be at most ${String(MAX_SESSION_CREATE_MESSAGE_CHARS)} characters`])
  }
  exec.signal.throwIfAborted()
  let created
  try {
    created = await ctx.sessionController.create({ cwd })
  } catch (error: unknown) {
    if (exec.signal.aborted) throw error
    throw new HarnessError(
      `session creation was refused: ${error instanceof Error ? error.message : 'unknown failure'}`,
      'SESSION_CREATE_TOOL_REFUSED',
    )
  }
  const prompted = message !== undefined && message !== ''
  if (prompted) {
    exec.signal.throwIfAborted()
    try {
      await ctx.sessionController.prompt({
        requestId: brandString<SessionRequestId>(randomUUID()),
        sessionId: created.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: message }],
      }, exec.signal)
    } catch (error: unknown) {
      if (exec.signal.aborted) throw error
      throw new HarnessError(
        `session ${created.sessionId} was created but its first message was not accepted: ${error instanceof Error ? error.message : 'unknown failure'}`,
        'SESSION_CREATE_TOOL_REFUSED',
      )
    }
  }
  const value: CreateSessionValue = {
    session_id: created.sessionId,
    ...created.agentPreset === undefined ? {} : { agent_preset: created.agentPreset },
    prompted,
  }
  return JSON.stringify(value)
}
