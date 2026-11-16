// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { SurfaceSnapshot } from '../src/protocol.ts'
import type { SurfaceAdapter } from '../src/client/adapters.ts'
import { SurfaceRuntime } from '../src/client/service.ts'

/** Committed classic presentation used as the comparison baseline. */
const BASE: SurfaceSnapshot = Object.freeze({
  form: 'classic', role: 'classic', presentation: 'classic', pinned: false, available: true, modal: null, orbHovered: false,
  modalOpen: false,
})

interface FakeAdapter {
  readonly adapter: SurfaceAdapter
  readonly commands: string[]
  /** Snapshot the next command's read returns. */
  nextRead: SurfaceSnapshot | undefined
  /** Number of live carrier subscriptions. */
  readonly followers: number
  /** Publish one snapshot to the connected runtime. */
  push(snapshot: SurfaceSnapshot): void
}

function fakeAdapter(): FakeAdapter {
  const state = {
    current: BASE,
    listeners: new Set<(snapshot: SurfaceSnapshot) => void>(),
    commands: [] as string[],
    nextRead: undefined as SurfaceSnapshot | undefined,
  }
  const adapter: SurfaceAdapter = {
    initial: () => BASE,
    read: async () => state.nextRead ?? state.current,
    subscribe: (listener) => {
      state.listeners.add(listener)
      return () => { state.listeners.delete(listener) }
    },
    expand: async () => { state.commands.push('expand') },
    collapse: async () => { state.commands.push('collapse') },
    presentModal: async (id, size) => {
      state.commands.push(size?.heightRatio === undefined ? `presentModal:${id}` : `presentModal:${id}:${String(size.heightRatio)}`)
    },
    dismissModal: async () => { state.commands.push('dismissModal') },
    presentBubbles: async () => { state.commands.push('presentBubbles') },
    dismissBubbles: async () => { state.commands.push('dismissBubbles') },
    setPinned: async (pinned) => { state.commands.push(`setPinned:${String(pinned)}`) },
    dragBy: async (deltaX, deltaY) => { state.commands.push(`dragBy:${String(deltaX)},${String(deltaY)}`) },
    pointerInside: (inside) => { state.commands.push(`pointerInside:${String(inside)}`) },
  }
  return {
    adapter, commands: state.commands,
    get nextRead(): SurfaceSnapshot | undefined { return state.nextRead },
    set nextRead(value: SurfaceSnapshot | undefined) { state.nextRead = value },
    get followers(): number { return state.listeners.size },
    push: (snapshot) => {
      state.current = snapshot
      for (const listener of [...state.listeners]) listener(snapshot)
    },
  }
}

describe('SurfaceRuntime snapshot', () => {
  it('keeps one reference until a presentation field changes', () => {
    const runtime = new SurfaceRuntime(fakeAdapter().adapter)
    expect(runtime.snapshot()).toBe(BASE)
    expect(runtime.snapshot()).toBe(runtime.snapshot())
  })

  it('adopts each changed field and ignores an identical snapshot', () => {
    const fake = fakeAdapter()
    const runtime = new SurfaceRuntime(fake.adapter)
    runtime.connect()
    fake.push({ ...BASE })
    expect(runtime.snapshot()).toBe(BASE)
    const changes: SurfaceSnapshot[] = [
      { ...BASE, form: 'orb' },
      { ...BASE, role: 'orb' },
      { ...BASE, presentation: 'panel' },
      { ...BASE, pinned: true },
      { ...BASE, available: false },
      { ...BASE, modal: 'voice-setup' },
      { ...BASE, orbHovered: true },
      { ...BASE, modalOpen: true },
    ]
    for (const change of changes) {
      fake.push(change)
      expect(runtime.snapshot()).toBe(change)
    }
  })

  it('stops following carrier notifications when its one subscription is disposed', () => {
    const fake = fakeAdapter()
    const runtime = new SurfaceRuntime(fake.adapter)
    const disconnect = runtime.connect()
    expect(fake.followers).toBe(1)
    disconnect()
    expect(fake.followers).toBe(0)
    fake.push({ ...BASE, presentation: 'orb' })
    expect(runtime.snapshot()).toBe(BASE)
  })
})

