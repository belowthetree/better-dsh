// @vitest-environment jsdom
/** Driven OrbLayer props: presentation branches, visual states, and the drag gesture. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
import type { VoiceCaptureSnapshot } from '@deepseek-ai/dsh-client-voice-capture/client'
import type { VoiceOutputSnapshot } from '@deepseek-ai/dsh-client-ui-voice-output/protocol'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { OrbLayer } from '../src/client/OrbLayer.tsx'
import type { OrbLayerProps } from '../src/client/OrbLayer.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const ORB_SURFACE: SurfaceSnapshot = Object.freeze({
  form: 'orb', role: 'orb', presentation: 'orb', pinned: false, available: true, modal: null, orbHovered: false,
  modalOpen: false,
})

/** One Session row; only the current main-view row is retained. */
function row(id: string, title: string, options: { running?: boolean; current?: boolean } = {}): SessionSummary {
  return {
    id: SessionId(id), displayTitle: title, running: options.running ?? false,
    retainedBy: options.current === true ? { mainView: 1 } : {}, blank: false, updatedAt: 0,
  }
}

/** Session list snapshot over the given rows. */
function list(...rows: SessionSummary[]): SessionListState {
  return {
    ids: rows.map(item => item.id),
    byId: Object.fromEntries(rows.map(item => [item.id, item])),
    phase: 'ready',
    projectionsBySession: {},
  }
}

const EMPTY_LIST = list()

/** Capture snapshot in the requested phase. */
function capture(phase: VoiceCaptureSnapshot['phase']): VoiceCaptureSnapshot {
  return {
    phase,
    pendingTranscript: null,
    device: { id: '', label: 'System default' },
    level: 0,
    failure: null,
    maxDurationSeconds: 120,
    selection: { providerId: 'test' as SpeechProviderId, language: 'auto' },
  }
}

/** Playback snapshot with the caller's changes. */
function playback(patch: Partial<VoiceOutputSnapshot> = {}): VoiceOutputSnapshot {
  return {
    policy: 'off',
    voiceId: 'stella',
    voices: [{ id: 'stella', name: 'Stella' }, { id: 'tide', name: 'Tide' }],
    muted: false,
    speaking: false,
    queued: 0,
    failure: null,
    limit: 4096,
    ...patch,
  }
}

let frames = new Map<number, FrameRequestCallback>()
let nextFrame = 1

/** Run the queued animation frames. */
function flushFrames(): void {
  const pending = [...frames.values()]
  frames.clear()
  for (const run of pending) run(0)
}

/** Fire one pointer event with explicit client and screen positions. */
function pointer(
  target: Element,
  type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel',
  x: number,
  y: number,
  screen: { readonly x: number; readonly y: number } = { x, y },
): void {
  fireEvent[type](target, { pointerId: 1, button: 0, clientX: x, clientY: y, screenX: screen.x, screenY: screen.y })
}

function fixture(initial: { surface?: Partial<SurfaceSnapshot>; sessions?: SessionListState } = {}) {
  const surface = createSnapshotStore<SurfaceSnapshot>({ ...ORB_SURFACE, ...initial.surface })
  const captureStore = createSnapshotStore<VoiceCaptureSnapshot | null>(null)
  const voice = createSnapshotStore<VoiceOutputSnapshot | null>(null)
  const reducedMotion = createSnapshotStore(false)
  const sessions = createSnapshotStore<SessionListState>(initial.sessions ?? EMPTY_LIST)
  const actions = {
    openChat: vi.fn(), dragBy: vi.fn(), pointerInside: vi.fn(), toggleVoice: vi.fn(),
  }
  const props = {
    useSurface: bindSnapshotSelector(surface),
    useCapture: bindSnapshotSelector(captureStore),
    useVoice: bindSnapshotSelector(voice),
    useReducedMotion: bindSnapshotSelector(reducedMotion),
    useSessions: bindSnapshotSelector(sessions),
    actions,
    t: makeTranslate(zh),
  } as OrbLayerProps
  render(<OrbLayer {...props} />)
  return { surface, capture: captureStore, voice, reducedMotion, sessions, actions }
}

/** The overlay root and the orb button. */
const root = (): HTMLElement => document.querySelector('[data-orb]') as HTMLElement
const orb = (): HTMLElement => document.querySelector('[data-orb-button]') as HTMLElement

beforeEach(() => {
  frames = new Map()
  nextFrame = 1
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++
    frames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  // jsdom has no pointer capture; each element keeps the pointer id it captured.
  const captured = new WeakMap<Element, number>()
  Object.defineProperty(Element.prototype, 'setPointerCapture', {
    configurable: true,
    value(this: Element, id: number) { captured.set(this, id) },
  })
  Object.defineProperty(Element.prototype, 'releasePointerCapture', {
    configurable: true,
    value(this: Element) { captured.delete(this) },
  })
})

