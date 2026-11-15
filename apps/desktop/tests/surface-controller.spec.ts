// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  DesktopSurfaceController, MAX_MODAL_ID_CHARS, parseSurfaceCommand, type SurfaceWindowEffects,
} from '../src/surface-controller.ts'
import type { DesktopFormLayout } from '../src/form-layout.ts'
import { bubblesBounds, modalBounds, type FormPresentationBounds } from '../src/form-window.ts'

const WORK_AREA = { x: 0, y: 0, width: 1440, height: 900 }
const LAYOUT: DesktopFormLayout = { version: 1, orb: { x: 1300, y: 400 }, pinned: false }

function effects(workArea = WORK_AREA): SurfaceWindowEffects & {
  readonly bounds: FormPresentationBounds[]
  readonly resizable: boolean[]
  readonly ignored: boolean[]
  readonly persisted: DesktopFormLayout[]
  readonly published: unknown[]
  readonly focused: number
} {
  const record = {
    bounds: [] as FormPresentationBounds[],
    resizable: [] as boolean[],
    ignored: [] as boolean[],
    persisted: [] as DesktopFormLayout[],
    published: [] as unknown[],
    focused: 0,
  }
  return {
    get bounds() { return record.bounds },
    get resizable() { return record.resizable },
    get ignored() { return record.ignored },
    get persisted() { return record.persisted },
    get published() { return record.published },
    get focused() { return record.focused },
    setBounds: (next) => { record.bounds.push(next) },
    setResizable: (next) => { record.resizable.push(next) },
    setIgnoreMouseEvents: (next) => { record.ignored.push(next) },
    focus: () => { record.focused++ },
    publish: (next) => { record.published.push(next) },
    persist: (next) => { record.persisted.push(next) },
    workArea: () => workArea,
  }
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
  it('starts on the orb presentation with persisted pinning', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: { ...LAYOUT, pinned: true }, effects: window })
    expect(controller.snapshot()).toEqual({
      form: 'orb', presentation: 'orb', pinned: true, available: true, modal: null,
    })
  })

  it('clamps a persisted orb into the work area at construction', () => {
    const window = effects()
    new DesktopSurfaceController({ layout: { ...LAYOUT, orb: { x: 5000, y: -40 } }, effects: window })
    expect(window.persisted).toEqual([])
    const controller = new DesktopSurfaceController({ layout: { ...LAYOUT, orb: { x: 5000, y: -40 } }, effects: window })
    expect(controller.snapshot().presentation).toBe('orb')
  })

  it('expands to the panel, resizes, focuses, and publishes', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'expand' })
    expect(controller.snapshot().presentation).toBe('panel')
    expect(window.resizable).toEqual([true])
    expect(window.focused).toBe(1)
    expect(window.bounds.at(-1)).toEqual({ x: 740, y: 400, width: 560, height: 160 })
    expect(window.published.at(-1)).toMatchObject({ presentation: 'panel' })
  })

  it('raises the panel for a shell-owned document and stays idempotent', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    expect(controller.ensurePanel()).toBe(true)
    expect(controller.snapshot().presentation).toBe('panel')
    expect(window.focused).toBe(1)
    const published = window.published.length
    expect(controller.ensurePanel()).toBe(true)
    expect(window.published.length).toBe(published)
  })

  it('leaves a form-owned modal in place for a shell-owned document', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'orb.quick-setup' })
    expect(controller.ensurePanel()).toBe(false)
    expect(controller.snapshot()).toEqual({ form: 'orb', presentation: 'modal', pinned: false,
      available: true, modal: 'orb.quick-setup' })
  })

  it('ignores expand while already expanded and collapse while collapsed', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'collapse' })
    expect(window.bounds).toEqual([])
    controller.dispatch({ kind: 'expand' })
    const focused = window.focused
    controller.dispatch({ kind: 'expand' })
    expect(window.focused).toBe(focused)
  })

  it('collapses back to the orb without focusing', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'expand' })
    const focused = window.focused
    controller.dispatch({ kind: 'collapse' })
    expect(controller.snapshot().presentation).toBe('orb')
    expect(window.focused).toBe(focused)
    expect(window.resizable.at(-1)).toBe(false)
    expect(window.bounds.at(-1)).toEqual({ x: 1300, y: 400, width: 112, height: 112 })
  })

  it('restores the previous presentation when the modal dismisses', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'voice-setup' })
    expect(controller.snapshot()).toMatchObject({ presentation: 'modal', modal: 'voice-setup' })
    expect(window.bounds.at(-1)).toEqual(modalBounds(WORK_AREA))
    controller.dispatch({ kind: 'dismissModal' })
    expect(controller.snapshot()).toMatchObject({ presentation: 'orb', modal: null })
  })

  it('restores the panel presentation a modal was raised from', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'expand' })
    controller.dispatch({ kind: 'presentModal', id: 'permission-repair' })
    controller.dispatch({ kind: 'dismissModal' })
    expect(controller.snapshot().presentation).toBe('panel')
  })

  it('replaces the active modal entry without re-entering the presentation', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'first' })
    const bounds = window.bounds.length
    controller.dispatch({ kind: 'presentModal', id: 'second' })
    expect(controller.snapshot().modal).toBe('second')
    expect(window.bounds.length).toBe(bounds)
  })

  it('sizes the modal window from the presentation size hint', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'better-interact.workbench', size: { heightRatio: 0.8 } })
    expect(window.bounds.at(-1)).toEqual(modalBounds(WORK_AREA, { heightRatio: 0.8 }))
    controller.dispatch({ kind: 'dismissModal' })
    expect(controller.snapshot().presentation).toBe('orb')
  })

  it('resizes the modal window when a later entry asks for another size', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'better-interact.workbench', size: { heightRatio: 0.8 } })
    controller.dispatch({ kind: 'presentModal', id: 'orb.chat', size: { heightRatio: 0.5 } })
    expect(window.bounds.at(-1)).toEqual(modalBounds(WORK_AREA, { heightRatio: 0.5 }))
    const resized = window.bounds.length
    controller.dispatch({ kind: 'presentModal', id: 'permission-repair', size: { heightRatio: 0.5 } })
    expect(window.bounds.length).toBe(resized)
  })

  it('ignores modal dismissal while no modal is presented', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'dismissModal' })
    expect(window.published).toEqual([])
  })

  it('persists pinning and survives panel dismissal', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'expand' })
    controller.dispatch({ kind: 'setPinned', pinned: true })
    expect(window.persisted.at(-1)?.pinned).toBe(true)
    controller.blurred()
    expect(controller.snapshot()).toMatchObject({ presentation: 'panel', pinned: true })
  })

  it('collapses an unpinned panel when the window loses focus', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'expand' })
    controller.blurred()
    expect(controller.snapshot().presentation).toBe('orb')
  })

  it('leaves the orb alone and dismisses the modal when the window loses focus', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.blurred()
    expect(controller.snapshot().presentation).toBe('orb')
    controller.dispatch({ kind: 'presentModal', id: 'settings-card' })
    const focused = window.focused
    controller.blurred()
    expect(controller.snapshot()).toEqual({ form: 'orb', presentation: 'orb', pinned: false, available: true, modal: null })
    expect(window.focused).toBe(focused)
  })

  it('dismisses a modal raised from an unpinned panel back to the orb', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'expand' })
    controller.dispatch({ kind: 'presentModal', id: 'permission-repair' })
    const focused = window.focused
    controller.blurred()
    expect(controller.snapshot()).toMatchObject({ presentation: 'orb', modal: null })
    expect(window.focused).toBe(focused)
  })

  it('restores a pinned panel a modal was raised from when the window loses focus', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'expand' })
    controller.dispatch({ kind: 'setPinned', pinned: true })
    controller.dispatch({ kind: 'presentModal', id: 'permission-repair' })
    const focused = window.focused
    controller.blurred()
    expect(controller.snapshot()).toMatchObject({ presentation: 'panel', modal: null, pinned: true })
    expect(window.focused).toBe(focused)
  })

  it('moves the orb by a pointer delta and clamps it into the work area', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'dragBy', deltaX: 20, deltaY: -30 })
    expect(window.bounds.at(-1)).toEqual({ x: 1320, y: 370, width: 112, height: 112 })
    controller.dispatch({ kind: 'dragBy', deltaX: 10_000, deltaY: 10_000 })
    expect(window.bounds.at(-1)).toEqual({ x: 1328, y: 788, width: 112, height: 112 })
    expect(window.persisted.at(-1)?.orb).toEqual({ x: 1328, y: 788 })
  })

  it('ignores dragging outside the orb presentation', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'expand' })
    const bounds = window.bounds.length
    controller.dispatch({ kind: 'dragBy', deltaX: 40, deltaY: 40 })
    expect(window.bounds.length).toBe(bounds)
  })

  it('keeps the orb interactive until the renderer reports pointer presence', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    expect(window.ignored).toEqual([])
    controller.dispatch({ kind: 'pointerInside', inside: false })
    expect(window.ignored.at(-1)).toBe(true)
    controller.dispatch({ kind: 'pointerInside', inside: true })
    expect(window.ignored.at(-1)).toBe(false)
  })

  it('never passes clicks through while expanded', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'pointerInside', inside: false })
    controller.dispatch({ kind: 'expand' })
    expect(window.ignored.at(-1)).toBe(false)
  })

  it('re-clamps the persisted orb and current bounds after a display change', () => {
    const window = effects({ x: 0, y: 0, width: 800, height: 600 })
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.reflow()
    expect(window.persisted.at(-1)?.orb).toEqual({ x: 688, y: 400 })
    expect(window.bounds.at(-1)).toEqual({ x: 688, y: 400, width: 112, height: 112 })
  })

  it('re-applies bounds, resizing, click-through, and a snapshot when the window is restored', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'pointerInside', inside: false })
    window.bounds.length = 0
    controller.restore()
    expect(window.bounds).toHaveLength(1)
    expect(window.resizable.at(-1)).toBe(false)
    expect(window.ignored.at(-1)).toBe(true)
    expect(window.published.at(-1)).toMatchObject({ presentation: 'orb' })
  })

  it('publishes after the modal presentation is raised', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentModal', id: 'fatal-form' })
    expect(window.published.at(-1)).toMatchObject({ presentation: 'modal', modal: 'fatal-form' })
  })

  it('presents the bubble column at the right edge without focus', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' })
    expect(controller.snapshot()).toMatchObject({ presentation: 'bubbles', modal: null })
    expect(window.bounds.at(-1)).toEqual(bubblesBounds(WORK_AREA))
    expect(window.resizable.at(-1)).toBe(false)
    expect(window.focused).toBe(0)
  })

  it('dismisses the bubble column back to the orb without focus', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' })
    controller.dispatch({ kind: 'dismissBubbles' })
    expect(controller.snapshot().presentation).toBe('orb')
    expect(window.bounds.at(-1)).toEqual({ x: 1300, y: 400, width: 112, height: 112 })
    expect(window.focused).toBe(0)
  })

  it('ignores bubble commands that do not change the presentation', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'dismissBubbles' })
    expect(window.published).toEqual([])
    controller.dispatch({ kind: 'presentBubbles' })
    const published = window.published.length
    controller.dispatch({ kind: 'presentBubbles' })
    expect(window.published.length).toBe(published)
  })

  it('keeps the bubble column when the window loses focus', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' })
    const bounds = window.bounds.length
    controller.blurred()
    expect(controller.snapshot().presentation).toBe('bubbles')
    expect(window.bounds.length).toBe(bounds)
  })

  it('restores the bubble column a modal was raised from', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' })
    controller.dispatch({ kind: 'presentModal', id: 'better-interact.workbench' })
    expect(window.bounds.at(-1)).toEqual(modalBounds(WORK_AREA))
    controller.dispatch({ kind: 'dismissModal' })
    expect(controller.snapshot()).toMatchObject({ presentation: 'bubbles', modal: null })
  })

  it('returns to the bubble column when a modal raised from it loses focus', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' })
    controller.dispatch({ kind: 'presentModal', id: 'better-interact.workbench' })
    controller.blurred()
    expect(controller.snapshot()).toMatchObject({ presentation: 'bubbles', modal: null })
  })

  it('replaces the bubble column when a shell-owned document needs the panel', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'presentBubbles' })
    expect(controller.ensurePanel()).toBe(true)
    expect(controller.snapshot().presentation).toBe('panel')
  })

  it('passes clicks through the empty pixels of the bubble column', () => {
    const window = effects()
    const controller = new DesktopSurfaceController({ layout: LAYOUT, effects: window })
    controller.dispatch({ kind: 'pointerInside', inside: false })
    controller.dispatch({ kind: 'presentBubbles' })
    expect(window.ignored.at(-1)).toBe(true)
    controller.dispatch({ kind: 'pointerInside', inside: true })
    expect(window.ignored.at(-1)).toBe(false)
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
    ]) {
      const command = parseSurfaceCommand(raw)
      expect(command).not.toBeUndefined()
      controller.dispatch(command!)
    }
    expect(controller.snapshot().presentation).toBe('orb')
  })
})
