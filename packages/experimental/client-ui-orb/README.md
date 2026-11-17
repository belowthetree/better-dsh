---
description: "Orb form chrome for the desktop shell: floating orb, centered chat dialog, and system commands."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-orb

English | [中文](README.zh.md)

## Summary

The orb form's client plugins: one `shell.overlay` entry drawing a 112-pixel floating orb, one `shell.modal` entry for the form's centered chat dialog, and the system-scope `orb.toggle` and `voice.pushToTalk` commands. The orb profile renders no classic frame: clicking the orb raises the chat dialog, which sends prompts into the conversation catalog and dismisses after acceptance, while voice capture and playback states appear when the sibling service packages are mounted. The dialog's voice toggle records on the shared capture service and appends the recognized text to its input instead of submitting it.

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

Add the `client-ui-orb` row to a profile whose form declares the orb presentation, together with [client-surface](../../client/surface/README.md) and the surface-aware [ui-layout](../../client/ui-layout/README.md). The package injects `surface`, `slots`, `locale`, `shortcuts`, and `sessions`; the Desktop carrier owns window geometry, transparency, click-through, and presentation transitions, so the renderer only reports intent.

The overlay entry draws only in the snapshot's `orb` role and renders nothing in the `surface` window, the bubble column window, or a classic window, so a panel, bubble column, or modal presented beside the orb never replaces it. In the orb window it draws one circular button whose visual state is published as data attributes: `data-orb` carries `data-state` (`idle`, `capturing`, `transcribing`, `speaking`, or `running`) and `data-reduced-motion`, while the button carries `data-hovered`, `data-pressed`, and `data-dragging`. Each state has its own localized accessibility label. Clicking presents the centered chat dialog; dragging past four logical pixels reports throttled deltas through `surface.dragBy` and suppresses the click it would have produced. Entering or leaving the orb and its drag handle reports `surface.setPointerInside` so the carrier can pass clicks through elsewhere. While the capture service is mounted, a smaller microphone button at the orb's lower right starts a capture without opening the dialog, or finishes it and presents the dialog, which takes the held transcript into its input. A secondary click does nothing: the orb carries no context menu, and session creation and quitting stay with the Desktop shell.

The `shell.modal` entry `orb.chat` renders the chat dialog inside the frame's focus-trapped modal layer: one auto-focused textarea, a voice input toggle, and a send button. The dialog draws its own surface — a card that uses the shared composer's material and control row: the elevated input fill, a hairline stroke, the 34-pixel info-fill send circle, and the 28-pixel ghost microphone — so it reads as the same control as the workbench prompt. It marks the frame's modal card bare so the frame keeps only the dismissal layer, focus trap, and dismissal. Enter submits, Shift+Enter inserts a newline, and Escape or a backdrop click dismisses the presentation through the frame. A successful submission clears the box and dismisses it, while a rejected one keeps the text and shows a localized failure line inside the box. The prompt goes through the injected `sessions` service to the most recently catalogued Session, creating a blank Session when the catalog is empty. While the capture service is mounted, the microphone toggle starts a recording, shows the requesting, recording, and transcribing states, and appends a finished transcript to the end of the input without inserting a separator or submitting it; without that service the toggle is absent and the box keeps working as a plain prompt. Closing the dialog while it records discards the recording this box started.

`orb.open` is a `scope: 'system'` command bound by default to Ctrl+Alt+D on Windows and macOS: it presents the chat dialog and focuses its input, and presenting again while it is open leaves it in place. Rebind it in Settings, General, Global; Linux keeps its focused-window model and reports no OS-global registration. `orb.toggle` is a second system command with no default binding: resolving it presents the chat dialog while the snapshot reports `orb`, dismisses the modal presentation otherwise, and collapses the panel presentation back to the orb, so one command both opens and hides the form. `voice.pushToTalk` is a third system command with no default binding: it starts a capture while idle and otherwise finishes the active one, so a global key dictates without opening the dialog. `ctx.shortcuts` owns OS registration and reports conflicts.

Optional services keep the same chrome working alone. When [client-voice-capture](../client-voice-capture/README.md) is mounted, the orb shows its recording and transcription phases and the dialog offers its voice toggle; when the playback package is mounted, the orb reflects its speaking state. Without either service the orb still opens the dialog, drags, and submits prompts.

## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`apply` registers the eight dictionaries once, then builds one snapshot store per observation: the carrier surface, the reduced-motion media query, and each voice service that is mounted. The surface observation and the two optional voice observations share one helper that follows a signal-scoped stream into a store and aborts with the fiber; optional services are observed through `ctx.inject`, so unmounting one clears its store and leaves the chrome functional. The two entries register through `ctx.slots.inject`, which waits for the frame's declaration and removes the contribution when that declaration collapses. The command registers through `ctx.shortcuts.register`, whose disposer runs with the plugin. A submission retains the target through `ctx.sessions.using` with this package's `orbPrompt` reference source, then calls `prompt(content, 'queue')` without a local submission echo because the dialog shows no optimistic transcript. Every carrier command is issued from one closure that contains rejections and reports them once.

The components receive plain data and callbacks only: `hooks` compartment sources become `useSurface`, `useCapture`, `useVoice`, and `useReducedMotion` selector hooks, the standard `useSessions` seat supplies the running state, and `actions` carries the callbacks. The overlay face carries `openChat`, the drag command, and `toggleVoice`; the chat face additionally carries `takeTranscript`, `submit`, `dismiss`, and the dictation commands over the shared capture service, so the dialog never owns a recorder. Drag state, hover, and pressed are local component state; the drag hook coalesces pointer movement into one report per animation frame, measures it in screen coordinates so the carrier moving the window under the pointer cannot cancel the next delta, and flushes the remainder on release, which is also what decides whether the gesture counts as a drag. The dialog's text, submission failure, and dictation notice are local component state; a transcript append is the only write into that text from outside the input.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [client-surface](../../client/surface/README.md) — the presentation snapshot and carrier commands this overlay issues.
- [ui-layout](../../client/ui-layout/README.md) — the frame that declares `shell.overlay` and `shell.modal` and owns the modal presentation.
- [client-voice-capture](../client-voice-capture/README.md) — the optional capture service behind the recording states.
- [Desktop shell forms and the orb profile](../../../.agents/notes/proposed/architecture/2026-11-14-desktop-shell-forms-and-orb-profile.md) — the window, presentation, and voice design this package belongs to.

-----

<a id="model-experience"></a>
## Model Experience

None, as the orb and the chat dialog render process-local presentation state without contributing model input.

#### KV Cache effect

No direct effect; ordinary user submission owns every model-visible message.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- No orb context menu. The orb carries only the click, the drag, and the microphone button; pinning, playback mute, the auto-speak policy, and voice selection have no form UI, and the playback service keeps its configured defaults.
- No attention badge. Pending approvals and questions keep rendering inside the conversation, and the orb does not count or badge them, which also means the carrier's attention-driven expansion has nothing to trigger from this package.
- No reply transcript. The dialog shows only prompt entry; conversation history and assistant replies stay out of the form, and voice playback is the only in-form way to hear an answer.
- Voice controls require the sibling packages. Without the capture package the orb hides its microphone button and the dialog has no voice toggle; without the playback package the orb only stays idle.
- Desktop form profiles only. A Web page keeps the classic presentation, so no page-level orb fallback exists here.
- Light-theme and reduced-motion scenes were not inspected in the assembled form window; the dark-theme orb, chat dialog, and Escape transition are covered by driven component and plugin tests, and a light/reduced-motion review still belongs with the form carrier.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
