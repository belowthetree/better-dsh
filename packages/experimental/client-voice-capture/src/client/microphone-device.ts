/** Browser-local microphone preference shared by settings previews and dictation. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MicrophoneDevice } from '../protocol.ts'

/**
 * Restore the browser preference independently of Host recognition settings.
 * @returns validated device selection, persisted through the shared Client store.
 */
export function createMicrophoneDeviceStore(): SnapshotStore<MicrophoneDevice> {
  const store = createSnapshotStore<MicrophoneDevice>({ id: '', label: '' }, { persist: { name: 'dsh.voice-input.microphone' } })
  const saved: unknown = store.getSnapshot()
  if (!saved || typeof saved !== 'object' || !('id' in saved) || typeof saved.id !== 'string'
    || !('label' in saved) || typeof saved.label !== 'string') store.set({ id: '', label: '' })
  return store
}