it('labels the idle, capturing, transcribing, speaking, and running states', () => {
  const b = fixture()
  expect(root().dataset.state).toBe('idle')
  expect(document.querySelector('[data-orb-glyph]')?.getAttribute('data-orb-glyph')).toBe('idle')
  expect(orb().getAttribute('aria-label')).toBe(zh['orb.open'])

  act(() => { b.capture.set(capture('capturing')) })
  expect(root().dataset.state).toBe('capturing')
  expect(document.querySelector('[data-orb-glyph]')?.getAttribute('data-orb-glyph')).toBe('capturing')
  expect(orb().getAttribute('aria-label')).toBe(zh['orb.openCapturing'])

  act(() => { b.capture.set(capture('transcribing')) })
  expect(root().dataset.state).toBe('transcribing')
  expect(orb().getAttribute('aria-label')).toBe(zh['orb.openTranscribing'])

  act(() => { b.capture.set(null); b.voice.set(playback({ speaking: true })) })
  expect(root().dataset.state).toBe('speaking')
  expect(document.querySelector('[data-orb-glyph]')?.getAttribute('data-orb-glyph')).toBe('speaking')
  expect(orb().getAttribute('aria-label')).toBe(zh['orb.openSpeaking'])

  act(() => { b.voice.set(null); b.sessions.set(list(row('active', 'Release notes', { running: true, current: true }))) })
  expect(root().dataset.state).toBe('running')
  expect(orb().getAttribute('aria-label')).toBe(zh['orb.openRunning'])
})

it('offers a mic control only while the capture service is mounted', () => {
  const b = fixture()
  expect(document.querySelector('[data-orb-mic]')).toBeNull()
  act(() => { b.capture.set(capture('idle')) })
  const mic = document.querySelector('[data-orb-mic]') as HTMLButtonElement
  expect(mic.getAttribute('aria-label')).toBe(zh['orb.micStart'])
  fireEvent.pointerDown(mic, { pointerId: 1, button: 0, clientX: 40, clientY: 60 })
  fireEvent.pointerEnter(mic)
  fireEvent.pointerLeave(mic)
  expect(b.actions.pointerInside).toHaveBeenNthCalledWith(1, true)
  expect(b.actions.pointerInside).toHaveBeenNthCalledWith(2, false)
  fireEvent.click(mic)
  expect(b.actions.toggleVoice).toHaveBeenCalledOnce()
  expect(b.actions.openChat).not.toHaveBeenCalled()

  act(() => { b.capture.set(capture('capturing')) })
  expect(mic.getAttribute('aria-label')).toBe(zh['orb.micStop'])

  act(() => { b.capture.set(null) })
  expect(document.querySelector('[data-orb-mic]')).toBeNull()
})

it('marks hover, press, and the reduced-motion preference', () => {
  const b = fixture()
  fireEvent.pointerEnter(orb())
  expect(orb().dataset.hovered).toBe('true')
  pointer(orb(), 'pointerDown', 10, 10)
  expect(orb().dataset.pressed).toBe('true')
  pointer(orb(), 'pointerUp', 10, 10)
  expect(orb().dataset.pressed).toBeUndefined()
  fireEvent.pointerLeave(orb())
  expect(orb().dataset.hovered).toBeUndefined()
  expect(root().dataset.reducedMotion).toBeUndefined()
  act(() => { b.reducedMotion.set(true) })
  expect(root().dataset.reducedMotion).toBe('true')
})

it('opens the chat dialog on click and reports pointer presence from the orb and its drag handle', () => {
  const b = fixture()
  fireEvent.click(orb())
  expect(b.actions.openChat).toHaveBeenCalledOnce()
  fireEvent.pointerEnter(orb())
  expect(b.actions.pointerInside).toHaveBeenLastCalledWith(true)
  fireEvent.pointerLeave(orb())
  expect(b.actions.pointerInside).toHaveBeenLastCalledWith(false)
  // The handle sits inside the orb, so entering it reports presence for both boundaries.
  const handle = document.querySelector('[data-orb-drag]') as HTMLElement
  fireEvent.pointerEnter(handle)
  expect(b.actions.pointerInside).toHaveBeenLastCalledWith(true)
  fireEvent.pointerLeave(handle)
  expect(b.actions.pointerInside).toHaveBeenLastCalledWith(false)
  expect(b.actions.pointerInside.mock.calls).toEqual([[true], [false], [true], [true], [false], [false]])
})

