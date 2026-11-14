/** Speech playback over the speechOutput Remote: auto-speak policy, queue, and one audio element. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-text-to-speech/remote'
import type { SpeechOutputCatalog, SynthesizedAudio } from '@deepseek-ai/dsh-api-text-to-speech/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  VoiceOutput, VoiceOutputFailure, VoiceOutputPolicy, VoiceOutputSnapshot, VoiceOutputVoice,
} from '../protocol.ts'
import { createPreferenceStore, type VoiceOutputPreferences } from './preferences.ts'
import {
  ActiveReplyObserver, type CapturePhaseSource, type ObservedReply, type ReplySessionSource,
} from './replies.ts'

/** The audio-element operations playback uses; a browser `HTMLAudioElement` satisfies it. */
export interface VoiceOutputAudioElement {
  /** Start or resume the clip; rejects when the browser refuses to play. */
  play(): Promise<void>
  /** Stop the clip without completing it. */
  pause(): void
  /**
   * Listen for one media event.
   * @param type - media event playback handles.
   * @param listener - callback invoked when the event fires.
   */
  addEventListener(type: 'ended' | 'error', listener: () => void): void
}

/**
 * Creates the audio element for one synthesized clip's object URL.
 * @param url - object URL of the encoded audio bytes.
 * @returns the element whose playback the service owns and revokes.
 */
export type VoiceOutputAudioFactory = (url: string) => VoiceOutputAudioElement

/** Injectable browser dependencies of the playback service. */
export interface VoiceOutputOptions {
  /** Audio element factory; the default uses the browser `Audio` constructor. */
  readonly audio?: VoiceOutputAudioFactory
}

/** Media type of the one audio format the speech Remote returns. */
const AUDIO_TYPE = 'audio/wav'

/** Provider identity the speech Remote needs to resolve a catalog voice. */
type VoiceOutputProviderId = SpeechOutputCatalog['providers'][number]['id']

/** The browser audio factory used when no factory is injected. */
const browserAudio: VoiceOutputAudioFactory = url => new Audio(url)

/** One clip playing through the shared audio element. */
interface Playback {
  readonly element: VoiceOutputAudioElement
  readonly url: string
  readonly settle: () => void
}

/** One reply waiting for the playing clip to end; the newest enqueue replaces it. */
interface PendingReply {
  readonly text: string
  readonly settle: () => void
}

/**
 * Whether two snapshots carry the same listed facts.
 * @param left - published snapshot.
 * @param right - candidate snapshot.
 * @returns whether every listed field matches.
 */
function sameSnapshot(left: VoiceOutputSnapshot, right: VoiceOutputSnapshot): boolean {
  return left.policy === right.policy
    && left.voiceId === right.voiceId
    && left.voices === right.voices
    && left.muted === right.muted
    && left.speaking === right.speaking
    && left.queued === right.queued
    && left.failure === right.failure
    && left.limit === right.limit
}

/**
 * Decode canonical base64 audio into its bytes.
 * @param audioBase64 - base64 without a data URL prefix.
 * @returns the decoded bytes.
 */
