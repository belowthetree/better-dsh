/**
 * Shared microphone capture contract: the microphone preference, the closed
 * capture-failure union, the observable snapshot, and the commands a voice
 * control issues. Pure type declarations: importing this module creates no
 * runtime dependency.
 */
import type { SpeechPreparationOptions, SpeechProviderId, SpeechProviderView, SpeechSelection, SpeechSelectionPatch } from '@deepseek-ai/dsh-experimental-speech-to-text/types'

/** One browser microphone preference shared by every voice control. */
export interface MicrophoneDevice {
  /** Empty follows the system input; the stored label is a browser name, never localized copy. */
  readonly id: string
  readonly label: string
}

/** Why a capture command produced no transcript. */
export type VoiceCaptureFailure =
  /** The browser exposes no microphone recording at all. */
  | 'unavailable'
  /** The user or the operating system denied microphone access. */
  | 'permission'
  /** The finished recording carried no audio. */
  | 'empty'
  /** The command was cancelled before it settled. */
  | 'cancelled'
  /** The microphone or its track ended during capture. */
  | 'interrupted'
  /** The selected microphone no longer exists in this browser. */
  | 'deviceMissing'
  /** The speech Remote failed, or a failure has no dedicated member; the rejection message carries the diagnostic. */
  | 'transcribe'

/**
 * One identity-stable observation of the capture service. The object keeps its
 * reference until a listed fact changes, so observers may compare snapshots by
 * identity.
 */
export interface VoiceCaptureSnapshot {
  /** Current recorder phase. */
  readonly phase: 'idle' | 'starting' | 'capturing' | 'transcribing'
  /** Microphone the next capture acquires. */
  readonly device: MicrophoneDevice
  /** Measured RMS input level while capturing; zero in every other phase. */
  readonly level: number
  /** Last failed command, cleared when the next capture begins. */
  readonly failure: VoiceCaptureFailure | null
  /** Capture cap the Host advertises; zero before the first catalog observation. */
  readonly maxDurationSeconds: number
  /** Recognition selection remembered for the next finished capture; empty before the first catalog observation. */
  readonly selection: SpeechSelection
  /**
   * Transcript a capture finished with `{ hold: true }` and no composer consumer has taken yet.
   * A collapsed panel finishes this way so the transcript survives until the composer mounts.
   */
  readonly pendingTranscript: string | null
}

/** Final transcript of one finished capture. */
export interface VoiceCaptureResult {
  /** Recognized text; an empty string means no speech was recognized. */
  readonly text: string
  /** Audio duration reported by the recognizer. */
  readonly audioSeconds: number
  /** Inference duration reported by the recognizer. */
  readonly inferenceSeconds: number
}

/** Current providers, selection, and audio intake limits of the speech Remote. */
export interface VoiceCaptureCatalog {
  /** Available recognizers with their preparation state. */
  readonly providers: readonly SpeechProviderView[]
  /** Host-persisted default selection. */
  readonly selection: SpeechSelection
  /** Largest WAV the Host accepts per request. */
  readonly maxAudioBytes: number
  /** Longest recording the Host accepts. */
  readonly maxDurationSeconds: number
}

/** One microphone level observation that records and uploads nothing. */
export interface VoiceCapturePreview {
  /** @returns the latest measured RMS input level, or zero after release begins. */
  level(): number
  /** @returns the acquired input's browser name and group, or undefined outside acquisition. */
  deviceInfo(): Pick<MediaDeviceInfo, 'label' | 'groupId'> | undefined
  /** @returns after the microphone and its audio graph are released. */
  dispose(): Promise<void>
}

/** Rejection of one capture command: `failure` names the union member and the message carries diagnostics. */
export interface VoiceCaptureError extends Error {
  /** Closed failure member naming what went wrong. */
  readonly failure: VoiceCaptureFailure
}

/** Shared microphone capture service exposed as `ctx.voiceCapture`. */
export interface VoiceCapture {
  /**
   * Read the current identity-stable observation.
   * @returns the same object until a listed fact changes.
   */
  snapshot(): VoiceCaptureSnapshot
  /**
   * Observe the snapshot stream.
   * @param signal - observation lifetime; aborting it ends the iteration without throwing.
   * @returns the current snapshot, then one item per change until the signal aborts.
   */
  follow(signal: AbortSignal): AsyncIterable<VoiceCaptureSnapshot>
  /**
   * Acquire the selected microphone and start recording; the caller owns neither the recorder nor the tracks.
   * @returns after capture starts and the snapshot reports `capturing`.
   * @throws {VoiceCaptureError} when the catalog request or the microphone acquisition fails.
   * @throws {Error} when a capture is already active or the service is disposed.
   */
  begin(): Promise<void>
  /**
   * Stop the active capture, encode canonical 16 kHz mono PCM16 WAV, and ask the speech Remote to transcribe it.
   * @param options - `hold` publishes the transcript as {@link VoiceCaptureSnapshot.pendingTranscript} for a
   * composer consumer instead of only returning it, which a collapsed panel needs.
   * @returns the final transcript after the service returns to `idle`.
   * @throws {VoiceCaptureError} when encoding or transcription fails; the snapshot carries the same failure member.
   * @throws {Error} when no capture is active, the service is disposed, or a cancel superseded the command.
   */
  finish(options?: { readonly hold?: boolean }): Promise<VoiceCaptureResult>
  /**
   * Take the held transcript of a capture finished with `{ hold: true }`.
   * @returns the transcript exactly once, or null when no capture is held.
   */
  takeTranscript(): string | null
  /**
   * Stop the active capture and discard its audio; never uploads.
   * @returns after the microphone and its audio graph are released.
   */
  cancel(): Promise<void>
  /**
   * Remember a microphone for previews and subsequent recordings.
   * @param device - selected browser microphone; an empty id follows the system input.
   */
  setDevice(device: MicrophoneDevice): void
  /**
   * Persist recognition preferences through the speech Remote.
   * @param patch - preference fields to change.
   */
  configure(patch: SpeechSelectionPatch): Promise<void>
  /**
   * Start or join one Host-owned preparation task.
   * @param providerId - selected recognizer.
   * @param options - task-local download source selection.
   */
  prepare(providerId: SpeechProviderId, options?: SpeechPreparationOptions): Promise<void>
  /**
   * Cancel preparation of one recognizer.
   * @param providerId - selected recognizer.
   */
  cancelPreparation(providerId: SpeechProviderId): Promise<void>
  /**
   * Read the current catalog from the speech Remote.
   * @returns the current catalog, rejecting with the Remote failure.
   */
  catalog(): Promise<VoiceCaptureCatalog>
  /**
   * Observe the catalog across transport reconnections.
   * @param signal - observation lifetime.
   * @returns the current catalog, then one item per change until the signal aborts.
   */
  followCatalog(signal: AbortSignal): AsyncIterable<VoiceCaptureCatalog>
  /**
   * Observe one microphone's input level without recording or uploading.
   * @param device - microphone to acquire; an empty id follows the system input.
   * @param onFailure - receives a device interruption before release completes.
   * @param signal - preview lifetime; aborting it releases a pending or settled acquisition.
   * @returns the acquired preview after the microphone is live.
   */
  preview(device: MicrophoneDevice, onFailure: (failure: VoiceCaptureFailure) => void, signal: AbortSignal): Promise<VoiceCapturePreview>
}
