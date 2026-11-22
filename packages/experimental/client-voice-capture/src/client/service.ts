/** Shared microphone capture lifetime over the experimental speech Remote. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-experimental-api-speech-to-text/remote'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SpeechCatalog } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types'
import type { SpeechPreparationOptions, SpeechProviderId, SpeechSelection, SpeechSelectionPatch } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type {
  MicrophoneDevice, VoiceCapture, VoiceCaptureCatalog, VoiceCaptureError, VoiceCaptureFailure,
  VoiceCapturePreview, VoiceCaptureResult, VoiceCaptureSnapshot,
} from '../protocol.ts'
import { audioBase64, PCM_BYTES_PER_SECOND, Recording, RecordingError, WAVE_HEADER_BYTES } from './audio.ts'
import { createMicrophoneDeviceStore } from './microphone-device.ts'

/** Selection reported before any catalog observation. */
const UNOBSERVED_SELECTION: SpeechSelection = { providerId: '' as SpeechProviderId, language: '' }

/**
 * Map one recorder failure onto the public failure union.
 * @param error - rejection from a recorder command; every failure without a dedicated member reads as a speech-service failure.
 * @returns the closed failure member.
 */
function failureOf(error: unknown): VoiceCaptureFailure {
  return error instanceof RecordingError ? error.kind : 'transcribe'
}

/**
 * Project the speech Remote catalog onto the capture contract.
 * @param catalog - complete Remote observation.
 * @returns the same providers, selection, and intake limits.
 */
function toCatalog(catalog: SpeechCatalog): VoiceCaptureCatalog {
  return {
    providers: catalog.providers,
    selection: catalog.selection,
    maxAudioBytes: catalog.maxAudioBytes,
    maxDurationSeconds: catalog.maxDurationSeconds,
  }
}

/** Capture command rejection carrying its closed failure member and the diagnostic message. */
class CaptureError extends Error implements VoiceCaptureError {
  /**
   * @param failure - closed failure member naming what went wrong.
   * @param message - diagnostic message the caller localizes for unrecognized failures.
   * @param options - the originating Remote or recorder failure.
   */
  constructor(readonly failure: VoiceCaptureFailure, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'VoiceCaptureError'
  }
}

/**
 * One shared recorder: microphone preference, capture lifetime, WAV encoding,
 * and the speech Remote calls. The composer and future voice controls observe
 * one snapshot and never own a recorder, so capture survives their unmount.
 */
export class VoiceCaptureService implements VoiceCapture {
  readonly #ctx: Context
  readonly #device: SnapshotStore<MicrophoneDevice>
  readonly #listeners = new Set<() => void>()
  readonly #recordings = new Set<Recording>()
  readonly #previews = new Set<Recording>()
  #snapshot: VoiceCaptureSnapshot
  #selection: SpeechSelection = UNOBSERVED_SELECTION
  #durationLimit = 0
  #recording: Recording | undefined
  #transcription: AbortController | undefined
  #frame: number | undefined
  #generation = 0
  #disposed = false