function decodeAudio(audioBase64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(audioBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * Truncate text to the character bound the speech Remote accepts.
 * @param text - text already trimmed of surrounding whitespace.
 * @param limit - maximum UTF-16 code units per request.
 * @returns the original text, or its leading `limit` characters.
 */
function capText(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit)
}

/**
 * Voice the speech Remote selects when no stored voice matches the catalog.
 * @param catalog - complete catalog observation.
 * @param voices - catalog voice ids in advertised order.
 * @returns the Host-selected voice when it is selectable, then the first advertised voice, then null.
 */
function defaultVoice(catalog: SpeechOutputCatalog, voices: ReadonlyMap<string, VoiceOutputProviderId>): string | null {
  const selected = catalog.selection.voiceId
  if (voices.has(selected)) return selected
  return voices.keys().next().value ?? null
}

/**
 * One shared playback service: it owns the speechOutput Remote calls, the
 * auto-speak policy, the single pending reply, and the one audio element.
 */
export class VoiceOutputService implements VoiceOutput {
  readonly #ctx: Context
  readonly #audio: VoiceOutputAudioFactory
  readonly #preferences: SnapshotStore<VoiceOutputPreferences>
  readonly #listeners = new Set<() => void>()
  #snapshot: VoiceOutputSnapshot
  #providers = new Map<string, VoiceOutputProviderId>()
  #detach: (() => void) | undefined
  #captureWatch: (() => void) | undefined
  #current: Playback | undefined
  #pending: PendingReply | undefined
  #synthesis: AbortController | undefined
  #generation = 0
  #busy = false
  #disposed = false

  /**
   * Read the persisted preferences, publish the initial snapshot, and adopt the Remote catalog.
   * @param ctx - client runtime whose mounted speech Remote serves every request.
   * @param options - optional audio element factory for tests and alternative carriers.
   */
  constructor(ctx: Context, options: VoiceOutputOptions = {}) {
    this.#ctx = ctx
    this.#audio = options.audio ?? browserAudio
    this.#preferences = createPreferenceStore()
    const preferences = this.#preferences.getSnapshot()
    this.#snapshot = {
      policy: preferences.policy,
      voiceId: preferences.voiceId,
      voices: [],
      muted: preferences.muted,
      speaking: false,
      queued: 0,
      failure: null,
      limit: 0,
    }
    void this.#adoptCatalog()
  }

  /** @inheritdoc */
  snapshot(): VoiceOutputSnapshot {
    return this.#snapshot
  }

  /** @inheritdoc */
  async *follow(signal: AbortSignal): AsyncIterable<VoiceOutputSnapshot> {
    signal.throwIfAborted()
    const aborted = (): boolean => signal.aborted
    let wake = Promise.withResolvers<undefined>()
    let changed = true
    const notify = (): void => { changed = true; wake.resolve(undefined) }
    this.#listeners.add(notify)
    signal.addEventListener('abort', notify, { once: true })
    try {
      for (;;) {
        if (!changed) await wake.promise
        if (aborted()) break
        wake = Promise.withResolvers<undefined>()
        changed = false
        yield this.#snapshot
      }
    } finally {
      this.#listeners.delete(notify)
      signal.removeEventListener('abort', notify)
    }
  }

  /** @inheritdoc */
  setPolicy(policy: VoiceOutputPolicy): void {
    if (this.#snapshot.policy === policy) return
    this.#preferences.set({ ...this.#preferences.getSnapshot(), policy })
    this.#publish({ policy })
  }

  /** @inheritdoc */
  setVoice(voiceId: string): void {
    if (this.#snapshot.voiceId === voiceId) return
    if (!this.#providers.has(voiceId)) {
      this.#fail('voice')
      return
    }
    this.#preferences.set({ ...this.#preferences.getSnapshot(), voiceId })
    this.#publish({ voiceId })
  }

  /** @inheritdoc */
  setMuted(muted: boolean): void {
    if (this.#snapshot.muted === muted) return
    this.#preferences.set({ ...this.#preferences.getSnapshot(), muted })
    this.#publish({ muted })
    if (muted) this.#halt()
  }

  /** @inheritdoc */
  stop(): void {
    this.#halt()
  }

  /** @inheritdoc */
  async speak(text: string): Promise<void> {
    const trimmed = text.trim()
    if (trimmed === '') return
    await this.#enqueue(trimmed)
  }

  /**
   * Follow the main-view Session's completed replies and the optional capture service.
   * @param sessions - Session object-layer reads for the main-view selection and its event window.
   * @returns disposer detaching the reply and capture observations.
   */
  observe(sessions: ReplySessionSource): () => void {
    if (this.#disposed) return () => {}
    const observer = new ActiveReplyObserver(sessions, {
      started: () => { this.#halt() },
      completed: (reply) => { this.#accept(reply) },
    })
    this.#detach = observer.connect()
    this.#captureWatch = this.#watchCapture(observer)
    return () => {
      this.#detach?.()
      this.#detach = undefined
      this.#captureWatch?.()
      this.#captureWatch = undefined
    }
  }

  /**
   * Release playback, the observations, and the pending reply.
   * @returns nothing; repeated calls take no further effect.
   */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#halt()
    this.#detach?.()
    this.#detach = undefined
    this.#captureWatch?.()
    this.#captureWatch = undefined
  }

  /**
   * Read one catalog observation and publish its voices, resolved voice, and text limit.
   * @returns completion after the catalog settles or publishes its failure.
   */
  async #adoptCatalog(): Promise<void> {
    let catalog: SpeechOutputCatalog
    try {
      const result = await this.#speech().catalog()
      if (!result.ok) {
        this.#fail('remote')
        return
      }
      catalog = result.value
    } catch (_error) {
      this.#fail('unavailable')
      return
    }
    if (this.#disposed) return
    const voices: VoiceOutputVoice[] = []
    const providers = new Map<string, VoiceOutputProviderId>()
    for (const provider of catalog.providers) {
      for (const voice of provider.voices) {
        if (providers.has(voice.id)) continue
        providers.set(voice.id, provider.id)
        voices.push({ id: voice.id, name: voice.name })
      }
    }
    this.#providers = providers
    const stored = this.#preferences.getSnapshot().voiceId
    const voiceId = stored !== null && providers.has(stored) ? stored : defaultVoice(catalog, providers)
    this.#publish({
      voices,
      voiceId,
      limit: catalog.maxTextChars,
      ...(voices.length === 0 ? { failure: 'unavailable' as const } : {}),
    })
  }

  /**
   * Speak one explicit or automatic reply, replacing any pending one.
   * @param text - trimmed reply text.
   * @returns after that reply settles.
   */
  #enqueue(text: string): Promise<void> {
    const settled = Promise.withResolvers<undefined>()
    const settle = (): void => { settled.resolve(undefined) }
    if (this.#snapshot.muted || this.#disposed) {
      settle()
      return settled.promise
    }
    this.#pending?.settle()
    this.#pending = { text, settle }
    this.#publish({ queued: 1 })
    void this.#pump()
    return settled.promise
  }

  /**
   * Start the pending reply unless a clip is already playing.
   * @returns completion after one attempt settles.
   */
  async #pump(): Promise<void> {
    if (this.#busy || this.#current !== undefined || this.#disposed) return
    const pending = this.#pending
    if (pending === undefined) return
    this.#busy = true
    this.#pending = undefined
    this.#publish({ queued: 0 })
    try {
      await this.#start(pending)
    } finally {
      this.#busy = false
    }
    void this.#pump()
  }

  /**
   * Synthesize one pending reply and begin its playback.
   * @param pending - reply text and its settlement.
   * @returns completion after playback starts or the attempt fails.
   */
  async #start(pending: PendingReply): Promise<void> {
    const voiceId = this.#snapshot.voiceId
    if (voiceId === null) {
      this.#fail('unavailable')
      pending.settle()
      return
    }
    const providerId = this.#providers.get(voiceId)
    if (providerId === undefined) {
      this.#fail('voice')
      pending.settle()
      return
    }
    const generation = ++this.#generation
    const synthesis = new AbortController()
    this.#synthesis = synthesis
    let audio: SynthesizedAudio
    try {
      const result = await this.#speech().synthesize({
        text: capText(pending.text, this.#snapshot.limit),
        providerId,
        voiceId,
      }, synthesis.signal)
      if (generation !== this.#generation || this.#disposed) {
        pending.settle()
        return
      }
      if (!result.ok) {
        this.#fail('remote')
        pending.settle()
        return
      }
      audio = result.value
    } catch (_error) {
      if (generation !== this.#generation) {
        pending.settle()
        return
      }
      this.#fail('unavailable')
      pending.settle()
      return
    } finally {
      if (this.#synthesis === synthesis) this.#synthesis = undefined
    }
    await this.#play(audio, pending)
  }

  /**
   * Create the object URL and audio element for one synthesized clip, then start it.
   * @param audio - synthesized bytes from the speech Remote.
   * @param pending - reply whose settlement follows the clip.
   * @returns completion after playback starts or the browser refuses.
   */
  async #play(audio: SynthesizedAudio, pending: PendingReply): Promise<void> {
    let url: string
    try {
      url = URL.createObjectURL(new Blob([decodeAudio(audio.audioBase64)], { type: AUDIO_TYPE }))
    } catch (_error) {
      this.#fail('playback')
      pending.settle()
      return
    }
    let element: VoiceOutputAudioElement
    try {
      element = this.#audio(url)
    } catch (_error) {
      URL.revokeObjectURL(url)
      this.#fail('playback')
      pending.settle()
      return
    }
    const playback: Playback = { element, url, settle: pending.settle }
    this.#current = playback
    element.addEventListener('ended', () => { this.#end(playback) })
    element.addEventListener('error', () => { this.#end(playback, 'playback') })
    try {
      await element.play()
    } catch (_error) {
      this.#end(playback, 'playback')
      return
    }
    if (this.#current === playback) this.#publish({ speaking: true, failure: null })
  }

  /**
   * Finish one clip: revoke its URL, settle the reply, and start the next one.
   * @param playback - clip that ended.
   * @param failure - failure that ended it abnormally, or undefined after normal completion.
   */
  #end(playback: Playback, failure?: VoiceOutputFailure): void {
    if (this.#current !== playback) return
    this.#current = undefined
    URL.revokeObjectURL(playback.url)
    playback.settle()
    this.#publish({ speaking: false, ...(failure === undefined ? {} : { failure }) })
    void this.#pump()
  }

  /** Interrupt playback: abandon the request, drop the pending reply, and settle both. */
  #halt(): void {
    this.#generation += 1
    this.#synthesis?.abort(new Error('Voice output stopped'))
    this.#synthesis = undefined
    const current = this.#current
    this.#current = undefined
    if (current !== undefined) {
      current.element.pause()
      URL.revokeObjectURL(current.url)
      current.settle()
    }
    this.#pending?.settle()
    this.#pending = undefined
    this.#publish({ speaking: false, queued: 0 })
  }

  /**
   * Speak one reply completed by the followed Session under the current policy.
   * @param reply - completed reply with its turn and text.
   */
  #accept(reply: ObservedReply): void {
    const policy = this.#snapshot.policy
    if (policy === 'off') return
    if (policy === 'voice' && !reply.voiceInitiated) return
    void this.#enqueue(reply.text)
  }

  /**
   * Follow the optional capture service and mark a turn when a capture finishes.
   * @param observer - reply observer that owns the voice-turn mark.
   * @returns disposer ending the capture observation, or undefined without a capture service.
   */
  #watchCapture(observer: ActiveReplyObserver): (() => void) | undefined {
    // The optional capture service belongs to another package; this local shape
    // names only the phase observation playback reads, so the two packages stay decoupled.
    const capture = this.#ctx.get('voiceCapture') as CapturePhaseSource | undefined
    if (capture === undefined) return undefined
    const lifetime = new AbortController()
    let previous = capture.snapshot().phase
    const observe = async (): Promise<void> => {
      for await (const snapshot of capture.follow(lifetime.signal)) {
        const phase = snapshot.phase
        if (previous === 'transcribing' && phase === 'idle') observer.markCapture()
        previous = phase
      }
    }
    void observe().catch(() => {
      // A capture-observation failure only ends the voice-turn marker; playback stays available.
    })
    return () => { lifetime.abort() }
  }

  /** Publish one failure at the state change that produced it. */
  #fail(failure: VoiceOutputFailure): void {
    this.#publish({ failure })
  }

  /**
   * Publish one changed snapshot to every observer.
   * @param patch - changed facts; unchanged fields keep their identity.
   */
  #publish(patch: Partial<VoiceOutputSnapshot>): void {
    const current = this.#snapshot
    const next: VoiceOutputSnapshot = { ...current, ...patch }
    if (sameSnapshot(current, next)) return
    this.#snapshot = next
    for (const listener of [...this.#listeners]) listener()
  }

  /** @returns the mounted speech Remote namespace. */
  #speech(): Context['remote']['speechOutput'] {
    return this.#ctx.remote.speechOutput
  }
}
