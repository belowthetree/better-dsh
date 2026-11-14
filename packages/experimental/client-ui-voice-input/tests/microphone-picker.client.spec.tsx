// @vitest-environment jsdom
/** Device selection owns microphone previews while its page is active. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MicrophoneDevice, VoiceCaptureFailure, VoiceCapturePreview } from '@deepseek-ai/dsh-client-voice-capture/client'
import { MicrophonePicker } from '../src/client/MicrophonePicker.tsx'
import { en, zh } from '../src/client/locales.ts'

/** One enumerated media device entry. */
interface Candidate {
  kind: string
  deviceId: string
  label: string
  groupId?: string
}

interface StubPreview extends VoiceCapturePreview {
  readonly device: MicrophoneDevice
  readonly signal: AbortSignal
  failure: ((failure: VoiceCaptureFailure) => void) | undefined
  disposed: boolean
  current: number
  label: string
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

/**
 * Tag a page-detected capture failure so the shared translator localizes it.
 * @param failure - closed failure member describing the page condition.
 * @returns an error the shared failure translation recognizes.
 */
function tagged(failure: VoiceCaptureFailure): Error {
  return Object.assign(new Error(failure), { failure })
}

function fixture(options: { initial?: MicrophoneDevice; enumeration?: Promise<Candidate[]> } = {}) {
  const selection = createSnapshotStore<MicrophoneDevice>(options.initial ?? { id: '', label: '' })
  const enumerateDevices = vi.fn(async (): Promise<Candidate[]> => [
    { kind: 'audioinput', deviceId: 'default', label: 'Default' },
    { kind: 'audioinput', deviceId: 'usb', label: 'USB microphone' },
    { kind: 'audioinput', deviceId: 'internal', label: 'Built-in microphone' },
    { kind: 'audiooutput', deviceId: 'speakers', label: 'Speakers' },
  ])
  if (options.enumeration !== undefined) enumerateDevices.mockReturnValueOnce(options.enumeration)
  const media = Object.assign(new EventTarget(), { enumerateDevices })
  vi.stubGlobal('navigator', { mediaDevices: media })
  const created: StubPreview[] = []
  const failures: (Error | undefined)[] = []
  let disposeFailure: Error | undefined
  let pending: Promise<void> | undefined
  const previewMicrophone = vi.fn(async (device: MicrophoneDevice, onFailure: (failure: VoiceCaptureFailure) => void,
    signal: AbortSignal) => {
    const failure = failures.shift()
    if (failure !== undefined) throw failure
    if (pending !== undefined) await pending
    const handle: StubPreview = { device, signal, failure: onFailure, disposed: false, current: 0.25, label: 'Fixture microphone',
      level: () => handle.current,
      deviceInfo: () => ({ label: handle.label, groupId: 'fixture-input' }),
      dispose: async () => { handle.disposed = true; if (disposeFailure !== undefined) throw disposeFailure } }
    created.push(handle)
    return handle
  })
  const props = { t: makeTranslate(zh, commonZh),
    useMicrophoneDevice: bindSnapshotSelector(selection),
    selectMicrophone: (device: MicrophoneDevice) => { selection.set(device) },
    previewMicrophone }
  const view = render(<MicrophonePicker {...props} />)
  return { ...view, props, media, enumerateDevices, created, failures, previewMicrophone, selection,
    active: (): StubPreview | undefined => created.at(-1),
    released: (): number => created.filter(handle => handle.disposed).length,
    hold: (promise: Promise<void> | undefined): void => { pending = promise },
    failDisposal: (error: Error | undefined): void => { disposeFailure = error } }
}
function selector(): HTMLSelectElement { return screen.getByRole<HTMLSelectElement>('combobox', { name: zh.inputDevice }) }
async function waitForPreview(): Promise<void> { await screen.findByRole('img', { name: zh.inputLevel }) }

it('previews the selected input, remembers it, and keeps the meter through field blur', async () => {
  const b = fixture()
  try {
    await waitForPreview()
    expect(screen.queryByRole('option', { name: 'Speakers' })).toBeNull()
    expect(b.previewMicrophone).toHaveBeenCalledOnce()
    expect(b.active()?.device).toEqual({ id: '', label: '' })
    fireEvent.change(selector(), { target: { value: 'usb' } })
    await waitFor(() => { expect(b.active()?.device.id).toBe('usb') })
    expect(b.released()).toBe(1)
    expect(selector().selectedOptions[0]?.textContent).toBe('USB microphone')
    expect(b.selection.getSnapshot()).toEqual({ id: 'usb', label: 'USB microphone' })
    const released = b.released()
    fireEvent.blur(selector())
    expect(screen.getByRole('img', { name: zh.inputLevel })).toBeTruthy()
    expect(b.released()).toBe(released)
    b.unmount()
    expect(b.released()).toBe(released + 1)
  } finally { b.unmount() }
})
it('shows the acquired input name for the system default row', async () => {
  const b = fixture()
  try {
    await waitForPreview()
    expect(selector().selectedOptions[0]?.textContent).toBe('系统默认（Fixture microphone）')
  } finally { b.unmount() }
})
it('keeps device choices after a permission failure', async () => {
  const b = fixture()
  b.failures.push(tagged('permission'))
  try {
    await screen.findByText(zh.permission)
    fireEvent.change(selector(), { target: { value: 'usb' } })
    await screen.findByRole('img', { name: zh.inputLevel })
    expect(screen.queryByText(zh.permission)).toBeNull()
  } finally { b.unmount() }
})
it('reports an unavailable browser and an enumeration failure beside the field', async () => {
  const b = fixture()
  try {
    vi.stubGlobal('navigator', {})
    b.rerender(<MicrophonePicker {...b.props}
      previewMicrophone={(device, onFailure, signal) => b.previewMicrophone(device, onFailure, signal)} />)
    await screen.findByText(zh.unavailable)
    vi.stubGlobal('navigator', { mediaDevices: b.media })
    b.enumerateDevices.mockRejectedValueOnce(new Error('enumeration failed'))
    b.rerender(<MicrophonePicker {...b.props}
      previewMicrophone={(device, onFailure, signal) => b.previewMicrophone(device, onFailure, signal)} />)
    await screen.findByText('语音识别失败：enumeration failed')
  } finally { b.unmount() }
})
it('retains a disconnected selection as an unavailable option and recovers its preview', async () => {
  const b = fixture()
  try {
    await waitForPreview()
    fireEvent.change(selector(), { target: { value: 'usb' } })
    await waitFor(() => { expect(b.selection.getSnapshot().id).toBe('usb') })
    const existing = await b.enumerateDevices()
    const previews = b.previewMicrophone.mock.calls.length
    b.enumerateDevices.mockResolvedValue(existing.filter(device => device.deviceId !== 'usb'))
    await act(async () => { b.media.dispatchEvent(new Event('devicechange')) })
    const unavailable = screen.getByRole<HTMLOptionElement>('option', { name: `USB microphone — ${zh.deviceUnavailable}` })
    expect(unavailable.disabled).toBe(true)
    expect(screen.queryByRole('img', { name: zh.inputLevel })).toBeNull()
    expect(b.selection.getSnapshot()).toEqual({ id: 'usb', label: 'USB microphone' })
    b.enumerateDevices.mockResolvedValue(existing)
    await act(async () => { b.media.dispatchEvent(new Event('devicechange')) })
    await screen.findByRole('img', { name: zh.inputLevel })
    expect(b.previewMicrophone.mock.calls.length).toBe(previews + 1)
    expect(b.active()?.device.id).toBe('usb')
  } finally { b.unmount() }
})
it('recovers the preview after a device interruption', async () => {
  const b = fixture()
  try {
    await waitForPreview()
    const previews = b.previewMicrophone.mock.calls.length
    await act(async () => { b.active()!.failure?.('interrupted') })
    await vi.waitFor(() => { expect(b.previewMicrophone.mock.calls.length).toBe(previews + 1) })
    expect(b.released()).toBeGreaterThanOrEqual(1)
  } finally { b.unmount() }
})
it('stops the preview while the page hides and restarts it when the page returns', async () => {
  const b = fixture()
  const hidden = vi.spyOn(document, 'hidden', 'get')
  try {
    await waitForPreview()
    hidden.mockReturnValue(true)
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => { expect(screen.queryByRole('img', { name: zh.inputLevel })).toBeNull() })
    expect(b.released()).toBe(1)
    hidden.mockReturnValue(false)
    fireEvent(document, new Event('visibilitychange'))
    await screen.findByRole('img', { name: zh.inputLevel })
  } finally { hidden.mockRestore(); b.unmount() }
})
it('does not restart the preview when only the locale changes', async () => {
  const b = fixture()
  try {
    await waitForPreview()
    const previews = b.previewMicrophone.mock.calls.length, enumerations = b.enumerateDevices.mock.calls.length
    b.rerender(<MicrophonePicker {...b.props} t={makeTranslate(en, commonEn)} />)
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.inputDevice }).selectedOptions[0]?.textContent)
      .toBe('System default (Fixture microphone)')
    expect(b.previewMicrophone.mock.calls.length).toBe(previews)
    expect(b.enumerateDevices.mock.calls.length).toBe(enumerations)
    expect(b.released()).toBe(0)
  } finally { b.unmount() }
})
it('persists raw unnamed labels and translates a retained permission failure', async () => {
  const b = fixture()
  b.enumerateDevices.mockResolvedValue([{ kind: 'audioinput', deviceId: 'unnamed', label: '' }])
  b.failures.push(tagged('permission'), tagged('permission'))
  try {
    await act(async () => { b.media.dispatchEvent(new Event('devicechange')) })
    await screen.findByRole('option', { name: '麦克风 1' })
    fireEvent.change(selector(), { target: { value: 'unnamed' } })
    await screen.findByText(zh.permission)
    expect(b.selection.getSnapshot()).toEqual({ id: 'unnamed', label: '' })
    const previews = b.previewMicrophone.mock.calls.length
    b.rerender(<MicrophonePicker {...b.props} t={makeTranslate(en, commonEn)} />)
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.inputDevice }).selectedOptions[0]?.textContent).toBe('Microphone 1')
    expect(screen.getByText(en.permission)).toBeTruthy()
    expect(b.previewMicrophone.mock.calls.length).toBe(previews)
  } finally { b.unmount() }
})
it('shows a localized name while a restored unnamed selection awaits enumeration', async () => {
  const pending = Promise.withResolvers<Candidate[]>()
  const b = fixture({ initial: { id: 'usb', label: '' }, enumeration: pending.promise })
  try {
    expect(selector().selectedOptions[0]?.textContent).toBe(zh.unnamedSelectedMicrophone)
    await act(async () => { pending.resolve([{ kind: 'audioinput', deviceId: 'usb', label: 'USB microphone' }]) })
    await waitFor(() => { expect(selector().selectedOptions[0]?.textContent).toBe('USB microphone') })
  } finally { b.unmount() }
})
it('keeps the communications choice and the active system device name', async () => {
  const b = fixture()
  b.enumerateDevices.mockResolvedValue([
    { kind: 'audioinput', deviceId: 'default', groupId: 'internal', label: 'Default alias' },
    { kind: 'audioinput', deviceId: 'internal', groupId: 'internal', label: 'Built-in microphone' },
    { kind: 'audioinput', deviceId: 'communications', groupId: 'headset', label: 'Communications headset' },
  ])
  try {
    await act(async () => { b.media.dispatchEvent(new Event('devicechange')) })
    expect(selector().selectedOptions[0]?.textContent).toBe('系统默认（Fixture microphone）')
    await screen.findByRole('option', { name: 'Communications headset' })
    expect(screen.queryByRole('option', { name: 'Default alias' })).toBeNull()
    fireEvent.change(selector(), { target: { value: 'communications' } })
    await waitFor(() => { expect(b.active()?.device.id).toBe('communications') })
  } finally { b.unmount() }
})
it('uses the acquired device group to name the system default row', async () => {
  const b = fixture()
  b.enumerateDevices.mockResolvedValue([
    { kind: 'audioinput', deviceId: 'default', groupId: 'other-input', label: 'Default - Other microphone' },
    { kind: 'audioinput', deviceId: 'other', groupId: 'other-input', label: 'Other microphone' },
    { kind: 'audioinput', deviceId: 'active', groupId: 'fixture-input', label: 'Active microphone' },
  ])
  try {
    await act(async () => { b.media.dispatchEvent(new Event('devicechange')) })
    expect(selector().selectedOptions[0]?.textContent).toBe('系统默认（Active microphone）')
  } finally { b.unmount() }
})
it('ignores an older enumeration result', async () => {
  const b = fixture()
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof b.enumerateDevices>>>()
  try {
    await waitForPreview()
    const existing = await b.enumerateDevices()
    b.enumerateDevices.mockReturnValueOnce(pending.promise)
    act(() => { b.media.dispatchEvent(new Event('devicechange')) })
    b.enumerateDevices.mockResolvedValue(existing.filter(device => device.deviceId !== 'usb'))
    await act(async () => { b.media.dispatchEvent(new Event('devicechange')) })
    await act(async () => { pending.resolve(existing) })
    expect(screen.queryByRole('option', { name: /USB microphone/ })).toBeNull()
  } finally { pending.resolve([]); b.unmount() }
})
it('releases a pending acquisition when the page unmounts', async () => {
  const b = fixture(), held = Promise.withResolvers<undefined>()
  b.hold(held.promise)
  b.failDisposal(new Error('already released'))
  try {
    await waitFor(() => { expect(b.previewMicrophone).toHaveBeenCalledOnce() })
    const signal = b.previewMicrophone.mock.calls[0]?.[2]
    b.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => { held.resolve(undefined) })
    expect(screen.queryByRole('img', { name: zh.inputLevel })).toBeNull()
  } finally { held.resolve(undefined); b.unmount() }
})
it('contains a disposal failure while releasing a preview', async () => {
  const b = fixture()
  try {
    await waitForPreview()
    b.failDisposal(new Error('already released'))
    b.unmount()
    expect(b.released()).toBe(1)
  } finally { b.unmount() }
})

