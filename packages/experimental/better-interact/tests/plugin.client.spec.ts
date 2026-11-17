/** The plugin mounts the bubble column and the Workspace-paged workbench, and wires its commands. */
import { expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ShortcutCommand } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  apply, inject, WORKBENCH_COMMAND_ID, WORKBENCH_NEW_WORKSPACE_COMMAND_ID, WORKBENCH_NEXT_COMMAND_ID,
  WORKBENCH_PREVIOUS_COMMAND_ID,
} from '../src/client/index.ts'
import type { BubblesInjected } from '../src/client/bubbles.tsx'
import { WORKBENCH_MODAL_ID } from '../src/client/resource.ts'
import type { WorkbenchInjected } from '../src/client/workbench.tsx'
import { WORKBENCH_MODAL_SIZE } from '../src/client/workbench.tsx'

type Registration = { readonly name: string; readonly [key: string]: unknown }

/** Orb presentation the carrier reports while the plugin runs. */
const ORB: SurfaceSnapshot = {
  form: 'orb', role: 'orb', presentation: 'orb', pinned: false, available: true, modal: null, orbHovered: false,
  modalOpen: false,
}

/** Dialog presentation the carrier reports while the workbench is open. */
const WORKBENCH: SurfaceSnapshot = {
  form: 'orb', role: 'surface', presentation: 'modal', pinned: false, available: true,
  modal: WORKBENCH_MODAL_ID, orbHovered: false, modalOpen: true,
}

const sid = (value: string) => value as SessionId
const ws = (value: string) => value as WorkspaceId

function row(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return { id: sid(id), displayTitle: id, running: false, retainedBy: {}, blank: true, updatedAt: 0, ...overrides }
}

function sessionList(sessions: readonly { readonly id: string; readonly updatedAt?: number; readonly mainView?: boolean }[]) {
  return createSnapshotStore<SessionListState>({
    ids: sessions.map(session => sid(session.id)),
    byId: Object.fromEntries(sessions.map(session => [session.id, row(session.id, {
      updatedAt: session.updatedAt ?? 0,
      ...session.mainView === true ? { retainedBy: { mainView: 1 } } : {},
    })])),
    phase: 'ready',
    projectionsBySession: {},
  })
}

function view(id: string, title: string, sessionIds: readonly string[], updatedAt = '2026-11-01T00:00:00.000Z'): WorkspaceView {
  return {
    workspaceId: ws(id), path: `E:\\Project\\${title}`, title, sessionIds: sessionIds.map(sid),
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt,
  }
}

function workspaceList(items: readonly WorkspaceView[]) {
  return createSnapshotStore<WorkspaceSnapshot>({
    items, archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  })
}

function context(options: {
  readonly surface?: SurfaceSnapshot
  readonly sessions?: readonly { readonly id: string; readonly updatedAt?: number; readonly mainView?: boolean }[]
  readonly workspaces?: readonly WorkspaceView[]
} = {}) {
  const registrations: Registration[] = []
  const disposers: (() => void)[] = []
  const commands: ShortcutCommand[] = []
  const dictionaries: { readonly namespace?: string; readonly languages: string[] } = { languages: [] }
  const record = (namespace: string, values: Record<string, unknown>): (() => void) => {
    (dictionaries as { namespace?: string }).namespace = namespace
    dictionaries.languages.push(...Object.keys(values))
    return () => {}
  }
  const presentModal = vi.fn(() => Promise.resolve())
  const presentBubbles = vi.fn(() => Promise.resolve())
  const dismissBubbles = vi.fn(() => Promise.resolve())
  const openSession = vi.fn()
  const openWorkspace = vi.fn(() => Promise.resolve())
  const pickDirectory = vi.fn<() => Promise<string | null>>(() => Promise.resolve(null))
  const createWorkspace = vi.fn(async () => view('ws-new', 'New', []))
  const snapshot = options.surface ?? ORB
  const sessions = sessionList(options.sessions ?? [{ id: 's1' }])
  const workspaces = workspaceList(options.workspaces ?? [view('ws-1', 'Alpha', ['s1'])])
  const ctx = {
    effect: (factory: () => unknown) => {
      const value = factory()
      if (typeof value === 'function') disposers.push(value as () => void)
      return () => {}
    },
    locale: { register: record, bind: vi.fn(() => (key: string) => key) },
    resources: { register: vi.fn(() => () => {}) },
    sessions: { list: sessions },
    workspaces: { list: workspaces, create: createWorkspace },
    uiWorkspace: {
      openSession, openWorkspace, pickDirectory, startSession: vi.fn(), connectWorkspace: vi.fn(),
    },
    surface: {
      snapshot: () => snapshot,
      async *follow(signal: AbortSignal) {
        yield snapshot
        await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }) })
      },
      presentModal,
      presentBubbles,
      dismissBubbles,
      setPointerInside: vi.fn(),
    },
    shortcuts: { register: vi.fn((command: ShortcutCommand) => { commands.push(command); return () => {} }) },
    slots: {
      register: vi.fn((registration: Registration) => { registrations.push(registration); return () => {} }),
      inject: vi.fn((_name: string, factory: () => unknown) => { factory(); return () => {} }),
    },
  }
  return {
    ctx, registrations, commands, dictionaries, sessions, workspaces, presentModal, presentBubbles, dismissBubbles,
    openSession, openWorkspace, pickDirectory, createWorkspace, disposers,
  }
}

