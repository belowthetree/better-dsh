/** The plugin mounts the bubble column, the workbench cards, and the launcher commands. */
import { expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ShortcutCommand } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  apply, inject, WORKBENCH_COMMAND_ID, WORKBENCH_NEXT_COMMAND_ID, WORKBENCH_PREVIOUS_COMMAND_ID,
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

function row(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return { id: sid(id), displayTitle: id, running: false, retainedBy: {}, blank: false, updatedAt: 0, ...overrides }
}

function sessionList(ids: readonly string[], mainView?: string) {
  return createSnapshotStore<SessionListState>({
    ids: ids.map(sid),
    byId: Object.fromEntries(ids.map(id => [id, row(id, mainView === id ? { retainedBy: { mainView: 1 } } : {})])),
    phase: 'ready',
    projectionsBySession: {},
  })
}

function context(options: { readonly surface?: SurfaceSnapshot; readonly ids?: readonly string[]; readonly mainView?: string } = {}) {
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
  const snapshot = options.surface ?? ORB
  const list = sessionList(options.ids ?? ['session-1'], options.mainView)
  const ctx = {
    effect: (factory: () => unknown) => {
      const value = factory()
      if (typeof value === 'function') disposers.push(value as () => void)
      return () => {}
    },
    locale: { register: record, bind: vi.fn(() => (key: string) => key) },
    resources: { register: vi.fn(() => () => {}) },
    sessions: { list },
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
  return { ctx, registrations, commands, dictionaries, list, presentModal, presentBubbles, dismissBubbles, disposers }
}

const contextAt = (modal: string | null) => ({ region: 'page', modal, target: null }) as never

function workbenchInjected(registrations: readonly Registration[]): WorkbenchInjected {
  const modal = registrations.find(entry => entry.name === 'shell.modal')
  return (modal?.inject as () => WorkbenchInjected)()
}

it('declares the services it reads', () => {
  expect(inject).toEqual(['surface', 'slots', 'locale', 'shortcuts', 'resources', 'sessions'])
})

it('mounts the workbench dialog with its card strip and conversation seat', () => {
  const { ctx, registrations, dictionaries } = context()
  apply(ctx as never)
  const modal = registrations.find(entry => entry.name === 'shell.modal')
  expect(modal).toMatchObject({
    name: 'shell.modal', id: WORKBENCH_MODAL_ID, locale: 'betterInteract',
    children: { 'better-interact.workbench.conversation': { kind: 'single', scope: 'session' } },
  })
  const injected = (modal?.inject as () => WorkbenchInjected)()
  expect(injected.hooks.tabs.getSnapshot()).toEqual({ sessionIds: [], active: undefined })
  injected.select(sid('session-2'))
  expect(injected.hooks.tabs.getSnapshot()).toEqual({ sessionIds: [sid('session-2')], active: sid('session-2') })
  expect(registrations.find(entry => entry.name === 'better-interact.workbench.conversation')).toBeDefined()
  expect(ctx.resources.register).toHaveBeenCalledOnce()
  expect(dictionaries.namespace).toBe('betterInteract')
  expect([...dictionaries.languages].sort()).toEqual(['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'])
})

it('labels every workbench command for the shortcut catalog', () => {
  const { ctx, commands } = context()
  apply(ctx as never)
  expect(commands.map(command => command.label()).sort()).toEqual([
    'command.next', 'command.open', 'command.previous',
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

it('drives the carrier presentation and the card strip from the bubble entries', () => {
  const { ctx, registrations, presentModal, presentBubbles, dismissBubbles } = context()
  apply(ctx as never)
  const overlay = registrations.find(entry => entry.name === 'shell.overlay')
  const injected = (overlay?.inject as () => BubblesInjected)()
  const modal = registrations.find(entry => entry.name === 'shell.modal')
  const workbench = (modal?.inject as () => WorkbenchInjected)()
  expect(injected.hooks.surface.getSnapshot()).toEqual(ORB)
  injected.show()
  injected.hide()
  injected.open(sid('session-2'))
  injected.pointerInside(true)
  expect(presentBubbles).toHaveBeenCalledTimes(1)
  expect(dismissBubbles).toHaveBeenCalledTimes(1)
  expect(presentModal).toHaveBeenCalledWith(WORKBENCH_MODAL_ID, WORKBENCH_MODAL_SIZE)
  expect(workbench.hooks.tabs.getSnapshot()).toEqual({ sessionIds: [sid('session-2')], active: sid('session-2') })
  expect(ctx.surface.setPointerInside).toHaveBeenCalledWith(true)
})

it('reports a carrier that refuses a presentation command', async () => {
  const { ctx, registrations } = context()
  ctx.surface.dismissBubbles.mockRejectedValueOnce(new Error('carrier closed'))
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  apply(ctx as never)
  const overlay = registrations.find(entry => entry.name === 'shell.overlay')
  const injected = (overlay?.inject as () => BubblesInjected)()
  injected.hide()
  await vi.waitFor(() => {
    expect(error).toHaveBeenCalledWith('better-interact: dismissing the bubble column failed', new Error('carrier closed'))
  })
  error.mockRestore()
})

it('opens the most recently used card from the launcher command', () => {
  const { ctx, commands, registrations, presentModal } = context()
  apply(ctx as never)
  const modal = registrations.find(entry => entry.name === 'shell.modal')
  const workbench = (modal?.inject as () => WorkbenchInjected)()
  workbench.select(sid('recent'))
  const command = commands.find(entry => entry.id === WORKBENCH_COMMAND_ID)
  expect(command).toBeDefined()
  const resolution = command!.resolve(contextAt(null))
  expect(resolution.status).toBe('handled')
  if (resolution.status === 'handled') resolution.run()
  expect(presentModal).toHaveBeenCalledWith(WORKBENCH_MODAL_ID, WORKBENCH_MODAL_SIZE)
  expect(workbench.hooks.tabs.getSnapshot()).toEqual({ sessionIds: [sid('recent')], active: sid('recent') })
})

it('reports a carrier that refuses the workbench', async () => {
  const { ctx, commands } = context()
  const failure = new Error('carrier closed')
  ctx.surface.presentModal.mockRejectedValueOnce(failure)
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  apply(ctx as never)
  const resolution = commands.find(entry => entry.id === WORKBENCH_COMMAND_ID)!.resolve(contextAt(null))
  if (resolution.status === 'handled') resolution.run()
  await vi.waitFor(() => { expect(error).toHaveBeenCalledWith('better-interact: opening the workbench failed', failure) })
  error.mockRestore()
})

it('cycles the cards with the next and previous commands only inside the dialog', () => {
  const { ctx, commands, registrations } = context({ ids: ['one', 'two', 'three'] })
  apply(ctx as never)
  const modal = registrations.find(entry => entry.name === 'shell.modal')
  const workbench = (modal?.inject as () => WorkbenchInjected)()
  workbench.select(sid('one'))
  workbench.select(sid('two'))
  workbench.select(sid('three'))
  const next = commands.find(entry => entry.id === WORKBENCH_NEXT_COMMAND_ID)!
  const previous = commands.find(entry => entry.id === WORKBENCH_PREVIOUS_COMMAND_ID)!
  expect(next.resolve(contextAt('orb.chat')).status).toBe('pass')
  const forwards = next.resolve(contextAt(WORKBENCH_MODAL_ID))
  expect(forwards.status).toBe('handled')
  if (forwards.status === 'handled') forwards.run()
  expect(workbench.hooks.tabs.getSnapshot().active).toBe(sid('one'))
  const backwards = previous.resolve(contextAt(WORKBENCH_MODAL_ID))
  expect(backwards.status).toBe('handled')
  if (backwards.status === 'handled') backwards.run()
  expect(workbench.hooks.tabs.getSnapshot().active).toBe(sid('three'))
})

it('adds a new workbench when New Session moves the main view behind the dialog', async () => {
  const { ctx, registrations, list } = context({ surface: WORKBENCH, ids: ['old'], mainView: 'old' })
  apply(ctx as never)
  const workbench = workbenchInjected(registrations)
  const created = {
    ids: [sid('new'), sid('old')],
    byId: {
      [sid('new')]: row('new', { blank: true, retainedBy: { mainView: 1 } }),
      [sid('old')]: row('old'),
    },
    phase: 'ready' as const,
    projectionsBySession: {},
  }
  list.set(created)
  await vi.waitFor(() => {
    expect(workbench.hooks.tabs.getSnapshot()).toEqual({ sessionIds: [sid('new')], active: sid('new') })
  })
  list.set(created)
  expect(workbench.hooks.tabs.getSnapshot()).toEqual({ sessionIds: [sid('new')], active: sid('new') })
  list.set({ ids: [sid('new')], byId: { [sid('new')]: row('new') }, phase: 'ready', projectionsBySession: {} })
  expect(workbench.hooks.tabs.getSnapshot()).toEqual({ sessionIds: [sid('new')], active: sid('new') })
})

it('adds the first main-view Session seen while the dialog is open', async () => {
  const { ctx, registrations, list } = context({ surface: WORKBENCH, ids: [] })
  apply(ctx as never)
  const workbench = workbenchInjected(registrations)
  list.set({
    ids: [sid('first')],
    byId: { [sid('first')]: row('first', { blank: true, retainedBy: { mainView: 1 } }) },
    phase: 'ready',
    projectionsBySession: {},
  })
  await vi.waitFor(() => {
    expect(workbench.hooks.tabs.getSnapshot()).toEqual({ sessionIds: [sid('first')], active: sid('first') })
  })
})

it('does not add a card when the main view changes behind a closed dialog', () => {
  const { ctx, registrations, list } = context({ surface: ORB, ids: ['old'], mainView: 'old' })
  apply(ctx as never)
  const workbench = workbenchInjected(registrations)
  list.set({
    ids: [sid('new'), sid('old')],
    byId: {
      [sid('new')]: row('new', { blank: true, retainedBy: { mainView: 1 } }),
      [sid('old')]: row('old'),
    },
    phase: 'ready',
    projectionsBySession: {},
  })
  expect(workbench.hooks.tabs.getSnapshot()).toEqual({ sessionIds: [], active: undefined })
})

it('keeps cards through a pending catalog and prunes them once it is ready', () => {
  const { ctx, registrations, list } = context({ ids: ['one'] })
  apply(ctx as never)
  const workbench = workbenchInjected(registrations)
  workbench.select(sid('one'))
  list.set({ ids: [], byId: {}, phase: 'pending', projectionsBySession: {} })
  expect(workbench.hooks.tabs.getSnapshot()).toEqual({ sessionIds: [sid('one')], active: sid('one') })
  list.set({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} })
  expect(workbench.hooks.tabs.getSnapshot()).toEqual({ sessionIds: [], active: undefined })
})

it('keeps the launcher and cycle commands safe without any Session', () => {
  const { ctx, commands, presentModal } = context({ ids: [] })
  apply(ctx as never)
  const open = commands.find(entry => entry.id === WORKBENCH_COMMAND_ID)!.resolve(contextAt(null))
  expect(open.status).toBe('handled')
  if (open.status === 'handled') open.run()
  expect(presentModal).toHaveBeenCalledWith(WORKBENCH_MODAL_ID, WORKBENCH_MODAL_SIZE)
  const next = commands.find(entry => entry.id === WORKBENCH_NEXT_COMMAND_ID)!.resolve(contextAt(WORKBENCH_MODAL_ID))
  expect(next.status).toBe('handled')
  if (next.status === 'handled') next.run()
})
