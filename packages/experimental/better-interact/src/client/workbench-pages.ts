/**
 * Workbench pages: one page per Workspace, the Workspace the dialog shows, and
 * the Session each Workspace page last showed. The selection is persisted so
 * the launcher can reopen the most recently used page.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** localStorage identity of the pages; a new shape takes a new name. */
export const WORKBENCH_PAGES_STORAGE = 'dsh.better-interact.workbench-pages.v1'

/** Persisted page state. */
export interface WorkbenchPagesState {
  /** Workspace the dialog shows, or undefined while no Workspace page exists. */
  readonly active: WorkspaceId | undefined
  /** Session each Workspace page shows; absence falls back to its newest Session. */
  readonly sessions: Readonly<Partial<Record<WorkspaceId, SessionId>>>
}

/** Store plus the mutations the workbench commands and cards use. */
export interface WorkbenchPages {
  readonly store: SnapshotStore<WorkbenchPagesState>
  /** Show one Workspace page. */
  select(workspaceId: WorkspaceId): void
  /** Record the Session one Workspace page shows. */
  setSession(workspaceId: WorkspaceId, sessionId: SessionId): void
  /** Move to the next or previous Workspace page, wrapping around. */
  cycle(ordered: readonly WorkspaceId[], delta: 1 | -1): WorkspaceId | undefined
  /** Resolve the page to show, falling back to the catalog order. */
  ensure(ordered: readonly WorkspaceId[], fallback?: WorkspaceId): WorkspaceId | undefined
  /** Drop pages and Session selections whose referents left the catalogs. */
  retain(workspaceIds: ReadonlySet<WorkspaceId>, sessionIds: ReadonlySet<SessionId>): void
}

/**
 * Create the persisted workbench pages.
 * @returns the store and its complete mutation set.
 */
export function createWorkbenchPagesStore(): WorkbenchPages {
  const store = createSnapshotStore<WorkbenchPagesState>(
    { active: undefined, sessions: {} },
    { persist: { name: WORKBENCH_PAGES_STORAGE } },
  )
  const select = (workspaceId: WorkspaceId): void => {
    const state = store.getSnapshot()
    if (state.active !== workspaceId) store.set({ ...state, active: workspaceId })
  }
  const setSession = (workspaceId: WorkspaceId, sessionId: SessionId): void => {
    const state = store.getSnapshot()
    if (state.sessions[workspaceId] === sessionId) return
    store.set({ ...state, sessions: { ...state.sessions, [workspaceId]: sessionId } })
  }
  const cycle = (ordered: readonly WorkspaceId[], delta: 1 | -1): WorkspaceId | undefined => {
    if (ordered.length === 0) return undefined
    const state = store.getSnapshot()
    const current = state.active === undefined ? -1 : ordered.indexOf(state.active)
    const index = current === -1
      ? (delta > 0 ? 0 : ordered.length - 1)
      : (current + delta + ordered.length) % ordered.length
    const next = ordered[index]
    if (next === undefined) return undefined
    select(next)
    return next
  }
  const ensure = (ordered: readonly WorkspaceId[], fallback?: WorkspaceId): WorkspaceId | undefined => {
    const state = store.getSnapshot()
    if (state.active !== undefined && ordered.includes(state.active)) return state.active
    if (fallback !== undefined && ordered.includes(fallback)) {
      select(fallback)
      return fallback
    }
    const first = ordered[0]
    if (first !== undefined) select(first)
    return first
  }
  const retain = (workspaceIds: ReadonlySet<WorkspaceId>, sessionIds: ReadonlySet<SessionId>): void => {
    const state = store.getSnapshot()
    const sessions: Partial<Record<WorkspaceId, SessionId>> = {}
    for (const [workspaceId, sessionId] of Object.entries(state.sessions) as [WorkspaceId, SessionId][]) {
      if (workspaceIds.has(workspaceId) && sessionIds.has(sessionId)) sessions[workspaceId] = sessionId
    }
    const active = state.active !== undefined && workspaceIds.has(state.active) ? state.active : undefined
    if (active === state.active && Object.keys(sessions).length === Object.keys(state.sessions).length) return
    store.set({ active, sessions })
  }
  return { store, select, setSession, cycle, ensure, retain }
}
