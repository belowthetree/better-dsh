/**
 * Opt-in read-only Workspace and Session metadata tools for the mounted runtime.
 * @module @deepseek-ai/dsh-tool-session-list
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DEFAULT_PAGE_LIMIT, listSessions, listWorkspaces, MAX_PAGE_LIMIT, type WorkspaceAccess } from './list.ts'

export type { WorkspaceAccess } from './list.ts'

/** Cordis plugin identity. */
export const name = 'tool-session-list'
/** Services needed for header-only listing and live metadata. */
export const inject = ['tools', 'sessions', 'sessionQuery', 'workspaceRegistry', 'sessionProjections']

/** Deployment-owned Workspace metadata visibility. */
export interface Config {
  /** `all` preserves runtime-wide listing; `current` restricts both tools to the caller's registered Workspace. Defaults to `all`. */
  readonly workspaceAccess?: WorkspaceAccess
}

interface ResolvedConfig {
  readonly workspaceAccess: WorkspaceAccess
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config, ResolvedConfig> = z.object({
  workspaceAccess: z.union(['all', 'current'] as const).default('all'),
})

const pagination = {
  limit: { type: 'integer', description: `Maximum entries to return, from 1 to ${String(MAX_PAGE_LIMIT)}. Defaults to ${String(DEFAULT_PAGE_LIMIT)}.` },
  offset: { type: 'integer', description: 'Number of matching entries to skip. Defaults to 0.' },
} as const

/**
 * Grant tools access to Workspace and Session metadata selected by the composition.
 * @param ctx - scoped context granting these tools to its callers.
 * @param config - runtime-wide default, or current-workspace mode enforced by both executors.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = Config(config)
  ctx.tools.register(defineTool({
    name: 'list_workspace',
    description: resolved.workspaceAccess === 'current'
      ? 'List the current workspace of the caller, including when it has no sessions. Returns its ID, title, path, and creation and update times.'
      : 'List workspaces in registry order, including empty workspaces. Returns IDs, titles, paths, and creation and update times.',
    parameters: pagination,
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            workspace_id: { type: 'string', required: true },
            title: { type: 'string', required: true },
            path: { type: 'string', required: true },
            created_at: { type: 'string', required: true, description: 'ISO 8601 creation time.' },
            updated_at: { type: 'string', required: true, description: 'ISO 8601 update time.' },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    execute: (args, exec) => Promise.resolve(listWorkspaces(ctx, args, exec.signal, { mode: resolved.workspaceAccess, exec })),
    presentCall: args => ({ card: 'generic', title: 'List workspaces', kind: 'read', rawInput: args }),
  }))
  ctx.tools.register(defineTool({
    name: 'list_session',
    description: 'List non-subagent sessions by latest human prompt time, newest first, then by ID. Returns IDs, available titles, and ISO creation and update times. Missing activity metadata uses creation time; unavailable titles are null.',
    parameters: {
      workspace_id: {
        type: 'string',
        description: resolved.workspaceAccess === 'current'
          ? 'Workspace ID from list_workspace. Lists only its member sessions. Omit to use the current workspace of the caller.'
          : 'Workspace ID from list_workspace. Lists only its member sessions. Omit to list sessions in every workspace and outside all workspaces.',
      },
      archived: { type: 'boolean', description: 'Return only archived sessions when true, otherwise only unarchived sessions. Defaults to false.' },
      ...pagination,
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            session_id: { type: 'string', required: true },
            title: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            created_at: { type: 'string', required: true, description: 'ISO 8601 creation time.' },
            updated_at: { type: 'string', required: true, description: 'ISO 8601 latest human prompt time, or creation time when unavailable.' },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    execute: (args, exec) => listSessions(ctx, args, exec.signal, { mode: resolved.workspaceAccess, exec }),
    presentCall: args => ({ card: 'generic', title: 'List sessions', kind: 'read', rawInput: args }),
  }))
}
