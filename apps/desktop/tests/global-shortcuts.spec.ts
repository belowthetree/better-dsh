// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { GlobalShortcutCarrier } from '../src/global-shortcuts.ts'
import { DesktopGlobalShortcuts } from '../src/global-shortcuts.ts'
import type {
  ShortcutCommandId, ShortcutDefinition, ShortcutDocument, ShortcutRevision, SystemShortcutState,
} from '@deepseek-ai/dsh-client-shortcuts/protocol'

const contrast = vi.hoisted(() => ({
  register: vi.fn<(accelerator: string, callback: () => void) => boolean>(() => true),
  unregister: vi.fn<(accelerator: string) => void>(),
  unregisterAll: vi.fn<() => void>(),
  isRegistered: vi.fn<(accelerator: string) => boolean>(() => true),
}))
vi.mock('electron', () => ({ globalShortcut: contrast }))

const REVISION = 'accepted-revision' as ShortcutRevision

interface DefinitionInput {
  readonly id: string
  readonly scope?: 'application' | 'system'
  readonly code?: string
  readonly modifiers?: Array<'primary' | 'control' | 'alt' | 'shift' | 'meta'>
}

function definitions(...rows: DefinitionInput[]): ShortcutDefinition[] {
  return rows.map(row => ({
    id: row.id as ShortcutCommandId,
    scope: row.scope ?? 'system',
    defaults: row.code === undefined ? {} : {
      'desktop:macos': { code: row.code, modifiers: row.modifiers ?? ['control'] },
      'desktop:windows': { code: row.code, modifiers: row.modifiers ?? ['control'] },
      'desktop:linux': { code: row.code, modifiers: row.modifiers ?? ['control'] },
    },
  }))
}

function document(): ShortcutDocument {
  return { schemaVersion: 3, profiles: {} }
}

interface MockCarrier extends GlobalShortcutCarrier {
  readonly callbacks: Map<string, () => void>
  readonly registered: Set<string>
  readonly register: ReturnType<typeof vi.fn<(accelerator: string, callback: () => void) => boolean>>
  readonly unregister: ReturnType<typeof vi.fn<(accelerator: string) => void>>
  readonly unregisterAll: ReturnType<typeof vi.fn<() => void>>
  readonly isRegistered: ReturnType<typeof vi.fn<(accelerator: string) => boolean>>
}

function carrier(): MockCarrier {
  const callbacks = new Map<string, () => void>()
  const registered = new Set<string>()
  const all = {
    callbacks,
    registered,
    register: vi.fn((accelerator: string, callback: () => void) => {
      if (registered.has(accelerator)) return false
      registered.add(accelerator)
      callbacks.set(accelerator, callback)
      return true
    }),
    unregister: vi.fn((accelerator: string) => { registered.delete(accelerator); callbacks.delete(accelerator) }),
    unregisterAll: vi.fn(() => { registered.clear(); callbacks.clear() }),
    isRegistered: vi.fn((accelerator: string) => registered.has(accelerator)),
  }
  return all
}

function installer(input: {
  carrier?: GlobalShortcutCarrier
  platform?: 'macos' | 'windows' | 'linux'
  revision?: ShortcutRevision | undefined
  recording?: boolean
}) {
  const published: SystemShortcutState[] = []
  const sent: Array<{ id: string; revision: ShortcutRevision }> = []
  const state: { revision: ShortcutRevision | undefined; recording: boolean } = {
    revision: input.revision ?? REVISION, recording: input.recording ?? false,
  }
  const owner = new DesktopGlobalShortcuts({
    platform: input.platform ?? 'macos',
    carrier: input.carrier ?? carrier(),
    revision: () => state.revision,
    recording: () => state.recording,
    send: (id, revision) => { sent.push({ id, revision }) },
    publish: (next) => { published.push(next) },
  })
  return { owner, published, sent, state }
}

