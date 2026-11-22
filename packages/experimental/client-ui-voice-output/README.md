---
description: "Speaks completed assistant replies with an auto-speak policy, voice selection, and mute."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-voice-output

English | [中文](README.zh.md)

## Summary

This experimental browser plugin speaks the active Session's completed assistant replies. It mounts the generated `speechOutput` Remote and serves `ctx.voiceOutput`: one snapshot of the auto-speak policy, the selected voice, the catalog voices, mute, speaking state, the pending count, the last failure, and the text limit, plus commands for policy, voice, mute, stop, and an explicit `speak(text)`. The `voice` policy speaks only a turn a voice transcript started; `all` speaks every completed reply. One clip plays at a time with at most one pending reply, and failures are never retried.

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

A profile needs the `text-to-speech` and `api-text-to-speech` rows plus this package; the better bundle already composes all three. The plugin injects `remote` and `surface`, which the web-app composition supplies for both voice bundles, and observes the Session object layer when `sessions` is available, so the frame, the orb, and the classic composer never own playback. An orb form mounts playback only in the surface renderer; Better projects its speaking state to the resident orb. Settings and playback commands call `setMuted`, `setPolicy`, and `setVoice` through the primary `ctx.voiceOutput`, whose snapshot lists catalog voices by name.

The policy decides automatic playback. `off` speaks no reply, while an explicit `speak(text)` still plays; `all` speaks every completed assistant reply of the active Session; `voice` speaks only a reply whose turn a voice transcript initiated. A voice-initiated turn is a heuristic: a capture snapshot returning from `transcribing` to `idle` opens a 60-second window, the first submitted user message inside the window marks the turn it is claimed in, and the mark clears after that one submission.

`setVoice(voiceId)` accepts only a voice the catalog advertises; the DeepSeek provider publishes `stella` and `tide`. An unknown id publishes the `voice` failure and keeps the previous selection. `setMuted(true)` stops the playing clip and drops the pending reply. Policy, voice, and mute persist under the browser `localStorage` key `dsh.voice-output`; malformed stored values fall back to their defaults.

**Privacy and billing.** The text that is spoken travels through the Host to the configured DeepSeek endpoint. Synthesized audio exists only in browser memory: the object URL is revoked when playback ends, and no audio byte reaches the Session log, attachments, or disk. A failed synthesis is not retried because every provider call is billed. Failures are published as one closed member: `unavailable` (the Remote is absent, unreachable, or advertises no voice), `remote` (the Remote rejected the request), `playback` (the browser refused to create or play the element), and `voice` (the selected voice is not in the current catalog). The next clip that starts playing clears the failure.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The plugin mounts the `speechOutput` Remote contribution and provides `ctx.voiceOutput` in one step; withdrawing the plugin removes both. The namespace the gateway mounts is a service of its own fiber, which a sibling plugin cannot read by property, so the service lives in a scope that injects `remote.speechOutput` and calls the Remote through it. Playback reads every provider's advertised voices once (deduplicated by id, `stella` and `tide` from the DeepSeek provider) and adopts the catalog's `maxTextChars` as the per-request text bound; a longer reply is truncated rather than split into several billable requests.

Automatic playback is not a React concern. `ActiveReplyObserver` reads the active Session through the client object layer: the row the main view retains in `ctx.sessions.list`, then the borrowed `SessionBinding`'s event window. It consumes appended durable events and assistant settlements only, so a replacement window or an older page (initial open, reconnect baseline, history paging) never replays the conversation as new speech. A `turn/start` makes the previous turn's playback stale, and the visible text blocks of an `assistant/message` become the candidate reply; tool results, user messages, attempts, and reasoning-only messages are never spoken.

One clip plays at a time and the pending slot holds at most one reply, so a reply completing during playback replaces the older pending one (newest wins). `stop()`, mute, and a newly opened turn interrupt the playing clip and abandon an in-flight synthesis; a failed request is never retried. The audio element comes from an injected factory whose default is `new Audio(url)`, and its object URL is revoked when playback ends or is interrupted.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [speechOutput Remote](../api-text-to-speech/README.md) — the bounded, transient synthesis this package mounts.
- [Speech synthesis Service Definition](../text-to-speech/README.md) — the provider registry and selection behind that Remote.
- [Voice capture service](../client-voice-capture/README.md) — the microphone service whose finished capture marks a voice-initiated turn.
- [Voice input subsystem](../../../docs/subsystems/voice-input.md) — the recognition seam this playback path pairs with.
- [Typert subsystem](../../../docs/subsystems/typert.md) — Remote namespaces, typed errors, and streams.

-----

<a id="model-experience"></a>
## Model Experience

None, as playback reads already-logged assistant text and sends that text for synthesis without adding a model request or a Session event.

#### KV Cache effect

No direct effect; the spoken text is an existing assistant message whose content never changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- No streaming synthesis or streaming playback: each request returns one complete clip, so speaking starts after the whole response arrives.
- The pending slot keeps one reply: a reply that completes while another clip plays replaces the earlier pending one, which is dropped without speaking.
- The voice-initiated marker is heuristic. It depends on a 60-second window, consumes one submission, and assigns the turn the durable user message is claimed in, so queued or steering submissions can attribute the mark imprecisely.
- No per-message read-aloud action ships; explicit `speak(text)` exists for a later control.
- Browser system voices are not used; selectable voices come only from the speech Remote's providers.
- Playback, the queue, and speaking state are process-local to the owning renderer (surface in the orb form), so its reload drops them, while policy, voice, and mute survive.
- The `text-to-speech` and `api-text-to-speech` rows are required; without them the plugin is inert and only reports the `unavailable` failure.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
