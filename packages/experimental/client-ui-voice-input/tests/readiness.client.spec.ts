/** The voice views share one catalog mirror over the shared capture service. */
import { expect, it, vi } from 'vitest'
import { observeReadiness } from '../src/client/readiness.ts'
import { CATALOG, fakeCapture } from './capture-service.client.ts'

it('publishes the catalog the capture service forwards and stops on disposal', async () => {
  const { capture } = fakeCapture()
  const mirror = observeReadiness(capture)
  await vi.waitFor(() => { expect(mirror.state.getSnapshot()).toEqual({ catalog: CATALOG, connected: true, error: null }) })
  await mirror.dispose()
})

it.each([new Error('invalid snapshot'), 'invalid snapshot'])('reports a terminal catalog failure (%s)', async (failure) => {
  const { capture } = fakeCapture({ catalogs: [CATALOG], catalogFailure: failure })
  const mirror = observeReadiness(capture)
  await vi.waitFor(() => { expect(mirror.state.getSnapshot()).toMatchObject({ connected: false, error: 'invalid snapshot' }) })
  expect(mirror.state.getSnapshot().catalog).toBe(CATALOG)
  await mirror.dispose()
})
