// @vitest-environment jsdom
/** The composer control drives the shared capture service and keeps transcripts reviewable. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SpeechPreparationState } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { VoiceCaptureCatalog, VoiceCaptureFailure, VoiceCaptureSnapshot } from '@deepseek-ai/dsh-client-voice-capture/client'
import { VoiceInput, type VoiceInputProps } from '../src/client/VoiceInput.tsx'
import type { SpeechReadiness } from '../src/client/readiness.ts'
import { zh } from '../src/client/locales.ts'
import { CATALOG, IDLE_SNAPSHOT } from './capture-service.client.ts'

beforeEach(() => { vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn()) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

const transcript = { text: '检查 TypeScript 类型', audioSeconds: 2, inferenceSeconds: 0.4 }
const spanA = { start: 3, end: 3, draftRev: 1 }, spanB = { start: 0, end: 0, draftRev: 2 }

/**
 * Build the tagged rejection one capture command throws.
 * @param failure - closed failure member to carry.
 * @returns an error the shared failure translation recognizes.
 */
function captureError(failure: VoiceCaptureFailure): Error {
  return Object.assign(new Error(failure), { failure })
}

/** @returns a fresh ready-provider catalog. */
function readyCatalog(): VoiceCaptureCatalog {
  return { ...CATALOG, selection: { ...CATALOG.selection }, providers: CATALOG.providers.map(provider => ({ ...provider })) }
}

function fixture(options: { navigable?: boolean } = {}) {
  const snapshots = createSnapshotStore<VoiceCaptureSnapshot>(IDLE_SNAPSHOT)
  const handsFree = createSnapshotStore(false)
  const readiness = createSnapshotStore<SpeechReadiness>({ connected: true, error: null, catalog: readyCatalog() })
  const onActiveChange = vi.fn()
  const inputActions = { notify: vi.fn(), insertQuote: () => false,
    captureInsertion: vi.fn(() => spanA), insertText: vi.fn(() => true),
    setDraft: vi.fn(), persistDraft: vi.fn(), addAttachments: vi.fn(() => true), removeAttachment: vi.fn(),
    pruneAttachments: vi.fn(), submit: vi.fn() }
  const takeTranscript = vi.fn((): string | null => {
    const pending = snapshots.getSnapshot().pendingTranscript
    if (pending === null) return null
    snapshots.set({ ...snapshots.getSnapshot(), pendingTranscript: null })
    return pending
  })
  const settle = (phase: VoiceCaptureSnapshot['phase'] = 'idle', patch: Partial<VoiceCaptureSnapshot> = {}): void => {
    snapshots.set({ ...IDLE_SNAPSHOT, ...patch, phase })
  }
  const begin = vi.fn(async () => { snapshots.set({ ...snapshots.getSnapshot(), phase: 'capturing' }) })
  const finish = vi.fn(async () => { settle(); return transcript })
  const cancel = vi.fn(async () => { settle() })
  const props: VoiceInputProps = {
    sessionId: 'one' as SessionId, inputActions, locked: false, onActiveChange,
    openSettings: vi.fn(), selectMicrophone: vi.fn(),
    previewMicrophone: vi.fn(async () => ({ level: () => 0, deviceInfo: () => undefined, dispose: async () => {} })),
    captureSnapshot: () => snapshots.getSnapshot(), begin, finish, cancel,
    takeTranscript,
    configure: vi.fn(async () => {}), prepare: vi.fn(async () => {}), cancelPreparation: vi.fn(async () => {}),
    useSpeechReadiness: bindSnapshotSelector(readiness),
    useMicrophoneDevice: bindSnapshotSelector(createSnapshotStore({ id: '', label: '' })),
    useVoiceSnapshot: bindSnapshotSelector(snapshots),
    usePluginNavigation: bindSnapshotSelector(createSnapshotStore(options.navigable ?? true)),
    useHandsFree: bindSnapshotSelector(handsFree),
    setHandsFree: vi.fn((enabled: boolean) => { handsFree.set(enabled) }),
    t: makeTranslate(zh, commonZh),
  }
  const view = render(<VoiceInput {...props} />)
  return { props, view, snapshots, handsFree, readiness, inputActions, onActiveChange, begin, finish, cancel, takeTranscript, settle }
}

