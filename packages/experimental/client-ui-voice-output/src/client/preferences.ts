/** Persisted playback preferences: the auto-speak policy, the selected voice, and mute. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { VoiceOutputPolicy } from '../protocol.ts'

/** Preference fields one browser profile remembers across reloads. */
export interface VoiceOutputPreferences {
  /** Policy applied to completed assistant replies. */
  readonly policy: VoiceOutputPolicy
  /** Selected synthesis voice, or null before the first documented choice. */
  readonly voiceId: string | null
  /** Whether playback and pending replies are suppressed. */
  readonly muted: boolean
}

/** Browser storage key of the persisted preferences. */
export const PREFERENCES_STORE = 'dsh.voice-output'

/** Preferences in force before any stored value or catalog observation exists. */
export const DEFAULT_PREFERENCES: VoiceOutputPreferences = { policy: 'off', voiceId: null, muted: false }

/**
 * Whether one stored value is a supported policy.
 * @param value - stored value of unknown validity.
 * @returns whether the value selects a policy the service implements.
 */
function isPolicy(value: unknown): value is VoiceOutputPolicy {
  return value === 'off' || value === 'voice' || value === 'all'
}

/**
 * Validate one stored preference object; a malformed or missing field falls back to its default.
 * @param stored - value rehydrated from storage under the typed preference fields.
 * @returns the complete, valid preference object.
 */
export function validatePreferences(stored: VoiceOutputPreferences): VoiceOutputPreferences {
  return {
    policy: isPolicy(stored.policy) ? stored.policy : DEFAULT_PREFERENCES.policy,
    voiceId: typeof stored.voiceId === 'string' && stored.voiceId !== ''
      ? stored.voiceId
      : DEFAULT_PREFERENCES.voiceId,
    muted: typeof stored.muted === 'boolean' ? stored.muted : DEFAULT_PREFERENCES.muted,
  }
}

/**
 * Create the persisted preference store and repair any malformed rehydrated value.
 * @returns the store holding the validated preferences.
 */
export function createPreferenceStore(): SnapshotStore<VoiceOutputPreferences> {
  const store = createSnapshotStore<VoiceOutputPreferences>(
    { ...DEFAULT_PREFERENCES },
    { persist: { name: PREFERENCES_STORE } },
  )
  const stored = store.getSnapshot()
  const validated = validatePreferences(stored)
  if (validated.policy !== stored.policy || validated.voiceId !== stored.voiceId || validated.muted !== stored.muted) {
    store.set(validated)
  }
  return store
}
