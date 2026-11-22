/** Resolve and remember the management Session shared by the orb and workbench. */
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MANAGE_PRESET } from './workbench-groups.ts'

/** Storage identity of the dedicated management Session. */
export const MANAGEMENT_SESSION_KEY = 'dsh.orb.management-session.v2'

/** Whether a default-Workspace initialization failure is logged before registered-current-Workspace fallback. */
export type ManagementWorkspacePolicy = 'required' | 'optional'

/** Inputs of the management Session resolver. */
export interface ManagementSessionControllerOptions {
  /** Session catalog and creation command. */
  readonly sessions: Pick<ISessions, 'list' | 'create'>
  /** Host default-Workspace initializer and registered Workspace catalog. */
  readonly workspaces: Pick<IWorkspaces, 'initializeDefault' | 'list'>
}

/** No registered Workspace can safely own a new management Session. */
class ManagementWorkspaceUnavailableError extends Error {
  constructor() {
    super('management Session requires a registered Workspace')
    this.name = 'ManagementWorkspaceUnavailableError'
  }
}

/** Single-flight resolver for the management Session used by every Better entry point. */
export class ManagementSessionController {
  private target: SessionId | undefined
  private targetObserved = false
  private pending: Promise<SessionId> | undefined

  /** @param options - Session catalog and creation command, default-Workspace initializer, and Workspace catalog. */
  constructor(private readonly options: ManagementSessionControllerOptions) {}

  /**
   * Resolve the remembered Session while it remains listed, or create its replacement.
   * @param workspacePolicy - whether initialization failure is logged before fallback or rejection.
   * @returns the existing or newly created management Session.
   * @throws when no default or registered current Workspace is available, or Session creation fails.
   */
  resolve(workspacePolicy: ManagementWorkspacePolicy = 'optional'): Promise<SessionId> {
    const listed = this.options.sessions.list.getSnapshot().ids
    if (this.target !== undefined) {
      if (listed.includes(this.target)) {
        this.targetObserved = true
        return Promise.resolve(this.target)
      }
      if (!this.targetObserved) return Promise.resolve(this.target)
      this.target = undefined
      this.targetObserved = false
    }
    const remembered = this.remembered()
    const known = remembered === null
      ? undefined
      : listed.find(id => String(id) === remembered)
    if (known !== undefined) {
      this.target = known
      this.targetObserved = true
      return Promise.resolve(known)
    }
    return this.create(workspacePolicy)
  }

  /**
   * Create a fresh management Session, sharing any creation already in flight.
   * @param workspacePolicy - whether initialization failure is logged before fallback or rejection.
   * @returns the newly created management Session.
   * @throws when no default or registered current Workspace is available, or Session creation fails.
   */
  create(workspacePolicy: ManagementWorkspacePolicy): Promise<SessionId> {
    if (this.pending !== undefined) return this.pending
    const pending = this.createSession(workspacePolicy).then((sessionId) => {
      this.remember(sessionId)
      this.target = sessionId
      this.targetObserved = false
      return sessionId
    })
    this.pending = pending
    void pending.finally(() => {
      if (this.pending === pending) this.pending = undefined
    }).catch(() => {
      // The caller observes the original rejection; this only settles the cleanup chain.
    })
    return pending
  }

  /** @returns the stored Session id, or null when storage or a value is unavailable. */
  private remembered(): string | null {
    if (typeof window === 'undefined') return null
    try {
      return window.localStorage.getItem(MANAGEMENT_SESSION_KEY)
    } catch (error) {
      console.debug('orb: management session preference unavailable', error)
      return null
    }
  }

  /** @param id - Session to remember across renderer reloads. */
  private remember(id: SessionId): void {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(MANAGEMENT_SESSION_KEY, String(id))
    } catch (error) {
      console.debug('orb: management session preference unavailable', error)
    }
  }

  /** Resolve the registered Workspace that owns the main view's Session, if any. */
  private registeredCurrentWorkspace(): WorkspaceView | undefined {
    const summaries = this.options.sessions.list.getSnapshot().byId
    const current = Object.values(summaries).find(row => (row.retainedBy.mainView ?? 0) > 0)
    if (current === undefined) return undefined
    return this.options.workspaces.list.getSnapshot().items.find(item => item.sessionIds.includes(current.id))
  }

  /**
   * Create only in the Host default Workspace or the registered current Workspace.
   * @param workspacePolicy - whether initialization failure is logged before fallback or rejection.
   */
  private async createSession(workspacePolicy: ManagementWorkspacePolicy): Promise<SessionId> {
    let initialized: WorkspaceView | undefined
    let initializationError: unknown
    try {
      initialized = await this.options.workspaces.initializeDefault()
    } catch (error) {
      initializationError = error
      if (workspacePolicy === 'optional') console.warn('orb: default workspace unavailable', error)
    }
    const workspaceId = initialized?.workspaceId ?? this.registeredCurrentWorkspace()?.workspaceId
    if (workspaceId === undefined) {
      if (initializationError instanceof Error) throw initializationError
      throw new ManagementWorkspaceUnavailableError()
    }
    return this.options.sessions.create({ agentPreset: MANAGE_PRESET, workspaceId })
  }
}
