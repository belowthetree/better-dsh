/** The orb action registry: ordering, publication identity, disposal, and its bounds. */
import { expect, it, vi } from 'vitest'
import { createOrbActions } from '../src/client/orb-actions.ts'
import type { OrbAction } from '../src/client/orb-actions.ts'
import { MAX_ORB_ACTIONS } from '../src/client/orb-action-layout.ts'

/** One action with a stable id and a recording run callback. */
function action(
  id: string,
  options: { order?: number; label?: string } = {},
): OrbAction & { readonly run: ReturnType<typeof vi.fn<() => void>> } {
  return {
    id,
    label: () => options.label ?? id,
    icon: { key: id },
    ...options.order === undefined ? {} : { order: options.order },
    run: vi.fn<() => void>(),
  }
}

it('publishes registered actions in order and keeps free registrations in registration order', () => {
  const service = createOrbActions()
  const first = action('first')
  const second = action('second', { order: -1 })
  service.register(first)
  service.register(second)
  expect(service.items.getSnapshot().map(view => view.id)).toEqual(['second', 'first'])
  const snapshot = service.items.getSnapshot()
  service.register(action('third'))
  expect(service.items.getSnapshot().map(view => view.id)).toEqual(['second', 'first', 'third'])
  expect(service.items.getSnapshot()).not.toBe(snapshot)
})

it('publishes only presentation fields and runs the registered action', () => {
  const service = createOrbActions()
  const dialog = action('dialog', { label: 'Assistant dialog' })
  service.register(dialog)
  const [view] = service.items.getSnapshot()
  expect(view).toEqual({ id: 'dialog', label: dialog.label, icon: { key: 'dialog' } })
  service.run('dialog')
  expect(dialog.run).toHaveBeenCalledOnce()
  service.run('missing')
  expect(dialog.run).toHaveBeenCalledOnce()
})

it('removes an action with its disposer and rejects a repeated id', () => {
  const service = createOrbActions()
  const dispose = service.register(action('dialog'))
  expect(() => service.register(action('dialog'))).toThrow('orb action "dialog" is already registered')
  dispose()
  expect(service.items.getSnapshot()).toEqual([])
  // Re-registering after disposal is allowed.
  expect(() => service.register(action('dialog'))).not.toThrow()
})

it('holds no more actions than the ring can lay out', () => {
  const service = createOrbActions()
  for (let index = 0; index < MAX_ORB_ACTIONS; index += 1) service.register(action(`action-${String(index)}`))
  expect(() => service.register(action('overflow'))).toThrow(
    `the orb options ring holds at most ${String(MAX_ORB_ACTIONS)} actions`,
  )
})
