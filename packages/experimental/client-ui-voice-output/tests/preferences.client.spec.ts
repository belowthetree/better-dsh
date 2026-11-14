/** Stored preference validation keeps malformed browser state from reaching playback. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPreferenceStore, DEFAULT_PREFERENCES, PREFERENCES_STORE, validatePreferences,
} from '../src/client/preferences.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Install a browser-like localStorage over one map.
 * @param storage - map backing the stub.
 * @returns the installed map.
 */
function stubStorage(storage = new Map<string, string>()): Map<string, string> {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
  })
  return storage
}

describe('validatePreferences', () => {
  it('keeps every valid field', () => {
    expect(validatePreferences({ policy: 'voice', voiceId: 'tide', muted: true }))
      .toEqual({ policy: 'voice', voiceId: 'tide', muted: true })
  })

  it('replaces every malformed field with its default', () => {
    expect(validatePreferences({ policy: 'loud', voiceId: 7, muted: 'yes' } as never)).toEqual(DEFAULT_PREFERENCES)
    expect(validatePreferences({ policy: 'all', voiceId: '', muted: false }))
      .toEqual({ policy: 'all', voiceId: null, muted: false })
  })
})

describe('createPreferenceStore', () => {
  it('adopts a complete stored value', () => {
    stubStorage().set(PREFERENCES_STORE, JSON.stringify({ policy: 'all', voiceId: 'tide', muted: true }))
    expect(createPreferenceStore().getSnapshot()).toEqual({ policy: 'all', voiceId: 'tide', muted: true })
  })

  it('rewrites a malformed stored value with the repaired defaults', () => {
    const storage = stubStorage()
    storage.set(PREFERENCES_STORE, JSON.stringify({ policy: 'always', voiceId: 3, muted: 'sometimes' }))
    expect(createPreferenceStore().getSnapshot()).toEqual(DEFAULT_PREFERENCES)
    expect(JSON.parse(storage.get(PREFERENCES_STORE) ?? 'null')).toEqual(DEFAULT_PREFERENCES)
  })

  it('starts from the defaults when the browser exposes no storage', () => {
    expect(createPreferenceStore().getSnapshot()).toEqual(DEFAULT_PREFERENCES)
    expect(PREFERENCES_STORE).toBe('dsh.voice-output')
  })
})