it('ignores an enumeration failure that settles after unmount', async () => {
  const pending = Promise.withResolvers<Candidate[]>()
  const b = fixture({ enumeration: pending.promise })
  try {
    b.unmount()
    await act(async () => { pending.reject(new Error('late enumeration')) })
    expect(screen.queryByText('语音识别失败：late enumeration')).toBeNull()
  } finally { pending.resolve([]); b.unmount() }
})

it('ignores an interruption reported by a released preview', async () => {
  const b = fixture()
  try {
    await waitForPreview()
    const first = b.active()!
    fireEvent.change(selector(), { target: { value: 'usb' } })
    await waitFor(() => { expect(b.active()?.device.id).toBe('usb') })
    await act(async () => { first.failure?.('interrupted') })
    expect(screen.queryByText(zh.interrupted)).toBeNull()
    expect(b.active()?.device.id).toBe('usb')
  } finally { b.unmount() }
})

it('ignores a preview rejection that settles after unmount', async () => {
  const b = fixture(), held = Promise.withResolvers<undefined>()
  b.hold(held.promise)
  try {
    await waitFor(() => { expect(b.previewMicrophone).toHaveBeenCalledOnce() })
    b.unmount()
    await act(async () => { held.reject(new Error('late permission')) })
    expect(screen.queryByText(/语音识别失败/)).toBeNull()
  } finally { held.resolve(undefined); b.unmount() }
})

