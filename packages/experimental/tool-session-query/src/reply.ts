/**
 * Read the newest assistant text reply from one authorized Session.
 *
 * @module @deepseek-ai/dsh-tool-session-query/reply
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  isReplacementSurfaceEvent,
  type SessionEvent,
  type SessionId,
} from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { serviceBoundary } from './service-boundary.ts'
import { workspaceAccess } from './workspace-access.ts'

/** Largest reply prefix returned inline; a larger reply is marked truncated. */
export const MAX_LATEST_REPLY_CHARS = 20_000

/** Model arguments for the latest-reply tool. */
export interface LatestReplyArgs {
  /** Target Session id; omitted means the caller's own Session. */
  readonly session_id?: string
}

interface LatestReply {
  readonly seq: number
  readonly time: number
  readonly turn: number
  readonly text: string
}

interface LatestReplyValue {
  readonly session_id: SessionId
  readonly seq: number | null
  readonly replied_at: string | null
  readonly turn: number | null
  readonly text: string | null
  readonly truncated: boolean
}

/**
 * Select the newest current assistant message that carries non-empty text.
 * Messages shadowed by a later surface replacement are not current.
 * @param events - ordered Session log from one observation.
 * @returns the selected event and its text, or undefined when no text reply is current.
 */
export function latestAssistantReply(events: readonly SessionEvent[]): LatestReply | undefined {
  const shadowed = new Set<number>()
  for (const event of events) {
    if (!isReplacementSurfaceEvent(event)) continue
    for (let seq: number = event.surfaceOp.startSeq; seq <= event.surfaceOp.endSeq; seq += 1) {
      shadowed.add(seq)
    }
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || shadowed.has(event.seq) || event.type !== 'assistant/message') continue
    const text = event.data.message.content
      .flatMap(block => block.type === 'text' ? [block.text] : [])
      .join('\n')
      .trim()
    if (text.length === 0) continue
    return { seq: event.seq, time: event.time, turn: event.data.turn, text }
  }
  return undefined
}

/**
 * Read one Session's newest assistant text reply.
 * @param ctx - context providing the Session query service.
 * @param args - target Session id.
 * @param exec - caller identity, cancellation, and tool execution context.
 * @returns JSON text with the reply metadata and bounded text.
 */
export async function executeLatestReply(
  ctx: Context,
  args: LatestReplyArgs,
  exec: ToolRunContext,
): Promise<string> {
  const caller = workspaceAccess.callerOf(exec, ctx)
  const sessionId = workspaceAccess.targetId(args, caller)
  await workspaceAccess.authorizeTarget(ctx, caller, sessionId, exec.signal)
  exec.signal.throwIfAborted()
  using observation = await serviceBoundary.call(ctx, exec.signal, 'latest reply', () =>
    ctx.sessionQuery.observeSession(sessionId, { signal: exec.signal, projectionMode: 'none' }))
  workspaceAccess.assertObservedTargetAuthorized(caller, sessionId, observation.header)
  const latest = latestAssistantReply(observation.events)
  const truncated = latest !== undefined && latest.text.length > MAX_LATEST_REPLY_CHARS
  const value: LatestReplyValue = {
    session_id: sessionId,
    seq: latest?.seq ?? null,
    replied_at: latest === undefined ? null : new Date(latest.time).toISOString(),
    turn: latest?.turn ?? null,
    text: latest === undefined ? null : latest.text.slice(0, MAX_LATEST_REPLY_CHARS),
    truncated,
  }
  return JSON.stringify(value)
}
