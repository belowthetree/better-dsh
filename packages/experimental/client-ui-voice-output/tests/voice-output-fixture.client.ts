/** Controlled speech Remote, audio clips, and Session windows shared by the playback specs. */
import type { SessionEventLikeEntry, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { MutableSessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SpeechOutputCatalog, SynthesizedAudio } from '@deepseek-ai/dsh-api-text-to-speech/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { vi } from 'vitest'
import type { ReplySessionSource } from '../src/client/replies.ts'
import type { VoiceOutputAudioElement, VoiceOutputAudioFactory } from '../src/client/service.ts'

/** Provider identity of the DeepSeek synthesis provider the product profile configures. */
type ProviderId = SpeechOutputCatalog['providers'][number]['id']

/** Voice ids the DeepSeek synthesis provider advertises. */
export const VOICE_IDS = { stella: 'stella', tide: 'tide' } as const

/** One catalog observation with the two product voices and a small text bound. */
export function catalog(overrides: Partial<SpeechOutputCatalog> = {}): SpeechOutputCatalog {
  const providerId = 'deepseek-tts' as ProviderId
  return {
    providers: [{
      id: providerId,
      name: 'DeepSeek speech',
      location: 'cloud',
      voices: [
        { id: VOICE_IDS.stella, name: 'Stella' },
        { id: VOICE_IDS.tide, name: 'Tide' },
      ],
      formats: ['wav'],
      maxTextChars: 40,
    }],
    selection: { providerId, voiceId: VOICE_IDS.stella, format: 'wav' },
    maxTextChars: 40,
    maxAudioBytes: 1024,
    timeoutMs: 1000,
    ...overrides,
  }
}

/** One transient synthesis result carrying a stand-in WAV prefix instead of real audio. */
export function synthesized(characters = 5): SynthesizedAudio {
  return { audioBase64: 'UklGRg==', format: 'wav', characters }
}

/** What the stub speech Remote returns for each call. */
export interface SpeechFixture {
  /** Namespace the speechOutput Remote contribution exposes. */
  readonly namespace: {
    catalog(): Promise<RemoteResult<SpeechOutputCatalog>>
    configure(): Promise<RemoteResult<void>>
    follow(): never
    synthesize(request: unknown, signal?: AbortSignal): Promise<RemoteResult<SynthesizedAudio>>
  }
  readonly catalog: ReturnType<typeof vi.fn<() => Promise<RemoteResult<SpeechOutputCatalog>>>>
  readonly synthesize: ReturnType<typeof vi.fn<(request: unknown, signal?: AbortSignal) => Promise<RemoteResult<SynthesizedAudio>>>>
}

/**
 * Build the stub speech Remote namespace.
 * @param options - catalog and synthesis answers, defaulting to one complete catalog and one transient clip.
 * @returns the namespace plus both call spies.
 */
export function speechFixture(options: {
  catalog?: () => Promise<RemoteResult<SpeechOutputCatalog>>
  synthesize?: (request: unknown, signal?: AbortSignal) => Promise<RemoteResult<SynthesizedAudio>>
} = {}): SpeechFixture {
  const catalogCall = vi.fn(options.catalog ?? (async () => ({ ok: true as const, value: catalog() })))
  const synthesizeCall = vi.fn(options.synthesize
    ?? (async (_request: unknown, _signal?: AbortSignal) => ({ ok: true as const, value: synthesized() })))
  return {
    namespace: {
      catalog: catalogCall,
      configure: async () => ({ ok: true, value: undefined }),
      follow: () => { throw new Error('the playback service never follows the speech Remote') },
      synthesize: synthesizeCall,
    },
    catalog: catalogCall,
    synthesize: synthesizeCall,
  }
}

/** One controllable audio clip the service created. */
export interface AudioProbe {
  /** Object URL the element was created for. */
  readonly url: string
  readonly play: ReturnType<typeof vi.fn<() => Promise<void>>>
  readonly pause: ReturnType<typeof vi.fn<() => void>>
  /** Deliver the media `ended` event. */
  ended(): void
  /** Deliver the media `error` event. */
  failed(): void
}

/** Audio factory plus every clip it created, in creation order. */
export interface AudioFixture {
  readonly factory: VoiceOutputAudioFactory
  readonly clips: AudioProbe[]
}

/**
 * Build an audio factory whose clips report their media events on demand.
 * @param options - play behaviour and a factory hook that may throw instead of creating a clip.
 * @returns the factory and its created clips.
 */
export function audioFixture(options: {
  play?: () => Promise<void>
  create?: (url: string) => void
} = {}): AudioFixture {
  const clips: AudioProbe[] = []
  const factory: VoiceOutputAudioFactory = (url) => {
    options.create?.(url)
    const listeners = new Map<string, () => void>()
    const play = vi.fn<() => Promise<void>>(options.play ?? (async () => {}))
    const pause = vi.fn<() => void>(() => {})
    clips.push({
      url,
      play,
      pause,
      ended: () => { listeners.get('ended')?.() },
      failed: () => { listeners.get('error')?.() },
    })
    const element: VoiceOutputAudioElement = {
      play,
      pause,
      addEventListener: (type, listener) => { listeners.set(type, listener) },
    }
    return element
  }
  return { factory, clips }
}

/** One controllable Session the reply observer can follow. */
export interface SessionFixture {
  /** The Session object-layer reads the observer consumes. */
  readonly source: ReplySessionSource
  /**
   * Register one Session row and its event window.
   * @param id - Session identity.
   * @returns the Session's mutable event source.
   */
  session(id: string): MutableSessionEventSource
  /**
   * Move the main-view reference to one Session.
   * @param id - Session the conversation frame retains.
   */
  focus(id: string): void
  /** Drop every main-view reference. */
  blur(): void
}

/**
 * Build the Session object-layer stub the observer reads.
 * @returns the source, Session registration, and main-view selection controls.
 */
export function sessionFixture(): SessionFixture {
  const list: SnapshotStore<SessionListState> = createSnapshotStore<SessionListState>({
    ids: [],
    byId: {},
    phase: 'ready',
    projectionsBySession: {},
  })
  const windows = new Map<string, MutableSessionEventSource>()
  const row = (id: string): SessionListState['byId'][SessionId] => list.getSnapshot().byId[id as SessionId] as SessionListState['byId'][SessionId]
  return {
    source: {
      list,
      binding: (id) => {
        const eventSource = windows.get(id)
        return eventSource === undefined ? undefined : { eventSource }
      },
    },
    session(id) {
      const events = new MutableSessionEventSource()
      windows.set(id, events)
      list.update((draft) => {
        draft.ids.push(id as SessionId)
        draft.byId[id as SessionId] = {
          id: id as SessionId,
          displayTitle: id,
          running: false,
          retainedBy: {},
          blank: false,
          updatedAt: 1,
        }
      })
      return events
    },
    focus(id) {
      list.update((draft) => {
        for (const known of Object.keys(draft.byId)) {
          draft.byId[known as SessionId] = { ...row(known), retainedBy: {} }
        }
        draft.byId[id as SessionId] = { ...row(id), retainedBy: { mainView: 1 } }
      })
    },
    blur() {
      list.update((draft) => {
        for (const id of Object.keys(draft.byId)) {
          draft.byId[id as SessionId] = { ...row(id), retainedBy: {} }
        }
      })
    },
  }
}

/**
 * Wrap one minimal durable event as a window entry; specs set only the fields playback reads.
 * @param type - Session event type.
 * @param seq - durable sequence number.
 * @param data - event payload fields the reader touches.
 * @returns the appendable window entry.
 */
export function entry(type: string, seq: number, data: Record<string, unknown>): SessionEventLikeEntry {
  return { type: 'event', event: { type, seq, time: seq * 1000, data } as never }
}

/**
 * Build one `turn/start` entry.
 * @param seq - durable sequence number.
 * @param turn - turn the event opens.
 * @returns the window entry.
 */
export function turnStart(seq: number, turn: number): SessionEventLikeEntry {
  return entry('turn/start', seq, { turn })
}

/**
 * Build one user-role message entry.
 * @param seq - durable sequence number.
 * @param source - message source; `user` marks a submitted prompt.
 * @returns the window entry.
 */
export function userMessage(seq: number, source: Record<string, unknown> = { kind: 'user' }): SessionEventLikeEntry {
  return entry('user/message', seq, { id: `user-${String(seq)}`, role: 'user', source, content: [] })
}

/**
 * Build one completed assistant message entry.
 * @param seq - durable sequence number.
 * @param turn - turn the message belongs to.
 * @param text - visible text; null builds a message with reasoning content only.
 * @param interrupted - whether the turn was cancelled mid-stream.
 * @returns the window entry.
 */
export function assistantMessage(seq: number, turn: number, text: string | null, interrupted = false): SessionEventLikeEntry {
  const content = text === null
    ? [{ type: 'reasoning', text: 'thinking' }]
    : [{ type: 'text', text }]
  return entry('assistant/message', seq, {
    turn,
    step: 1,
    stream: [],
    message: { id: `assistant-${String(seq)}`, role: 'assistant', source: { kind: 'model', provider: 'stub', model: 'stub' }, content },
    ...(interrupted ? { interrupted: true } : {}),
  })
}

/**
 * Build one tool-result entry.
 * @param seq - durable sequence number.
 * @param turn - turn the result belongs to.
 * @returns the window entry.
 */
export function toolResult(seq: number, turn: number): SessionEventLikeEntry {
  return entry('tool/result', seq, {
    turn,
    step: 1,
    message: { id: `tool-${String(seq)}`, role: 'tool', toolCallId: 'call-1', source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'text', text: 'file contents' }] },
  })
}
