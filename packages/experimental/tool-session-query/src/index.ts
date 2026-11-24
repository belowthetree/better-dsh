/**
 * Model-facing, workspace-authorized session history search, read, latest-reply,
 * and optional cross-session message tools.
 *
 * @module @deepseek-ai/dsh-tool-session-query
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { toolInput } from './input.ts'
import { executeCreateSession, MAX_SESSION_CREATE_MESSAGE_CHARS } from './create.ts'
import { executeSendMessage, MAX_SESSION_MESSAGE_CHARS } from './message.ts'
import { operations } from './operations.ts'
import { presentation } from './presentation.ts'
import { executeLatestReply, MAX_LATEST_REPLY_CHARS } from './reply.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-session-query'

/** Capability services required by the model-facing consumer. */
export const inject = ['tools', 'systemPrompt', 'sessionQuery', 'agents']

/** Default maximum number of authorized search hits returned by one call. */
export const DEFAULT_MAX_SEARCH_RESULTS = 100

/** Default cooperative deadline for either full-text search tool. */
export const DEFAULT_SEARCH_TIMEOUT_MS = 30_000

/** Deployment-owned search count, timeout, and cross-session message bounds. */
export interface Config {
  /** Maximum authorized hits returned by one search call. Defaults to 100. */
  maxSearchResults?: number
  /** Cooperative full-text search deadline in milliseconds. Defaults to 30000. */
  searchTimeoutMs?: number
  /** Whether to register the cross-session message tool. Defaults to false. */
  allowSessionMessages?: boolean
  /** Whether to register the session creation tool. Defaults to false. */
  allowSessionCreate?: boolean
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  maxSearchResults: z.number().step(1).min(1).default(DEFAULT_MAX_SEARCH_RESULTS),
  searchTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_SEARCH_TIMEOUT_MS),
  allowSessionMessages: z.boolean().default(false),
  allowSessionCreate: z.boolean().default(false),
})

interface ResolvedConfig {
  readonly maxSearchResults: number
  readonly searchTimeoutMs: number
  readonly allowSessionMessages: boolean
  readonly allowSessionCreate: boolean
}

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

const PROMPT_TEXT =
  'Use session_search to find relevant work from prior sessions, or session_event_search to search earlier '
  + 'events in one session. Search results are cursor-free and workspace-scoped. Follow a useful hit with '
  + 'session_trace, session_event_trace, or session_event_read when you need lineage, relationships, or exact data. '
  + 'Use session_latest_reply to read the newest reply in an authorized session.'

const MESSAGE_PROMPT_TEXT =
  'Use session_send_message to deliver a text message to another authorized session; it returns once accepted '
  + 'and does not wait for the reply. Read the answer with session_latest_reply.'

const CREATE_PROMPT_TEXT =
  'Use session_create to start a new session in the caller workspace, optionally with its first message; it returns '
  + 'the new session id once the session is created and does not wait for a reply.'

