/** Desktop bridge that stages the workspace around the first-run flow. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopOnboardingState } from './onboarding-contract.ts'

/** Preload capability telling the desktop shell whether the introduction still covers the workspace. */
export interface OnboardingActivityBridge {
  /** @param active - whether the introduction still owns this renderer's workspace. */
  setActive(active: boolean): void
}

/**
 * Report the introduction's presence to the desktop shell from every product
 * window. The carrier stages the workspace from this state rather than from the
 * window that paints the flow: a form profile opens a standalone first-run window
 * and keeps the orb, the workbench surface, and the bubble column hidden until it
 * finishes, while the classic workspace resizes and covers itself in place.
 * @param state - controller snapshot source.
 * @param bridge - preload capability; absent in a plain browser, which stages no windows.
 * @returns disposer reporting inactivity for a renderer that leaves mid-flow.
 */
export function reportOnboardingActivity(
  state: HostObservable<DesktopOnboardingState>,
  bridge: OnboardingActivityBridge | undefined,
): () => void {
  if (bridge === undefined) return () => {}
  let reported = state.getSnapshot().visible
  bridge.setActive(reported)
  const off = state.subscribe(() => {
    const active = state.getSnapshot().visible
    if (active === reported) return
    reported = active
    bridge.setActive(active)
  })
  return () => {
    off()
    if (!reported) return
    reported = false
    bridge.setActive(false)
  }
}
