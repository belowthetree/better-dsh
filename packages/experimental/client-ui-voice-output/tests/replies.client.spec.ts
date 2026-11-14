/** The reply observer reads the main-view Session window and marks voice-initiated turns. */
import type {
  SessionEventLikeEntry, SessionEventSource, SessionEventWindow, SessionListState,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActiveReplyObserver, type ReplySessionSource } from '../src/client/replies.ts'
import {
  assistantMessage, sessionFixture, turnStart, userMessage,
} from './voice-output-fixture.client.ts'

afterEach(() => {
  vi.useRealTimers()
})

interface Bench {
  readonly sessions: ReturnType<typeof sessionFixture>
  readonly observer: ActiveReplyObserver
  readonly started: ReturnType<typeof vi.fn>
  readonly completed: ReturnType<typeof vi.fn>
}

/**
 * Bind an observer to its two playback handlers.
 * @returns the Session fixture, the observer, and both handler spies.
 */
function bench(): Bench {
  const sessions = sessionFixture()
  const started = vi.fn()
  const completed = vi.fn()
  const observer = new ActiveReplyObserver(sessions.source, { started, completed })
  return { sessions, observer, started, completed }
}

describe('reply observation', () => {
  it('reports each newly opened turn and each completed reply', () => {
    const b = bench()
    const events = b.sessions.session('one')
    b.sessions.focus('one')
    const detach = b.observer.connect()
    events.replace([], false)
    events.append(turnStart(1, 1))
    events.append(userMessage(2))
    events.append(assistantMessage(3, 1, 'Hello world'))
    expect(b.started).toHaveBeenCalledOnce()
    expect(b.completed).toHaveBeenCalledWith({ turn: 1, text: 'Hello world', voiceInitiated: false })
    detach()
  })

  it('reports a durable settlement entry and ignores an abandoned attempt', () => {
    const b = bench()
    const events = b.sessions.session('one')
    b.sessions.focus('one')
    const detach = b.observer.connect()
    events.replace([], false)
    events.append(turnStart(1, 1))
    events.settleAssistant('attempt' as never, assistantMessage(2, 1, 'settled') as never)
    events.settleAssistant('attempt' as never)
    expect(b.completed).toHaveBeenCalledOnce()
    expect(b.completed).toHaveBeenCalledWith({ turn: 1, text: 'settled', voiceInitiated: false })
    detach()
  })

  it('ignores a replacement window and an older page', () => {
    const b = bench()
    const events = b.sessions.session('one')
    b.sessions.focus('one')
    const detach = b.observer.connect()
    events.replace([assistantMessage(1, 1, 'history')], false)
    events.prepend([assistantMessage(2, 1, 'older')], true)
    expect(b.completed).not.toHaveBeenCalled()
    expect(b.started).not.toHaveBeenCalled()
    detach()
  })

  it('reports nothing for client-only transient rows', () => {
    const completed = vi.fn()
    const started = vi.fn()
    let snapshot: SessionEventWindow = { entries: [], hasMore: false, revision: 0, change: { kind: 'replace', entries: [] } }
    let notify = (): void => {}
    const eventSource: SessionEventSource = {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        notify = listener
        return () => { notify = () => {} }
      },
    }
    const list = createSnapshotStore<SessionListState>({
      ids: ['one' as SessionId],
      byId: {
        [('one' as SessionId)]: {
          id: 'one' as SessionId, displayTitle: 'one', running: true, retainedBy: { mainView: 1 }, blank: false, updatedAt: 1,
        },
      },
      phase: 'ready',
      projectionsBySession: {},
    })
    const source: ReplySessionSource = { list, binding: () => ({ eventSource }) }
    const observer = new ActiveReplyObserver(source, { started, completed })
    observer.connect()
    const entries: SessionEventLikeEntry[] = [{
      type: 'transient',
      event: { type: 'assistant/live-chunk', seq: 1, time: 1, data: { attemptId: 'attempt', turn: 1, step: 1, chunk: {} } } as never,
    }]
    snapshot = { entries, hasMore: false, revision: 1, change: { kind: 'append', entries } }
    notify()
    expect(completed).not.toHaveBeenCalled()
    expect(started).not.toHaveBeenCalled()
  })

  it('retargets to the Session the conversation frame newly retains', () => {
    const b = bench()
    const first = b.sessions.session('one')
    const second = b.sessions.session('two')
    b.sessions.focus('one')
    const detach = b.observer.connect()
    first.replace([], false)
    second.replace([], false)
    b.sessions.focus('two')
    first.append(turnStart(1, 1))
    first.append(assistantMessage(2, 1, 'stale view'))
    expect(b.started).not.toHaveBeenCalled()
    second.append(turnStart(1, 1))
    second.append(assistantMessage(2, 1, 'current view'))
    expect(b.completed).toHaveBeenCalledOnce()
    expect(b.completed).toHaveBeenCalledWith({ turn: 1, text: 'current view', voiceInitiated: false })
    detach()
  })

  it('keeps its observation when a catalog change keeps the same main view', () => {
    const b = bench()
    const events = b.sessions.session('one')
    b.sessions.focus('one')
    const detach = b.observer.connect()
    events.replace([], false)
    b.sessions.focus('one')
    events.append(turnStart(1, 1))
    events.append(assistantMessage(2, 1, 'still observed'))
    expect(b.completed).toHaveBeenCalledOnce()
    detach()
  })

  it('observes nothing while the catalog retains no Session', () => {
    const b = bench()
    const events = b.sessions.session('one')
    const detach = b.observer.connect()
    events.replace([], false)
    events.append(turnStart(1, 1))
    events.append(assistantMessage(2, 1, 'no main view'))
    expect(b.completed).not.toHaveBeenCalled()
    b.sessions.focus('one')
    events.append(assistantMessage(3, 1, 'retained later'))
    expect(b.completed).toHaveBeenCalledOnce()
    detach()
  })

  it('detaches when the conversation frame stops retaining any Session', () => {
    const b = bench()
    const events = b.sessions.session('one')
    b.sessions.focus('one')
    const detach = b.observer.connect()
    events.replace([], false)
    b.sessions.blur()
    events.append(turnStart(1, 1))
    events.append(assistantMessage(2, 1, 'after blur'))
    expect(b.completed).not.toHaveBeenCalled()
    detach()
  })

  it('does nothing when the retained Session has no live binding', () => {
    const b = bench()
    const events = b.sessions.session('one')
    b.sessions.focus('one')
    const list = b.sessions.source.list
    const source: ReplySessionSource = { list, binding: () => undefined }
    const completed = vi.fn()
    const observer = new ActiveReplyObserver(source, { started: vi.fn(), completed })
    observer.connect()
    events.append(turnStart(1, 1))
    events.append(assistantMessage(2, 1, 'unbound'))
    expect(completed).not.toHaveBeenCalled()
  })

  it('ignores a user message whose source is not a human prompt', () => {
    const b = bench()
    const events = b.sessions.session('one')
    b.sessions.focus('one')
    const detach = b.observer.connect()
    events.replace([], false)
    b.observer.markCapture()
    events.append(turnStart(1, 1))
    events.append(userMessage(2, { kind: 'goal-round' }))
    events.append(assistantMessage(3, 1, 'injected context'))
    expect(b.completed).toHaveBeenCalledWith({ turn: 1, text: 'injected context', voiceInitiated: false })
    detach()
  })
})

