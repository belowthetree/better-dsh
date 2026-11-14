# 语音合成

[English](text-to-speech.md) | 中文

语音合成是可选启用的 Host seam：Provider 注册表把一次文本转音频请求路由到唯一 Provider，带认证的[语音输出 Remote](../../packages/experimental/api-text-to-speech/README.zh.md) 将它提供给浏览器客户端。Provider 实现留在组合之外；官方 DeepSeek 音色注册到该 seam。任何合成结果都不会写入 Session、附件或文件。

## 选择与路由

`TextToSpeechProvider` 声明其 id、显示名、处理位置、音色、格式与最大文本长度；凭证、端点与计费状态留在 Provider 内部。`resolve()` 应用持久化的默认选择，然后拒绝未知 Provider、Provider 未声明的音色或格式、空文本，以及超过 Provider 上限的文本。缺少 Provider 时绝不回退到其他 Provider。

`register()` 返回唯一的 disposer：它拒绝新的准入，通过注册生命周期中止进行中的合成，并在释放 id 前等待已接受的工作结束。`synthesize()` 只执行已固定的注册，该注册被替换或撤下时失败。Settings 只通过插件的 profile 条目持久化显式的偏好变化。

## 浏览器交付

[语音输出 Remote](../../packages/experimental/api-text-to-speech/README.zh.md) 在转发前校验文本长度、字节大小与请求时限，把每个结果编码为规范的 base64 通过线上传输，并将 Provider 拒绝映射为经过脱敏的类型化错误。音频是临时的：绝不进入 Session 日志、附件或磁盘；由于每次合成都计费，请求不会自动重试。

播放属于[语音播放消费者](../../packages/experimental/client-ui-voice-output/README.zh.md)：它拥有自动朗读策略、音色与静音选择、打断，以及形态插件观察的朗读状态。它只读取已记录的助手文本，把该文本送去合成，并让音频、队列与播放状态保持进程本地。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
