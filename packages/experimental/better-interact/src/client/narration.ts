/**
 * Persisted narration preference for the character balloons, its cross-renderer
 * speak request, and the tool-result metadata that asks a renderer to speak.
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Browser storage key of the narration preference. */
export const NARRATION_STORAGE = 'dsh.better-interact.narration.v1'

/** Renderer channel asking the playback renderer to speak one balloon. */
export const SPEAK_CHANNEL = 'better-interact/speak'

/** Whether the character balloons are read aloud; on until the user turns it off. */
export interface NarrationPreference {
  readonly enabled: boolean
}

/** Preference in force before any stored value exists. */
export const DEFAULT_NARRATION: NarrationPreference = { enabled: true }

/**
 * Validate one rehydrated preference; a malformed value keeps the default.
 * @param stored - value rehydrated from storage under the declared fields.
 * @returns the complete, valid preference.
 */
export function validateNarration(stored: unknown): NarrationPreference {
  if (typeof stored !== 'object' || stored === null) return { ...DEFAULT_NARRATION }
  const enabled = (stored as { readonly enabled?: unknown }).enabled
  return { enabled: typeof enabled === 'boolean' ? enabled : DEFAULT_NARRATION.enabled }
}

/**
 * Create the persisted narration preference store and repair any malformed rehydrated value.
 * @returns the store holding the validated preference.
 */
export function createNarrationStore(): SnapshotStore<NarrationPreference> {
  const store = createSnapshotStore<NarrationPreference>(
    { ...DEFAULT_NARRATION },
    { persist: { name: NARRATION_STORAGE } },
  )
  const stored = store.getSnapshot()
  const validated = validateNarration(stored)
  if (validated.enabled !== stored.enabled) store.set(validated)
  return store
}

/** Reads one narration preference as the renderer-facing observable. */
export type NarrationSource = HostObservable<NarrationPreference>

/** One cross-renderer request to speak a balloon. */
export interface SpeakRequest {
  /** Text to say. */
  readonly text: string
  /** Stable balloon identity, so a request forwarded by several windows is spoken once. */
  readonly key?: string
}

/**
 * Narrow one speak request at the renderer-message boundary.
 * @param payload - raw message payload.
 * @returns the text to speak and its key, or undefined for a malformed request.
 */
export function parseSpeakRequest(payload: unknown): SpeakRequest | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const { text, key } = payload as { readonly text?: unknown; readonly key?: unknown }
  if (typeof text !== 'string') return undefined
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  return typeof key === 'string' && key !== '' ? { text: trimmed, key } : { text: trimmed }
}

/**
 * Read the text one tool result asked to speak.
 * @param meta - persisted presentation metadata of one tool result.
 * @returns the requested text, or undefined for another or malformed payload.
 */
export function requestedSpeech(meta: unknown): string | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const speak: unknown = (meta as { readonly speak?: unknown }).speak
  if (typeof speak !== 'object' || speak === null) return undefined
  const text: unknown = (speak as { readonly text?: unknown }).text
  if (typeof text !== 'string') return undefined
  const trimmed = text.trim()
  return trimmed === '' ? undefined : trimmed
}
