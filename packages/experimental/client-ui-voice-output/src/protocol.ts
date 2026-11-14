/**
 * Shared speech playback contract: the auto-speak policy, the closed failure
 * union, the observable snapshot, and the commands a voice control issues.
 * Pure type declarations: importing this module creates no runtime dependency.
 */

/** Which completed assistant replies the playback service speaks without an explicit request. */
export type VoiceOutputPolicy =
  /** Never speak a reply; an explicit `speak` call still plays. */
  | 'off'
  /** Speak only a reply whose turn a voice transcript initiated. */
  | 'voice'
  /** Speak every completed assistant reply of the active Session. */
  | 'all'

/** Why playback produced no audio. */
export type VoiceOutputFailure =
  /** The speech Remote is absent, unreachable, or advertises no voice. */
  | 'unavailable'
  /** The speech Remote rejected the synthesis request. */
  | 'remote'
  /** The browser refused to create or play the audio element. */
  | 'playback'
  /** The selected voice is not in the current catalog. */
  | 'voice'

/** One selectable synthesis voice; `id` is the stable request value and `name` is display text. */
export interface VoiceOutputVoice {
  readonly id: string
  readonly name: string
}

/**
 * One identity-stable observation of the playback service. The object keeps its
 * reference until a listed fact changes, so observers may compare snapshots by
 * identity.
 */
export interface VoiceOutputSnapshot {
  /** Policy applied to completed assistant replies. */
  readonly policy: VoiceOutputPolicy
  /** Voice the next synthesis request names, or null before the first catalog observation. */
  readonly voiceId: string | null
  /** Voices the speech Remote advertises, in catalog order; empty before the first observation. */
  readonly voices: readonly VoiceOutputVoice[]
  /** Whether playback and pending replies are suppressed. */
  readonly muted: boolean
  /** Whether one synthesized clip is playing. */
  readonly speaking: boolean
  /** Replies waiting for the playing clip to end; this version keeps at most one. */
  readonly queued: number
  /** Last failed request, cleared when the next clip starts or another failure replaces it. */
  readonly failure: VoiceOutputFailure | null
  /** Longest text the speech Remote accepts per request; zero before the first catalog observation. */
  readonly limit: number
}

/** Shared speech playback service exposed as `ctx.voiceOutput`. */
export interface VoiceOutput {
  /**
   * Read the current identity-stable observation.
   * @returns the same object until a listed fact changes.
   */
  snapshot(): VoiceOutputSnapshot
  /**
   * Observe the snapshot stream.
   * @param signal - observation lifetime; aborting it ends the iteration without throwing.
   * @returns the current snapshot, then one item per change until the signal aborts.
   */
  follow(signal: AbortSignal): AsyncIterable<VoiceOutputSnapshot>
  /**
   * Remember the auto-speak policy; it applies to replies completed afterwards.
   * @param policy - policy to persist.
   */
  setPolicy(policy: VoiceOutputPolicy): void
  /**
   * Remember a synthesis voice the current catalog advertises.
   * @param voiceId - catalog voice id; an unknown id publishes the `voice` failure instead of changing the selection.
   */
  setVoice(voiceId: string): void
  /**
   * Silence or restore playback; silencing interrupts the playing clip and drops the pending reply.
   * @param muted - whether playback stays silent.
   */
  setMuted(muted: boolean): void
  /** Stop the playing clip and drop the pending reply; a failed request is not retried. */
  stop(): void
  /**
   * Speak one text without waiting for an assistant reply.
   * @param text - text to synthesize; surrounding whitespace is removed and surplus length is truncated to the catalog limit.
   * @returns after the request settled, either by playing, by a published failure, or by being superseded; it never rejects.
   */
  speak(text: string): Promise<void>
}
