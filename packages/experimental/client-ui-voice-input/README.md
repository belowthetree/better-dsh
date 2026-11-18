---
description: "Record speech and insert reviewable transcripts into the conversation draft."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-voice-input

English | [中文](README.zh.md)

## Summary

This optional browser plugin adds an outline microphone icon between the model selector and Send. When recognition is ready, clicking it opens a recording toolbar with measured audio levels, Cancel and Stop. The waveform stays shorter than the recording buttons. Stopping transcribes into the draft. Recording, microphone selection, and transcription belong to the shared capture service in [client-voice-capture](../client-voice-capture/README.md); this package is one consumer of it. Recognition preferences and model preparation live in plugin settings; language choices come from the selected provider. A hands-free setting there submits the transcript as an ordinary message instead of leaving it in the draft.

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

Enable the [voice input bundle](../voice-input-bundle/README.md) from Plugins. The plugin injects `voiceCapture`, so the composition must also mount [client-voice-capture](../client-voice-capture/README.md); that package mounts the speech Remote and owns the recorder. After cache inspection, missing models trigger a setup prompt with Go to setup and Later actions. Go to setup opens bundle details; Download and prepare starts installation there. Intact cached models need no prompt or repeated installation. Before recognition is ready, guidance appears only on click, with no microphone tooltip. Clicking the microphone opens the same guidance dialog; its action opens the voice bundle details without recording or downloading. Cache inspection, preparation in progress, failures and disconnected services instead offer navigation to status, progress or error details. The dialog moves focus to its navigation action and keeps Tab traversal inside it; Later or Escape restores the previous focus without changing or submitting the draft. Before preparation, local providers can show their estimated disk, memory and setup-time requirements. The preparation summary starts collapsed; expand it to inspect completed, current and pending steps. Once ready, click the microphone, allow access and click Stop to transcribe. Cancel or Escape discards capture. Capture belongs to the shared service, so it continues when the toolbar unmounts, the window loses focus, or the page hides; returning to the conversation shows the active recording again. Recognition feedback stays inside the toolbar. Provider and language preferences are saved from bundle details through the Settings service. Browser microphone access requires HTTPS or loopback and operating-system permission.

Use the native **Input device** selector in bundle details to follow the system default or select a browser microphone. System default shows the current device name when available. While bundle details are active, the selected input's live level remains visible at the right of the field; selecting another input restarts the preview for that device. Hiding or leaving the page, or disabling the plugin, releases the preview, including late permission grants. The browser remembers the device for subsequent recordings independently of Host recognition settings. Device insertion and removal refresh the options without interrupting an available selected input. A disconnected selection retains its name and position as a disabled option with an Unavailable label. Reconnecting while the page is active restores its preview; choosing another input removes the unavailable option. Interrupted recordings require an explicit restart. Permission denial keeps other choices accessible; an explicitly selected device never silently falls back to another input.

Before downloading or retrying, **Model download source** offers Automatic and the origins advertised by the Host. SenseVoice normally offers Hugging Face and HF-Mirror; a fixed private deployment exposes only its configured origin. Manual selection uses only that source, while Automatic preserves the provider’s comparison and fallback policy. The choice is retained for retries in the current card, without changing deployment configuration or recognition preferences. Source controls are unavailable during preparation and hidden when resources are ready.

`pluginNavigation` is optional: the plugin starts without it, and the setup dialog offers the details button only while the service is present.

-----

Activation prompts use the shared modal description, so the heading and explanatory text form one group above the actions.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The plugin registers one composer contribution and the bundle's setup and preparation contributions, then adapts the shared service into their injected props. It owns no recorder: `begin`, `finish`, `cancel`, the live snapshot, and the microphone previews all come from [client-voice-capture](../client-voice-capture/README.md), which also mounts the speech Remote contribution. That service publishes one snapshot; the toolbar derives its requesting, recording, transcribing, and feedback phases from it and reads the level for the waveform, so a remounted composer rejoins an active capture instead of discarding it.

Capture ownership is why losing window focus, hiding the page, and unmounting the composer no longer stop a recording; only Cancel, Escape, a device interruption, or an explicit Stop end it. A Session change keeps the capture running and retargets the next transcript to the current draft instead of dropping it. Command failures return the service to idle and arrive as tagged rejections, which the toolbar localizes; the original editor selection still carries a draft revision, so changed drafts retain the transcript for explicit insertion or discard beside the microphone. One plugin-owned readiness subscription serves the composer, installation prompt and details. These views use the existing Slot lifecycle and own no preparation tasks. A capture finished from the orb while the panel was collapsed holds its transcript in the shared service, and this control inserts it as soon as it mounts.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [client-voice-capture](../client-voice-capture/README.md) — the shared capture service and speech Remote mount this package consumes.
- [Voice input subsystem](../../../docs/subsystems/voice-input.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as recordings and preparation remain outside model requests; ordinary user submission owns any later text.

#### KV Cache effect

No direct effect; ordinary submission owns the message content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Requires the [client-voice-capture](../client-voice-capture/README.md) row; without it the plugin stays inactive and no microphone control appears.
- No automatic send, always-on microphone, wake word, streaming captions or speech synthesis. “Local” means the Host machine, which can differ from the browser’s machine.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