it('keeps a selection that was never enumerated as a localized row', async () => {
  const b = fixture()
  try {
    await waitForPreview()
    act(() => { b.selection.set({ id: 'ghost', label: '' }) })
    await waitFor(() => { expect(selector().selectedOptions[0]?.textContent).toBe(`麦克风 1 — ${zh.deviceUnavailable}`) })
    expect(screen.queryByRole('img', { name: zh.inputLevel })).toBeNull()
  } finally { b.unmount() }
})

it('ignores an older enumeration failure after a newer result', async () => {
  const b = fixture()
  const pending = Promise.withResolvers<Candidate[]>()
  try {
    await waitForPreview()
    const existing = await b.enumerateDevices()
    b.enumerateDevices.mockReturnValueOnce(pending.promise)
    act(() => { b.media.dispatchEvent(new Event('devicechange')) })
    b.enumerateDevices.mockResolvedValue(existing)
    await act(async () => { b.media.dispatchEvent(new Event('devicechange')) })
    await act(async () => { pending.reject(new Error('stale enumeration')) })
    expect(screen.queryByText('语音识别失败：stale enumeration')).toBeNull()
    expect(screen.getByRole('option', { name: 'USB microphone' })).toBeTruthy()
  } finally { pending.resolve([]); b.unmount() }
})