const contextAt = (modal: string | null) => ({ region: 'page', modal, target: null }) as never

function workbenchInjected(registrations: readonly Registration[]): WorkbenchInjected {
  const modal = registrations.find(entry => entry.name === 'shell.modal')
  return (modal?.inject as () => WorkbenchInjected)()
}

it('declares the services it reads', () => {
  expect(inject).toEqual([
    'surface', 'slots', 'locale', 'shortcuts', 'resources', 'sessions', 'workspaces', 'uiWorkspace',
  ])
})

it('mounts the workbench dialog with its Workspace cards and conversation seat', () => {
  const { ctx, registrations, dictionaries, openSession } = context({
    sessions: [{ id: 's1', updatedAt: 1 }, { id: 's2', updatedAt: 2 }],
    workspaces: [view('ws-1', 'Alpha', ['s1', 's2'])],
  })
  apply(ctx as never)
  const modal = registrations.find(entry => entry.name === 'shell.modal')
  expect(modal).toMatchObject({
    name: 'shell.modal', id: WORKBENCH_MODAL_ID, locale: 'betterInteract',
    children: { 'better-interact.workbench.conversation': { kind: 'single', scope: 'session' } },
  })
  const workbench = workbenchInjected(registrations)
  expect(workbench.hooks.pages.getSnapshot()).toEqual({ active: undefined, sessions: {} })
  expect(workbench.hooks.notice.getSnapshot()).toBeNull()
  workbench.select(ws('ws-1'))
  expect(workbench.hooks.pages.getSnapshot()).toEqual({
    active: ws('ws-1'), sessions: { [ws('ws-1')]: sid('s2') },
  })
  expect(openSession).toHaveBeenCalledWith(sid('s2'))
  expect(registrations.find(entry => entry.name === 'better-interact.workbench.conversation')).toBeDefined()
  expect(ctx.resources.register).toHaveBeenCalledOnce()
  expect(dictionaries.namespace).toBe('betterInteract')
  expect([...dictionaries.languages].sort()).toEqual(['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'])
})

it('labels every workbench command for the shortcut catalog', () => {
  const { ctx, commands } = context()
  apply(ctx as never)
  expect(commands.map(command => command.label()).sort()).toEqual([
    'command.newWorkspace', 'command.next', 'command.open', 'command.previous',
  ])
})

it('mounts the bubble column and its bound stack', () => {
  const { ctx, registrations } = context()
  apply(ctx as never)
  expect(registrations.find(entry => entry.name === 'shell.overlay')).toMatchObject({
    name: 'shell.overlay', id: 'better-interact.bubbles', locale: 'betterInteract',
    children: { 'better-interact.bubbles.stack': { kind: 'single', scope: 'session' } },
  })
  const stack = registrations.find(entry => entry.name === 'better-interact.bubbles.stack')
  expect((stack?.inject as () => BubblesInjected)().hooks.surface.getSnapshot()).toEqual(ORB)
})

it('drives the carrier and opens the bubble Session in its Workspace page', () => {
  const { ctx, registrations, presentModal, presentBubbles, dismissBubbles, openSession } = context({
    sessions: [{ id: 's1', updatedAt: 1 }, { id: 's2', updatedAt: 2 }],
    workspaces: [view('ws-1', 'Alpha', ['s1', 's2']), view('ws-2', 'Beta', [])],
  })
  apply(ctx as never)
  const overlay = registrations.find(entry => entry.name === 'shell.overlay')
  const bubbles = (overlay?.inject as () => BubblesInjected)()
  const workbench = workbenchInjected(registrations)
  bubbles.show()
  bubbles.hide()
  bubbles.open(sid('s1'))
  bubbles.pointerInside(true)
  expect(presentBubbles).toHaveBeenCalledTimes(1)
  expect(dismissBubbles).toHaveBeenCalledTimes(1)
  expect(presentModal).toHaveBeenCalledWith(WORKBENCH_MODAL_ID, WORKBENCH_MODAL_SIZE)
  expect(workbench.hooks.pages.getSnapshot()).toEqual({
    active: ws('ws-1'), sessions: { [ws('ws-1')]: sid('s1') },
  })
  expect(openSession).toHaveBeenCalledWith(sid('s1'))
  expect(ctx.surface.setPointerInside).toHaveBeenCalledWith(true)
})

