// @vitest-environment jsdom
/** Requested-speech narration follows the main-view Session and reads tool metadata. */
import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { watchSpeechRequests } from '../src/client/speech.ts'

/** Minimal Session catalog and retention doubles for the narration watch. */
function source() {
  const catalog = createSnapshotStore({
    ids: [] as string[],
    byId: {} as Record<string, { retainedBy: { mainView?: number } }>,
    phase: 'ready',
    projectionsBySession: {},
  } as never)
  const events = createSnapshotStore({
    entries: [], hasMore: false, revision: 0, change: { kind: 'append' },
  } as never)
  const release = vi.fn()
  const retain = vi.fn(() => ({ binding: { eventSource: events }, release }))
  return {
    catalog,
    events,
    release,
    retain,
    sessions: { list: catalog, retain } as never,
  }
}

describe('watchSpeechRequests', () => {
  it('retains the main-view Session and narrates only newer tool results', () => {
    const fake = source()
    fake.catalog.set({
      ids: ['s1'],
      byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } },
      phase: 'ready',
      projectionsBySession: {},
    } as never)
    fake.events.set({
      entries: [
        { type: 'event', event: { type: 'tool/result', seq: 2, time: 0, data: { meta: { speak: { text: '历史' } } } } },
      ],
      hasMore: false, revision: 1, change: { kind: 'append' },
    } as never)
    const speak = vi.fn()
    const dispose = watchSpeechRequests(fake.sessions, speak)
    expect(fake.retain).toHaveBeenCalledWith('s1', { source: 'betterInteractNarration' })
    expect(speak).not.toHaveBeenCalled()

    fake.events.set({
      entries: [
        { type: 'event', event: { type: 'tool/result', seq: 2, time: 0, data: { meta: { speak: { text: '历史' } } } } },
        { type: 'event', event: { type: 'assistant/message', seq: 3, time: 0, data: {} } },
        { type: 'event', event: { type: 'tool/result', seq: 4, time: 0, data: { meta: { speak: { text: '新话' } } } } },
      ],
      hasMore: false, revision: 2, change: { kind: 'append' },
    } as never)
    expect(speak).toHaveBeenCalledWith('新话', 'tool-speak:4')

    dispose()
    expect(fake.release).toHaveBeenCalledOnce()
  })

  it('releases the previous Session when the main view changes and stays quiet without one', () => {
    const fake = source()
    const speak = vi.fn()
    const dispose = watchSpeechRequests(fake.sessions, speak)
    expect(fake.retain).not.toHaveBeenCalled()

    fake.catalog.set({
      ids: ['s1', 's2'],
      byId: { s1: { id: 's1', retainedBy: { mainView: 1 } }, s2: { id: 's2' } },
      phase: 'ready', projectionsBySession: {},
    } as never)
    expect(fake.retain).toHaveBeenCalledWith('s1', { source: 'betterInteractNarration' })

    fake.catalog.set({
      ids: ['s2'],
      byId: { s2: { id: 's2', retainedBy: { mainView: 1 } } },
      phase: 'ready', projectionsBySession: {},
    } as never)
    expect(fake.release).toHaveBeenCalledOnce()
    expect(fake.retain).toHaveBeenLastCalledWith('s2', { source: 'betterInteractNarration' })

    fake.catalog.set({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} } as never)
    expect(fake.release).toHaveBeenCalledTimes(2)
    expect(speak).not.toHaveBeenCalled()
    dispose()
  })
})
