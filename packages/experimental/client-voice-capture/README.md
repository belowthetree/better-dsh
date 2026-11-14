---
description: "Shared microphone capture service over the experimental speech Remote, with device preference, WAV encoding, and transcription."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-voice-capture

English | [中文](README.zh.md)

## Summary

Provides the browser capture capability: one microphone recorder, one persisted input selection, canonical WAV encoding, and the speech Remote transcription call, exposed as the Cordis service `ctx.voiceCapture`. The plugin mounts the experimental speech Remote contribution itself, so a composition that mounts this package gains recording without a second speech row. The composer control in [client-ui-voice-input](../client-ui-voice-input/README.md) is one consumer; future orb and push-to-talk controls observe the same snapshot, and capture no longer ends when one control unmounts, loses focus, or hides the page.

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

Mount the package where a browser composition needs microphone capture. The plugin injects `remote` and, after mounting the generated speech Remote contribution, provides `ctx.voiceCapture`. A consumer injects the service and reads `snapshot()`: the phase (`idle`, `starting`, `capturing`, `transcribing`), the selected microphone, the live input level, the last failure, the Host capture cap, and the recognition selection remembered for the next finished capture. The snapshot keeps its reference until one of those facts changes, and `follow(signal)` yields the current value plus every change until the signal aborts.

`begin()` acquires the selected microphone and starts recording; a second concurrent capture, a disposed service, or a failed acquisition rejects. `finish()` stops the recorder, encodes canonical 16 kHz mono PCM16 WAV, asks the speech Remote to transcribe it with the selection remembered at `begin()`, and resolves the transcript after the service returns to `idle`. `cancel()` stops and discards the recording, and it never uploads. A command failure returns the service to `idle` carrying one member of the closed failure union (`unavailable`, `permission`, `empty`, `cancelled`, `interrupted`, `deviceMissing`, `transcribe`), and the next `begin()` clears it. Every failure without a dedicated member, including a rejected Remote transcription, reads as `transcribe` and keeps the diagnostic message on the rejection. `finish({ hold: true })` additionally publishes the transcript in `snapshot().pendingTranscript` until `takeTranscript()` returns it once, so a collapsed panel can finish a capture before its composer exists.

`setDevice(device)` stores the browser input preference under the existing `dsh.voice-input.microphone` storage key, so preferences recorded before this package existed keep working; an empty id follows the system input. `catalog()` unwraps the speech Remote catalog and rejects its error branch, and `followCatalog(signal)` mirrors it across transport reconnections. `configure`, `prepare`, and `cancelPreparation` forward to the speech Remote so a consumer keeps its selection and preparation UI. `preview(device, onFailure, signal)` acquires one microphone for a level meter without recording or uploading; aborting the signal releases a pending or settled acquisition.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The `/protocol` export is pure type declarations shared by the browser halves; it imports nothing at runtime. The `/client` export is the Cordis plugin: it mounts the speech Remote contribution, constructs the service, and registers its disposal as a fiber effect before providing `ctx.voiceCapture`. Disposal runs in order — the service withdrawal wakes dependents, the service releases every recorder and preview, and the Remote unmount completes last.

One recorder instance is active at a time and it belongs to the service, not to a rendered control. The level loop reads the recorder analyser with `requestAnimationFrame` only while `capturing` and publishes zero otherwise. `finish` truncates the encoded audio to the smaller of the Host duration cap and the byte cap derived from `maxAudioBytes`, so the canonical WAV stays inside the Remote intake limits even when a timer overshoots. Device interruptions, recorder errors, and ended tracks release the tracks before the failure is published.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [client-ui-voice-input](../client-ui-voice-input/README.md) — the composer control that consumes this service.
- [api-speech-to-text](../api-speech-to-text/README.md) — the authenticated speech Remote this package mounts and calls.
- [speech-to-text](../speech-to-text/README.md) — the Host recognition seam behind that Remote.
- [Voice input subsystem](../../../docs/subsystems/voice-input.md) — how capture, recognition, and the composer fit together.

-----

<a id="model-experience"></a>
## Model Experience

None, as recording, encoding, and recognition produce no model input; ordinary user submission owns any later message content.

#### KV Cache effect

No direct effect; this package sends no provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One consumer drives the deadline** — the service publishes `maxDurationSeconds` and truncates encoded audio at the Host limits, but a consumer owns the stop timer; a capture left behind by an unmounted consumer keeps the microphone open until a consumer stops or cancels it.
- **No partial transcripts or streaming audio** — recognition runs on one complete WAV request per finished capture.
- **Recognition service owned elsewhere** — provider choice, credentials, billing, and cloud versus local execution belong to the speech-to-text seam and its providers; this package only requests a transcript.
- **No delivery policy** — the service never inserts or submits text; each consumer decides where a transcript goes. A held transcript is only a handoff; a consumer that never mounts leaves it in the snapshot until the next `begin()`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The speech Remote contribution arrives through the generated `/remote` export, which exists only after a build; source tests exercise `mountVoiceCapture` with a synthetic contribution instead, and the browser refresh exercises the built entry.

</details>