async function start(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: zh.start }))
  await screen.findByRole('button', { name: zh.stop })
}
function stop(): void { fireEvent.click(screen.getByRole('button', { name: zh.stop })) }

/**
 * Publish one preparation state for the selected provider.
 * @param readiness - shared readiness store.
 * @param preparation - Host preparation state to show.
 */
function publishPreparation(readiness: ReturnType<typeof fixture>['readiness'], preparation: SpeechPreparationState): void {
  const state = readiness.getSnapshot()
  act(() => { readiness.set({ ...state, catalog: { ...state.catalog!, providers: [{ ...state.catalog!.providers[0]!, preparation }] } }) })
}

it('submits the transcript instead of leaving it in the draft when hands-free is on', async () => {
  const b = fixture()
  act(() => { b.handsFree.set(true) })
  await start()
  stop()
  await waitFor(() => { expect(b.inputActions.insertText).toHaveBeenCalledWith(transcript.text, spanA) })
  expect(b.inputActions.submit).toHaveBeenCalledOnce()
  expect(b.inputActions.notify).not.toHaveBeenCalled()
})

it('keeps a rejected hands-free insertion in the retry row without submitting', async () => {
  const b = fixture()
  act(() => { b.handsFree.set(true) })
  b.inputActions.insertText.mockReturnValue(false)
  await start()
  stop()
  await waitFor(() => { expect(b.inputActions.insertText).toHaveBeenCalledOnce() })
  expect(b.inputActions.submit).not.toHaveBeenCalled()
  expect(screen.getByText(zh.conflict)).toBeTruthy()
})

it('inserts a transcript a collapsed-panel capture held and submits it when hands-free is on', async () => {
  const b = fixture()
  act(() => {
    b.handsFree.set(true)
    b.snapshots.set({ ...b.snapshots.getSnapshot(), pendingTranscript: '把标题改成项目说明' })
  })
  await waitFor(() => { expect(b.inputActions.insertText).toHaveBeenCalledWith('把标题改成项目说明', spanA) })
  expect(b.inputActions.submit).toHaveBeenCalledOnce()
  expect(b.snapshots.getSnapshot().pendingTranscript).toBeNull()
})

it('keeps a held transcript beside the microphone when its insertion is rejected', async () => {
  const b = fixture()
  b.inputActions.insertText.mockReturnValue(false)
  act(() => { b.snapshots.set({ ...b.snapshots.getSnapshot(), pendingTranscript: 'held' }) })
  await waitFor(() => { expect(screen.getByText(zh.conflict)).toBeTruthy() })
  expect(b.inputActions.insertText).toHaveBeenCalledWith('held', spanA)
  expect(b.inputActions.submit).not.toHaveBeenCalled()
})

it('inserts a held transcript without submitting while hands-free is off', async () => {
  const b = fixture()
  act(() => { b.snapshots.set({ ...b.snapshots.getSnapshot(), pendingTranscript: 'held text' }) })
  await waitFor(() => { expect(b.inputActions.insertText).toHaveBeenCalledWith('held text', spanA) })
  expect(b.inputActions.submit).not.toHaveBeenCalled()
})

it('leaves the held transcript for the next mount when taking it produced nothing', async () => {
  const b = fixture()
  b.takeTranscript.mockReturnValue(null)
  act(() => { b.snapshots.set({ ...b.snapshots.getSnapshot(), pendingTranscript: 'held' }) })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(b.inputActions.insertText).not.toHaveBeenCalled()
  expect(b.snapshots.getSnapshot().pendingTranscript).toBe('held')
})

