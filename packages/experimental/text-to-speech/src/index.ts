/** Named speech-synthesis providers with disposable registration and explicit routing. */
import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: the `settings` service that persists `configure()` into this plugin's profile entry, and the Loader's
// entry and `loader/volatile-update` merges.
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { SpeechSynthesisInput, SynthesizedSpeech, TextToSpeechFormat, TextToSpeechProvider, TextToSpeechProviderId, TextToSpeechProviderInfo, TextToSpeechRequest, TextToSpeechSelectionPatch, TextToSpeechSnapshot, TextToSpeechSpec } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Experimental speech synthesis provider registry. */
    textToSpeech: TextToSpeech
  }
}

/** Live selection read before a synthesis starts; `configure()` writes it through the profile. */
export interface Config {
  /** Registered provider selected when the caller omits an id. */
  defaultProvider: Volatile<string>
  /** Provider voice selected when the caller omits one. */
  voiceId: Volatile<string>
  /** Encoded audio format selected when the caller omits one. */
  format: Volatile<TextToSpeechFormat>
}

interface Registration {
  readonly provider: TextToSpeechProvider
  readonly lifetime: AbortController
  readonly pending: Set<Promise<Uint8Array>>
}

/** Registry shared by all speech-synthesis consumers in one Host composition. */
export default class TextToSpeech extends Service {
  static Config = z.object({
    defaultProvider: z.string().min(1).required().volatile(),
    voiceId: z.string().min(1).required().volatile(),
    format: z.const('wav').default('wav').volatile(),
  })

  private readonly providers = new Map<TextToSpeechProviderId, Registration>()
  private readonly listeners = new Set<() => void>()
  private readonly lifetime = new AbortController()
  /** Profile-local entry id used by Settings; absent when the plugin was mounted without Loader. */
  private readonly entryId: string | undefined

