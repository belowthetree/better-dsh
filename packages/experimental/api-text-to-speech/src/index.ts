/** Authenticated, cancellation-aware Client access to speech synthesis. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SynthesizedSpeech, TextToSpeechSelectionPatch, TextToSpeechSpec } from '@deepseek-ai/dsh-text-to-speech'
import type { SpeechOutputCatalog, SynthesisRequest, SynthesizedAudio } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Experimental speech-synthesis Remote controller. */
    textToSpeechController: TextToSpeechController
  }
}

/** Limits applied before text admission, audio encoding, and provider time. */
export interface Config {
  /** Maximum UTF-16 code units of trimmed text per request. */
  maxTextChars: number
  /** Maximum encoded audio bytes per request. */
  maxAudioBytes: number
  /** Milliseconds one provider call may take before the request times out. */
  timeoutMs: number
}

/** Speech output calls never activate or submit to an Agent. */
export default class TextToSpeechController extends TypertRemoteService {
  static inject = ['textToSpeech', 'typert']
  static Config: z<Config> = z.object({
    maxTextChars: z.natural().min(1).default(4000),
    maxAudioBytes: z.natural().min(64).default(8 * 1024 * 1024),
    timeoutMs: z.natural().min(1000).default(60_000),
  })

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'textToSpeechController', { namespace: 'speechOutput' })
  }

  /**
   * Read voice and format choices without synthesizing audio.
   * @returns available providers, the resolved selection, and request limits.
   */
  @Remote
  catalog(): SpeechOutputCatalog {
    return { ...this.ctx.textToSpeech.snapshot(), ...this.config }
  }

  /**
   * Follow provider readiness and preference changes.
   * @param signal - Client observation lifetime.
   * @returns initial and subsequent complete catalogs.
   */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<SpeechOutputCatalog> {
    for await (const snapshot of this.ctx.textToSpeech.follow(signal)) yield { ...snapshot, ...this.config }
  }

  /**
   * Persist the user's voice and format preferences.
   * @param patch - changed preference fields.
   * @returns after preferences are saved.
   */
  @Remote
  configure(patch: TextToSpeechSelectionPatch): Promise<void> { return this.ctx.textToSpeech.configure(patch) }

  /**
   * Validate text and synthesize one transient audio result.
   * @param request - text to speak and explicit voice selection.
   * @param signal - Client cancellation or Remote contribution disposal.
   * @returns canonical base64 audio without a Session event, attachment, or log entry.
   */
  @Remote
  async synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<SynthesizedAudio> {
    signal.throwIfAborted()
    const text = request.text.trim()
    if (text.length === 0) throw new RemoteError('speech-output/invalid-text', 'Text is empty', { reason: 'empty' })
    if (text.length > this.config.maxTextChars) {
      throw new RemoteError('speech-output/invalid-text', 'Text exceeds the configured character limit', { reason: 'size' })
    }
    const deadline = AbortSignal.timeout(this.config.timeoutMs)
    let spec: TextToSpeechSpec
    try {
      spec = this.ctx.textToSpeech.resolve({
        text,
        ...request.providerId === undefined ? {} : { providerId: request.providerId },
        ...request.voiceId === undefined ? {} : { voiceId: request.voiceId },
        ...request.format === undefined ? {} : { format: request.format },
      })
    } catch (error) {
      throw new RemoteError('speech-output/synthesis-failed', 'The selected voice is unavailable', { reason: 'unavailable' }, { cause: error })
    }
    let speech: SynthesizedSpeech
    try {
      speech = await this.ctx.textToSpeech.synthesize(spec, AbortSignal.any([signal, deadline]))
    } catch (error) {
      if (deadline.aborted) throw new RemoteError('speech-output/timeout', 'Synthesis exceeded the configured timeout', { reason: 'timeout' }, { cause: error })
      signal.throwIfAborted()
      throw new RemoteError('speech-output/synthesis-failed', 'Speech synthesis failed', { reason: 'provider' }, { cause: error })
    }
    if (speech.audio.length > this.config.maxAudioBytes) {
      throw new RemoteError('speech-output/too-large', 'Synthesized audio exceeds the configured byte limit', { reason: 'size' })
    }
    return { audioBase64: Buffer.from(speech.audio).toString('base64'), format: speech.format, characters: speech.characters }
  }
}
