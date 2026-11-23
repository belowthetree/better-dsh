---
description: "DeepSeek OCR, speech recognition, speech synthesis, and in-memory playback tools with their speech providers."
kind: "package-reference"
---

# @deepseek-ai/dsh-deepseek-suite

English | [中文](README.zh.md)

## Overview

The built-in DeepSeek application API toolkit: `deepseek_ocr` recognizes documents page by page, `deepseek_asr` transcribes audio with the DeepSeek account, `deepseek_tts` synthesizes an audio file, and `deepseek_speak` synthesizes speech and plays it in client memory. The plugin also registers the `deepseek-cloud` recognition provider and the `deepseek-tts` synthesis provider whenever the composition mounts those seams, so the Better DSH orb profile needs no external suite.

## Summary

The built-in DeepSeek application API tools and their speech providers: OCR, account speech recognition, file synthesis, and in-memory playback, mounted by the better bundle so the orb profile needs no external suite.

## Use this package

The better bundle mounts this package as the `deepseek-suite` row in `better-bundle/cordis.patch.yml`, so any profile that declares the orb form gets the four tools and both providers. Tools register in the root scope and stay visible down the scope chain to every Agent, including the `manage` preset.

- `deepseek_ocr` and `deepseek_tts` use the credential named by `apiKeyRef` (default `DEEPSEEK_API_KEY`, falling back to the environment variable of that name).
- `deepseek_asr` accepts account authorization only: a missing sign-in, a 401, or a sign-out during the request produces a stable error code and Settings > Account guidance.
- `deepseek_speak` synthesizes through the speech Remote and plays the audio in browser memory; nothing is written to disk or the Session log. The client reads the text to speak from the `speak` presentation metadata on the tool result (the Better DSH orb form owns playback).
- Relative `filePath` and `outputPath` resolve against the current Session workspace; without `outputPath` the file is written as `deepseek-tts-<timestamp>.wav`.

## Understand the implementation

[api.ts](src/api.ts) is the transport layer: it takes the origin, credential, fetch, and AbortSignal explicitly and maps HTTP failures onto `DeepSeekApiError` with the status, provider code, and retryability. Both the recognition and synthesis providers reuse that transport and its account authorization; the synthesis provider returns encoded bytes and never writes a file.

## Further exploration

- [better-bundle](../better-bundle/README.md): the orb composition and its `manage` preset.
- [Speech synthesis](../../../docs/subsystems/text-to-speech.md): the provider registry and selection.
- [Voice input](../../../docs/subsystems/voice-input.md): the recognition seam and microphone capture.

## Model Experience

### The four tools

#### What the model sees

Four tools call the DeepSeek application API: `deepseek_ocr`, `deepseek_asr`, `deepseek_tts`, and `deepseek_speak`. Each successful call returns one text for the model; `deepseek_speak` returns the character count plus `speak` presentation metadata that only the client reads.

#### Token effect

Every Agent in a composition that mounts this package carries the fixed schema cost of four tools per request; OCR and recognition results are truncated to `maxOutputChars` with an explicit omission note.

#### KV Cache effect

Schemas and descriptions stay a stable prefix while the composition is unchanged; each call appends only its result text to the suffix. The `speak` presentation payload never enters model content.

## Known Limitations and Deferred Work

- `deepseek_speak` speaks only where the playback service (`ctx.voiceOutput`) is mounted; a process without playback stays silent.
- Installing the external `@dsh-external/dsh-deepseek-suite` alongside this package registers the same tool names and provider ids twice; keep only one.
- The management page (the external suite's plugin detail form) is not ported: the credential name, timeouts, and output directory are configured through this package's `Config` in the composition.
- `deepseek_ocr` inherits the documented 100 MiB and 1000-page limits; provider errors surface unchanged.
