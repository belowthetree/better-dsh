/** Activity reporting decides when the desktop carrier stages the first-run window. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { expect, it, vi } from 'vitest'
import { reportOnboardingActivity } from '../src/client/onboarding-activity.ts'
import type { DesktopOnboardingState } from '../src/client/onboarding-contract.ts'

function snapshot(visible: boolean, status: DesktopOnboardingState['status'] = 'ready'): DesktopOnboardingState {
  return {
    status, visible, creditFunded: false, error: null,
    progress: { version: 1, step: 'welcome', purpose: null, process: null, completion: null, usage: 'compact', developerTools: false },
  }
}

it('reports each visibility change once and inactivity when the renderer leaves', () => {
  const state = createSnapshotStore<DesktopOnboardingState>(snapshot(false))
  const bridge = { setActive: vi.fn() }
  const dispose = reportOnboardingActivity(state, bridge)
  expect(bridge.setActive).toHaveBeenLastCalledWith(false)
  state.set(snapshot(true))
  expect(bridge.setActive).toHaveBeenLastCalledWith(true)
  // A status change that leaves the flow visible is not a new activity report.
  state.set(snapshot(true, 'saving'))
  expect(bridge.setActive).toHaveBeenCalledTimes(2)
  state.set(snapshot(false))
  expect(bridge.setActive).toHaveBeenLastCalledWith(false)
  state.set(snapshot(true))
  expect(bridge.setActive).toHaveBeenLastCalledWith(true)
  dispose()
  expect(bridge.setActive).toHaveBeenLastCalledWith(false)
  // A disposed renderer reports nothing further.
  state.set(snapshot(true))
  expect(bridge.setActive).toHaveBeenCalledTimes(5)
})

it('leaves a renderer without a desktop bridge alone', () => {
  const state = createSnapshotStore<DesktopOnboardingState>(snapshot(true))
  expect(() => { reportOnboardingActivity(state, undefined)() }).not.toThrow()
})
