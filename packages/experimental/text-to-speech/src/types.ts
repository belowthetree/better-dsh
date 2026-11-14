/** Provider-neutral speech synthesis inputs and registration metadata. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Configured identity of one speech synthesis provider. */
export type TextToSpeechProviderId = Branded<'TextToSpeechProviderId'>

/** Encoded audio container this version understands; providers return these bytes and never write a file. */
export type TextToSpeechFormat = 'wav'

/** One selectable synthesis voice; the name is display text and never part of a request. */
export interface TextToSpeechVoice {
  readonly id: string
  readonly name: string
}

/** Public provider facts; credentials, endpoints, and billing details stay inside the provider. */
export interface TextToSpeechProviderInfo {
  readonly id: TextToSpeechProviderId
  readonly name: string
  readonly location: 'host-local' | 'cloud'
  readonly voices: readonly TextToSpeechVoice[]
  readonly formats: readonly TextToSpeechFormat[]
  /** Longest accepted text length; longer requests fail before any provider call. */
  readonly maxTextChars: number
}

/** Provider facts as consumers observe them; separate from the provider's own info so later preparation-like fields join only here. */
export interface TextToSpeechProviderView extends TextToSpeechProviderInfo {}

/** Host-persisted default selection applied when a request omits a field. */
export interface TextToSpeechSelection {
  readonly providerId: TextToSpeechProviderId
  readonly voiceId: string
  readonly format: TextToSpeechFormat
}

/** User intent updates only the preference fields explicitly changed. */
export interface TextToSpeechSelectionPatch {
  readonly providerId?: TextToSpeechProviderId
  readonly voiceId?: string
  readonly format?: TextToSpeechFormat
}

/** One consistent provider roster and default-selection observation. */
export interface TextToSpeechSnapshot {
  readonly providers: readonly TextToSpeechProviderView[]
  readonly selection: TextToSpeechSelection
}

/** Accepted text and the exact voice and format pinned for one synthesis call. */
export interface SpeechSynthesisInput {
  readonly text: string
  readonly voiceId: string
  readonly format: TextToSpeechFormat
}

/** Caller selection before composition defaults are resolved. */
export interface TextToSpeechRequest {
  readonly text: string
  readonly providerId?: TextToSpeechProviderId
  readonly voiceId?: string
  readonly format?: TextToSpeechFormat
}

/** Resolved selection pins the exact registered provider, including its lifetime. */
export interface TextToSpeechSpec extends SpeechSynthesisInput {
  readonly provider: TextToSpeechProvider
}

/** Encoded audio returned by one synthesis call; characters counts the accepted text, not the audio. */
export interface SynthesizedSpeech {
  readonly audio: Uint8Array
  readonly format: TextToSpeechFormat
  readonly characters: number
}

/** One replaceable synthesizer. It owns execution and cancellation and writes no file. */
export interface TextToSpeechProvider {
  readonly info: TextToSpeechProviderInfo
  /**
   * Synthesize one text in the requested voice without submitting an Agent message.
   * @param input - accepted text, voice, and format, borrowed until settlement.
   * @param signal - caller or registration cancellation; rejection follows resource cleanup.
   * @returns encoded audio bytes for the requested format.
   */
  synthesize(input: SpeechSynthesisInput, signal: AbortSignal): Promise<Uint8Array>
}
