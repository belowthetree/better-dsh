// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/protocol'
import {
  DesktopSurfaceController, MAX_MODAL_ID_CHARS, parseSurfaceCommand, type SurfaceWindowEffects,
} from '../src/surface-controller.ts'
import type { DesktopFormLayout } from '../src/form-layout.ts'
import { bubblesBounds, modalBounds, orbBounds, panelBounds, type DesktopFormRole, type FormPresentationBounds } from '../src/form-window.ts'

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
  readonly revealed: number
  readonly focused: number
  readonly hidden: number
} {
  const record = {
    bounds: [] as AppliedBounds[],
    resizable: [] as Applied<boolean>[],
    ignored: [] as Applied<boolean>[],
    persisted: [] as DesktopFormLayout[],
    publishedOrb: [] as SurfaceSnapshot[],
    publishedSurface: [] as SurfaceSnapshot[],
    revealed: 0,
    focused: 0,
    hidden: 0,
  }
  return {
    get bounds() { return record.bounds },
    get resizable() { return record.resizable },
    get ignored() { return record.ignored },
    get persisted() { return record.persisted },
    get publishedOrb() { return record.publishedOrb },
    get publishedSurface() { return record.publishedSurface },
    get revealed() { return record.revealed },
    get focused() { return record.focused },
    get hidden() { return record.hidden },
    setBounds: (role, bounds) => { record.bounds.push({ role, bounds }) },
    setResizable: (role, value) => { record.resizable.push({ role, value }) },
    setIgnoreMouseEvents: (role, value) => { record.ignored.push({ role, value }) },
    revealSurface: () => { record.revealed++ },
    focusSurface: () => { record.focused++ },
    hideSurface: () => { record.hidden++ },
    publishOrb: (snapshot) => { record.publishedOrb.push(snapshot) },
    publishSurface: (snapshot) => { record.publishedSurface.push(snapshot) },
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

describe('parseSurfaceCommand', () => {
  it.each([
    [{ kind: 'expand' }, { kind: 'expand' }],
    [{ kind: 'collapse' }, { kind: 'collapse' }],
    [{ kind: 'dismissModal' }, { kind: 'dismissModal' }],
    [{ kind: 'presentBubbles' }, { kind: 'presentBubbles' }],
    [{ kind: 'dismissBubbles' }, { kind: 'dismissBubbles' }],
    [{ kind: 'presentModal', id: 'voice-setup' }, { kind: 'presentModal', id: 'voice-setup' }],
    [
      { kind: 'presentModal', id: 'voice-setup', size: { heightRatio: 0.8 } },
      { kind: 'presentModal', id: 'voice-setup', size: { heightRatio: 0.8 } },
    ],
    [{ kind: 'presentModal', id: 'voice-setup', size: {} }, { kind: 'presentModal', id: 'voice-setup', size: {} }],
    [{ kind: 'setPinned', pinned: true }, { kind: 'setPinned', pinned: true }],
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
    ['non-object size', { kind: 'presentModal', id: 'x', size: 'tall' }],
    ['zero height ratio', { kind: 'presentModal', id: 'x', size: { heightRatio: 0 } }],
    ['oversized height ratio', { kind: 'presentModal', id: 'x', size: { heightRatio: 1.5 } }],
    ['nan height ratio', { kind: 'presentModal', id: 'x', size: { heightRatio: Number.NaN } }],
    ['string height ratio', { kind: 'presentModal', id: 'x', size: { heightRatio: '0.8' } }],
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
      form: 'orb', role: 'orb', presentation: 'orb', pinned: true, available: true, modal: null,
    })
    expect(controller.snapshot('surface')).toEqual({
      form: 'orb', role: 'surface', presentation: 'orb', pinned: true, available: true, modal: null,
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
    controller.dispatch({ kind: 'presentModal', id: 'orb.quick-setup' })
    expect(controller.ensurePanel()).toBe(false)
    expect(controller.snapshot('surface')).toEqual({ form: 'orb', role: 'surface', presentation: 'modal', pinned: false,
      available: true, modal: 'orb.quick-setup' })
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
    expect(boundsOf(window, 'orb').at(-1)).toEqual({ x: 1300, y: 400, width: 112, height: 112 })
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
    controller.dispatch({ kind: 'presentModal', id: 'orb.quick-setup' })
    const focused = window.focused
    controller.dispatch({ kind: 'presentModal', id: 'orb.chat' }, 'orb')
    expect(window.focused).toBe(focused + 1)
    expect(controller.snapshot('surface').modal).toBe('orb.chat')
    controller.dispatch({ kind: 'presentModal', id: 'orb.chat' })
    expect(window.focused).toBe(focused + 1)
  })

  it('sizes the modal window from the presentation size hint', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'better-interact.workbench', size: { heightRatio: 0.8 } })
    expect(boundsOf(window, 'surface').at(-1)).toEqual(modalBounds(WORK_AREA, { heightRatio: 0.8 }))
    controller.dispatch({ kind: 'dismissModal' })
    expect(controller.snapshot('surface').presentation).toBe('orb')
  })

  it('resizes the modal window when a later entry asks for another size', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'better-interact.workbench', size: { heightRatio: 0.8 } })
    controller.dispatch({ kind: 'presentModal', id: 'orb.chat', size: { heightRatio: 0.5 } })
    expect(boundsOf(window, 'surface').at(-1)).toEqual(modalBounds(WORK_AREA, { heightRatio: 0.5 }))
    const resized = window.bounds.length
    controller.dispatch({ kind: 'presentModal', id: 'permission-repair', size: { heightRatio: 0.5 } })
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

  it('publishes the changed pin state to both windows', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'setPinned', pinned: true }, 'orb')
    expect(window.publishedOrb.at(-1)).toMatchObject({ role: 'orb', pinned: true })
    expect(window.publishedSurface.at(-1)).toMatchObject({ role: 'surface', pinned: true })
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
      form: 'orb', role: 'surface', presentation: 'orb', pinned: false, available: true, modal: null,
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
    expect(boundsOf(window, 'orb').at(-1)).toEqual({ x: 1320, y: 370, width: 112, height: 112 })
    controller.dispatch({ kind: 'dragBy', deltaX: 10_000, deltaY: 10_000 }, 'orb')
    expect(boundsOf(window, 'orb').at(-1)).toEqual({ x: 1328, y: 788, width: 112, height: 112 })
    expect(window.persisted.at(-1)?.orb).toEqual({ x: 1328, y: 788 })
  })

  it('ignores drag commands reported by the surface window', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'dragBy', deltaX: 40, deltaY: 40 })
    expect(window.bounds).toEqual([])
    expect(window.persisted).toEqual([])
  })

  it('keeps the orb draggable while a modal occupies the surface window', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'orb.chat' })
    controller.dispatch({ kind: 'dragBy', deltaX: 10, deltaY: 10 }, 'orb')
    expect(boundsOf(window, 'orb').at(-1)).toEqual({ x: 1310, y: 410, width: 112, height: 112 })
    expect(controller.snapshot('surface').presentation).toBe('modal')
  })

  it('keeps the orb window interactive until its renderer reports pointer presence', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    expect(window.ignored).toEqual([])
    controller.dispatch({ kind: 'pointerInside', inside: false }, 'orb')
    expect(lastOf(window.ignored, 'orb')).toBe(true)
    controller.dispatch({ kind: 'pointerInside', inside: true }, 'orb')
    expect(lastOf(window.ignored, 'orb')).toBe(false)
  })

  it('keeps the orb window click-through while the surface window presents a panel', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'pointerInside', inside: false }, 'orb')
    controller.dispatch({ kind: 'expand' })
    expect(lastOf(window.ignored, 'orb')).toBe(true)
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

  it('re-clamps the persisted orb and both window bounds after a display change', () => {
    const window = effects({ x: 0, y: 0, width: 800, height: 600 })
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' })
    controller.reflow()
    expect(window.persisted.at(-1)?.orb).toEqual({ x: 688, y: 400 })
    expect(boundsOf(window, 'orb').at(-1)).toEqual({ x: 688, y: 400, width: 112, height: 112 })
    expect(boundsOf(window, 'surface').at(-1)).toEqual(bubblesBounds({ ...LAYOUT, orb: { x: 688, y: 400 } },
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
    expect(lastOf(window.ignored, 'orb')).toBe(true)
    expect(window.hidden).toBe(1)
    expect(window.publishedOrb.at(-1)).toMatchObject({ role: 'orb', presentation: 'orb' })
    expect(window.publishedSurface.at(-1)).toMatchObject({ role: 'surface', presentation: 'orb' })
  })

  it('re-reveals a non-orb presentation when the windows are restored', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' })
    const revealed = window.revealed
    controller.restore()
    expect(boundsOf(window, 'surface').at(-1)).toEqual(bubblesBounds(LAYOUT, WORK_AREA))
    expect(window.revealed).toBe(revealed + 1)
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

  it('presents the bubble column in the surface window without focus', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' }, 'orb')
    expect(controller.snapshot('surface')).toMatchObject({ role: 'surface', presentation: 'bubbles', modal: null })
    expect(controller.snapshot('orb')).toMatchObject({ role: 'orb', presentation: 'orb' })
    expect(boundsOf(window, 'surface').at(-1)).toEqual(bubblesBounds(LAYOUT, WORK_AREA))
    expect(lastOf(window.resizable, 'surface')).toBe(false)
    expect(window.revealed).toBe(1)
    expect(window.focused).toBe(0)
  })

  it('keeps the bubble column when the pointer has moved onto it', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' }, 'orb')
    controller.dispatch({ kind: 'pointerInside', inside: true }, 'surface')
    controller.dispatch({ kind: 'dismissBubbles' }, 'orb')
    expect(controller.snapshot('surface').presentation).toBe('bubbles')
    controller.dispatch({ kind: 'pointerInside', inside: false }, 'surface')
    controller.dispatch({ kind: 'dismissBubbles' }, 'orb')
    expect(controller.snapshot('surface').presentation).toBe('orb')
  })

  it('dismisses the bubble column back to the orb window and hides the surface window', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' })
    controller.dispatch({ kind: 'dismissBubbles' })
    expect(controller.snapshot('surface').presentation).toBe('orb')
    expect(window.hidden).toBe(1)
    expect(window.focused).toBe(0)
  })

  it('ignores bubble commands that do not change the presentation', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'dismissBubbles' })
    expect(window.publishedSurface).toEqual([])
    controller.dispatch({ kind: 'presentBubbles' })
    const published = window.publishedSurface.length
    controller.dispatch({ kind: 'presentBubbles' })
    expect(window.publishedSurface.length).toBe(published)
  })

  it('does not let a hovered orb replace an open panel or modal', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'orb.chat' })
    controller.dispatch({ kind: 'presentBubbles' }, 'orb')
    expect(controller.snapshot('surface')).toMatchObject({ presentation: 'modal', modal: 'orb.chat' })
    controller.dispatch({ kind: 'dismissModal' })
    controller.dispatch({ kind: 'expand' })
    controller.dispatch({ kind: 'presentBubbles' }, 'orb')
    expect(controller.snapshot('surface')).toMatchObject({ presentation: 'panel' })
  })

  it('keeps the bubble column when the surface window loses focus', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' })
    const bounds = window.bounds.length
    controller.blurred()
    expect(controller.snapshot('surface').presentation).toBe('bubbles')
    expect(window.bounds.length).toBe(bounds)
  })

  it('restores the bubble column a modal was raised from', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' })
    controller.dispatch({ kind: 'presentModal', id: 'better-interact.workbench' })
    expect(boundsOf(window, 'surface').at(-1)).toEqual(modalBounds(WORK_AREA))
    controller.dispatch({ kind: 'dismissModal' })
    expect(controller.snapshot('surface')).toMatchObject({ presentation: 'bubbles', modal: null })
  })

  it('returns to the bubble column when a modal raised from it loses focus', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' })
    controller.dispatch({ kind: 'presentModal', id: 'better-interact.workbench' })
    controller.blurred()
    expect(controller.snapshot('surface')).toMatchObject({ presentation: 'bubbles', modal: null })
  })

  it('replaces the bubble column when a shell-owned document needs the panel', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' })
    expect(controller.ensurePanel()).toBe(true)
    expect(controller.snapshot('surface').presentation).toBe('panel')
  })

  it('passes clicks through the empty pixels of the bubble column', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'pointerInside', inside: false }, 'surface')
    controller.dispatch({ kind: 'presentBubbles' })
    expect(lastOf(window.ignored, 'surface')).toBe(true)
    controller.dispatch({ kind: 'pointerInside', inside: true }, 'surface')
    expect(lastOf(window.ignored, 'surface')).toBe(false)
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