it('clicks to record, shows measured audio, and stops to insert without sending or a popup', async () => {
  const b = fixture()
  fireEvent.pointerEnter(screen.getByRole('button', { name: zh.start }).parentElement!)
  expect((await screen.findByRole('tooltip')).textContent).toBe('听写')
  fireEvent.mouseDown(screen.getByRole('button', { name: zh.start }))
  await start()
  expect(b.begin).toHaveBeenCalledOnce()
  expect(b.onActiveChange).toHaveBeenLastCalledWith(true)
  act(() => { b.snapshots.set({ ...b.snapshots.getSnapshot(), level: 0.3 }) })
  expect(screen.getByRole('img', { name: zh.recording })).toBeTruthy()
  expect(b.finish).not.toHaveBeenCalled()
  stop()
  await waitFor(() => { expect(b.inputActions.insertText).toHaveBeenCalledWith(transcript.text, spanA) })
  expect(b.inputActions.submit).not.toHaveBeenCalled()
  expect(b.inputActions.notify).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(b.onActiveChange).toHaveBeenLastCalledWith(false)
})

it.each(['cancel', 'escape'])('discards the capture without transcription on %s', async (how) => {
  const b = fixture()
  await start()
  if (how === 'cancel') fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
  else fireEvent.keyDown(document, { key: 'Escape' })
  await screen.findByRole('button', { name: zh.start })
  expect(b.cancel).toHaveBeenCalledOnce()
  expect(b.finish).not.toHaveBeenCalled()
})

it('ignores a begin failure that arrives after cancellation', async () => {
  const b = fixture(), permission = Promise.withResolvers<undefined>()
  b.begin.mockImplementationOnce(async () => {
    b.snapshots.set({ ...b.snapshots.getSnapshot(), phase: 'starting' })
    await permission.promise
  })
  fireEvent.click(screen.getByRole('button', { name: zh.start }))
  fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
  permission.reject(captureError('permission'))
  await act(async () => {})
  expect(screen.queryByText(zh.permission)).toBeNull()
  expect(screen.getByRole('button', { name: zh.start })).toBeTruthy()
})

it('ignores a finish failure that arrives after cancellation', async () => {
  const b = fixture(), pending = Promise.withResolvers<typeof transcript>()
  b.finish.mockImplementationOnce(async () => {
    b.snapshots.set({ ...b.snapshots.getSnapshot(), phase: 'transcribing' })
    return pending.promise
  })
  await start()
  stop()
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
  pending.reject(captureError('transcribe'))
  await act(async () => {})
  expect(screen.queryByText(/语音识别失败/)).toBeNull()
  expect(screen.getByRole('button', { name: zh.start })).toBeTruthy()
})

it('records without a deadline when the Host advertises no duration cap', async () => {
  const b = fixture()
  const state = b.readiness.getSnapshot()
  act(() => { b.readiness.set({ ...state, catalog: { ...state.catalog!, maxDurationSeconds: 0 } }) })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  fireEvent.click(screen.getByRole('button', { name: zh.start }))
  await act(async () => {})
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000_000) })
  expect(b.finish).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: zh.stop })).toBeTruthy()
})

it('keeps capturing when another key is pressed', async () => {
  const b = fixture()
  await start()
  fireEvent.keyDown(document, { key: 'x' })
  expect(b.cancel).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: zh.stop })).toBeTruthy()
})

it('keeps capturing when the window loses focus or the page hides', async () => {
  const b = fixture()
  await start()
  fireEvent.blur(window)
  Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  try { fireEvent(document, new Event('visibilitychange')) } finally { delete (document as { hidden?: boolean }).hidden }
  await act(async () => {})
  expect(b.cancel).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: zh.stop })).toBeTruthy()
})

