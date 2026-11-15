/** The plugin mounts the workbench dialog, its Session resource, and the launcher command. */
import { expect, it, vi } from 'vitest'
import { apply, inject, WORKBENCH_COMMAND_ID } from '../src/client/index.ts'
import { WORKBENCH_MODAL_ID } from '../src/client/resource.ts'

type Registration = { readonly name: string; readonly [key: string]: unknown }
type Command = { readonly id: string; readonly resolve: () => { readonly status: string; readonly run: () => void } }

function context() {
  const registrations: Registration[] = []
  const disposers: (() => void)[] = []
  const commands: Command[] = []
  const presentModal = vi.fn(() => Promise.resolve())
  const ctx = {
    effect: (factory: () => unknown) => {
      const value = factory()
      if (typeof value === 'function') disposers.push(value as () => void)
      return () => {}
    },
    locale: { register: vi.fn(() => () => {}), bind: vi.fn(() => (key: string) => key) },
    resources: { register: vi.fn(() => () => {}) },
    sessions: {},
    surface: { presentModal },
    shortcuts: { register: vi.fn((command: Command) => { commands.push(command); return () => {} }) },
    slots: {
      register: vi.fn((options: Registration) => { registrations.push(options); return () => {} }),
      inject: vi.fn((_name: string, factory: () => unknown) => { factory(); return () => {} }),
    },
  }
  return { ctx, registrations, commands, presentModal, disposers }
}

it('declares the services it reads', () => {
  expect(inject).toEqual(['surface', 'slots', 'locale', 'shortcuts', 'resources', 'sessions'])
})

it('mounts the workbench dialog and its conversation seat', () => {
  const { ctx, registrations } = context()
  apply(ctx as never)
  expect(registrations.find(entry => entry.name === 'shell.modal')).toMatchObject({
    name: 'shell.modal', id: WORKBENCH_MODAL_ID, locale: 'betterInteract',
    children: { 'better-interact.workbench.conversation': { kind: 'single', scope: 'session' } },
  })
  expect(registrations.find(entry => entry.name === 'better-interact.workbench.conversation')).toBeDefined()
  expect(ctx.resources.register).toHaveBeenCalledOnce()
  expect(ctx.locale.register).toHaveBeenCalledWith('betterInteract',
    expect.objectContaining({ zh: expect.any(Object), en: expect.any(Object) }))
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
