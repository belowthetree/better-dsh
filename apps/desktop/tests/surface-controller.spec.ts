// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/protocol'
import {
  DesktopSurfaceController, MAX_MODAL_ID_CHARS, MAX_SURFACE_MESSAGE_CHANNEL_CHARS, MAX_SURFACE_MESSAGE_JSON_BYTES,
  parseSurfaceCommand, parseSurfaceMessage, type SurfaceWindowEffects,
} from '../src/surface-controller.ts'
import type { DesktopFormLayout } from '../src/form-layout.ts'
import {
  bubblesBounds, modalBounds, orbBounds, orbMenuBounds, orbMenuDirection, panelBounds, type DesktopFormRole,
  type FormPresentationBounds,
} from '../src/form-window.ts'

const WORK_AREA = { x: 0, y: 0, width: 1440, height: 900 }
const LAYOUT: DesktopFormLayout = { version: 1, orb: { x: 1300, y: 400 }, pinned: false }

interface AppliedBounds {
  readonly role: DesktopFormRole
  readonly bounds: FormPresentationBounds
}

interface Applied<Value> {
  readonly role: DesktopFormRole
  readonly value: Value
}

function effects(workArea = WORK_AREA): SurfaceWindowEffects & {
  readonly bounds: AppliedBounds[]
  readonly resizable: Applied<boolean>[]
  readonly ignored: Applied<boolean>[]
  readonly persisted: DesktopFormLayout[]
  readonly publishedOrb: SurfaceSnapshot[]
  readonly publishedSurface: SurfaceSnapshot[]
  readonly publishedBubbles: SurfaceSnapshot[]
  readonly revealed: number
  readonly focused: number
  readonly orbFocused: number
  readonly hidden: number
  readonly bubblesRevealed: number
  readonly bubblesHidden: number
} {
  const record = {
    bounds: [] as AppliedBounds[],
    resizable: [] as Applied<boolean>[],
    ignored: [] as Applied<boolean>[],
    persisted: [] as DesktopFormLayout[],
    publishedOrb: [] as SurfaceSnapshot[],
    publishedSurface: [] as SurfaceSnapshot[],
    publishedBubbles: [] as SurfaceSnapshot[],
    revealed: 0,
    focused: 0,
    orbFocused: 0,
    hidden: 0,
    bubblesRevealed: 0,
    bubblesHidden: 0,
  }
  return {
    get bounds() { return record.bounds },
    get resizable() { return record.resizable },
    get ignored() { return record.ignored },
    get persisted() { return record.persisted },
    get publishedOrb() { return record.publishedOrb },
    get publishedSurface() { return record.publishedSurface },
    get publishedBubbles() { return record.publishedBubbles },
    get revealed() { return record.revealed },
    get focused() { return record.focused },
    get orbFocused() { return record.orbFocused },
    get hidden() { return record.hidden },
    get bubblesRevealed() { return record.bubblesRevealed },
    get bubblesHidden() { return record.bubblesHidden },
    setBounds: (role, bounds) => { record.bounds.push({ role, bounds }) },
    setResizable: (role, value) => { record.resizable.push({ role, value }) },
    setIgnoreMouseEvents: (role, value) => { record.ignored.push({ role, value }) },
    revealSurface: () => { record.revealed++ },
    focusSurface: () => { record.focused++ },
    focusOrb: () => { record.orbFocused++ },
    hideSurface: () => { record.hidden++ },
    revealBubbles: () => { record.bubblesRevealed++ },
    hideBubbles: () => { record.bubblesHidden++ },
    publishOrb: (snapshot) => { record.publishedOrb.push(snapshot) },
    publishSurface: (snapshot) => { record.publishedSurface.push(snapshot) },
    publishBubbles: (snapshot) => { record.publishedBubbles.push(snapshot) },
    persist: (next) => { record.persisted.push(next) },
    workArea: () => workArea,
  }
}

/** Bounds applied to one role, oldest first. */
function boundsOf(window: ReturnType<typeof effects>, role: DesktopFormRole): FormPresentationBounds[] {
  return window.bounds.filter(entry => entry.role === role).map(entry => entry.bounds)
}

/** Last value applied to one role, or undefined when the role was never addressed. */
function lastOf<Value>(entries: readonly Applied<Value>[], role: DesktopFormRole): Value | undefined {
  return entries.filter(entry => entry.role === role).at(-1)?.value
}