describe('voice-turn mark', () => {
  it('marks the turn a voice-transcribed submission claims', () => {
    const b = bench()
    const events = b.sessions.session('one')
    b.sessions.focus('one')
    const detach = b.observer.connect()
    events.replace([], false)
    b.observer.markCapture()
    events.append(turnStart(1, 1))
    events.append(userMessage(2))
    events.append(assistantMessage(3, 1, 'spoken'))
    expect(b.completed).toHaveBeenCalledWith({ turn: 1, text: 'spoken', voiceInitiated: true })
    events.append(turnStart(4, 2))
    events.append(userMessage(5))
    events.append(assistantMessage(6, 2, 'typed later'))
    expect(b.completed).toHaveBeenLastCalledWith({ turn: 2, text: 'typed later', voiceInitiated: false })
    detach()
  })

  it('marks a turn that opened before the observation started', () => {
    const b = bench()
    const events = b.sessions.session('one')
    b.sessions.focus('one')
    events.replace([turnStart(1, 7)], false)
    const detach = b.observer.connect()
    b.observer.markCapture()
    events.append(userMessage(2))
    events.append(assistantMessage(3, 7, 'steered'))
    expect(b.completed).toHaveBeenCalledWith({ turn: 7, text: 'steered', voiceInitiated: true })
    detach()
  })

  it('drops a mark whose submission arrives after the window', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(5_000_000)
    const b = bench()
    const events = b.sessions.session('one')
    b.sessions.focus('one')
    const detach = b.observer.connect()
    events.replace([], false)
    b.observer.markCapture()
    vi.setSystemTime(5_000_000 + 60_001)
    events.append(turnStart(1, 1))
    events.append(userMessage(2))
    events.append(assistantMessage(3, 1, 'late'))
    expect(b.completed).toHaveBeenCalledWith({ turn: 1, text: 'late', voiceInitiated: false })
    detach()
  })

  it('drops a mark submitted before any turn opened', () => {
    const b = bench()
    const events = b.sessions.session('one')
    b.sessions.focus('one')
    const detach = b.observer.connect()
    events.replace([], false)
    b.observer.markCapture()
    events.append(userMessage(1))
    events.append(turnStart(2, 1))
    events.append(assistantMessage(3, 1, 'unmarked turn'))
    expect(b.completed).toHaveBeenCalledWith({ turn: 1, text: 'unmarked turn', voiceInitiated: false })
    detach()
  })

  it('keeps one mark for exactly one submission', () => {
    const b = bench()
    const events = b.sessions.session('one')
    b.sessions.focus('one')
    const detach = b.observer.connect()
    events.replace([], false)
    b.observer.markCapture()
    events.append(turnStart(1, 1))
    events.append(userMessage(2))
    events.append(userMessage(3))
    events.append(assistantMessage(4, 1, 'first'))
    expect(b.completed).toHaveBeenLastCalledWith({ turn: 1, text: 'first', voiceInitiated: true })
    events.append(assistantMessage(5, 1, 'second'))
    expect(b.completed).toHaveBeenLastCalledWith({ turn: 1, text: 'second', voiceInitiated: true })
    detach()
  })
})
