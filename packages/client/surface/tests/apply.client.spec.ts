// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import type { DesktopSurfaceApi, SurfaceSnapshot } from '../src/protocol.ts'
import { apply } from '../src/client/index.ts'
import type { SurfaceService } from '../src/client/index.ts'

/** Committed orb presentation the carrier boots with. */
const ORB: SurfaceSnapshot = Object.freeze({
  form: 'orb', role: 'orb', presentation: 'orb', pinned: false, available: true, modal: null, orbHovered: false,
})

interface FakeBridge {
  readonly api: DesktopSurfaceApi
  /** Publish one snapshot to the plugin's follower. */
  push(snapshot: SurfaceSnapshot): void
  /** Whether the plugin still holds its carrier subscription. */
  readonly subscribed: boolean
}

function fakeBridge(initial: SurfaceSnapshot): FakeBridge {
  let current = initial
  const listeners = new Set<(snapshot: SurfaceSnapshot) => void>()
  const api: DesktopSurfaceApi = {
    snapshot: async () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    expand: async () => {},
    collapse: async () => {},
    presentModal: async () => {},
    dismissModal: async () => {},
    presentBubbles: async () => {},
    dismissBubbles: async () => {},
    setPinned: async () => {},
    dragBy: async () => {},
    pointerInside: () => {},
  }
  return {
    api,
    get subscribed(): boolean { return listeners.size > 0 },
    push: (snapshot) => {
      current = snapshot
      for (const listener of [...listeners]) listener(snapshot)
    },
  }
}

function serviceOf(ctx: Context): SurfaceService {
  const surface = ctx.get('surface')
  if (surface === undefined) throw new Error('the surface plugin did not provide its service')
  return surface
}

afterEach(() => {
  Reflect.deleteProperty(window, 'dshDesktop')
  delete (globalThis as { __DSH_SURFACE__?: SurfaceSnapshot }).__DSH_SURFACE__
})

describe('surface client plugin', () => {
  it('provides the inert classic presentation on Web', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(serviceOf(ctx).snapshot()).toEqual({
      form: 'classic', role: 'classic', presentation: 'classic', pinned: false, available: false, modal: null, orbHovered: false,
    })
    await fiber.dispose()
    expect(ctx.get('surface')).toBeUndefined()
  })

  it('adopts the boot descriptor and carrier updates, then releases the subscription on disposal', async () => {
    const bridge = fakeBridge(ORB)
    Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { surface: bridge.api } })
    ;(globalThis as { __DSH_SURFACE__?: SurfaceSnapshot }).__DSH_SURFACE__ = ORB
    const ctx = new Context()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(serviceOf(ctx).snapshot()).toBe(ORB)
    const panel: SurfaceSnapshot = { ...ORB, presentation: 'panel', pinned: true }
    bridge.push(panel)
    expect(serviceOf(ctx).snapshot()).toBe(panel)
    expect(bridge.subscribed).toBe(true)
    await fiber.dispose()
    expect(bridge.subscribed).toBe(false)
    expect(ctx.get('surface')).toBeUndefined()
  })
})