it('shows the permission phase and invalidates it after cancellation', async () => {
  const b = fixture(), permission = Promise.withResolvers<undefined>()
  b.begin.mockImplementationOnce(async () => {
    b.snapshots.set({ ...b.snapshots.getSnapshot(), phase: 'starting' })
    await permission.promise
  })
  fireEvent.click(screen.getByRole('button', { name: zh.start }))
  expect(screen.getByRole('status').textContent).toBe(zh.requesting)
  fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
  expect(b.cancel).toHaveBeenCalledOnce()
  permission.resolve(undefined)
  await act(async () => {})
  expect(b.inputActions.notify).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: zh.start })).toBeTruthy()
})

it('preserves conflicting text for explicit insertion or discard', async () => {
  const b = fixture()
  b.inputActions.insertText.mockReturnValue(false)
  await start()
  stop()
  const insert = await screen.findByRole('button', { name: zh.insert })
  fireEvent.click(insert)
  expect(screen.getByRole('button', { name: zh.insert })).toBeTruthy()
  b.inputActions.insertText.mockReturnValue(true)
  fireEvent.click(insert)
  expect(screen.getByRole('button', { name: zh.start })).toBeTruthy()
  b.inputActions.insertText.mockReturnValue(false)
  await start()
  stop()
  fireEvent.click(await screen.findByRole('button', { name: zh.discard }))
  expect(screen.queryByRole('button', { name: zh.insert })).toBeNull()
})

it('retargets a transcript that arrives after a Session change to the current draft', async () => {
  const b = fixture(), result = Promise.withResolvers<typeof transcript>()
  b.inputActions.captureInsertion.mockReturnValueOnce(spanA).mockReturnValue(spanB)
  b.finish.mockImplementationOnce(async () => { b.settle(); return result.promise })
  await start()
  stop()
  await act(async () => {})
  b.view.rerender(<VoiceInput {...b.props} sessionId={'two' as SessionId} />)
  result.resolve(transcript)
  await waitFor(() => { expect(b.inputActions.insertText).toHaveBeenCalledWith(transcript.text, spanB) })
  expect(b.inputActions.notify).not.toHaveBeenCalled()
})

it('keeps empty-speech and service errors inside the toolbar with retry and dismissal', async () => {
  const b = fixture()
  b.finish.mockImplementationOnce(async () => { b.settle(); return { ...transcript, text: '' } })
  await start()
  stop()
  expect((await screen.findByRole('status')).textContent).toBe(zh.empty)
  expect(b.inputActions.notify).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.retryRecording }))
  await screen.findByRole('button', { name: zh.stop })
  b.finish.mockImplementationOnce(async () => { b.settle(); throw captureError('transcribe') })
  stop()
  await screen.findByText('语音识别失败：transcribe')
  fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
  expect(screen.getByRole('button', { name: zh.start })).toBeTruthy()
})

it.each([captureError('permission'), new Error('device lost'), 'device lost',
  Object.assign(new Error('unknown failure'), { failure: 'bogus' })])('handles capture failure locally (%s)', async (failure) => {
  const b = fixture()
  b.begin.mockImplementationOnce(async () => { b.settle(); throw failure })
  fireEvent.click(screen.getByRole('button', { name: zh.start }))
  await screen.findByText(failure instanceof Error && 'failure' in failure && failure.message === 'permission'
    ? zh.permission
    : failure instanceof Error && 'failure' in failure ? '语音识别失败：unknown failure' : '语音识别失败：device lost')
  expect(b.inputActions.notify).not.toHaveBeenCalled()
})

it.each([captureError('empty'), new Error('decode failed'), 'decode failed'])('handles conversion failure locally (%s)', async (failure) => {
  const b = fixture()
  b.finish.mockImplementationOnce(async () => { b.settle(); throw failure })
  await start()
  stop()
  await screen.findByText(failure instanceof Error && 'failure' in failure ? zh.empty : '语音识别失败：decode failed')
  expect(b.inputActions.insertText).not.toHaveBeenCalled()
})

