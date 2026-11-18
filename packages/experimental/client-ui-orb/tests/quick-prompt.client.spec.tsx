// @vitest-environment jsdom
/** Driven chat box: prompt entry, submission, and the dictation toggle over the shared capture service. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { VoiceCaptureSnapshot } from '@deepseek-ai/dsh-client-voice-capture/client'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { afterEach, expect, it, vi } from 'vitest'
import { QuickPrompt } from '../src/client/QuickPrompt.tsx'
import type { QuickPromptProps } from '../src/client/QuickPrompt.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** Capture snapshot in the requested phase. */
function capture(phase: VoiceCaptureSnapshot['phase'], patch: Partial<VoiceCaptureSnapshot> = {}): VoiceCaptureSnapshot {
  return {
    phase,
    pendingTranscript: null,
    device: { id: '', label: 'System default' },
    level: 0,
    failure: null,
    maxDurationSeconds: 120,
    selection: { providerId: 'test' as SpeechProviderId, language: 'auto' },
    ...patch,
  }
}

function fixture(initial: { capture?: VoiceCaptureSnapshot | null; transcript?: string | null } = {}) {
  const captureStore = createSnapshotStore<VoiceCaptureSnapshot | null>(initial.capture ?? null)
  const actions = {
    takeTranscript: vi.fn((): string | null => initial.transcript ?? null),
    submit: vi.fn(async () => {}),
    dismiss: vi.fn(),
    startDictation: vi.fn(async () => {}),
    finishDictation: vi.fn(async () => 'dictated text'),
    cancelDictation: vi.fn(),
  }
  const props = {
    useCapture: bindSnapshotSelector(captureStore),
    actions,
    t: makeTranslate(zh),
  } as QuickPromptProps
  render(<QuickPrompt {...props} />)
  return { capture: captureStore, actions }
}

const input = (): HTMLTextAreaElement => document.querySelector('[data-orb-prompt-input]') as HTMLTextAreaElement
const send = (): HTMLButtonElement => document.querySelector('[data-orb-prompt-send]') as HTMLButtonElement
const mic = (): HTMLButtonElement | null => document.querySelector('[data-orb-prompt-mic]')
const status = (): HTMLElement | null => document.querySelector('[data-orb-prompt-status]')

/** Click inside act so the settled capture promise reaches the component. */
async function click(element: Element): Promise<void> {
  await act(async () => { fireEvent.click(element) })
}

it('names the chat box as the management conversation', () => {
  fixture()
  expect(document.querySelector('h2')?.textContent).toBe(zh['prompt.title'])
})

it('starts from the held transcript, focuses the input, and submits on Enter', async () => {
  const b = fixture({ transcript: 'dictated text' })
  expect(document.querySelector('[data-orb-prompt]')?.getAttribute('data-shell-modal-surface')).toBe('bare')
  expect(input().value).toBe('dictated text')
  expect(document.activeElement).toBe(input())
  expect(input().getAttribute('aria-label')).toBe(zh['prompt.label'])
  expect(input().getAttribute('placeholder')).toBe(zh['prompt.placeholder'])
  expect(send().getAttribute('aria-label')).toBe(zh['prompt.send'])
  expect(send().disabled).toBe(false)

  await act(async () => { fireEvent.keyDown(input(), { key: 'Enter' }) })
  expect(b.actions.submit).toHaveBeenCalledExactlyOnceWith('dictated text')
  expect(input().value).toBe('')
  expect(b.actions.dismiss).toHaveBeenCalledOnce()
})

it('keeps Shift+Enter and a composing Enter as editing gestures', () => {
  const b = fixture()
  fireEvent.change(input(), { target: { value: 'line one' } })
  fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true })
  fireEvent.keyDown(input(), { key: 'Enter', isComposing: true })
  expect(b.actions.submit).not.toHaveBeenCalled()
  expect(input().value).toBe('line one')
})

it('disables the send button while the box is empty', () => {
  fixture()
  expect(send().disabled).toBe(true)
  fireEvent.change(input(), { target: { value: '   ' } })
  expect(send().disabled).toBe(true)
  fireEvent.change(input(), { target: { value: 'hello' } })
  expect(send().disabled).toBe(false)
})

it('keeps the text and reports a rejected submission', async () => {
  const b = fixture()
  b.actions.submit.mockRejectedValueOnce(new Error('offline'))
  fireEvent.change(input(), { target: { value: 'retry me' } })
  await click(send())
  expect(screen.getByRole('alert').textContent).toBe(zh['prompt.failed'])
  expect(input().value).toBe('retry me')
  expect(b.actions.dismiss).not.toHaveBeenCalled()
})

