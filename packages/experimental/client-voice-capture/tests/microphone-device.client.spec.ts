// @vitest-environment jsdom
/** The stored microphone preference survives reloads and rejects malformed records. */
import { afterEach, expect, it } from 'vitest'
import { createMicrophoneDeviceStore } from '../src/client/microphone-device.ts'

afterEach(() => { localStorage.clear() })

it('restores the remembered microphone through the shared storage key', () => {
  localStorage.setItem('dsh.voice-input.microphone', JSON.stringify({ id: 'usb', label: 'USB microphone' }))
  expect(createMicrophoneDeviceStore().getSnapshot()).toEqual({ id: 'usb', label: 'USB microphone' })
})

it.each([null, 'usb', { id: 3, label: 'USB' }, { id: 'usb' }])('ignores invalid persisted microphone fields: %j', (saved) => {
  localStorage.setItem('dsh.voice-input.microphone', JSON.stringify(saved))
  expect(createMicrophoneDeviceStore().getSnapshot()).toEqual({ id: '', label: '' })
  expect(JSON.parse(localStorage.getItem('dsh.voice-input.microphone')!)).toEqual({ id: '', label: '' })
})

it('persists a selection under the shared storage key', () => {
  const store = createMicrophoneDeviceStore()
  store.set({ id: 'usb', label: 'USB microphone' })
  expect(JSON.parse(localStorage.getItem('dsh.voice-input.microphone')!)).toEqual({ id: 'usb', label: 'USB microphone' })
})
