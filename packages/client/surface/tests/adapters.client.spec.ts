// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { DesktopSurfaceApi, SurfaceSnapshot } from '../src/protocol.ts'
import {
  createSurfaceAdapter, desktopSurfaceApi, electronSurfaceAdapter, inertSurfaceAdapter,
} from '../src/client/adapters.ts'

/** Desktop presentation used by the committed form profiles. */
const ORB: SurfaceSnapshot = Object.freeze({ form: 'orb', role: 'orb', presentation: 'orb', pinned: false, available: true, modal: null })

interface FakeBridge {
  readonly api: DesktopSurfaceApi
  readonly calls: { readonly name: string; readonly args: readonly unknown[] }[]
  /** Publish one snapshot to every current follower. */
  push(snapshot: SurfaceSnapshot): void
  /** Whether any follower still holds a subscription. */
  readonly followers: number
}

function fakeBridge(initial: SurfaceSnapshot): FakeBridge {
  let current = initial
  const calls: { name: string; args: readonly unknown[] }[] = []
  const listeners = new Set<(snapshot: SurfaceSnapshot) => void>()
  const command = (name: string, args: readonly unknown[]): Promise<void> => {
    calls.push({ name, args })
    return Promise.resolve()
  }
  const api: DesktopSurfaceApi = {
    snapshot: async () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    expand: () => command('expand', []),
    collapse: () => command('collapse', []),
    presentModal: (id, size) => command('presentModal', size === undefined ? [id] : [id, size]),
    dismissModal: () => command('dismissModal', []),
    presentBubbles: () => command('presentBubbles', []),
    dismissBubbles: () => command('dismissBubbles', []),
    setPinned: pinned => command('setPinned', [pinned]),
    dragBy: (deltaX, deltaY) => command('dragBy', [deltaX, deltaY]),
    pointerInside: (inside) => { calls.push({ name: 'pointerInside', args: [inside] }) },
  }
  return {
    api, calls,
    get followers(): number { return listeners.size },
    push: (snapshot) => {
      current = snapshot
      for (const listener of [...listeners]) listener(snapshot)
    },
  }
}

function installBridge(surface: DesktopSurfaceApi): void {
  Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { surface } })
}

afterEach(() => {
  Reflect.deleteProperty(window, 'dshDesktop')
  delete (globalThis as { __DSH_SURFACE__?: SurfaceSnapshot }).__DSH_SURFACE__
})

describe('inert carrier', () => {
  it('reports classic and resolves every command without a bridge', async () => {
    expect(desktopSurfaceApi(window)).toBeUndefined()
    const adapter = createSurfaceAdapter(window)
    expect(adapter.initial()).toEqual({ form: 'classic', role: 'classic', presentation: 'classic', pinned: false, available: false, modal: null })
    const unsubscribe = adapter.subscribe(() => { throw new Error('the inert carrier never publishes') })
    unsubscribe()
    expect(await adapter.read()).toBe(adapter.initial())
    await adapter.expand()
    await adapter.collapse()
    await adapter.presentModal('voice-setup')
    await adapter.dismissModal()
    await adapter.presentBubbles()
    await adapter.dismissBubbles()
    await adapter.setPinned(true)
    await adapter.dragBy(12, -4)
    adapter.pointerInside(true)
  })

  it('keeps the classic presentation when window.dshDesktop exists without a surface block', () => {
    Object.defineProperty(window, 'dshDesktop', { configurable: true, value: {} })
    expect(desktopSurfaceApi(window)).toBeUndefined()
    expect(createSurfaceAdapter(window).initial()).toEqual({
      form: 'classic', role: 'classic', presentation: 'classic', pinned: false, available: false, modal: null,
    })
  })
})

describe('desktop carrier', () => {
  it('seeds the initial snapshot from the boot descriptor and reads the bridge', async () => {
    const bridge = fakeBridge({ ...ORB, presentation: 'panel' })
    installBridge(bridge.api)
    ;(globalThis as { __DSH_SURFACE__?: SurfaceSnapshot }).__DSH_SURFACE__ = ORB
    const adapter = createSurfaceAdapter(window)
    expect(adapter.initial()).toBe(ORB)
    expect(await adapter.read()).toEqual({ ...ORB, presentation: 'panel' })
  })

  it('starts classic but available when the preload has no boot descriptor', () => {
    installBridge(fakeBridge(ORB).api)
    expect(createSurfaceAdapter(window).initial()).toEqual({
      form: 'classic', role: 'classic', presentation: 'classic', pinned: false, available: true, modal: null,
    })
  })

  it('forwards subscribe and removes the listener on disposal', () => {
    const bridge = fakeBridge(ORB)
    installBridge(bridge.api)
    const adapter = createSurfaceAdapter(window)
    const seen: SurfaceSnapshot[] = []
    const unsubscribe = adapter.subscribe((snapshot) => { seen.push(snapshot) })
    expect(bridge.followers).toBe(1)
    const panel: SurfaceSnapshot = { ...ORB, presentation: 'panel' }
    bridge.push(panel)
    expect(seen).toEqual([panel])
    unsubscribe()
    expect(bridge.followers).toBe(0)
    bridge.push(ORB)
    expect(seen).toEqual([panel])
  })

  it('forwards every command and the pointer report', async () => {
    const bridge = fakeBridge(ORB)
    installBridge(bridge.api)
    const adapter = createSurfaceAdapter(window)
    await adapter.expand()
    await adapter.collapse()
    await adapter.presentModal('voice-setup')
    await adapter.presentModal('better-interact.workbench', { heightRatio: 0.8 })
    await adapter.dismissModal()
    await adapter.presentBubbles()
    await adapter.dismissBubbles()
    await adapter.setPinned(true)
    await adapter.dragBy(8, -3)
    adapter.pointerInside(false)
    expect(bridge.calls).toEqual([
      { name: 'expand', args: [] },
      { name: 'collapse', args: [] },
      { name: 'presentModal', args: ['voice-setup'] },
      { name: 'presentModal', args: ['better-interact.workbench', { heightRatio: 0.8 }] },
      { name: 'dismissModal', args: [] },
      { name: 'presentBubbles', args: [] },
      { name: 'dismissBubbles', args: [] },
      { name: 'setPinned', args: [true] },
      { name: 'dragBy', args: [8, -3] },
      { name: 'pointerInside', args: [false] },
    ])
  })

  it('builds the Desktop adapter directly from a preload capability', async () => {
    const bridge = fakeBridge(ORB)
    const adapter = electronSurfaceAdapter(bridge.api, ORB)
    expect(adapter.initial()).toBe(ORB)
    expect(await adapter.read()).toBe(ORB)
  })

  it('exposes an inert adapter directly', async () => {
    const adapter = inertSurfaceAdapter()
    expect(adapter.initial()).toBe(adapter.initial())
    expect(await adapter.read()).toBe(adapter.initial())
  })
})