it('ignores a second submission while one is in flight', async () => {
  const b = fixture()
  let release = (): void => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  b.actions.submit.mockReturnValueOnce(gate)
  fireEvent.change(input(), { target: { value: 'first' } })
  await act(async () => { fireEvent.click(send()) })
  fireEvent.keyDown(input(), { key: 'Enter' })
  fireEvent.click(send())
  expect(b.actions.submit).toHaveBeenCalledExactlyOnceWith('first')
  await act(async () => { release(); await gate })
  expect(input().value).toBe('')
  expect(b.actions.dismiss).toHaveBeenCalledOnce()
})

it('hides the voice toggle while the capture service is unmounted', () => {
  const b = fixture()
  expect(mic()).toBeNull()
  fireEvent.change(input(), { target: { value: 'typed only' } })
  expect(input().value).toBe('typed only')
  expect(b.actions.startDictation).not.toHaveBeenCalled()
})

it('records from the toggle and appends the finished transcript without a separator', async () => {
  const b = fixture({ capture: capture('idle') })
  const toggle = mic() as HTMLButtonElement
  expect(toggle.getAttribute('aria-label')).toBe(zh['prompt.voiceStart'])

  await click(toggle)
  expect(b.actions.startDictation).toHaveBeenCalledOnce()

  act(() => { b.capture.set(capture('capturing')) })
  expect(toggle.getAttribute('aria-label')).toBe(zh['prompt.voiceStop'])
  expect(toggle.dataset.recording).toBe('true')
  expect(status()?.textContent).toBe(zh['prompt.voiceRecording'])

  fireEvent.change(input(), { target: { value: 'ask: ' } })
  b.actions.finishDictation.mockResolvedValueOnce('dictated text')
  await click(toggle)
  expect(b.actions.finishDictation).toHaveBeenCalledOnce()
  expect(input().value).toBe('ask: dictated text')
})

it('shows the requesting and transcribing phases and ignores clicks while busy', async () => {
  const b = fixture({ capture: capture('idle') })
  await click(mic() as HTMLElement)
  expect(b.actions.startDictation).toHaveBeenCalledOnce()
  act(() => { b.capture.set(capture('starting')) })
  expect(status()?.textContent).toBe(zh['prompt.voiceRequesting'])
  expect(mic()?.getAttribute('aria-label')).toBe(zh['prompt.voiceRequesting'])
  expect(mic()?.disabled).toBe(true)

  act(() => { b.capture.set(capture('transcribing')) })
  expect(status()?.textContent).toBe(zh['prompt.voiceTranscribing'])
  expect(mic()?.disabled).toBe(true)
  fireEvent.click(mic() as HTMLElement)
  expect(b.actions.finishDictation).not.toHaveBeenCalled()
})

it('reports an empty transcript and a failed capture without changing the input', async () => {
  const b = fixture({ capture: capture('capturing') })
  fireEvent.change(input(), { target: { value: 'keep me' } })
  b.actions.finishDictation.mockResolvedValueOnce('')
  await click(mic() as HTMLElement)
  act(() => { b.capture.set(capture('idle')) })
  expect(status()?.textContent).toBe(zh['prompt.voiceEmpty'])
  expect(input().value).toBe('keep me')

  act(() => { b.capture.set(capture('capturing')) })
  b.actions.finishDictation.mockRejectedValueOnce(new Error('permission'))
  await click(mic() as HTMLElement)
  act(() => { b.capture.set(capture('idle')) })
  expect(status()?.textContent).toBe(zh['prompt.voiceFailed'])
  expect(input().value).toBe('keep me')
})

it('reports a rejected recording start', async () => {
  const b = fixture({ capture: capture('idle') })
  b.actions.startDictation.mockRejectedValueOnce(new Error('microphone busy'))
  await click(mic() as HTMLElement)
  expect(status()?.textContent).toBe(zh['prompt.voiceFailed'])
  expect(b.actions.startDictation).toHaveBeenCalledOnce()
})

it('cancels the recording it started when the box unmounts', async () => {
  const b = fixture({ capture: capture('idle') })
  await click(mic() as HTMLElement)
  act(() => { b.capture.set(capture('capturing')) })
  cleanup()
  expect(b.actions.cancelDictation).toHaveBeenCalledOnce()
})

it('leaves a capture started elsewhere running when the box unmounts', () => {
  const b = fixture({ capture: capture('capturing') })
  cleanup()
  expect(b.actions.cancelDictation).not.toHaveBeenCalled()
})

it('takes a transcript the capture service holds while the box is open', () => {
  const b = fixture({ capture: capture('idle') })
  // Another consumer already took the held transcript: the box stays untouched.
  act(() => { b.capture.set(capture('idle', { pendingTranscript: 'held transcript' })) })
  expect(input().value).toBe('')
  b.actions.takeTranscript.mockReturnValue('held transcript')
  act(() => { b.capture.set(capture('idle', { pendingTranscript: 'held transcript' })) })
  expect(input().value).toBe('held transcript')
  expect(b.actions.takeTranscript).toHaveBeenCalled()
})