it('drags the orb through throttled deltas and suppresses the click it would produce', () => {
  const b = fixture()
  pointer(orb(), 'pointerDown', 10, 10)
  pointer(orb(), 'pointerMove', 30, 18)
  expect(orb().dataset.dragging).toBe('true')
  expect(b.actions.dragBy).not.toHaveBeenCalled()
  act(flushFrames)
  expect(b.actions.dragBy).toHaveBeenCalledExactlyOnceWith(20, 8)
  // A second move joins the queued frame instead of scheduling another one.
  pointer(orb(), 'pointerMove', 40, 18)
  pointer(orb(), 'pointerMove', 42, 18)
  expect(frames.size).toBe(1)
  pointer(orb(), 'pointerUp', 42, 18)
  expect(frames.size).toBe(0)
  expect(b.actions.dragBy.mock.calls).toEqual([[20, 8], [12, 0]])
  expect(orb().dataset.dragging).toBeUndefined()
  fireEvent.click(orb())
  expect(b.actions.openChat).not.toHaveBeenCalled()
})

it('measures drag movement in screen coordinates so the moving window cannot cancel it', () => {
  const b = fixture()
  pointer(orb(), 'pointerDown', 10, 10)
  pointer(orb(), 'pointerMove', 30, 18)
  act(flushFrames)
  expect(b.actions.dragBy).toHaveBeenLastCalledWith(20, 8)
  // The carrier followed the pointer by (20, 8), so the pointer's client
  // position under the moved window is back at the press point while the
  // screen position continues from the last report.
  pointer(orb(), 'pointerMove', 10, 10, { x: 50, y: 28 })
  act(flushFrames)
  expect(b.actions.dragBy).toHaveBeenLastCalledWith(20, 10)
  pointer(orb(), 'pointerUp', 10, 10, { x: 50, y: 28 })
})

it('skips a queued drag frame that accumulated no movement', () => {
  const b = fixture()
  pointer(orb(), 'pointerDown', 10, 10)
  pointer(orb(), 'pointerMove', 30, 30)
  pointer(orb(), 'pointerMove', 10, 10)
  act(flushFrames)
  expect(b.actions.dragBy).not.toHaveBeenCalled()
  pointer(orb(), 'pointerUp', 10, 10)
})

it('treats a press that stays inside the threshold as a click', () => {
  const b = fixture()
  pointer(orb(), 'pointerDown', 10, 10)
  pointer(orb(), 'pointerMove', 12, 11)
  act(flushFrames)
  pointer(orb(), 'pointerUp', 12, 11)
  expect(b.actions.dragBy).not.toHaveBeenCalled()
  fireEvent.click(orb())
  expect(b.actions.openChat).toHaveBeenCalledOnce()
})

it('ignores a secondary press, a foreign pointer, and a cancelled gesture', () => {
  const b = fixture()
  fireEvent.pointerDown(orb(), { pointerId: 1, button: 2, clientX: 10, clientY: 10 })
  expect(frames.size).toBe(0)
  pointer(orb(), 'pointerDown', 10, 10)
  pointer(orb(), 'pointerMove', 40, 10)
  act(flushFrames)
  pointer(orb(), 'pointerCancel', 40, 10)
  expect(b.actions.dragBy).toHaveBeenCalledExactlyOnceWith(30, 0)
  pointer(orb(), 'pointerDown', 10, 10)
  pointer(orb(), 'pointerDown', 50, 10)
  pointer(orb(), 'pointerUp', 10, 10)
  fireEvent.pointerMove(orb(), { pointerId: 9, clientX: 90, clientY: 10 })
  fireEvent.pointerUp(orb(), { pointerId: 9, clientX: 90, clientY: 10 })
  fireEvent.lostPointerCapture(orb(), { pointerId: 1 })
  act(flushFrames)
  expect(b.actions.dragBy).toHaveBeenCalledOnce()
  expect(orb().dataset.dragging).toBeUndefined()
})

it('leaves a secondary click inert', () => {
  const b = fixture()
  act(() => { b.voice.set(playback()) })
  fireEvent.contextMenu(orb())
  expect(screen.queryByRole('menu')).toBeNull()
  expect(b.actions.openChat).not.toHaveBeenCalled()
})

it('draws no orb in the surface window role', () => {
  fixture({ surface: { role: 'surface' } })
  expect(document.querySelector('[data-orb]')).toBeNull()
  expect(document.querySelector('[data-orb-prompt]')).toBeNull()
})

it('draws no orb in the bubble column window role', () => {
  fixture({ surface: { role: 'bubbles' } })
  expect(document.querySelector('[data-orb]')).toBeNull()
})

it('keeps the orb while the surface window presents another presentation', () => {
  for (const presentation of ['classic', 'panel', 'modal', 'bubbles'] as const) {
    fixture({ surface: { presentation } })
    expect(document.querySelector('[data-orb]')).not.toBeNull()
    cleanup()
  }
})
