# Speech synthesis

English | [中文](text-to-speech.zh.md)

Speech synthesis is an opt-in Host seam: a provider registry routes one text-to-audio request to exactly one provider, and the authenticated [speech output Remote](../../packages/experimental/api-text-to-speech/README.md) exposes it to browser clients. Provider implementations stay outside this composition; the official DeepSeek voices register on this seam. No synthesis result is written to a Session, an attachment, or a file.

## Selection and routing

`TextToSpeechProvider` advertises its id, display name, processing location, voices, formats, and maximum text length; credentials, endpoints, and billing state stay inside the provider. `resolve()` applies the persisted default selection, then rejects an unknown provider, a voice or format the provider does not advertise, empty text, or text beyond the provider limit. A missing provider never falls back to another provider.

`register()` returns one disposer: it rejects new admissions, aborts in-flight synthesis through the registration lifetime, and joins accepted work before releasing the id. `synthesize()` executes exactly the pinned registration and fails when that registration was replaced or withdrawn. Settings persist only explicit preference changes through the plugin's profile entry.

## Browser delivery

The [speech output Remote](../../packages/experimental/api-text-to-speech/README.md) validates text length, byte size, and a request deadline before forwarding, encodes each result as canonical base64 for the wire, and maps provider rejections to sanitized typed errors. Audio is transient: it never enters the Session log, attachments, or disk, and no request is retried automatically because every synthesis is billable.

Playback belongs to the [speech playback consumer](../../packages/experimental/client-ui-voice-output/README.md): it owns the auto-speak policy, voice and mute selection, interruption, and the speaking state other form plugins observe. It reads only already-logged assistant text, sends that text for synthesis, and keeps audio, queues, and playback state process-local.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtexttospeech--texttospeech"></a>

### `ctx.textToSpeech` — `TextToSpeech`

Registry shared by all speech-synthesis consumers in one Host composition.

```ts cordis-catalog
/**
 * Register one synthesizer; duplicate ids fail without replacing the original.
 * @param provider - synthesizer owned by the contributing fiber.
 * @returns idempotent disposer which rejects admission, cancels, and joins accepted work.
 */
register(provider: TextToSpeechProvider): () => Promise<void>

/**
 * Read the current synthesizer roster.
 * @returns available provider facts in registration order.
 */
listProviders(): readonly TextToSpeechProviderInfo[]

/**
 * Observe complete selection snapshots; a slow reader coalesces intermediate progress.
 * @param caller - observer lifetime, independent of any synthesis call.
 * @returns an initial snapshot followed by the latest provider states.
 */
async *follow(caller: AbortSignal): AsyncIterable<TextToSpeechSnapshot>

/**
 * Read the provider roster and current user preferences together.
 * @returns one detached complete observation.
 */
snapshot(): TextToSpeechSnapshot

/**
 * Persist changed selection fields into this plugin's profile entry; the selected provider must accept the resulting voice and format.
 * @param patch - explicit provider, voice, or format changes.
 * @returns after the profile write and the live update it applies.
 */
async configure(patch: TextToSpeechSelectionPatch): Promise<void>

/**
 * Apply composition defaults and capture the selected provider. Missing providers and undeliverable text fail explicitly.
 * @param request - accepted text and optional selection.
 * @returns provider-pinned input for synthesize().
 */
resolve(request: TextToSpeechRequest): TextToSpeechSpec

/**
 * Execute exactly the resolved provider; no fallback sends text elsewhere.
 * @param spec - resolved input; a withdrawn or replaced registration is rejected.
 * @param signal - caller cancellation.
 * @returns encoded audio and the accepted text length after provider settlement.
 */
async synthesize(spec: TextToSpeechSpec, signal: AbortSignal): Promise<SynthesizedSpeech>
```

Source: [`packages/experimental/text-to-speech/src/index.ts`](../../packages/experimental/text-to-speech/src/index.ts)

<a id="ctxtexttospeechcontroller--texttospeechcontroller"></a>

### `ctx.textToSpeechController` — `TextToSpeechController`

Speech output calls never activate or submit to an Agent.

```ts cordis-catalog
/**
 * Read voice and format choices without synthesizing audio.
 * @returns available providers, the resolved selection, and request limits.
 */
@Remote catalog(): SpeechOutputCatalog

/**
 * Follow provider readiness and preference changes.
 * @param signal - Client observation lifetime.
 * @returns initial and subsequent complete catalogs.
 */
@Remote({ mode: 'stream' }) async *follow(signal: AbortSignal): AsyncIterable<SpeechOutputCatalog>

/**
 * Persist the user's voice and format preferences.
 * @param patch - changed preference fields.
 * @returns after preferences are saved.
 */
@Remote configure(patch: TextToSpeechSelectionPatch): Promise<void>

/**
 * Validate text and synthesize one transient audio result.
 * @param request - text to speak and explicit voice selection.
 * @param signal - Client cancellation or Remote contribution disposal.
 * @returns canonical base64 audio without a Session event, attachment, or log entry.
 */
@Remote async synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<SynthesizedAudio>
```

Source: [`packages/experimental/api-text-to-speech/src/index.ts`](../../packages/experimental/api-text-to-speech/src/index.ts)
<!-- END GENERATED cordis-surface -->
