/** The workbench resource retains exactly the Session it addresses. */
import { expect, it, vi } from 'vitest'
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { parseWorkbenchAddress, workbenchAddress, workbenchResourceProvider } from '../src/client/resource.ts'

it('round-trips a Session address and keeps the empty catalog address', () => {
  expect(parseWorkbenchAddress(workbenchAddress('session-1' as SessionId))).toBe('session-1')
  expect(parseWorkbenchAddress(workbenchAddress(undefined))).toBeUndefined()
})

it.each([
  'dsh-resource://other/session/x',
  'dsh-resource://betterinteract/thread/x',
  'dsh-resource://betterinteract/session/a/b',
])('rejects the foreign workbench address %s', (address) => {
  expect(() => parseWorkbenchAddress(address)).toThrow(/invalid workbench resource address/u)
})

function sessions(): ISessions & { readonly released: () => number } {
  let released = 0
  const reference: SessionReference = { sessionId: 'session-1' as SessionId, release: () => { released += 1 } }
  return {
    retain: vi.fn(() => reference),
    get released() { return released },
  } as unknown as ISessions & { readonly released: () => number }
}

async function firstValue(provider: ReturnType<typeof workbenchResourceProvider>, address: string) {
  const controller = new AbortController()
  const iterator = provider.open(address, { signal: controller.signal })[Symbol.asyncIterator]()
  const first = await iterator.next()
  return { controller, iterator, first }
}

it('publishes an empty value while no Session exists', async () => {
  const provider = workbenchResourceProvider(sessions())
  const { controller, iterator, first } = await firstValue(provider, workbenchAddress(undefined))
  expect(first.value).toEqual({ ok: true, value: {} })
  controller.abort()
  expect((await iterator.next()).done).toBe(true)
})

it('retains the addressed Session and releases it when the workbench closes', async () => {
  const store = sessions()
  const provider = workbenchResourceProvider(store)
  const { controller, iterator, first } = await firstValue(provider, workbenchAddress('session-1' as SessionId))
  expect(first.value).toMatchObject({ ok: true, value: { reference: { sessionId: 'session-1' } } })
  controller.abort()
  expect((await iterator.next()).done).toBe(true)
  expect(store.released).toBe(1)
})

it('publishes nothing when the workbench closes before opening', async () => {
  const provider = workbenchResourceProvider(sessions())
  const controller = new AbortController()
  controller.abort()
  const iterator = provider.open(workbenchAddress('session-1' as SessionId), { signal: controller.signal })[Symbol.asyncIterator]()
  expect((await iterator.next()).done).toBe(true)
})