  /**
   * @param ctx - client runtime whose mounted speech Remote serves every call.
   */
  constructor(ctx: Context) {
    this.#ctx = ctx
    this.#device = createMicrophoneDeviceStore()
    this.#snapshot = {
      phase: 'idle',
      device: this.#device.getSnapshot(),
      level: 0,
      failure: null,
      maxDurationSeconds: 0,
      selection: UNOBSERVED_SELECTION,
      pendingTranscript: null,
    }
  }

  /** @inheritdoc */
  snapshot(): VoiceCaptureSnapshot {
    return this.#snapshot
  }

  /** @inheritdoc */
  /* jscpd:ignore-start -- coalescing follows the same protocol as the speech-to-text seam this service wraps. */
  async *follow(signal: AbortSignal): AsyncIterable<VoiceCaptureSnapshot> {
    signal.throwIfAborted()
    let wake = Promise.withResolvers<undefined>()
    let changed = true
    const aborted = (): boolean => signal.aborted
    const notify = (): void => { changed = true; wake.resolve(undefined) }
    this.#listeners.add(notify)
    signal.addEventListener('abort', notify, { once: true })
    try {
      while (!aborted()) {
        if (!changed) await wake.promise
        if (aborted()) break
        wake = Promise.withResolvers<undefined>(); changed = false
        yield this.#snapshot
      }
    } finally {
      this.#listeners.delete(notify)
      signal.removeEventListener('abort', notify)
    }
  }
  /* jscpd:ignore-end */

  /** @inheritdoc */
  async begin(): Promise<void> {
    this.#assertAvailable()
    if (this.#snapshot.phase !== 'idle') throw new Error('Voice capture is already active')
    const generation = ++this.#generation
    this.#publish({ phase: 'starting', level: 0, failure: null, pendingTranscript: null })
    let catalog: VoiceCaptureCatalog
    try { catalog = await this.catalog() } catch (error) {
      if (this.#generation !== generation) return
      throw this.#reject(error, 'transcribe')
    }
    if (this.#generation !== generation) return
    this.#selection = catalog.selection
    this.#durationLimit = Math.min(
      catalog.maxDurationSeconds,
      Math.max(0, (catalog.maxAudioBytes - WAVE_HEADER_BYTES) / PCM_BYTES_PER_SECOND),
    )
    this.#publish({ maxDurationSeconds: catalog.maxDurationSeconds, selection: catalog.selection })
    const recording = new Recording(() => { this.#recordings.delete(recording) }, this.#snapshot.device.id)
    this.#recordings.add(recording)
    this.#recording = recording
    try { await recording.start(() => { this.#interrupted() }) } catch (error) {
      await this.#release(recording)
      if (this.#generation !== generation) return
      throw this.#reject(error, failureOf(error))
    }
    /* v8 ignore next 2 -- the recorder rejects a cancelled start; this guards a cancellation settled in between. */
    if (this.#generation !== generation) { await this.#release(recording); return }
    this.#publish({ phase: 'capturing' })
    this.#watchLevels(recording)
  }

  /** @inheritdoc */
  async finish(options: { readonly hold?: boolean } = {}): Promise<VoiceCaptureResult> {
    this.#assertAvailable()
    const recording = this.#recording
    if (recording === undefined || this.#snapshot.phase !== 'capturing') throw new Error('Voice capture is not recording')
    const generation = ++this.#generation
    this.#recording = undefined
    this.#stopLevels()
    this.#publish({ phase: 'transcribing', level: 0 })
    let audio: Uint8Array<ArrayBuffer>
    try { audio = await recording.stop(this.#durationLimit) } catch (error) {
      if (error instanceof RecordingError && error.kind === 'cancelled') throw new Error('Voice capture was cancelled')
      throw this.#reject(error, failureOf(error))
    }
    if (this.#generation !== generation) throw new Error('Voice capture was cancelled')
    const transcription = new AbortController()
    this.#transcription = transcription
    try {
      const result = await this.#speech().transcribe({
        audioBase64: audioBase64(audio),
        providerId: this.#selection.providerId,
        language: this.#selection.language,
      }, transcription.signal)
      if (this.#generation !== generation) throw new Error('Voice capture was cancelled')
      if (!result.ok) throw result.error
      this.#publish({ phase: 'idle', failure: null,
        pendingTranscript: options.hold === true ? result.value.text : null })
      return result.value
    } catch (error) {
      if (this.#generation !== generation) throw new Error('Voice capture was cancelled')
      throw this.#reject(error, 'transcribe')
    } finally {
      if (this.#transcription === transcription) this.#transcription = undefined
    }
  }

  /** @inheritdoc */
  takeTranscript(): string | null {
    const text = this.#snapshot.pendingTranscript
    if (text === null) return null
    this.#publish({ pendingTranscript: null })
    return text
  }

  /** @inheritdoc */
  async cancel(): Promise<void> {
    if (this.#disposed) return
    this.#generation++
    this.#stopLevels()
    const recording = this.#recording
    this.#recording = undefined
    this.#transcription?.abort(new Error('Voice capture cancelled'))
    this.#transcription = undefined
    this.#publish({ phase: 'idle', level: 0, failure: null })
    if (recording !== undefined) await this.#release(recording)
  }

  /** @inheritdoc */
  setDevice(device: MicrophoneDevice): void {
    this.#device.set({ id: device.id, label: device.label })
    this.#publish({ device: this.#device.getSnapshot() })
  }

  /** @inheritdoc */
  async configure(patch: SpeechSelectionPatch): Promise<void> {
    this.#unwrap(await this.#speech().configure(patch))
  }

  /** @inheritdoc */
  async prepare(providerId: SpeechProviderId, options?: SpeechPreparationOptions): Promise<void> {
    this.#unwrap(await this.#speech().prepare(providerId, options))
  }

  /** @inheritdoc */
  async cancelPreparation(providerId: SpeechProviderId): Promise<void> {
    this.#unwrap(await this.#speech().cancelPreparation(providerId))
  }

  /** @inheritdoc */
  async catalog(): Promise<VoiceCaptureCatalog> {
    const result = await this.#speech().catalog()
    if (!result.ok) throw result.error
    return toCatalog(result.value)
  }

  /** @inheritdoc */
  async *followCatalog(signal: AbortSignal): AsyncIterable<VoiceCaptureCatalog> {
    signal.throwIfAborted()
    const stream = this.#ctx.remote.$stream<SpeechCatalog>({
      name: 'Voice capture catalog',
      open: open => this.#speech().follow(open),
      ended: () => new RemoteStreamCarrierError('Voice capture catalog stream ended'),
    })
    const abort = (): void => { void stream.dispose() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      for await (const item of stream) {
        if (signal.aborted) return
        yield toCatalog(item.value)
        item.accept()
      }
    } finally {
      signal.removeEventListener('abort', abort)
      await stream.dispose()
    }
  }

  /** @inheritdoc */
  async preview(device: MicrophoneDevice, onFailure: (failure: VoiceCaptureFailure) => void,
    signal: AbortSignal): Promise<VoiceCapturePreview> {
    this.#assertAvailable()
    signal.throwIfAborted()
    const recording = new Recording(() => { this.#previews.delete(recording) }, device.id)
    this.#previews.add(recording)
    const cancel = (): void => { void this.#release(recording) }
    signal.addEventListener('abort', cancel, { once: true })
    try { await recording.preview((error) => { onFailure(failureOf(error)) }) } catch (error) {
      await this.#release(recording)
      throw error
    } finally { signal.removeEventListener('abort', cancel) }
    return {
      level: () => recording.amplitude(),
      deviceInfo: () => recording.deviceInfo(),
      dispose: async () => { await recording.dispose() },
    }
  }

  /**
   * Release every recorder, preview, and pending transcription this service owns.
   * @returns after every microphone and audio graph is released.
   */
  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#generation++
    this.#stopLevels()
    this.#transcription?.abort(new Error('Voice capture service disposed'))
    this.#transcription = undefined
    const recordings = [...this.#recordings, ...this.#previews]
    this.#recordings.clear()
    this.#previews.clear()
    this.#recording = undefined
    this.#publish({ phase: 'idle', level: 0, failure: null, pendingTranscript: null })
    await Promise.all(recordings.map(recording => this.#release(recording)))
  }

  /** @returns the mounted speech Remote namespace. */
  #speech(): Context['remote']['speech'] {
    return this.#ctx.remote.speech
  }

  /** @throws {Error} when the plugin owning this service was withdrawn. */
  #assertAvailable(): void {
    if (this.#disposed) throw new Error('Voice capture is disposed')
  }

  /**
   * Reject one issued command after publishing the failed terminal state.
   * @param error - the underlying rejection.
   * @param failure - closed member naming the failure class.
   * @returns the error the command throws.
   */
  #reject(error: unknown, failure: VoiceCaptureFailure): VoiceCaptureError {
    const message = error instanceof Error ? error.message : String(error)
    this.#publish({ phase: 'idle', level: 0, failure })
    return new CaptureError(failure, message, { cause: error })
  }

  /**
   * Unwrap one void Remote result.
   * @param result - Remote result whose error branch becomes a rejection.
   */
  #unwrap(result: { readonly ok: true } | { readonly ok: false; readonly error: Error }): void {
    if (!result.ok) throw result.error
  }

  /**
   * Release one recorder, joining its shared release promise.
   * @param recording - recorder to release.
   */
  async #release(recording: Recording): Promise<void> {
    try { await recording.dispose() } catch (_error) {
      // Tracks stop before AudioContext.close(); a close failure must not hide the released capture.
    }
  }

  /**
   * Publish one changed snapshot to every observer.
   * @param patch - changed facts; unchanged fields keep their identity.
   */
  #publish(patch: Partial<VoiceCaptureSnapshot>): void {
    const current = this.#snapshot
    const next: VoiceCaptureSnapshot = { ...current, ...patch }
    if (next.phase === current.phase && next.device === current.device && next.level === current.level
      && next.failure === current.failure && next.maxDurationSeconds === current.maxDurationSeconds
      && next.selection === current.selection && next.pendingTranscript === current.pendingTranscript) return
    this.#snapshot = next
    for (const listener of [...this.#listeners]) listener()
  }

  /** Stop the owned capture after its microphone reports a device interruption. */
  #interrupted(): void {
    this.#recording = undefined
    this.#generation++
    this.#stopLevels()
    this.#publish({ phase: 'idle', level: 0, failure: 'interrupted' })
  }

  /**
   * Follow one recording's analyser for as long as it owns capture.
   * @param recording - recording whose level is published.
   */
  #watchLevels(recording: Recording): void {
    this.#stopLevels()
    const tick = (): void => {
      if (this.#recording !== recording) return
      const level = recording.amplitude()
      if (level !== this.#snapshot.level) this.#publish({ level })
      this.#frame = requestAnimationFrame(tick)
    }
    this.#frame = requestAnimationFrame(tick)
  }

  /** Cancel the level observation frame. */
  #stopLevels(): void {
    if (this.#frame === undefined) return
    cancelAnimationFrame(this.#frame)
    this.#frame = undefined
  }
}