it('marks the system row unavailable when no input remains', async () => {
  const b = fixture()
  b.enumerateDevices.mockResolvedValue([])
  try {
    await act(async () => { b.media.dispatchEvent(new Event('devicechange')) })
    const system = screen.getByRole<HTMLOptionElement>('option', { name: `${zh.systemMicrophone} — ${zh.deviceUnavailable}` })
    expect(system.disabled).toBe(true)
    expect(screen.queryByRole('img', { name: zh.inputLevel })).toBeNull()
  } finally { b.unmount() }
})

it('marks the system row unavailable while another input is selected', async () => {
  const b = fixture()
  try {
    await waitForPreview()
    fireEvent.change(selector(), { target: { value: 'usb' } })
    await waitFor(() => { expect(b.selection.getSnapshot().id).toBe('usb') })
    b.enumerateDevices.mockResolvedValue([])
    await act(async () => { b.media.dispatchEvent(new Event('devicechange')) })
    const system = screen.getByRole<HTMLOptionElement>('option', { name: `${zh.systemMicrophone} — ${zh.deviceUnavailable}` })
    expect(system.disabled).toBe(true)
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: zh.inputDevice }).selectedOptions[0]?.textContent)
      .toContain(zh.deviceUnavailable)
  } finally { b.unmount() }
})

it('persists only the system preference when the default row is chosen', async () => {
  localStorage.setItem('dsh.voice-input.microphone', JSON.stringify({ id: '', label: 'Previous default microphone' }))
  const b = fixture()
  try {
    expect(selector().selectedOptions[0]?.textContent).toBe(zh.systemMicrophone)
    await waitForPreview()
    fireEvent.change(selector(), { target: { value: '' } })
    expect(b.selection.getSnapshot()).toEqual({ id: '', label: '' })
  } finally { b.unmount() }
})
