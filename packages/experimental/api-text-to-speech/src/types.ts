/** JSON-safe inputs and results of the speech-output Remote namespace. */
import type { TextToSpeechFormat, TextToSpeechProviderId, TextToSpeechSnapshot } from '@deepseek-ai/dsh-text-to-speech'
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Request text was empty or exceeded the configured character limit. */
    'speech-output/invalid-text': { readonly reason: string }
    /** The selection was unresolvable or the provider rejected synthesis. */
    'speech-output/synthesis-failed': { readonly reason: string }
    /** Synthesized audio exceeded the configured byte limit. */
    'speech-output/too-large': { readonly reason: string }
    /** Synthesis did not settle within the configured timeout. */
    'speech-output/timeout': { readonly reason: 'timeout' }
  }
}

/** Text to speak and an optional explicit provider, voice, and format selection. */
export interface SynthesisRequest {
  /** Text to speak; surrounding whitespace is removed and the result is bounded by the catalog limit. */
  readonly text: string
  readonly providerId?: TextToSpeechProviderId
  readonly voiceId?: string
  readonly format?: TextToSpeechFormat
}

/** Current provider choices and synthesis request limits. */
export interface SpeechOutputCatalog extends TextToSpeechSnapshot {
  /** Maximum UTF-16 code units of trimmed text per request. */
  readonly maxTextChars: number
  /** Maximum encoded audio bytes per request. */
  readonly maxAudioBytes: number
  /** Milliseconds one request may take before the deadline aborts it. */
  readonly timeoutMs: number
}

/** Transient synthesized audio; never persisted, attached, or logged. */
export interface SynthesizedAudio {
  /** Canonical base64 of the encoded audio bytes, without a data URL prefix. */
  readonly audioBase64: string
  readonly format: TextToSpeechFormat
  /** Characters of accepted text the provider reported; the audio duration is provider-owned. */
  readonly characters: number
}