  /* jscpd:ignore-start -- deliberate symmetry with the speech-to-text seam: one admission, cancellation, and disposal contract. */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'textToSpeech')
    this.entryId = ctx.fiber.entry?.options.id
    ctx.on('loader/volatile-update', () => { this.changed() })
    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('Speech service disposed'))
      await Promise.all([...this.providers.values()].map(registration => this.remove(registration)))
      this.listeners.clear()
    })
  }

  /**
   * Register one synthesizer; duplicate ids fail without replacing the original.
   * @param provider - synthesizer owned by the contributing fiber.
   * @returns idempotent disposer which rejects admission, cancels, and joins accepted work.
   */
  register(provider: TextToSpeechProvider): () => Promise<void> {
    this.lifetime.signal.throwIfAborted()
    if (this.providers.has(provider.info.id)) throw new Error(`Speech provider already registered: ${provider.info.id}`)
    const registration: Registration = { provider, lifetime: new AbortController(), pending: new Set() }
    this.providers.set(provider.info.id, registration)
    this.changed()
    return async () => { await this.remove(registration) }
  }

  private async remove(registration: Registration): Promise<void> {
    if (this.providers.get(registration.provider.info.id) !== registration) return
    this.providers.delete(registration.provider.info.id)
    this.changed()
    registration.lifetime.abort(new Error('Speech provider unloaded'))
    await Promise.allSettled(registration.pending)
  }

  /**
   * Read the current synthesizer roster.
   * @returns available provider facts in registration order.
   */
  listProviders(): readonly TextToSpeechProviderInfo[] {
    return [...this.providers.values()].map(({ provider }) => provider.info)
  }

  /* jscpd:ignore-end */

  private changed(): void { for (const listener of this.listeners) listener() }

  /* jscpd:ignore-start -- coalescing observers behave exactly as in the speech-to-text seam. */
  /**
   * Observe complete selection snapshots; a slow reader coalesces intermediate progress.
   * @param caller - observer lifetime, independent of any synthesis call.
   * @returns an initial snapshot followed by the latest provider states.
   */
  async *follow(caller: AbortSignal): AsyncIterable<TextToSpeechSnapshot> {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    signal.throwIfAborted()
    let wake = Promise.withResolvers<undefined>()
    let changed = true
    const aborted = (): boolean => signal.aborted
    const notify = (): void => { changed = true; wake.resolve(undefined) }
    this.listeners.add(notify)
    signal.addEventListener('abort', notify, { once: true })
    try {
      while (!aborted()) {
        if (!changed) await wake.promise
        if (aborted()) break
        wake = Promise.withResolvers<undefined>(); changed = false
        yield this.snapshot()
      }
    } finally {
      this.listeners.delete(notify)
      signal.removeEventListener('abort', notify)
    }
  }

  /* jscpd:ignore-end */

  /**
   * Read the provider roster and current user preferences together.
   * @returns one detached complete observation.
   */
  snapshot(): TextToSpeechSnapshot {
    return { providers: [...this.providers.values()].map(({ provider }) => ({ ...provider.info })),
      selection: { providerId: this.config.defaultProvider.get() as TextToSpeechProviderId, voiceId: this.config.voiceId.get(),
        format: this.config.format.get() } }
  }

  /**
   * Persist changed selection fields into this plugin's profile entry; the selected provider must accept the resulting voice and format.
   * @param patch - explicit provider, voice, or format changes.
   * @returns after the profile write and the live update it applies.
   */
  async configure(patch: TextToSpeechSelectionPatch): Promise<void> {
    const settings = this.ctx.get('settings')
    const entry = this.entryId
    if (settings === undefined || entry === undefined) throw new Error('Speech selection requires the settings service and a profile entry')
    const id = patch.providerId ?? this.config.defaultProvider.get() as TextToSpeechProviderId
    this.selectedProvider(id, patch.voiceId ?? this.config.voiceId.get(), patch.format ?? this.config.format.get())
    await settings.update(entry, { ...patch.providerId === undefined ? {} : { defaultProvider: patch.providerId },
      ...patch.voiceId === undefined ? {} : { voiceId: patch.voiceId },
      ...patch.format === undefined ? {} : { format: patch.format } })
  }

  private selectedProvider(id: TextToSpeechProviderId, voiceId: string, format: TextToSpeechFormat): TextToSpeechProvider {
    const registration = this.providers.get(id)
    if (!registration) throw new Error(`Speech provider is unavailable: ${id}`)
    if (!registration.provider.info.voices.some(voice => voice.id === voiceId)) {
      throw new Error(`Speech provider ${id} does not support voice: ${voiceId}`)
    }
    if (!registration.provider.info.formats.includes(format)) {
      throw new Error(`Speech provider ${id} does not support format: ${format}`)
    }
    return registration.provider
  }

  /**
   * Apply composition defaults and capture the selected provider. Missing providers and undeliverable text fail explicitly.
   * @param request - accepted text and optional selection.
   * @returns provider-pinned input for synthesize().
   */
  resolve(request: TextToSpeechRequest): TextToSpeechSpec {
    const id = request.providerId ?? this.config.defaultProvider.get() as TextToSpeechProviderId
    const voiceId = request.voiceId ?? this.config.voiceId.get()
    const format = request.format ?? this.config.format.get()
    const provider = this.selectedProvider(id, voiceId, format)
    if (request.text.trim().length === 0) throw new Error('Speech text is empty')
    if (request.text.length > provider.info.maxTextChars) {
      throw new Error(`Speech text exceeds the provider limit of ${provider.info.maxTextChars} characters`)
    }
    return { provider, text: request.text, voiceId, format }
  }

  /**
   * Execute exactly the resolved provider; no fallback sends text elsewhere.
   * @param spec - resolved input; a withdrawn or replaced registration is rejected.
   * @param signal - caller cancellation.
   * @returns encoded audio and the accepted text length after provider settlement.
   */
  async synthesize(spec: TextToSpeechSpec, signal: AbortSignal): Promise<SynthesizedSpeech> {
    signal.throwIfAborted()
    const registration = this.providers.get(spec.provider.info.id)
    if (registration?.provider !== spec.provider) throw new Error('Resolved speech provider is no longer registered')
    const combined = AbortSignal.any([signal, registration.lifetime.signal])
    const input: SpeechSynthesisInput = { text: spec.text, voiceId: spec.voiceId, format: spec.format }
    const pending = Promise.resolve().then(() => {
      combined.throwIfAborted()
      return spec.provider.synthesize(input, combined)
    })
    registration.pending.add(pending)
    try {
      const audio = await pending
      combined.throwIfAborted()
      return { audio, format: spec.format, characters: spec.text.length }
    } finally {
      registration.pending.delete(pending)
    }
  }
}