it('bounds recordings, reports idle wake-up, and ignores a cancelled transcription', async () => {
  const b = fixture(), result = Promise.withResolvers<typeof transcript>()
  b.finish.mockImplementationOnce(async () => {
    b.snapshots.set({ ...b.snapshots.getSnapshot(), phase: 'transcribing', level: 0 })
    return result.promise
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  fireEvent.click(screen.getByRole('button', { name: zh.start }))
  await act(async () => {})
  await act(async () => { await vi.advanceTimersByTimeAsync(120000) })
  expect(b.finish).toHaveBeenCalledOnce()
  publishPreparation(b.readiness, { phase: 'waking', startedAt: Date.now() })
  expect(screen.getByRole('status').textContent).toBe(zh.wakingShort)
  fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
  result.resolve(transcript)
  await act(async () => {})
  expect(b.inputActions.insertText).not.toHaveBeenCalled()
})

it('allows recording while verified local resources are waking', async () => {
  const b = fixture()
  publishPreparation(b.readiness, { phase: 'waking', startedAt: 0 })
  await start()
  stop()
  await waitFor(() => { expect(b.inputActions.insertText).toHaveBeenCalledWith(transcript.text, spanA) })
})

it('keeps locked recognition and unavailable readiness disabled', async () => {
  const b = fixture()
  act(() => { b.readiness.set({ catalog: null, connected: false, error: null }) })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh['setupPrompt.trigger'] }).disabled).toBe(false)
  b.view.rerender(<VoiceInput {...b.props} locked />)
  const locked = screen.getByRole<HTMLButtonElement>('button', { name: zh['setupPrompt.trigger'] })
  expect(locked.disabled).toBe(true)
  fireEvent.click(locked)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(b.begin).not.toHaveBeenCalled()
})

it('releases expansion without cancelling capture when the composer unmounts', async () => {
  const b = fixture()
  await start()
  b.view.unmount()
  await act(async () => {})
  expect(b.onActiveChange).toHaveBeenLastCalledWith(false)
  expect(b.cancel).not.toHaveBeenCalled()
})

it('coalesces repeated capture and stop clicks before the toolbar rerenders', async () => {
  const b = fixture(), microphone = screen.getByRole<HTMLButtonElement>('button', { name: zh.start })
  act(() => { microphone.click(); microphone.click() })
  const stopButton = await screen.findByRole<HTMLButtonElement>('button', { name: zh.stop })
  act(() => { stopButton.click(); stopButton.click() })
  await waitFor(() => { expect(b.inputActions.insertText).toHaveBeenCalledOnce() })
  expect(b.begin).toHaveBeenCalledOnce()
  expect(b.finish).toHaveBeenCalledOnce()
})

it('ends the recording UI immediately on a device failure', async () => {
  const b = fixture()
  await start()
  act(() => { b.snapshots.set({ ...IDLE_SNAPSHOT, failure: 'interrupted' }) })
  expect(screen.getByRole('status').textContent).toBe(zh.interrupted)
  expect(screen.queryByRole('button', { name: zh.stop })).toBeNull()
  expect(screen.queryByRole('img', { name: zh.recording })).toBeNull()
  expect(b.finish).not.toHaveBeenCalled()
  expect(b.inputActions.notify).not.toHaveBeenCalled()
})

it('offers installation on click without a preparation tooltip', () => {
  const b = fixture()
  publishPreparation(b.readiness, { phase: 'unprepared' })
  const mic = screen.getByRole<HTMLButtonElement>('button', { name: zh['setupPrompt.trigger'] })
  expect(mic.disabled).toBe(false)
  expect(mic.getAttribute('aria-haspopup')).toBe('dialog')
  fireEvent.pointerEnter(mic.parentElement!)
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.click(mic)
  expect(screen.getByRole('dialog').textContent).toContain(zh['setupPrompt.body'])
  expect(b.begin).not.toHaveBeenCalled()
  expect(b.props.prepare).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh['setupPrompt.open'] }))
  expect(b.props.openSettings).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog')).toBeNull()
})

