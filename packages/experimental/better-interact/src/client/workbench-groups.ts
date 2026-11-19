/** Workbench pages: the managed-conversation page plus one page per Workspace. */
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Synthetic page holding Sessions whose recorded preset is the orb management
 * conversation. It is not a Workspace and is never sent to the Host.
 */
export const MANAGE_PAGE_ID = 'better-interact.manage' as WorkspaceId

/** One tab and its Session bookmarks in the workbench. */
export interface WorkbenchPageGroup {
  readonly workspaceId: WorkspaceId
  readonly title: string
  /** Workspace directory; absent on the synthetic managed-conversation page. */
  readonly path?: string
  readonly sessionIds: readonly SessionId[]
  /** Whether this tab is the synthetic managed-conversation page. */
  readonly manages: boolean
}

/**
 * Build workbench pages with the managed-conversation page first.
 *
 * Managed Sessions lead the synthetic page and are removed from their Workspace
 * page so one Session never appears twice. Managed Sessions keep their real
 * Workspace membership; this derivation only changes where the workbench shows
 * them.
 * @param workspaces - Host Workspaces in registry order.
 * @param sessions - current Session rows keyed by Session id.
 * @param manageTitle - localized title of the synthetic page.
 * @returns synthetic page first, then every real Workspace.
 */
export function workbenchGroups(
  workspaces: readonly WorkspaceView[],
  sessions: Readonly<Record<SessionId, SessionSummary>>,
  manageTitle: string,
): WorkbenchPageGroup[] {
  const managed = Object.values(sessions)
    .filter(session => session.agentPreset === 'manage' && session.origin !== 'subagent')
    .sort((left, right) => right.updatedAt - left.updatedAt || (left.id < right.id ? -1 : 1))
    .map(session => session.id)
  const managedIds = new Set(managed)
  const groups: WorkbenchPageGroup[] = []
  if (managed.length > 0) {
    groups.push({ workspaceId: MANAGE_PAGE_ID, title: manageTitle, sessionIds: managed, manages: true })
  }
  for (const workspace of workspaces) {
    groups.push({
      workspaceId: workspace.workspaceId,
      title: workspace.title,
      path: workspace.path,
      sessionIds: workspace.sessionIds.filter(sessionId => !managedIds.has(sessionId)),
      manages: false,
    })
  }
  return groups
}