it('opens the most recently used Workspace page from the launcher', () => {
  const { ctx, commands, registrations, presentModal, openSession } = context({
    sessions: [{ id: 's1', updatedAt: 1 }, { id: 's2', updatedAt: 2 }],
    workspaces: [view('ws-1', 'Alpha', ['s1']), view('ws-2', 'Beta', ['s2'])],
  })
  apply(ctx as never)
  const workbench = workbenchInjected(registrations)
  workbench.select(ws('ws-2'))
  openSession.mockClear()
  const resolution = commands.find(entry => entry.id === WORKBENCH_COMMAND_ID)!.resolve(contextAt(null))
  expect(resolution.status).toBe('handled')
  if (resolution.status === 'handled') resolution.run()
  expect(presentModal).toHaveBeenCalledWith(WORKBENCH_MODAL_ID, WORKBENCH_MODAL_SIZE)
  expect(workbench.hooks.pages.getSnapshot().active).toBe(ws('ws-2'))
  expect(openSession).toHaveBeenCalledWith(sid('s2'))
})

it('falls back to the main view Workspace when no page is stored', () => {
  const { ctx, commands, registrations } = context({
    sessions: [{ id: 's1', updatedAt: 1 }, { id: 's2', updatedAt: 2, mainView: true }],
    workspaces: [view('ws-1', 'Alpha', ['s1']), view('ws-2', 'Beta', ['s2'])],
  })
  apply(ctx as never)
  const workbench = workbenchInjected(registrations)
  const resolution = commands.find(entry => entry.id === WORKBENCH_COMMAND_ID)!.resolve(contextAt(null))
  if (resolution.status === 'handled') resolution.run()
  expect(workbench.hooks.pages.getSnapshot().active).toBe(ws('ws-2'))
})

it('connects a Workspace page that has no Session yet', () => {
  const { ctx, registrations, openWorkspace, openSession } = context({
    workspaces: [view('ws-1', 'Alpha', []), view('ws-2', 'Beta', ['s2'])],
    sessions: [{ id: 's2', updatedAt: 1 }],
  })
  apply(ctx as never)
  const workbench = workbenchInjected(registrations)
  openSession.mockClear()
  workbench.select(ws('ws-1'))
  expect(workbench.hooks.pages.getSnapshot().active).toBe(ws('ws-1'))
  expect(openWorkspace).toHaveBeenCalledWith(ws('ws-1'))
  expect(openSession).not.toHaveBeenCalled()
})

it('cycles the Workspace pages with the next and previous commands only inside the dialog', () => {
  const { ctx, commands, registrations, openSession } = context({
    sessions: [{ id: 's1', updatedAt: 1 }, { id: 's2', updatedAt: 2 }],
    workspaces: [view('ws-1', 'Alpha', ['s1']), view('ws-2', 'Beta', ['s2'])],
  })
  apply(ctx as never)
  const workbench = workbenchInjected(registrations)
  workbench.select(ws('ws-1'))
  openSession.mockClear()
  const next = commands.find(entry => entry.id === WORKBENCH_NEXT_COMMAND_ID)!
  const previous = commands.find(entry => entry.id === WORKBENCH_PREVIOUS_COMMAND_ID)!
  expect(next.resolve(contextAt('orb.chat')).status).toBe('pass')
  const forwards = next.resolve(contextAt(WORKBENCH_MODAL_ID))
  expect(forwards.status).toBe('handled')
  if (forwards.status === 'handled') forwards.run()
  expect(workbench.hooks.pages.getSnapshot().active).toBe(ws('ws-2'))
  expect(openSession).toHaveBeenLastCalledWith(sid('s2'))
  const backwards = previous.resolve(contextAt(WORKBENCH_MODAL_ID))
  if (backwards.status === 'handled') backwards.run()
  expect(workbench.hooks.pages.getSnapshot().active).toBe(ws('ws-1'))
})

