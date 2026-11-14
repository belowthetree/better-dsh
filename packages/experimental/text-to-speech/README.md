---
description: "Named experimental speech-synthesis providers with voice and format catalogs."
kind: "package-reference"
---

# @deepseek-ai/dsh-text-to-speech

English | [中文](README.zh.md)

## Summary

This Service Definition selects named speech synthesizers through `ctx.textToSpeech`. Consumers resolve their request before execution; providers register independently.

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

Load through a voice-output composition, or compose the service with a provider and a consumer. `defaultProvider` selects an exact registered provider id and `voiceId` selects one of its advertised voices; both are required. `format` stays `wav` in this version. A missing or duplicate provider fails explicitly.

Providers advertise `voices`, `formats`, and `maxTextChars`. `resolve()` applies the configured selection and rejects text that is empty, whitespace-only, or longer than the provider limit. `synthesize()` returns encoded audio bytes and the accepted text length; providers never write a file.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`resolve()` captures the provider instance, text, voice, and format. `synthesize()` rejects a withdrawn or replaced registration. A registration disposer closes admission, aborts accepted requests and joins provider settlement; providers must honor cancellation. No fallback selects a different synthesizer or sends text elsewhere.

`defaultProvider`, `voiceId`, and `format` are volatile Config fields: `configure()` writes the supplied fields into this plugin's profile entry through the `settings` service, and the running instance reads the updated values without remounting; composition defaults apply until an override is saved. Settings addresses the entry by its configured id (`entry.options.id`), without the Loader's Include path. `configure()` fails without `settings` or a profile entry, and rejects a voice or format the selected provider does not advertise before saving. `snapshot()` and `follow()` publish the provider roster and the current selection; closing an observer never cancels synthesis.

Synthesis produces transient bytes: no Session event, attachment, file, retry, or log line carries the text or the audio.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Speech synthesis subsystem](../../../docs/subsystems/text-to-speech.md)

[Speech recognition seam](../speech-to-text/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as this host capability seam registers no model-visible input and audio bytes never enter model requests.

#### KV Cache effect

No direct effect; the service registers no model-visible input, so cached prompt prefixes stay unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only complete-utterance WAV synthesis is supported; streaming synthesis, partial audio, and playback do not exist in this package.
- No local or offline synthesizer ships here, and providers own their credentials, endpoint, and per-call billing disclosure.
- Playback, auto-speak policy, queueing, interruption, and key-up handling belong to a client consumer, not to this seam.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