describe('parseSurfaceMessage', () => {
  it.each(['orb', 'surface', 'bubbles'] as const)('accepts one bounded JSON message for %s', (target) => {
    expect(parseSurfaceMessage({ target, channel: 'better/intent', payload: { kind: 'open' } }))
      .toEqual({ target, channel: 'better/intent', payload: { kind: 'open' } })
  })

  it('forwards a canonical JSON copy rather than the renderer-owned object', () => {
    const source = { nested: { value: 1 } }
    const result = parseSurfaceMessage({ target: 'surface', channel: 'better/intent', payload: source })
    expect(result?.payload).toEqual(source)
    expect(result?.payload).not.toBe(source)
  })

  it('rejects invalid roles, channels, and non-JSON or oversized payloads', () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    let deep: unknown = null
    for (let index = 0; index < 70; index++) deep = { nested: deep }
    const invalid = [
      null,
      { target: 'classic', channel: 'better/intent', payload: null },
      { target: 'surface', channel: '', payload: null },
      { target: 'surface', channel: 'better', payload: null },
      { target: 'surface', channel: 'Better/Intent', payload: null },
      { target: 'surface', channel: `better/${'x'.repeat(MAX_SURFACE_MESSAGE_CHANNEL_CHARS)}`, payload: null },
      { target: 'surface', channel: 'better/intent', payload: undefined },
      { target: 'surface', channel: 'better/intent', payload: 'x'.repeat(MAX_SURFACE_MESSAGE_JSON_BYTES) },
      { target: 'surface', channel: 'better/intent', payload: cyclic },
      { target: 'surface', channel: 'better/intent', payload: new Map([['large', 'x'.repeat(MAX_SURFACE_MESSAGE_JSON_BYTES)]]) },
      { target: 'surface', channel: 'better/intent', payload: new Uint8Array(MAX_SURFACE_MESSAGE_JSON_BYTES) },
      { target: 'surface', channel: 'better/intent', payload: Number.NaN },
      { target: 'surface', channel: 'better/intent', payload: { nested: undefined } },
      { target: 'surface', channel: 'better/intent', payload: [undefined] },
      { target: 'surface', channel: 'better/intent', payload: deep },
    ]
    for (const input of invalid) expect(parseSurfaceMessage(input)).toBeUndefined()
  })
})

describe('parseSurfaceCommand', () => {
  it.each([
    [{ kind: 'expand' }, { kind: 'expand' }],
    [{ kind: 'collapse' }, { kind: 'collapse' }],
    [{ kind: 'dismissModal' }, { kind: 'dismissModal' }],
    [{ kind: 'presentBubbles' }, { kind: 'presentBubbles' }],
    [{ kind: 'dismissBubbles' }, { kind: 'dismissBubbles' }],
    [{ kind: 'snap' }, { kind: 'snap' }],
    [{ kind: 'presentModal', id: 'voice-setup' }, { kind: 'presentModal', id: 'voice-setup' }],
    [
      { kind: 'presentModal', id: 'voice-setup', size: { heightRatio: 0.8 } },
      { kind: 'presentModal', id: 'voice-setup', size: { heightRatio: 0.8 } },
    ],
    [
      { kind: 'presentModal', id: 'voice-setup', size: { heightRatio: 0.8, width: 1488 } },
      { kind: 'presentModal', id: 'voice-setup', size: { heightRatio: 0.8, width: 1488 } },
    ],
    [
      { kind: 'presentModal', id: 'voice-setup', size: { width: 1488 } },
      { kind: 'presentModal', id: 'voice-setup', size: { width: 1488 } },
    ],
    [{ kind: 'presentModal', id: 'voice-setup', size: {} }, { kind: 'presentModal', id: 'voice-setup', size: {} }],
    [{ kind: 'setPinned', pinned: true }, { kind: 'setPinned', pinned: true }],
    [{ kind: 'setOrbMenu', open: true }, { kind: 'setOrbMenu', open: true }],
    [{ kind: 'setOrbMenu', open: false }, { kind: 'setOrbMenu', open: false }],
    [{ kind: 'dragBy', deltaX: -4, deltaY: 8 }, { kind: 'dragBy', deltaX: -4, deltaY: 8 }],
    [{ kind: 'pointerInside', inside: false }, { kind: 'pointerInside', inside: false }],
  ])('accepts %j', (raw, expected) => {
    expect(parseSurfaceCommand(raw)).toEqual(expected)
  })

  it.each([
    ['non-object', 'expand'],
    ['null', null],
    ['array', [{ kind: 'expand' }]],
    ['unknown kind', { kind: 'minimize' }],
    ['missing kind', { id: 'x' }],
    ['empty modal id', { kind: 'presentModal', id: '' }],
    ['oversized modal id', { kind: 'presentModal', id: 'x'.repeat(MAX_MODAL_ID_CHARS + 1) }],
    ['non-string modal id', { kind: 'presentModal', id: 7 }],
    ['non-boolean pinned', { kind: 'setPinned', pinned: 'yes' }],
    ['non-boolean orb menu', { kind: 'setOrbMenu', open: 'yes' }],
    ['non-object size', { kind: 'presentModal', id: 'x', size: 'tall' }],
    ['zero height ratio', { kind: 'presentModal', id: 'x', size: { heightRatio: 0 } }],
    ['oversized height ratio', { kind: 'presentModal', id: 'x', size: { heightRatio: 1.5 } }],
    ['nan height ratio', { kind: 'presentModal', id: 'x', size: { heightRatio: Number.NaN } }],
    ['string height ratio', { kind: 'presentModal', id: 'x', size: { heightRatio: '0.8' } }],
    ['zero width', { kind: 'presentModal', id: 'x', size: { width: 0 } }],
    ['negative width', { kind: 'presentModal', id: 'x', size: { width: -1 } }],
    ['nan width', { kind: 'presentModal', id: 'x', size: { width: Number.NaN } }],
    ['string width', { kind: 'presentModal', id: 'x', size: { width: '1488' } }],
    ['nan delta', { kind: 'dragBy', deltaX: Number.NaN, deltaY: 0 }],
    ['infinite delta', { kind: 'dragBy', deltaX: 0, deltaY: Number.POSITIVE_INFINITY }],
    ['non-boolean pointer', { kind: 'pointerInside', inside: 1 }],
  ])('rejects %s', (_name, raw) => {
    expect(parseSurfaceCommand(raw)).toBeUndefined()
  })

  it('accepts a modal id at the length limit', () => {
    expect(parseSurfaceCommand({ kind: 'presentModal', id: 'x'.repeat(MAX_MODAL_ID_CHARS) })).toEqual({
      kind: 'presentModal', id: 'x'.repeat(MAX_MODAL_ID_CHARS),
    })
  })
})

