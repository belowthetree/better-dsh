// @vitest-environment jsdom
/** Persisted hands-free preference: a stored boolean is restored, anything else falls back to off. */
import { beforeEach, expect, it } from 'vitest'
import { createHandsFreeStore } from '../src/client/hands-free.ts'

beforeEach(() => { localStorage.clear() })

it('restores a stored preference', () => {
  localStorage.setItem('dsh.voice-input.hands-free', JSON.stringify(true))
  expect(createHandsFreeStore().getSnapshot()).toBe(true)
})

it('falls back to off for a malformed stored value', () => {
  localStorage.setItem('dsh.voice-input.hands-free', JSON.stringify('yes'))
  expect(createHandsFreeStore().getSnapshot()).toBe(false)
})
