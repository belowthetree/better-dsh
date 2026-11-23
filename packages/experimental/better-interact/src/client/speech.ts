/**
 * Narrate tool results that carry a `speak` presentation payload.
 * The playback renderer needs its own observation: the bubble column that
 * raised a request is not always mounted while the conversation it narrates
 * runs in the workbench dialog.
 */
import type { SessionEventWindow, SessionReferenceSource } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { requestedSpeech } from './narration.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** Narration of tool results that request speech. */
    betterInteractNarration: unknown
  }
}

/** Key prefix shared with the bubble column's own narration request. */
const SPEECH_TOOL_KEY = 'tool-speak'

/** Session catalog and retention reads the narration watch needs. */
export interface SpeechSessionSource {
  readonly list: {
    getSnapshot(): {
      readonly byId: Readonly<Record<SessionId, {
        readonly id: SessionId
        readonly retainedBy: { readonly mainView?: number }
      }>>
    }
    subscribe(listener: () => void): () => void
  }
  retain(sessionId: SessionId, options: { readonly source: SessionReferenceSource }): {
    readonly binding: { readonly eventSource: {
      getSnapshot(): SessionEventWindow
      subscribe(listener: () => void): () => void
    } }
    release(): void
  }
}

/**
 * Follow the main-view Session and narrate each new tool result that requests speech.
 * Results already in the transcript when the watch binds are history and stay silent.
 * @param sessions - Session catalog and retention reads owned by the client object layer.
 * @param speak - narration callback of the renderer that owns playback.
 * @returns disposer detaching the catalog watch and the retained Session.
 */
export function watchSpeechRequests(
  sessions: SpeechSessionSource,
  speak: (text: string, key: string) => void,
): () => void {
  let reference: ReturnType<SpeechSessionSource['retain']> | undefined
  let unsubscribeEvents: (() => void) | undefined
  let active: SessionId | undefined
  let lastSeq = Number.NEGATIVE_INFINITY

  const detach = (): void => {
    unsubscribeEvents?.()
    unsubscribeEvents = undefined
    reference?.release()
    reference = undefined
    active = undefined
    lastSeq = Number.NEGATIVE_INFINITY
  }

  const scan = (): void => {
    if (reference === undefined) return
    for (const entry of reference.binding.eventSource.getSnapshot().entries) {
      if (entry.type !== 'event' || entry.event.type !== 'tool/result') continue
      const event = entry.event
      if (event.seq <= lastSeq) continue
      lastSeq = event.seq
      const text = requestedSpeech(event.data.meta)
      if (text !== undefined) speak(text, `${SPEECH_TOOL_KEY}:${String(event.seq)}`)
    }
  }

  const bind = (sessionId: SessionId): void => {
    if (active === sessionId) return
    detach()
    active = sessionId
    const retained = sessions.retain(sessionId, { source: 'betterInteractNarration' })
    reference = retained
    for (const entry of retained.binding.eventSource.getSnapshot().entries) {
      if (entry.type === 'event' && entry.event.seq > lastSeq) lastSeq = entry.event.seq
    }
    unsubscribeEvents = retained.binding.eventSource.subscribe(scan)
  }

  const follow = (): void => {
    const main = Object.values(sessions.list.getSnapshot().byId)
      .find(row => (row.retainedBy.mainView ?? 0) > 0)
    if (main === undefined) {
      detach()
      return
    }
    bind(main.id)
  }

  const unsubscribeList = sessions.list.subscribe(follow)
  follow()
  return () => {
    unsubscribeList()
    detach()
  }
}