it('creates a Workspace from the picked directory and opens its page', async () => {
  const { ctx, commands, registrations, pickDirectory, createWorkspace, openWorkspace, presentModal } = context()
  pickDirectory.mockResolvedValueOnce('E:\\Project\\New')
  createWorkspace.mockResolvedValueOnce(view('ws-new', 'New', []))
  apply(ctx as never)
  const workbench = workbenchInjected(registrations)
  const resolution = commands.find(entry => entry.id === WORKBENCH_NEW_WORKSPACE_COMMAND_ID)!.resolve(contextAt(null))
  expect(resolution.status).toBe('handled')
  if (resolution.status === 'handled') resolution.run()
  await vi.waitFor(() => { expect(openWorkspace).toHaveBeenCalledWith(ws('ws-new')) })
  expect(createWorkspace).toHaveBeenCalledWith({ path: 'E:\\Project\\New' })
  expect(workbench.hooks.pages.getSnapshot().active).toBe(ws('ws-new'))
  expect(presentModal).toHaveBeenCalledWith(WORKBENCH_MODAL_ID, WORKBENCH_MODAL_SIZE)
  expect(workbench.hooks.notice.getSnapshot()).toBeNull()
})

it('leaves the workbench closed when the directory picker is cancelled', async () => {
  const { ctx, commands, pickDirectory, createWorkspace, presentModal } = context()
  pickDirectory.mockResolvedValueOnce(null)
  apply(ctx as never)
  const resolution = commands.find(entry => entry.id === WORKBENCH_NEW_WORKSPACE_COMMAND_ID)!.resolve(contextAt(null))
  if (resolution.status === 'handled') resolution.run()
  await vi.waitFor(() => { expect(pickDirectory).toHaveBeenCalledOnce() })
  expect(createWorkspace).not.toHaveBeenCalled()
  expect(presentModal).not.toHaveBeenCalled()
})

it('reports a Workspace creation failure inside the dialog', async () => {
  const { ctx, commands, registrations, pickDirectory, createWorkspace, presentModal } = context()
  const failure = new Error('name conflict')
  pickDirectory.mockResolvedValueOnce('E:\\Project\\Taken')
  createWorkspace.mockRejectedValueOnce(failure)
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  apply(ctx as never)
  const workbench = workbenchInjected(registrations)
  const resolution = commands.find(entry => entry.id === WORKBENCH_NEW_WORKSPACE_COMMAND_ID)!.resolve(contextAt(null))
  if (resolution.status === 'handled') resolution.run()
  await vi.waitFor(() => { expect(workbench.hooks.notice.getSnapshot()).toBe('workbench.createFailed') })
  expect(error).toHaveBeenCalledWith('better-interact: creating the workspace failed', failure)
  expect(presentModal).toHaveBeenCalledWith(WORKBENCH_MODAL_ID, WORKBENCH_MODAL_SIZE)
  error.mockRestore()
})

it('reports a directory-picker failure inside the dialog', async () => {
  const { ctx, commands, registrations, pickDirectory, createWorkspace, presentModal } = context()
  const failure = new Error('picker unavailable')
  pickDirectory.mockRejectedValueOnce(failure)
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  apply(ctx as never)
  const workbench = workbenchInjected(registrations)
  const resolution = commands.find(entry => entry.id === WORKBENCH_NEW_WORKSPACE_COMMAND_ID)!.resolve(contextAt(null))
  if (resolution.status === 'handled') resolution.run()
  await vi.waitFor(() => { expect(workbench.hooks.notice.getSnapshot()).toBe('workbench.createFailed') })
  expect(createWorkspace).not.toHaveBeenCalled()
  expect(error).toHaveBeenCalledWith('better-interact: picking the workspace directory failed', failure)
  expect(presentModal).toHaveBeenCalledWith(WORKBENCH_MODAL_ID, WORKBENCH_MODAL_SIZE)
  error.mockRestore()
})

it('follows the main view Session into its Workspace page while the dialog is open', () => {
  const { ctx, registrations, sessions, workspaces } = context({
    surface: WORKBENCH,
    sessions: [{ id: 's1', updatedAt: 1, mainView: true }, { id: 's2', updatedAt: 2 }],
    workspaces: [view('ws-1', 'Alpha', ['s1']), view('ws-2', 'Beta', ['s2'])],
  })
  apply(ctx as never)
  const workbench = workbenchInjected(registrations)
  workbench.select(ws('ws-1'))
  sessions.set({
    ...sessions.getSnapshot(),
    byId: { [sid('s1')]: row('s1', { updatedAt: 1 }), [sid('s2')]: row('s2', { updatedAt: 2, retainedBy: { mainView: 1 } }) },
  })
  workspaces.set({
    ...workspaces.getSnapshot(),
    items: [view('ws-1', 'Alpha', ['s1']), view('ws-2', 'Beta', ['s2'])],
  })
  expect(workbench.hooks.pages.getSnapshot()).toEqual({
    active: ws('ws-2'), sessions: { [ws('ws-1')]: sid('s1'), [ws('ws-2')]: sid('s2') },
  })
})

