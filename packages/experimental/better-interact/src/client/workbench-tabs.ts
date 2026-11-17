/**
 * Workbench cards: the Sessions the workbench has hosted, in strip order, and
 * the one it currently shows. The selection is persisted so the launcher can
 * reopen the most recently used workbench.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Workbench cards kept in the strip before the oldest one is dropped. */
export const WORKBENCH_TAB_LIMIT = 8

/** localStorage identity of the strip; a new shape takes a new name. */
export const WORKBENCH_TABS_STORAGE = 'dsh.better-interact.workbenches.v1'

/** Persisted strip state. */
export interface WorkbenchTabsState {
  /** Sessions in strip order; the oldest card comes first. */
  readonly sessionIds: readonly SessionId[]
  /** Session the dialog shows, or undefined while no card exists. */
  readonly active: SessionId | undefined
}

/** Store plus the mutations the workbench commands and cards use. */
export interface WorkbenchTabs {
  readonly store: SnapshotStore<WorkbenchTabsState>
  /** Show a Session's workbench, appending a card when it has none. */
  select(sessionId: SessionId): void
  /** Move to the next or previous card, wrapping around. */
  cycle(delta: 1 | -1, fallback?: SessionId): SessionId | undefined
  /** Drop cards whose Session left the catalog and repair the selection. */
  retain(valid: ReadonlySet<SessionId>): void
  /** Resolve the card to show, seeding the strip from the catalog when it has none. */
  ensure(fallback?: SessionId): SessionId | undefined
}

/**
 * Create the persisted workbench strip.
 * @returns the store and its complete mutation set.
 */
export function createWorkbenchTabsStore(): WorkbenchTabs {
  const store = createSnapshotStore<WorkbenchTabsState>(
    { sessionIds: [], active: undefined },
    { persist: { name: WORKBENCH_TABS_STORAGE } },
  )
  const select = (sessionId: SessionId): void => {
    const state = store.getSnapshot()
    if (state.sessionIds.includes(sessionId)) {
      if (state.active !== sessionId) store.set({ ...state, active: sessionId })
      return
    }
    const appended = [...state.sessionIds, sessionId]
    store.set({ sessionIds: appended.slice(-WORKBENCH_TAB_LIMIT), active: sessionId })
  }
  const ensure = (fallback?: SessionId): SessionId | undefined => {
    const state = store.getSnapshot()
    if (state.active !== undefined && state.sessionIds.includes(state.active)) return state.active
    const first = state.sessionIds[0]
    if (first !== undefined) {
      store.set({ ...state, active: first })
      return first
    }
    if (fallback === undefined) return undefined
    select(fallback)
    return fallback
  }
  const cycle = (delta: 1 | -1, fallback?: SessionId): SessionId | undefined => {
    const state = store.getSnapshot()
    if (state.sessionIds.length === 0) return fallback === undefined ? undefined : ensure(fallback)
    const current = state.active === undefined ? -1 : state.sessionIds.indexOf(state.active)
    const index = current === -1
      ? (delta > 0 ? 0 : state.sessionIds.length - 1)
      : (current + delta + state.sessionIds.length) % state.sessionIds.length
    const active = state.sessionIds[index]
    if (active === undefined) return undefined
    if (active !== state.active) store.set({ ...state, active })
    return active
  }
  const retain = (valid: ReadonlySet<SessionId>): void => {
    const state = store.getSnapshot()
    const sessionIds = state.sessionIds.filter(id => valid.has(id))
    if (sessionIds.length === state.sessionIds.length) return
    const active = state.active !== undefined && sessionIds.includes(state.active)
      ? state.active
      : sessionIds[0]
    store.set({ sessionIds, active })
  }
  return { store, select, cycle, retain, ensure }
}
