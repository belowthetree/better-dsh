// @vitest-environment jsdom
/** The narration preference and the cross-renderer speak request. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NARRATION_STORAGE, createNarrationStore, parseSpeakRequest, validateNarration,
} from '../src/client/narration.ts'

afterEach(() => { localStorage.clear() })

describe('validateNarration', () => {
  it('accepts a stored boolean and repairs everything else to the default', () => {
    expect(validateNarration({ enabled: false })).toEqual({ enabled: false })
    expect(validateNarration({ enabled: true })).toEqual({ enabled: true })
    expect(validateNarration({ enabled: 'yes' })).toEqual({ enabled: true })
    expect(validateNarration({})).toEqual({ enabled: true })
    expect(validateNarration(null)).toEqual({ enabled: true })
  })
})

describe('createNarrationStore', () => {
  it('starts enabled and persists the toggle', () => {
    const store = createNarrationStore()
    expect(store.getSnapshot()).toEqual({ enabled: true })
    store.set({ enabled: false })
    expect(JSON.parse(localStorage.getItem(NARRATION_STORAGE) ?? 'null')).toEqual({ enabled: false })
  })

  it('rehydrates a stored preference and repairs a malformed one', () => {
    localStorage.setItem(NARRATION_STORAGE, JSON.stringify({ enabled: false }))
    expect(createNarrationStore().getSnapshot()).toEqual({ enabled: false })
    localStorage.setItem(NARRATION_STORAGE, JSON.stringify({ enabled: 'off' }))
    expect(createNarrationStore().getSnapshot()).toEqual({ enabled: true })
  })
})

describe('parseSpeakRequest', () => {
  it('keeps the text and the dedupe key', () => {
    expect(parseSpeakRequest({ text: ' 你好 ' })).toEqual({ text: '你好' })
    expect(parseSpeakRequest({ text: '你好', key: 'balloon:1' })).toEqual({ text: '你好', key: 'balloon:1' })
  })

  it('rejects malformed or empty requests', () => {
    expect(parseSpeakRequest(null)).toBeUndefined()
    expect(parseSpeakRequest('你好')).toBeUndefined()
    expect(parseSpeakRequest({})).toBeUndefined()
    expect(parseSpeakRequest({ text: 1 })).toBeUndefined()
    expect(parseSpeakRequest({ text: '   ' })).toBeUndefined()
  })
})

describe('narration store isolation', () => {
  it('reports storage failures without breaking the store', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(createNarrationStore().getSnapshot()).toEqual({ enabled: true })
    spy.mockRestore()
  })
})