describe('SurfaceRuntime commands', () => {
  it('forwards each command and adopts the settled snapshot', async () => {
    const fake = fakeAdapter()
    const runtime = new SurfaceRuntime(fake.adapter)
    const panel: SurfaceSnapshot = { ...BASE, presentation: 'panel' }
    fake.nextRead = panel
    await runtime.expand()
    expect(fake.commands).toEqual(['expand'])
    expect(runtime.snapshot()).toBe(panel)
    await runtime.collapse()
    await runtime.presentModal('voice-setup')
    await runtime.dismissModal()
    await runtime.presentBubbles()
    await runtime.dismissBubbles()
    await runtime.setPinned(true)
    await runtime.dragBy(6, -2)
    runtime.setPointerInside(true)
    expect(fake.commands).toEqual([
      'expand', 'collapse', 'presentModal:voice-setup', 'dismissModal', 'presentBubbles', 'dismissBubbles',
      'setPinned:true', 'dragBy:6,-2', 'pointerInside:true',
    ])
    expect(runtime.snapshot()).toBe(panel)
  })

  it('forwards the presentation size with the modal command', async () => {
    const fake = fakeAdapter()
    const runtime = new SurfaceRuntime(fake.adapter)
    await runtime.presentModal('better-interact.workbench', { heightRatio: 0.8 })
    await runtime.presentModal('voice-setup')
    expect(fake.commands).toEqual(['presentModal:better-interact.workbench:0.8', 'presentModal:voice-setup'])
  })

  it('keeps the current reference when a command settles into the same presentation', async () => {    const fake = fakeAdapter()
    const runtime = new SurfaceRuntime(fake.adapter)
    fake.nextRead = { ...BASE }
    await runtime.setPinned(false)
    expect(runtime.snapshot()).toBe(BASE)
  })

  it('propagates a carrier command failure without reading a snapshot', async () => {
    const fake = fakeAdapter()
    const adapter = { ...fake.adapter, expand: async () => { throw new Error('window is gone') } }
    const runtime = new SurfaceRuntime(adapter)
    await expect(runtime.expand()).rejects.toThrow('window is gone')
    expect(runtime.snapshot()).toBe(BASE)
  })
})

describe('SurfaceRuntime follow', () => {
  it('yields the current snapshot, then queued and awaited changes until abort', async () => {
    const fake = fakeAdapter()
    const runtime = new SurfaceRuntime(fake.adapter)
    runtime.connect()
    const controller = new AbortController()
    const iterator = runtime.follow(controller.signal)[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ done: false, value: BASE })
    // A change published while the consumer is between reads is retained.
    const panel: SurfaceSnapshot = { ...BASE, presentation: 'panel' }
    fake.push(panel)
    expect(await iterator.next()).toEqual({ done: false, value: panel })
    // A change published while the consumer awaits the next snapshot resumes it.
    const pending = iterator.next()
    const orb: SurfaceSnapshot = { ...BASE, presentation: 'orb' }
    fake.push(orb)
    expect(await pending).toEqual({ done: false, value: orb })
    // connect() owns the one carrier subscription; each follow() only adds a runtime listener.
    expect(fake.followers).toBe(1)
    controller.abort()
    expect(await iterator.next()).toEqual({ done: true, value: undefined })
    expect(fake.followers).toBe(1)
  })

  it('ends an awaited read when the signal aborts', async () => {
    const fake = fakeAdapter()
    const runtime = new SurfaceRuntime(fake.adapter)
    runtime.connect()
    const controller = new AbortController()
    const iterator = runtime.follow(controller.signal)[Symbol.asyncIterator]()
    await iterator.next()
    const pending = iterator.next()
    controller.abort()
    expect(await pending).toEqual({ done: true, value: undefined })
  })

  it('yields the current snapshot once and ends when the signal is already aborted', async () => {
    const fake = fakeAdapter()
    const runtime = new SurfaceRuntime(fake.adapter)
    runtime.connect()
    const controller = new AbortController()
    controller.abort()
    const iterator = runtime.follow(controller.signal)[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ done: false, value: BASE })
    expect(await iterator.next()).toEqual({ done: true, value: undefined })
    expect(fake.followers).toBe(1)
  })
})
