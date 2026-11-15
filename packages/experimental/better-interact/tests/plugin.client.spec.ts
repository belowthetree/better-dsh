/** The plugin mounts the bubble column, the workbench dialog, its Session resource, and the launcher command. */
import { expect, it, vi } from 'vitest'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
import { apply, inject, WORKBENCH_COMMAND_ID } from '../src/client/index.ts'
import type { BubblesInjected } from '../src/client/bubbles.tsx'
import { WORKBENCH_MODAL_ID } from '../src/client/resource.ts'

type Registration = { readonly name: string; readonly [key: string]: unknown }
type Command = { readonly id: string; readonly resolve: () => { readonly status: string; readonly run: () => void } }

/** Orb presentation the carrier reports while the plugin runs. */
const ORB: SurfaceSnapshot = { form: 'orb', presentation: 'orb', pinned: false, available: true, modal: null }

function context() {
  const registrations: Registration[] = []
  const disposers: (() => void)[] = []
  const commands: Command[] = []
  const dictionaries: { readonly namespace?: string; readonly languages: string[] } = { languages: [] }
  const record = (namespace: string, values: Record<string, unknown>): (() => void) => {
    (dictionaries as { namespace?: string }).namespace = namespace
    dictionaries.languages.push(...Object.keys(values))
    return () => {}
  }
  const presentModal = vi.fn(() => Promise.resolve())
  const presentBubbles = vi.fn(() => Promise.resolve())
  const dismissBubbles = vi.fn(() => Promise.resolve())
  const ctx = {
    effect: (factory: () => unknown) => {
      const value = factory()
      if (typeof value === 'function') disposers.push(value as () => void)
      return () => {}
    },
    locale: { register: record, bind: vi.fn(() => (key: string) => key) },
    resources: { register: vi.fn(() => () => {}) },
    sessions: {},
    surface: {
      snapshot: () => ORB,
      async *follow(signal: AbortSignal) {
        yield ORB
        await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }) })
      },
      presentModal,
      presentBubbles,
      dismissBubbles,
    },
    shortcuts: { register: vi.fn((command: Command) => { commands.push(command); return () => {} }) },
    slots: {
      register: vi.fn((options: Registration) => { registrations.push(options); return () => {} }),
      inject: vi.fn((_name: string, factory: () => unknown) => { factory(); return () => {} }),
    },
  }
  return { ctx, registrations, commands, dictionaries, presentModal, presentBubbles, dismissBubbles, disposers }
}

it('declares the services it reads', () => {
  expect(inject).toEqual(['surface', 'slots', 'locale', 'shortcuts', 'resources', 'sessions'])
})

it('mounts the workbench dialog and its conversation seat', () => {
  const { ctx, registrations, dictionaries } = context()
  apply(ctx as never)
  expect(registrations.find(entry => entry.name === 'shell.modal')).toMatchObject({
    name: 'shell.modal', id: WORKBENCH_MODAL_ID, locale: 'betterInteract',
    children: { 'better-interact.workbench.conversation': { kind: 'single', scope: 'session' } },
  })
  expect(registrations.find(entry => entry.name === 'better-interact.workbench.conversation')).toBeDefined()
  expect(ctx.resources.register).toHaveBeenCalledOnce()
  expect(dictionaries.namespace).toBe('betterInteract')
  expect([...dictionaries.languages].sort()).toEqual(['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'])
})

it('mounts the bubble column and its bound stack', () => {
  const { ctx, registrations } = context()
  apply(ctx as never)
  expect(registrations.find(entry => entry.name === 'shell.overlay')).toMatchObject({
    name: 'shell.overlay', id: 'better-interact.bubbles', locale: 'betterInteract',
    children: { 'better-interact.bubbles.stack': { kind: 'single', scope: 'session' } },
  })
  expect(registrations.find(entry => entry.name === 'better-interact.bubbles.stack')).toBeDefined()
})

it('drives the carrier presentation from the bubble entries', () => {
  const { ctx, registrations, presentModal, presentBubbles, dismissBubbles } = context()
  apply(ctx as never)
  const overlay = registrations.find(entry => entry.name === 'shell.overlay')
  const injected = (overlay?.inject as () => BubblesInjected)()
  expect(injected.hooks.surface.getSnapshot()).toEqual(ORB)
  injected.show()
  injected.hide()
  injected.open()
  expect(presentBubbles).toHaveBeenCalledTimes(1)
  expect(dismissBubbles).toHaveBeenCalledTimes(1)
  expect(presentModal).toHaveBeenCalledWith(WORKBENCH_MODAL_ID)
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

it('opens the workbench through the carrier from its launcher command', () => {
  const { ctx, commands, presentModal } = context()
  apply(ctx as never)
  const command = commands.find(entry => entry.id === WORKBENCH_COMMAND_ID)
  expect(command).toBeDefined()
  const resolution = command!.resolve()
  expect(resolution.status).toBe('handled')
  resolution.run()
  expect(presentModal).toHaveBeenCalledWith(WORKBENCH_MODAL_ID)
})

it('reports a carrier that refuses the workbench', async () => {
  const { ctx, commands } = context()
  const failure = new Error('carrier closed')
  ctx.surface.presentModal.mockRejectedValueOnce(failure)
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  apply(ctx as never)
  commands[0]!.resolve().run()
  await vi.waitFor(() => { expect(error).toHaveBeenCalledWith('better-interact: opening the workbench failed', failure) })
  error.mockRestore()
})