it('records the main view Session without switching pages behind a closed dialog', () => {
  const { ctx, registrations, sessions, workspaces } = context({
    sessions: [{ id: 's1', updatedAt: 1, mainView: true }, { id: 's2', updatedAt: 2 }],
    workspaces: [view('ws-1', 'Alpha', ['s1']), view('ws-2', 'Beta', ['s2'])],
  })
  apply(ctx as never)
  const workbench = workbenchInjected(registrations)
  workbench.select(ws('ws-2'))
  sessions.set({
    ...sessions.getSnapshot(),
    byId: { [sid('s1')]: row('s1', { updatedAt: 1, retainedBy: { mainView: 1 } }), [sid('s2')]: row('s2', { updatedAt: 2 }) },
  })
  workspaces.set({ ...workspaces.getSnapshot(), items: [view('ws-1', 'Alpha', ['s1']), view('ws-2', 'Beta', ['s2'])] })
  expect(workbench.hooks.pages.getSnapshot()).toEqual({
    active: ws('ws-2'), sessions: { [ws('ws-1')]: sid('s1'), [ws('ws-2')]: sid('s2') },
  })
})

it('drops pages and Session choices whose Workspace or Session left the catalogs', () => {
  const { ctx, registrations, sessions, workspaces } = context({
    sessions: [{ id: 's1', updatedAt: 1 }, { id: 's2', updatedAt: 2 }],
    workspaces: [view('ws-1', 'Alpha', ['s1']), view('ws-2', 'Beta', ['s2'])],
  })
  apply(ctx as never)
  const workbench = workbenchInjected(registrations)
  workbench.select(ws('ws-2'))
  workspaces.set({ ...workspaces.getSnapshot(), items: [view('ws-1', 'Alpha', ['s1'])] })
  sessions.set({ ...sessions.getSnapshot(), ids: [sid('s1')], byId: { [sid('s1')]: row('s1', { updatedAt: 1 }) } })
  expect(workbench.hooks.pages.getSnapshot()).toEqual({ active: undefined, sessions: {} })
})

it('reports a carrier that refuses a presentation command', async () => {
  const { ctx, registrations } = context()
  ctx.surface.dismissBubbles.mockRejectedValueOnce(new Error('carrier closed'))
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  apply(ctx as never)
  const overlay = registrations.find(entry => entry.name === 'shell.overlay')
  const bubbles = (overlay?.inject as () => BubblesInjected)()
  bubbles.hide()
  await vi.waitFor(() => {
    expect(error).toHaveBeenCalledWith('better-interact: dismissing the bubble column failed', new Error('carrier closed'))
  })
  error.mockRestore()
})

it('reports a carrier that refuses the workbench', async () => {
  const { ctx, commands } = context()
  const failure = new Error('carrier closed')
  ctx.surface.presentModal.mockRejectedValueOnce(failure)
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  apply(ctx as never)
  const resolution = commands.find(entry => entry.id === WORKBENCH_COMMAND_ID)!.resolve(contextAt(null))
  if (resolution.status === 'handled') resolution.run()
  await vi.waitFor(() => {
    expect(error).toHaveBeenCalledWith('better-interact: opening the workbench failed', failure)
  })
  error.mockRestore()
})

it('reports a Workspace page that cannot connect', async () => {
  const { ctx, registrations, openWorkspace } = context({
    workspaces: [view('ws-1', 'Alpha', [])],
  })
  const failure = new Error('carrier closed')
  openWorkspace.mockRejectedValueOnce(failure)
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  apply(ctx as never)
  const workbench = workbenchInjected(registrations)
  workbench.select(ws('ws-1'))
  await vi.waitFor(() => {
    expect(error).toHaveBeenCalledWith('better-interact: opening the workspace page failed', failure)
  })
  error.mockRestore()
})

it('opens an empty catalog dialog without a page', () => {
  const { ctx, commands, registrations, presentModal } = context({ workspaces: [], sessions: [] })
  apply(ctx as never)
  const workbench = workbenchInjected(registrations)
  const resolution = commands.find(entry => entry.id === WORKBENCH_COMMAND_ID)!.resolve(contextAt(null))
  if (resolution.status === 'handled') resolution.run()
  expect(presentModal).toHaveBeenCalledWith(WORKBENCH_MODAL_ID, WORKBENCH_MODAL_SIZE)
  expect(workbench.hooks.pages.getSnapshot()).toEqual({ active: undefined, sessions: {} })
})