describe('DesktopGlobalShortcuts', () => {
  it('registers every accepted system binding and reports the accelerator', () => {
    const fake = carrier()
    const { owner, published } = installer({ carrier: fake })
    owner.sync(definitions({ id: 'orb.toggle', code: 'KeyK', modifiers: ['primary', 'shift'] }), document())
    expect(fake.register).toHaveBeenCalledWith('Shift+Command+K', expect.any(Function))
    expect(owner.state()).toEqual({
      registrations: [{ id: 'orb.toggle', accelerator: 'Shift+Command+K', status: 'registered' }], suspended: false,
    })
    expect(published.at(-1)).toEqual(owner.state())
  })

  it('reports a failed registration and retries it on the next sync', () => {
    const fake = carrier()
    fake.register.mockReturnValueOnce(false)
    const { owner } = installer({ carrier: fake })
    owner.sync(definitions({ id: 'orb.toggle', code: 'F13', modifiers: [] }), document())
    expect(owner.state().registrations).toEqual([{ id: 'orb.toggle', accelerator: 'F13', status: 'failed' }])
    owner.sync(definitions({ id: 'orb.toggle', code: 'F13', modifiers: [] }), document())
    expect(owner.state().registrations).toEqual([{ id: 'orb.toggle', accelerator: 'F13', status: 'registered' }])
  })

  it('keeps an unchanged accelerator registered and releases a removed one', () => {
    const fake = carrier()
    const { owner } = installer({ carrier: fake })
    owner.sync(definitions({ id: 'orb.toggle', code: 'KeyK' }), document())
    owner.sync(definitions({ id: 'orb.toggle', code: 'KeyK' }), document())
    expect(fake.register).toHaveBeenCalledTimes(1)
    owner.sync([], document())
    expect(fake.unregister).toHaveBeenCalledWith('Control+K')
    expect(owner.state().registrations).toEqual([])
  })

  it('re-registers when the accepted binding changes', () => {
    const fake = carrier()
    const { owner } = installer({ carrier: fake })
    owner.sync(definitions({ id: 'orb.toggle', code: 'KeyK' }), document())
    owner.sync(definitions({ id: 'orb.toggle', code: 'KeyJ' }), document())
    expect(fake.unregister).toHaveBeenCalledWith('Control+K')
    expect(fake.register).toHaveBeenLastCalledWith('Control+J', expect.any(Function))
  })

  it('skips bindings the catalog reports as invalid', () => {
    const fake = carrier()
    const { owner } = installer({ carrier: fake })
    owner.sync(definitions(
      { id: 'orb.toggle', code: 'KeyK' },
      // A bare letter would swallow normal typing system-wide.
      { id: 'orb.bad', code: 'KeyA', modifiers: [] },
    ), document())
    expect(fake.register).toHaveBeenCalledTimes(1)
    expect(owner.state().registrations).toEqual([{ id: 'orb.toggle', accelerator: 'Control+K', status: 'registered' }])
  })

  it('skips both sides of a conflicting binding', () => {
    const fake = carrier()
    const { owner } = installer({ carrier: fake })
    owner.sync(definitions(
      { id: 'orb.toggle', code: 'KeyK' },
      { id: 'orb.close', code: 'KeyK' },
    ), document())
    expect(fake.register).not.toHaveBeenCalled()
    expect(owner.state().registrations).toEqual([])
  })

  it('suspends registration while the recording layer is active and restores it after', () => {
    const fake = carrier()
    const { owner } = installer({ carrier: fake })
    owner.sync(definitions({ id: 'orb.toggle', code: 'KeyK' }), document())
    fake.register.mockClear()
    owner.recording(true)
    expect(fake.unregister).toHaveBeenCalledWith('Control+K')
    expect(owner.state()).toEqual({ registrations: [], suspended: true })
    owner.recording(false)
    expect(fake.register).toHaveBeenCalledWith('Control+K', expect.any(Function))
    expect(owner.state()).toEqual({
      registrations: [{ id: 'orb.toggle', accelerator: 'Control+K', status: 'registered' }], suspended: false,
    })
  })

  it('reports the platform as unavailable without registering anything', () => {
    const fake = carrier()
    const { owner } = installer({ carrier: fake, platform: 'linux' })
    owner.sync(definitions({ id: 'orb.toggle', code: 'KeyK' }), document())
    expect(fake.register).not.toHaveBeenCalled()
    expect(owner.state()).toEqual({ registrations: [], suspended: false, unavailable: 'platform' })
  })

  it('forwards an activation with the accepted revision', () => {
    const fake = carrier()
    const { owner, sent } = installer({ carrier: fake })
    owner.sync(definitions({ id: 'orb.toggle', code: 'KeyK' }), document())
    fake.callbacks.get('Control+K')!()
    expect(sent).toEqual([{ id: 'orb.toggle', revision: REVISION }])
  })

  it('drops an activation once the renderer has no accepted revision', () => {
    const fake = carrier()
    const { owner, sent, state } = installer({ carrier: fake })
    owner.sync(definitions({ id: 'orb.toggle', code: 'KeyK' }), document())
    state.revision = undefined
    fake.callbacks.get('Control+K')!()
    expect(sent).toEqual([])
  })

  it('drops an activation while the recording layer owns input', () => {
    const fake = carrier()
    const { owner, sent, state } = installer({ carrier: fake })
    owner.sync(definitions({ id: 'orb.toggle', code: 'KeyK' }), document())
    state.recording = true
    fake.callbacks.get('Control+K')!()
    expect(sent).toEqual([])
  })

  it('releases every accelerator on reset and dispose', () => {
    const fake = carrier()
    const { owner } = installer({ carrier: fake })
    owner.sync(definitions({ id: 'orb.toggle', code: 'KeyK' }), document())
    owner.reset()
    expect(fake.registered.size).toBe(0)
    owner.sync(definitions({ id: 'orb.toggle', code: 'KeyK' }), document())
    owner.dispose()
    expect(fake.registered.size).toBe(0)
  })

  it('publishes only when the renderer-visible state changes', () => {
    const fake = carrier()
    const { owner, published } = installer({ carrier: fake })
    owner.sync(definitions({ id: 'orb.toggle', code: 'KeyK' }), document())
    const count = published.length
    owner.sync(definitions({ id: 'orb.toggle', code: 'KeyK' }), document())
    expect(published.length).toBe(count)
  })

  it('derives platform-specific accelerators', () => {
    const mac = carrier()
    const macOwner = installer({ carrier: mac, platform: 'macos' }).owner
    macOwner.sync(definitions({ id: 'orb.toggle', code: 'KeyK', modifiers: ['meta', 'alt'] }), document())
    expect(mac.register).toHaveBeenCalledWith('Alt+Command+K', expect.any(Function))
    const windows = carrier()
    const windowsOwner = installer({ carrier: windows, platform: 'windows' }).owner
    windowsOwner.sync(definitions({ id: 'orb.toggle', code: 'ArrowUp', modifiers: ['control'] }), document())
    expect(windows.register).toHaveBeenCalledWith('Control+Up', expect.any(Function))
  })
})
