/** One reconnecting Host readiness mirror shared by every voice UI occurrence. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { VoiceCapture, VoiceCaptureCatalog } from '@deepseek-ai/dsh-client-voice-capture/client'

/** Complete provider state, with a separate transport failure that never rewrites Host readiness. */
export interface SpeechReadiness {
  readonly catalog: VoiceCaptureCatalog | null
  readonly connected: boolean
  readonly error: string | null
}

/**
 * Subscribe once per Client plugin, independent of rendered pages and Sessions.
 * @param capture - mounted capture service forwarding the speech Remote catalog.
 * @returns shared readiness snapshot and joined observation cleanup.
 */
export function observeReadiness(capture: VoiceCapture): { state: SnapshotStore<SpeechReadiness>; dispose: () => Promise<void> } {
  const state = createSnapshotStore<SpeechReadiness>({ catalog: null, connected: false, error: null })
  const lifetime = new AbortController()
  const observing = (async () => {
    try {
      for await (const catalog of capture.followCatalog(lifetime.signal)) {
        state.set({ catalog, connected: true, error: null })
      }
    } catch (error) {
      state.set({ ...state.getSnapshot(), connected: false, error: error instanceof Error ? error.message : String(error) })
    }
  })()
  return { state, dispose: async () => { lifetime.abort(); await observing } }
}