it.each<SpeechPreparationState>([
  { phase: 'checking', step: 'check', startedAt: 0 },
  { phase: 'downloading', resource: 'model', completedBytes: 0 },
  { phase: 'failed', message: 'download failed' },
  { phase: 'cancelled' },
])('guides $phase recognition to its status page without starting recording', (preparation) => {
  const b = fixture()
  publishPreparation(b.readiness, preparation)
  fireEvent.click(screen.getByRole('button', { name: zh['setupPrompt.trigger'] }))
  expect(screen.getByRole('dialog').textContent).toContain(zh['setupPrompt.unavailableBody'])
  expect(b.begin).not.toHaveBeenCalled()
  expect(b.props.prepare).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: zh['setupPrompt.details'] }))
  expect(b.props.openSettings).toHaveBeenCalledOnce()
})

it('offers no plugin details from setup guidance while the Plugins page navigation is absent', () => {
  const b = fixture({ navigable: false })
  publishPreparation(b.readiness, { phase: 'unprepared' })
  fireEvent.click(screen.getByRole('button', { name: zh['setupPrompt.trigger'] }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.queryByRole('button', { name: zh['setupPrompt.open'] })).toBeNull()
  expect(dialog.getByRole('button', { name: zh['setupPrompt.later'] })).toBeTruthy()
  expect(b.props.openSettings).not.toHaveBeenCalled()
})

it('moves focus into setup guidance, contains Tab traversal, and restores the draft focus on dismissal', () => {
  const b = fixture()
  render(<textarea aria-label="draft" defaultValue="Keep this draft" />)
  const draft = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'draft' })
  act(() => { b.readiness.set({ catalog: null, connected: false, error: 'offline' }) })
  draft.focus()
  const mic = screen.getByRole('button', { name: zh['setupPrompt.trigger'] })
  fireEvent.mouseDown(mic)
  fireEvent.click(mic)
  const dialog = screen.getByRole('dialog')
  const details = within(dialog).getByRole('button', { name: zh['setupPrompt.details'] })
  const close = within(dialog).getByRole('button', { name: zh.cancel })
  expect(document.activeElement).toBe(details)
  fireEvent.keyDown(details, { key: 'Tab' })
  expect(document.activeElement).toBe(close)
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(details)
  fireEvent.keyDown(details, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(draft)
  expect(draft.value).toBe('Keep this draft')
  expect(b.inputActions.submit).not.toHaveBeenCalled()
  expect(b.props.openSettings).not.toHaveBeenCalled()
})

it.each(['later', 'escape', 'ready', 'session'])('dismisses unavailable recognition guidance on %s without changing the draft', (reason) => {
  const b = fixture(), ready = b.readiness.getSnapshot()
  act(() => { b.readiness.set({ catalog: null, connected: false, error: 'offline' }) })
  const open = (): void => { fireEvent.click(screen.getByRole('button', { name: zh['setupPrompt.trigger'] })) }
  open()
  expect(screen.getByRole('dialog').textContent).toContain(zh['setupPrompt.unavailableTitle'])
  if (reason === 'later') fireEvent.click(screen.getByRole('button', { name: zh['setupPrompt.later'] }))
  if (reason === 'escape') fireEvent.keyDown(document, { key: 'Escape' })
  if (reason === 'ready') act(() => { b.readiness.set(ready) })
  if (reason === 'session') b.view.rerender(<VoiceInput {...b.props} sessionId={'two' as SessionId} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(b.props.openSettings).not.toHaveBeenCalled()
  expect(b.begin).not.toHaveBeenCalled()
  expect(b.inputActions.setDraft).not.toHaveBeenCalled()
  expect(b.inputActions.insertText).not.toHaveBeenCalled()
  if (reason === 'ready') {
    act(() => { b.readiness.set({ ...ready, connected: false }) })
    expect(screen.queryByRole('dialog')).toBeNull()
  } else {
    open()
    expect(screen.getByRole('dialog')).toBeTruthy()
  }
})