describe('DesktopSurfaceController', () => {
  it('starts on the orb presentation and reports each window its own role', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: { ...LAYOUT, pinned: true }, effects: window })
    expect(controller.snapshot('orb')).toEqual({
      form: 'orb', role: 'orb', presentation: 'orb', pinned: true, available: true, modal: null, orbDocked: true, orbMenu: null,
      orbHovered: false, modalOpen: false,
    })
    expect(controller.snapshot('surface')).toEqual({
      form: 'orb', role: 'surface', presentation: 'orb', pinned: true, available: true, modal: null, orbDocked: true, orbMenu: null,
      orbHovered: false, modalOpen: false,
    })
    expect(controller.snapshot('bubbles')).toEqual({
      form: 'orb', role: 'bubbles', presentation: 'orb', pinned: true, available: true, modal: null, orbDocked: true, orbMenu: null,
      orbHovered: false, modalOpen: false,
    })
  })

  it('clamps a persisted orb into the work area at construction', () => {
    const window = effects()
    new DesktopSurfaceController({ layout: { ...LAYOUT, orb: { x: 5000, y: -40 } }, effects: window })
    expect(window.persisted).toEqual([])
    const controller = new DesktopSurfaceController({ layout: { ...LAYOUT, orb: { x: 5000, y: -40 } }, effects: window })
    expect(controller.snapshot('surface').presentation).toBe('orb')
  })

  it('expands to the panel in the surface window without taking focus', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'expand' })
    expect(controller.snapshot('surface').presentation).toBe('panel')
    expect(lastOf(window.resizable, 'surface')).toBe(true)
    expect(window.revealed).toBe(1)
    expect(window.focused).toBe(0)
    expect(window.hidden).toBe(0)
    expect(boundsOf(window, 'surface').at(-1)).toEqual(panelBounds(LAYOUT, WORK_AREA))
    expect(window.publishedSurface.at(-1)).toMatchObject({ role: 'surface', presentation: 'panel' })
    expect(window.publishedOrb.at(-1)).toMatchObject({ role: 'orb', presentation: 'orb' })
  })

  it('grows the orb window into its options ring and reports the ring geometry', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'setOrbMenu', open: true }, 'surface')
    const menu = orbMenuBounds(LAYOUT, WORK_AREA)
    const orb = orbBounds(LAYOUT, WORK_AREA)
    expect(boundsOf(window, 'orb').at(-1)).toEqual(menu)
    expect(window.orbFocused).toBe(1)
    expect(controller.snapshot('orb').orbMenu).toEqual({
      anchorX: orb.x - menu.x,
      anchorY: orb.y - menu.y,
      direction: orbMenuDirection(LAYOUT, WORK_AREA),
    })
    expect(window.publishedOrb.at(-1)?.orbMenu).toEqual(controller.snapshot('orb').orbMenu)
    expect(window.publishedSurface.at(-1)?.orbMenu).toEqual(controller.snapshot('orb').orbMenu)

    controller.dispatch({ kind: 'setOrbMenu', open: false }, 'orb')
    expect(boundsOf(window, 'orb').at(-1)).toEqual(orb)
    expect(controller.snapshot('surface').orbMenu).toBeNull()
  })

  it('rejects an options ring request from a window that cannot own the orb', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'setOrbMenu', open: true }, 'bubbles')
    expect(controller.snapshot('orb').orbMenu).toBeNull()
    expect(window.orbFocused).toBe(0)
  })

  it('collapses the options ring when a modal takes over or the orb window loses focus', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    const orb = orbBounds(LAYOUT, WORK_AREA)
    controller.dispatch({ kind: 'setOrbMenu', open: true }, 'orb')
    controller.dispatch({ kind: 'presentModal', id: 'orb.chat' })
    expect(controller.snapshot('orb').orbMenu).toBeNull()
    expect(boundsOf(window, 'orb').at(-1)).toEqual(orb)

    controller.dispatch({ kind: 'dismissModal' })
    controller.dispatch({ kind: 'setOrbMenu', open: true }, 'orb')
    controller.closeOrbMenu()
    expect(controller.snapshot('orb').orbMenu).toBeNull()
    expect(boundsOf(window, 'orb').at(-1)).toEqual(orb)
    // Closing an already closed ring is a no-op.
    const published = window.publishedOrb.length
    controller.closeOrbMenu()
    expect(window.publishedOrb.length).toBe(published)
  })

  it('raises the panel for a shell-owned document and stays idempotent', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    expect(controller.ensurePanel()).toBe(true)
    expect(controller.snapshot('surface').presentation).toBe('panel')
    expect(window.revealed).toBe(1)
    const published = window.publishedSurface.length
    expect(controller.ensurePanel()).toBe(true)
    expect(window.publishedSurface.length).toBe(published)
  })

  it('leaves a form-owned modal in place for a shell-owned document', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'orb.chat' })
    expect(controller.ensurePanel()).toBe(false)
    expect(controller.snapshot('surface')).toEqual({ form: 'orb', role: 'surface', presentation: 'modal', pinned: false,
      available: true, modal: 'orb.chat', orbDocked: true, orbMenu: null, orbHovered: false, modalOpen: true })
  })

  it('ignores expand while already expanded and collapse while collapsed', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'collapse' })
    expect(window.bounds).toEqual([])
    controller.dispatch({ kind: 'expand' })
    const revealed = window.revealed
    controller.dispatch({ kind: 'expand' })
    expect(window.revealed).toBe(revealed)
  })

  it('collapses back to the orb window and hides the surface window', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'expand' })
    controller.dispatch({ kind: 'collapse' })
    expect(controller.snapshot('surface').presentation).toBe('orb')
    expect(window.hidden).toBe(1)
    expect(lastOf(window.resizable, 'orb')).toBe(false)
    expect(boundsOf(window, 'orb').at(-1)).toEqual({ x: 1280, y: 400, width: 160, height: 160 })
  })

  it('restores the previous presentation when the modal dismisses', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'voice-setup' })
    expect(controller.snapshot('surface')).toMatchObject({ presentation: 'modal', modal: 'voice-setup' })
    expect(boundsOf(window, 'surface').at(-1)).toEqual(modalBounds(WORK_AREA))
    expect(window.focused).toBe(1)
    expect(window.revealed).toBe(0)
    controller.dispatch({ kind: 'dismissModal' })
    expect(controller.snapshot('surface')).toMatchObject({ presentation: 'orb', modal: null })
    expect(window.hidden).toBe(1)
  })

  it('restores the panel presentation a modal was raised from', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'expand' })
    controller.dispatch({ kind: 'presentModal', id: 'permission-repair' })
    controller.dispatch({ kind: 'dismissModal' })
    expect(controller.snapshot('surface').presentation).toBe('panel')
  })

  it('accepts a modal presentation requested by the resident orb window', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'orb.chat' }, 'orb')
    expect(controller.snapshot('surface')).toMatchObject({ presentation: 'modal', modal: 'orb.chat' })
    expect(window.focused).toBe(1)
    expect(window.publishedOrb.at(-1)).toMatchObject({ presentation: 'orb', modal: null })
  })

  it('replaces the active modal entry without re-entering the presentation', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'first' })
    const bounds = window.bounds.length
    controller.dispatch({ kind: 'presentModal', id: 'second' })
    expect(controller.snapshot('surface').modal).toBe('second')
    expect(window.bounds.length).toBe(bounds)
  })

  it('takes surface focus back when the orb window replaces an open modal', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'orb.chat' })
    const focused = window.focused
    controller.dispatch({ kind: 'presentModal', id: 'permission-repair' }, 'orb')
    expect(window.focused).toBe(focused + 1)
    expect(controller.snapshot('surface').modal).toBe('permission-repair')
    controller.dispatch({ kind: 'presentModal', id: 'permission-repair' })
    expect(window.focused).toBe(focused + 1)
  })

  it('sizes the modal window from the presentation size hint', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'better-interact.workbench', size: { heightRatio: 0.8, width: 1488 } })
    expect(boundsOf(window, 'surface').at(-1))
      .toEqual(modalBounds(WORK_AREA, { heightRatio: 0.8, width: 1488 }))
    controller.dispatch({ kind: 'dismissModal' })
    expect(controller.snapshot('surface').presentation).toBe('orb')
  })

  it('resizes the modal window when a later entry asks for another size', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'better-interact.workbench', size: { heightRatio: 0.8, width: 1488 } })
    controller.dispatch({ kind: 'presentModal', id: 'orb.chat', size: { heightRatio: 0.5, width: 900 } })
    expect(boundsOf(window, 'surface').at(-1))
      .toEqual(modalBounds(WORK_AREA, { heightRatio: 0.5, width: 900 }))
    const resized = window.bounds.length
    controller.dispatch({ kind: 'presentModal', id: 'permission-repair', size: { heightRatio: 0.5, width: 900 } })
    expect(window.bounds.length).toBe(resized)
  })

  it('ignores modal dismissal while no modal is presented', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'dismissModal' })
    expect(window.publishedSurface).toEqual([])
  })

  it('persists pinning and survives panel dismissal', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'expand' })
    controller.dispatch({ kind: 'setPinned', pinned: true })
    expect(window.persisted.at(-1)?.pinned).toBe(true)
    controller.blurred()
    expect(controller.snapshot('surface')).toMatchObject({ presentation: 'panel', pinned: true })
  })

  it('publishes the changed pin state to all three windows', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'setPinned', pinned: true }, 'orb')
    expect(window.publishedOrb.at(-1)).toMatchObject({ role: 'orb', pinned: true })
    expect(window.publishedSurface.at(-1)).toMatchObject({ role: 'surface', pinned: true })
    expect(window.publishedBubbles.at(-1)).toMatchObject({ role: 'bubbles', pinned: true })
  })

  it('collapses an unpinned panel when the surface window loses focus', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'expand' })
    controller.blurred()
    expect(controller.snapshot('surface').presentation).toBe('orb')
    expect(window.hidden).toBe(1)
  })

  it('leaves the orb alone and dismisses the modal when the surface window loses focus', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.blurred()
    expect(controller.snapshot('surface').presentation).toBe('orb')
    controller.dispatch({ kind: 'presentModal', id: 'settings-card' })
    controller.blurred()
    expect(controller.snapshot('surface')).toEqual({
      form: 'orb', role: 'surface', presentation: 'orb', pinned: false, available: true, modal: null, orbDocked: true, orbMenu: null,
      orbHovered: false, modalOpen: false,
    })
  })

  it('dismisses a modal raised from an unpinned panel back to the orb', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'expand' })
    controller.dispatch({ kind: 'presentModal', id: 'permission-repair' })
    controller.blurred()
    expect(controller.snapshot('surface')).toMatchObject({ presentation: 'orb', modal: null })
  })

  it('restores a pinned panel a modal was raised from when the surface window loses focus', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'expand' })
    controller.dispatch({ kind: 'setPinned', pinned: true })
    controller.dispatch({ kind: 'presentModal', id: 'permission-repair' })
    controller.blurred()
    expect(controller.snapshot('surface')).toMatchObject({ presentation: 'panel', modal: null, pinned: true })
  })

  it('moves the orb window by a pointer delta and clamps it into the work area', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'dragBy', deltaX: 20, deltaY: -30 }, 'orb')
    expect(boundsOf(window, 'orb').at(-1)).toEqual({ x: 1280, y: 370, width: 160, height: 160 })
    controller.dispatch({ kind: 'dragBy', deltaX: 10_000, deltaY: 10_000 }, 'orb')
    expect(boundsOf(window, 'orb').at(-1)).toEqual({ x: 1280, y: 740, width: 160, height: 160 })
    expect(window.persisted.at(-1)?.orb).toEqual({ x: 1280, y: 740 })
  })

  it('persists whole logical pixels after a drag with fractional deltas', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'dragBy', deltaX: 0.4, deltaY: -0.6 }, 'orb')
    expect(window.persisted.at(-1)?.orb).toEqual({ x: 1280, y: 399 })
  })

  it('snaps the orb flush to the nearest work-area edge after a nearby drop', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: { ...LAYOUT, orb: { x: 1272, y: 400 } }, effects: window })
    controller.dispatch({ kind: 'snap' }, 'orb')
    expect(boundsOf(window, 'orb').at(-1)).toEqual({ x: 1280, y: 400, width: 160, height: 160 })
    expect(window.persisted.at(-1)?.orb).toEqual({ x: 1280, y: 400 })
  })

  it('snaps the orb toward the closest edge in each direction', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: { ...LAYOUT, orb: { x: 8, y: 8 } }, effects: window })
    controller.dispatch({ kind: 'snap' }, 'orb')
    expect(boundsOf(window, 'orb').at(-1)).toEqual({ x: 0, y: 0, width: 160, height: 160 })
    controller.dispatch({ kind: 'dragBy', deltaX: 1272, deltaY: 732 }, 'orb')
    controller.dispatch({ kind: 'snap' }, 'orb')
    expect(boundsOf(window, 'orb').at(-1)).toEqual({ x: 1280, y: 740, width: 160, height: 160 })
  })

  it('leaves an orb dropped away from every edge where it is', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: { ...LAYOUT, orb: { x: 600, y: 300 } }, effects: window })
    controller.dispatch({ kind: 'snap' }, 'orb')
    expect(window.bounds).toEqual([])
    expect(window.persisted).toEqual([])
  })

  it('reports the docked orb while it rests at an edge and the free orb after it moves away', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: { ...LAYOUT, orb: { x: 600, y: 300 } }, effects: window })
    expect(controller.snapshot('orb').orbDocked).toBe(false)
    // Landing within the snap gap still counts as docked, before the release snaps it flush.
    controller.dispatch({ kind: 'dragBy', deltaX: 656, deltaY: 0 }, 'orb')
    expect(controller.snapshot('orb').orbDocked).toBe(true)
    controller.dispatch({ kind: 'snap' }, 'orb')
    expect(controller.snapshot('orb').orbDocked).toBe(true)
    controller.dispatch({ kind: 'dragBy', deltaX: -640, deltaY: 0 }, 'orb')
    expect(controller.snapshot('orb').orbDocked).toBe(false)
  })

  it('moves the bubble column with the snapped orb', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: { ...LAYOUT, orb: { x: 1272, y: 400 } }, effects: window })
    controller.dispatch({ kind: 'presentBubbles' }, 'surface')
    window.bounds.length = 0
    controller.dispatch({ kind: 'snap' }, 'orb')
    expect(boundsOf(window, 'orb')).toHaveLength(1)
    expect(boundsOf(window, 'bubbles')).toHaveLength(1)
  })

  it('ignores drag and snap commands reported by the surface window', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'dragBy', deltaX: 40, deltaY: 40 })
    controller.dispatch({ kind: 'snap' })
    expect(window.bounds).toEqual([])
    expect(window.persisted).toEqual([])
  })

  it('keeps the orb draggable while a modal occupies the surface window', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'orb.chat' })
    controller.dispatch({ kind: 'dragBy', deltaX: 10, deltaY: 10 }, 'orb')
    expect(boundsOf(window, 'orb').at(-1)).toEqual({ x: 1280, y: 410, width: 160, height: 160 })
    expect(controller.snapshot('surface').presentation).toBe('modal')
  })

  it('keeps the orb window interactive so a first click always reaches the artwork', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    expect(window.ignored).toEqual([])
    controller.dispatch({ kind: 'pointerInside', inside: false }, 'orb')
    expect(lastOf(window.ignored, 'orb')).toBe(false)
    controller.dispatch({ kind: 'pointerInside', inside: true }, 'orb')
    expect(lastOf(window.ignored, 'orb')).toBe(false)
  })

  it('keeps the orb window interactive while the surface window presents a panel', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'pointerInside', inside: false }, 'orb')
    controller.dispatch({ kind: 'expand' })
    expect(lastOf(window.ignored, 'orb')).toBe(false)
    expect(lastOf(window.ignored, 'surface')).toBe(false)
  })

  it('never passes surface clicks through while the panel or modal is presented', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'pointerInside', inside: false }, 'surface')
    controller.dispatch({ kind: 'expand' })
    expect(lastOf(window.ignored, 'surface')).toBe(false)
    controller.dispatch({ kind: 'presentModal', id: 'card' })
    expect(lastOf(window.ignored, 'surface')).toBe(false)
  })

  it('re-clamps the orb and all three windows after a display change', () => {
    const window = effects({ x: 0, y: 0, width: 800, height: 600 })
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' })
    controller.dispatch({ kind: 'expand' })
    controller.reflow()
    expect(window.persisted.at(-1)?.orb).toEqual({ x: 640, y: 400 })
    expect(boundsOf(window, 'orb').at(-1)).toEqual({ x: 640, y: 400, width: 160, height: 160 })
    expect(boundsOf(window, 'surface').at(-1)).toEqual(panelBounds({ ...LAYOUT, orb: { x: 640, y: 400 } },
      { x: 0, y: 0, width: 800, height: 600 }))
    expect(boundsOf(window, 'bubbles').at(-1)).toEqual(bubblesBounds({ ...LAYOUT, orb: { x: 640, y: 400 } },
      { x: 0, y: 0, width: 800, height: 600 }))
  })

  it('re-applies bounds, resizing, visibility, click-through, and snapshots when the windows are restored', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'pointerInside', inside: false }, 'orb')
    window.bounds.length = 0
    controller.restore()
    expect(boundsOf(window, 'orb')).toEqual([orbBounds(LAYOUT, WORK_AREA)])
    expect(lastOf(window.resizable, 'orb')).toBe(false)
    expect(lastOf(window.ignored, 'orb')).toBe(false)
    expect(window.hidden).toBe(1)
    expect(window.bubblesHidden).toBe(1)
    expect(window.bubblesRevealed).toBe(0)
    expect(window.publishedOrb.at(-1)).toMatchObject({ role: 'orb', presentation: 'orb' })
    expect(window.publishedSurface.at(-1)).toMatchObject({ role: 'surface', presentation: 'orb' })
    expect(window.publishedBubbles.at(-1)).toMatchObject({ role: 'bubbles', presentation: 'orb' })
  })

  it('re-reveals the panel and the bubble column when the windows are restored', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'expand' })
    controller.dispatch({ kind: 'presentBubbles' })
    const revealed = window.revealed
    const bubblesRevealed = window.bubblesRevealed
    controller.restore()
    expect(boundsOf(window, 'surface').at(-1)).toEqual(panelBounds(LAYOUT, WORK_AREA))
    expect(boundsOf(window, 'bubbles').at(-1)).toEqual(bubblesBounds(LAYOUT, WORK_AREA))
    expect(window.revealed).toBe(revealed + 1)
    expect(window.bubblesRevealed).toBe(bubblesRevealed + 1)
    expect(window.hidden).toBe(0)
  })

  it('focuses the surface window when a modal is restored', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'fatal-form' })
    const focused = window.focused
    controller.restore()
    expect(window.focused).toBe(focused + 1)
  })

  it('presents the bubble column in its own window without focus or a surface change', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' }, 'orb')
    expect(controller.snapshot('bubbles')).toMatchObject({ role: 'bubbles', presentation: 'bubbles', modal: null })
    expect(controller.snapshot('surface')).toMatchObject({ role: 'surface', presentation: 'orb' })
    expect(controller.snapshot('orb')).toMatchObject({ role: 'orb', presentation: 'orb' })
    expect(boundsOf(window, 'bubbles').at(-1)).toEqual(bubblesBounds(LAYOUT, WORK_AREA))
    expect(lastOf(window.resizable, 'bubbles')).toBe(false)
    expect(window.bubblesRevealed).toBe(1)
    expect(window.publishedBubbles.at(-1)).toMatchObject({ presentation: 'bubbles' })
    expect(window.revealed).toBe(0)
    expect(window.focused).toBe(0)
    expect(window.hidden).toBe(0)
  })

  it('keeps the bubble column independent of the surface presentation', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' }, 'orb')
    controller.dispatch({ kind: 'expand' })
    expect(controller.snapshot('surface').presentation).toBe('panel')
    expect(controller.snapshot('bubbles').presentation).toBe('bubbles')
    expect(window.bubblesHidden).toBe(0)
    controller.dispatch({ kind: 'dismissBubbles' }, 'bubbles')
    expect(controller.snapshot('bubbles').presentation).toBe('orb')
    expect(controller.snapshot('surface').presentation).toBe('panel')
    expect(window.bubblesHidden).toBe(1)
    expect(window.hidden).toBe(0)
  })

  it('publishes the orb hover fact so the bubble window can time the exit', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'pointerInside', inside: true }, 'orb')
    expect(window.publishedSurface.at(-1)).toMatchObject({ orbHovered: true })
    expect(window.publishedOrb.at(-1)).toMatchObject({ orbHovered: true })
    expect(window.publishedBubbles.at(-1)).toMatchObject({ orbHovered: true })
    const published = window.publishedBubbles.length
    controller.dispatch({ kind: 'pointerInside', inside: true }, 'orb')
    controller.dispatch({ kind: 'pointerInside', inside: false }, 'bubbles')
    expect(window.publishedBubbles.length).toBe(published)
    controller.dispatch({ kind: 'pointerInside', inside: false }, 'orb')
    expect(window.publishedBubbles.at(-1)).toMatchObject({ orbHovered: false })
  })

  it('ignores a repeated bubble presentation and dismissal that changes nothing', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'dismissBubbles' })
    expect(window.publishedBubbles).toEqual([])
    expect(window.bubblesHidden).toBe(0)
    controller.dispatch({ kind: 'presentBubbles' })
    const published = window.publishedBubbles.length
    controller.dispatch({ kind: 'presentBubbles' })
    expect(window.publishedBubbles.length).toBe(published)
    expect(window.bubblesRevealed).toBe(1)
  })

  it('holds a visible column while the workbench modal is open', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' }, 'orb')
    controller.dispatch({ kind: 'presentModal', id: 'better-interact.workbench' })
    expect(controller.snapshot('bubbles')).toMatchObject({ presentation: 'bubbles', modalOpen: true })
    expect(controller.snapshot('surface')).toMatchObject({ presentation: 'modal', modalOpen: true })
    controller.dispatch({ kind: 'dismissBubbles' }, 'bubbles')
    expect(controller.snapshot('bubbles').presentation).toBe('bubbles')
    expect(window.bubblesHidden).toBe(0)
    controller.dispatch({ kind: 'dismissModal' })
    expect(controller.snapshot('bubbles')).toMatchObject({ presentation: 'bubbles', modalOpen: false })
    expect(window.bubblesHidden).toBe(0)
    expect(window.bubblesRevealed).toBe(2)
  })

  it('defers a column requested during the workbench until the modal leaves', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'better-interact.workbench' })
    controller.dispatch({ kind: 'presentBubbles' }, 'orb')
    expect(controller.snapshot('bubbles')).toMatchObject({ presentation: 'bubbles', modalOpen: true })
    expect(window.bubblesRevealed).toBe(0)
    controller.dispatch({ kind: 'dismissModal' })
    expect(window.bubblesRevealed).toBe(1)
    expect(controller.snapshot('bubbles')).toMatchObject({ presentation: 'bubbles', modalOpen: false })
  })

  it('opens the workbench from a bubble click and keeps the column that opened it', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' }, 'orb')
    controller.dispatch({ kind: 'presentModal', id: 'better-interact.workbench' }, 'bubbles')
    expect(controller.snapshot('surface')).toMatchObject({ presentation: 'modal', modal: 'better-interact.workbench' })
    expect(window.focused).toBe(1)
    expect(controller.snapshot('bubbles').presentation).toBe('bubbles')
  })

  it('keeps the bubble column when the surface window loses focus', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' })
    controller.dispatch({ kind: 'expand' })
    controller.blurred()
    expect(controller.snapshot('surface').presentation).toBe('orb')
    expect(controller.snapshot('bubbles').presentation).toBe('bubbles')
    expect(window.bubblesHidden).toBe(0)
  })

  it('passes clicks through the empty pixels of the bubble column only while it is up', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'pointerInside', inside: false }, 'bubbles')
    expect(lastOf(window.ignored, 'bubbles')).toBe(false)
    controller.dispatch({ kind: 'presentBubbles' })
    expect(lastOf(window.ignored, 'bubbles')).toBe(true)
    controller.dispatch({ kind: 'pointerInside', inside: true }, 'bubbles')
    expect(lastOf(window.ignored, 'bubbles')).toBe(false)
    controller.dispatch({ kind: 'dismissBubbles' })
    expect(lastOf(window.ignored, 'bubbles')).toBe(false)
  })

  it('moves the bubble column with the orb while it is up', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'dragBy', deltaX: -10, deltaY: -10 }, 'orb')
    expect(boundsOf(window, 'bubbles')).toEqual([])
    controller.dispatch({ kind: 'presentBubbles' })
    controller.dispatch({ kind: 'dragBy', deltaX: -10, deltaY: -10 }, 'orb')
    expect(boundsOf(window, 'bubbles').at(-1))
      .toEqual(bubblesBounds({ ...LAYOUT, orb: { x: 1260, y: 380 } }, WORK_AREA))
  })

  it('hides the bubble column while a modal stays open when the windows are restored', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'better-interact.workbench' })
    controller.dispatch({ kind: 'presentBubbles' })
    const revealed = window.bubblesRevealed
    controller.restore()
    expect(window.bubblesRevealed).toBe(revealed)
    expect(window.bubblesHidden).toBe(1)
    controller.dispatch({ kind: 'dismissModal' })
    expect(window.bubblesRevealed).toBe(revealed + 1)
  })
})

describe('command dispatch through parsed input', () => {
  it('accepts every parsed command', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    for (const raw of [
      { kind: 'pointerInside', inside: true },
      { kind: 'expand' },
      { kind: 'presentModal', id: 'card' },
      { kind: 'dismissModal' },
      { kind: 'setPinned', pinned: false },
      { kind: 'presentBubbles' },
      { kind: 'dismissBubbles' },
      { kind: 'collapse' },
      { kind: 'dragBy', deltaX: 1, deltaY: 1 },
    ]) {
      const command = parseSurfaceCommand(raw)
      expect(command).not.toBeUndefined()
      controller.dispatch(command!)
    }
    expect(controller.snapshot('surface').presentation).toBe('orb')
  })
})
