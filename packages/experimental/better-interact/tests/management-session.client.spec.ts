// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ISessions, SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MANAGEMENT_SESSION_KEY, ManagementSessionController } from '../src/client/management-session.ts'

const sid = (value: string) => value as SessionId
const ws = (value: string) => value as WorkspaceId

function workspaceView(workspaceId: string, sessionIds: readonly string[]): WorkspaceView {
  return {
    workspaceId: ws(workspaceId), path: `/${workspaceId}`, title: workspaceId,
    sessionIds: sessionIds.map(sid), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  }
}

function sessionSummary(id: SessionId, current: boolean): SessionSummary {
  return {
    id, displayTitle: String(id), running: false,
    retainedBy: current ? { mainView: 1 } : {}, blank: false, updatedAt: 0,
  }
}

function fixture(ids: readonly string[] = [], options: {
  readonly workspaces?: readonly WorkspaceView[]
  readonly currentSession?: SessionId
} = {}) {
  const byId = Object.fromEntries(ids.map(id => [id, sessionSummary(sid(id), id === options.currentSession)])) as SessionListState['byId']
  const list = createSnapshotStore<SessionListState>({
    ids: ids.map(sid), byId, phase: 'ready', projectionsBySession: {},
  })
  const workspaceList = createSnapshotStore<WorkspaceSnapshot>({
    items: [...options.workspaces ?? []], archivedSessionIds: [], pinnedSessionIds: [],
    state: 'idle', phase: 'ready', error: null,
  })
  const create = vi.fn<ISessions['create']>(async () => sid('created'))
  const initializeDefault = vi.fn<IWorkspaces['initializeDefault']>(async () => ({
    workspaceId: ws('default'),
  }) as WorkspaceView)
  const controller = new ManagementSessionController({
    sessions: { list, create }, workspaces: { initializeDefault, list: workspaceList },
  })
  return {
    controller, create, initializeDefault,
    setIds(next: readonly string[]) { list.set({ ...list.getSnapshot(), ids: next.map(sid) }) },
  }
}

beforeEach(() => { window.localStorage.clear() })

describe('ManagementSessionController', () => {
  it('reuses the remembered listed Session and then its live cached target', async () => {
    window.localStorage.setItem(MANAGEMENT_SESSION_KEY, 'managed')
    const b = fixture(['managed'])
    expect(await b.controller.resolve()).toBe(sid('managed'))
    expect(await b.controller.resolve()).toBe(sid('managed'))
    expect(b.initializeDefault).not.toHaveBeenCalled()
    expect(b.create).not.toHaveBeenCalled()
  })

  it('shares one creation across overlapping resolutions and remembers the result', async () => {
    const b = fixture()
    let release: (sessionId: SessionId) => void = () => {}
    b.create.mockImplementationOnce(async () => await new Promise<SessionId>((resolve) => { release = resolve }))
    const first = b.controller.resolve()
    const second = b.controller.resolve('required')
    expect(second).toBe(first)
    await vi.waitFor(() => { expect(b.create).toHaveBeenCalledOnce() })
    release(sid('created'))
    expect(await Promise.all([first, second])).toEqual([sid('created'), sid('created')])
    expect(window.localStorage.getItem(MANAGEMENT_SESSION_KEY)).toBe('created')
    expect(b.create).toHaveBeenCalledWith({ agentPreset: 'manage', workspaceId: ws('default') })
    expect(await b.controller.resolve()).toBe(sid('created'))
    expect(b.create).toHaveBeenCalledOnce()
    b.setIds(['created'])
    expect(await b.controller.resolve()).toBe(sid('created'))
    expect(b.create).toHaveBeenCalledOnce()
  })

  it('replaces a cached and remembered Session that left the catalog', async () => {
    const b = fixture()
    expect(await b.controller.resolve()).toBe(sid('created'))
    b.setIds(['created'])
    expect(await b.controller.resolve()).toBe(sid('created'))
    b.create.mockResolvedValueOnce(sid('replacement'))
    b.setIds([])
    expect(await b.controller.resolve()).toBe(sid('replacement'))
    expect(window.localStorage.getItem(MANAGEMENT_SESSION_KEY)).toBe('replacement')
    expect(b.create).toHaveBeenCalledTimes(2)
  })

  it('creates fresh for the general page even when an archived or otherwise remembered Session is listed', async () => {
    window.localStorage.setItem(MANAGEMENT_SESSION_KEY, 'managed')
    const b = fixture(['managed'])
    expect(await b.controller.create('required')).toBe(sid('created'))
    expect(b.create).toHaveBeenCalledOnce()
    expect(window.localStorage.getItem(MANAGEMENT_SESSION_KEY)).toBe('created')
  })

  it.each(['empty', 'failure'] as const)('reuses the registered current Workspace when Orb default initialization returns %s', async (outcome) => {
    const current = workspaceView('current', ['working'])
    const b = fixture(['working'], {
      workspaces: [current], currentSession: sid('working'),
    })
    const failure = new Error('workspace unavailable')
    if (outcome === 'empty') b.initializeDefault.mockResolvedValueOnce(undefined)
    else b.initializeDefault.mockRejectedValueOnce(failure)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await b.controller.resolve('optional')).toBe(sid('created'))
      expect(b.create).toHaveBeenCalledWith({ agentPreset: 'manage', workspaceId: current.workspaceId })
      if (outcome === 'failure') expect(warning).toHaveBeenCalledWith('orb: default workspace unavailable', failure)
      else expect(warning).not.toHaveBeenCalled()
    } finally { warning.mockRestore() }
  })

  it('uses the same registered current Workspace for general-page creation after initialization fails', async () => {
    const current = workspaceView('current', ['working'])
    const b = fixture(['working'], { workspaces: [current], currentSession: sid('working') })
    b.initializeDefault.mockRejectedValueOnce(new Error('workspace unavailable'))
    expect(await b.controller.create('required')).toBe(sid('created'))
    expect(b.create).toHaveBeenCalledWith({ agentPreset: 'manage', workspaceId: current.workspaceId })
  })

  it.each(['empty', 'failure'] as const)('does not create an unregistered management Session after %s default initialization', async (outcome) => {
    const b = fixture()
    const failure = new Error('workspace unavailable')
    if (outcome === 'empty') b.initializeDefault.mockResolvedValueOnce(undefined)
    else b.initializeDefault.mockRejectedValueOnce(failure)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(b.controller.resolve('optional')).rejects.toThrow(
        outcome === 'empty' ? 'management Session requires a registered Workspace' : 'workspace unavailable',
      )
      expect(b.create).not.toHaveBeenCalled()
      if (outcome === 'failure') expect(warning).toHaveBeenCalledWith('orb: default workspace unavailable', failure)
    } finally { warning.mockRestore() }
  })

  it('keeps the general workbench default-Workspace failure visible to its caller', async () => {
    const b = fixture()
    const failure = new Error('workspace unavailable')
    b.initializeDefault.mockRejectedValueOnce(failure)
    await expect(b.controller.resolve('required')).rejects.toBe(failure)
    expect(b.create).not.toHaveBeenCalled()
  })

  it('keeps resolution usable when management Session storage is unavailable', async () => {
    const b = fixture()
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    try {
      expect(await b.controller.resolve()).toBe(sid('created'))
      expect(debug).toHaveBeenCalledTimes(2)
    } finally {
      get.mockRestore()
      set.mockRestore()
      debug.mockRestore()
    }
  })
})