/** Register the read tools plus the optional cross-session message and creation tools. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const promptText = [
    PROMPT_TEXT,
    ...resolved.allowSessionMessages ? [MESSAGE_PROMPT_TEXT] : [],
    ...resolved.allowSessionCreate ? [CREATE_PROMPT_TEXT] : [],
  ].join(' ')
  ctx.systemPrompt.section({
    name: 'tool:session-query',
    order: ctx.systemPrompt.getSectionOrder('TOOL_SESSION_QUERY'),
    text: promptText,
    retirement: 'The session-query tool is no longer available. Its guidance no longer applies.',
  })

  ctx.tools.register(defineTool({
    name: 'session_search',
    description: 'Search prior sessions in the caller workspace and return the strongest matching event from each session.',
    parameters: toolInput.sessionSearchParameters,
    output: TEXT_OUTPUT,
    timeoutMs: resolved.searchTimeoutMs,
    execute: (args, exec) => operations.executeSessionSearch(ctx, args, exec, resolved.maxSearchResults),
    presentCall: presentation.presentSessionSearchCall,
  }))

  ctx.tools.register(defineTool({
    name: 'session_event_search',
    description: 'Search prior events in one authorized session; the current session excludes the step performing this call.',
    parameters: toolInput.eventSearchParameters,
    output: TEXT_OUTPUT,
    timeoutMs: resolved.searchTimeoutMs,
    execute: (args, exec) => operations.executeEventSearch(ctx, args, exec, resolved.maxSearchResults),
    presentCall: presentation.presentEventSearchCall,
  }))

  ctx.tools.register(defineTool({
    name: 'session_trace',
    description: 'Read the authorized session lineage around one session, including complete visible ancestor and descendant relationships.',
    parameters: toolInput.targetSessionParameter,
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: (args, exec) => operations.executeSessionTrace(ctx, args, exec),
    presentCall: presentation.presentSessionTraceCall,
  }))

  ctx.tools.register(defineTool({
    name: 'session_event_trace',
    description: 'Read every direct replacement and relationship to a cited source event for one event in an authorized session.',
    parameters: {
      ...toolInput.targetSessionParameter,
      seq: { type: 'integer', required: true, description: 'Target event sequence number.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: (args, exec) => operations.executeEventTrace(ctx, args, exec),
    presentCall: args => presentation.presentEventTargetCall('Trace event', args),
  }))

  ctx.tools.register(defineTool({
    name: 'session_event_read',
    description: 'Read one full unabridged event and optional neighboring raw-event summaries from an authorized session.',
    parameters: {
      ...toolInput.targetSessionParameter,
      seq: { type: 'integer', required: true, description: 'Target event sequence number.' },
      before: { type: 'integer', description: 'Number of preceding raw events to summarize. Omit for none.' },
      after: { type: 'integer', description: 'Number of following raw events to summarize. Omit for none.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: (args, exec) => operations.executeEventRead(ctx, args, exec),
    presentCall: args => presentation.presentEventTargetCall('Read event', args),
  }))

  ctx.tools.register(defineTool({
    name: 'session_latest_reply',
    description: `Read the newest non-empty assistant text reply from one authorized session. Returns its event sequence, time, and up to ${String(MAX_LATEST_REPLY_CHARS)} characters of text; use session_event_read with that sequence for the complete event.`,
    parameters: {
      session_id: {
        type: 'string',
        description: 'Target Session ID. Omit to read the caller\'s own reply. The target must share the caller\'s workspace.',
      },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: (args, exec) => executeLatestReply(ctx, args, exec),
    presentCall: args => presentation.presentLatestReplyCall(args),
  }))

  if (resolved.allowSessionMessages || resolved.allowSessionCreate) {
    ctx.inject(['sessionController'], (scope) => {
      if (resolved.allowSessionMessages) {
        scope.tools.register(defineTool({
          name: 'session_send_message',
          description: 'Send a text message to another authorized session in the caller workspace. The target receives it as a user prompt; the call returns once accepted and does not wait for the reply.',
          parameters: {
            session_id: {
              type: 'string',
              required: true,
              description: 'Target Session ID. It must share the caller\'s workspace and cannot be the caller.',
            },
            message: {
              type: 'string',
              required: true,
              description: `Message text, from 1 to ${String(MAX_SESSION_MESSAGE_CHARS)} characters.`,
            },
          },
          output: TEXT_OUTPUT,
          isConcurrencySafe: () => false,
          execute: (args, exec) => executeSendMessage(scope, args, exec),
          presentCall: args => presentation.presentSendMessageCall(args),
        }))
      }
      if (resolved.allowSessionCreate) {
        scope.tools.register(defineTool({
          name: 'session_create',
          description: 'Create a new session in the caller workspace. The new session runs the composition\'s default preset; an optional first message is delivered as its user prompt. The call returns the new session id once the session exists and does not wait for a reply.',
          parameters: {
            message: {
              type: 'string',
              description: `Optional first message, from 1 to ${String(MAX_SESSION_CREATE_MESSAGE_CHARS)} characters. Omit to create an empty session.`,
            },
          },
          output: TEXT_OUTPUT,
          isConcurrencySafe: () => false,
          execute: (args, exec) => executeCreateSession(scope, args, exec),
          presentCall: args => presentation.presentCreateSessionCall(args),
        }))
      }
    })
  }
}

function resolveConfig(config: Config): ResolvedConfig {
  const maxSearchResults = config.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS
  const searchTimeoutMs = config.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS
  if (!Number.isSafeInteger(maxSearchResults) || maxSearchResults < 1) {
    throw new TypeError('tool-session-query: maxSearchResults must be a positive safe integer')
  }
  if (!Number.isInteger(searchTimeoutMs) || searchTimeoutMs < 1 || searchTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new TypeError(
      `tool-session-query: searchTimeoutMs must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  return {
    maxSearchResults,
    searchTimeoutMs,
    allowSessionMessages: config.allowSessionMessages ?? false,
    allowSessionCreate: config.allowSessionCreate ?? false,
  }
}
