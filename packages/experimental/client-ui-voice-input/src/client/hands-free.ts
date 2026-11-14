/** Persisted composer preference that submits a dictation instead of pre-filling the draft. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/**
 * Restore the hands-free preference.
 * @returns the store other voice controls read; an invalid stored value falls back to off.
 */
export function createHandsFreeStore(): SnapshotStore<boolean> {
  const store = createSnapshotStore<boolean>(false, { persist: { name: 'dsh.voice-input.hands-free' } })
  const saved: unknown = store.getSnapshot()
  if (typeof saved !== 'boolean') store.set(false)
  return store
}
