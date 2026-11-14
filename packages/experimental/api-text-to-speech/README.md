---
description: "Expose bounded, transient speech synthesis through the authenticated Web Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-text-to-speech

English | [中文](README.zh.md)

## Summary

The `speechOutput` Remote lets a browser play the spoken form of assistant text through `ctx.textToSpeech`. It advertises providers, voices, formats, and its request limits, persists the user's voice and format choice, and returns one complete audio result per call. Every request is bounded by text characters, audio bytes, and a provider timeout, and the returned base64 audio is transient: no Session event, attachment, or file is written.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose with the speech synthesis Service Definition and Typert. `maxTextChars`, `maxAudioBytes`, and `timeoutMs` bound every request. The browser UI mounts this package's generated `/remote` contribution when the playing client is enabled.

`synthesize()` accepts the assistant text and an optional explicit provider, voice, and format; omission uses the persisted selection. The result carries `audioBase64`, `format`, and `characters` for playback and progress. Playback, queueing, and stop policy belong to the client consumer, not to this Remote.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`catalog()` exposes the provider roster, the resolved selection, and the three request limits. `follow()` streams complete catalogs so a client tracks readiness and preference changes without polling. `configure()` persists the supplied selection fields through the service.

`synthesize()` trims the text, rejects empty and oversized text before a provider call, and combines the caller signal with `AbortSignal.timeout(timeoutMs)`. Only the timeout abort becomes a typed failure; a caller abort rethrows its own reason. Synthesized bytes over `maxAudioBytes` are rejected before encoding, so the response never carries a data URL prefix or a partial result. Provider rejections become `speech-output/synthesis-failed`: an unresolvable provider, voice, or format reports `unavailable`, and a rejected synthesis reports `provider`. Neither carries the provider's message, so credentials and provider diagnostics stay on the Host.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Speech synthesis Service Definition](../text-to-speech/README.md) — the provider registry and selection this Remote serves.
- [Voice input subsystem](../../../docs/subsystems/voice-input.md) — the recognition seam whose Remote mirrors this one.
- [Typert subsystem](../../../docs/subsystems/typert.md) — Remote namespaces, typed errors, and streams.

-----

<a id="model-experience"></a>
## Model Experience

None, as synthesis reads already-logged assistant text and returns transient audio; no request, tool, or Session event is added.

#### KV Cache effect

No direct effect; the spoken text comes from an existing assistant message whose content is unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Synthesis is one complete result per call: no streaming audio, partial delivery, or provider-side word timings.
- Audio is transient base64 over the authenticated Remote. It is never written to disk, attachments, the Session log, or a diagnostics record.
- A rejected synthesis is not retried automatically, because every provider call is billed.
- Provider failures reach the browser as sanitized reasons; the provider message, endpoint, and credential state stay on the Host.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
