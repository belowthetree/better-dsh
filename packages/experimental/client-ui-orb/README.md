---
description: "Orb form chrome for the desktop shell: floating orb, expanded chat box, quick voice settings, and system commands."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-orb

English | [中文](README.zh.md)

## Summary

The orb form's client plugins: one `shell.overlay` entry that draws a 112-pixel floating orb in the orb presentation and a compact chat box in the panel presentation, one `shell.modal` entry for the form's quick voice settings card, and the system-scope `orb.toggle` and `voice.pushToTalk` commands. The orb profile renders no classic frame: the expanded box sends prompts into the conversation catalog and collapses after acceptance, while voice capture and playback states appear when the sibling service packages are mounted. Every control stays usable without them.

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

The overlay entry follows the carrier's presentation. In `orb` it draws one circular button whose visual state is published as data attributes: `data-orb` carries `data-state` (`idle`, `capturing`, `transcribing`, `speaking`, or `running`) and `data-reduced-motion`, while the button carries `data-hovered`, `data-pressed`, and `data-dragging`. Each state has its own localized accessibility label. Clicking expands the panel; dragging past four logical pixels reports throttled deltas through `surface.dragBy` and suppresses the click it would have produced. Entering or leaving the orb and its drag handle reports `surface.setPointerInside` so the carrier can pass clicks through elsewhere. While the capture service is mounted, a smaller microphone button at the orb's lower right starts a capture without opening the box, or finishes it and expands the box, which takes the held transcript into its input. A secondary click opens the compact menu: keep on top or stop keeping on top, mute or unmute playback, cycle the auto-speak policy (off, voice-initiated replies, all replies), start or stop voice capture, and voice settings. The menu closes on selection, Escape, or a click outside it. It carries no new-session or quit entry: session creation stays in the sidebar and quitting stays with the Desktop shell.

In `panel` the entry draws the expanded chat box: one auto-focused textarea and one send button, with no frame chrome, Session title, or conversation. Enter submits, Shift+Enter inserts a newline, and Escape collapses back to the orb. A successful submission clears the box and collapses it, while a rejected one keeps the text and shows a localized failure line inside the box. The prompt goes through the injected `sessions` service to the most recently catalogued Session, creating a blank Session when the catalog is empty. In `classic` and `modal` the entry renders nothing: a profile without the form needs no chrome, and the frame's modal layer owns its card.

The `shell.modal` entry `orb.quick-setup` renders the form-owned card: the voice catalog with the selected voice marked, a mute toggle, the auto-speak policy, a note that synthesis is a billed cloud request, and Close, which dismisses through `surface.dismissModal()`. Focus, Escape, and the backdrop stay the frame's. While the playback plugin is unmounted, the card explains that voice output is not mounted instead of offering settings, and the orb's menu shows the same note in place of the mute and policy rows.

`orb.toggle` is a `scope: 'system'` command with no default binding: assign one in Settings, General, Global. Resolving it expands the chat box while the snapshot reports `orb` and collapses it otherwise, so the same command opens and hides the form. `voice.pushToTalk` is a second system command with no default binding: it starts a capture while idle and otherwise finishes the active one, so a global key dictates without opening the box. `ctx.shortcuts` owns OS registration and reports conflicts.

Optional services keep the same chrome working alone. When [client-voice-capture](../client-voice-capture/README.md) is mounted, the orb shows its recording and transcription phases; when the playback package is mounted, it shows speaking, mute, policy, and the voice catalog. Without either service the orb still expands, drags, and submits prompts.

## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`apply` registers the eight dictionaries once, then builds one snapshot store per observation: the carrier surface, the reduced-motion media query, and each voice service that is mounted. The surface observation and the two optional voice observations share one helper that follows a signal-scoped stream into a store and aborts with the fiber; optional services are observed through `ctx.inject`, so unmounting one clears its store and leaves the overlay functional. The two entries register through `ctx.slots.inject`, which waits for the frame's declaration and removes the contribution when that declaration collapses. The command registers through `ctx.shortcuts.register`, whose disposer runs with the plugin. A submission retains the target through `ctx.sessions.using` with this package's `orbPrompt` reference source, then calls `prompt(content, 'queue')` without a local submission echo because the box shows no optimistic transcript. Every carrier command is issued from one closure that contains rejections and reports them once.

The components receive plain data and callbacks only: `hooks` compartment sources become `useSurface`, `useCapture`, `useVoice`, and `useReducedMotion` selector hooks, the standard `useSessions` seat supplies the running state, and `actions` carries the callbacks. Drag state, hover, pressed, and the open menu are local component state; the drag hook coalesces pointer movement into one report per animation frame and flushes the remainder on release, which is also what decides whether the gesture counts as a drag. The orb's menu wraps its rows in the shared `MenuSurface` material.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [client-surface](../../client/surface/README.md) — the presentation snapshot and carrier commands this overlay issues.
- [ui-layout](../../client/ui-layout/README.md) — the frame that declares `shell.overlay`, `shell.modal`, and the panel presentation.
- [client-voice-capture](../client-voice-capture/README.md) — the optional capture service behind the recording states.
- [Desktop shell forms and the orb profile](../../../.agents/notes/proposed/architecture/2026-11-14-desktop-shell-forms-and-orb-profile.md) — the window, presentation, and voice design this package belongs to.

-----

<a id="model-experience"></a>
## Model Experience

None, as the orb, the chat box, and the quick setup card render process-local presentation state without contributing model input.

#### KV Cache effect

No direct effect; ordinary user submission owns every model-visible message.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- No new-session or quit entry in the orb menu: session creation belongs to the sidebar's own controls, and quitting stays with the Desktop shell.
- No attention badge. Pending approvals and questions keep rendering inside the conversation, and the orb does not count or badge them, which also means the carrier's attention-driven expansion has nothing to trigger from this package.
- No reply transcript. The box shows only prompt entry; conversation history and assistant replies stay out of the form, and voice playback is the only in-form way to hear an answer.
- The orb's context menu renders inside the orb window. The 112-pixel presentation clips it, so its entries cannot be reached in the orb presentation; a carrier that gives the menu presentation more room makes them reachable, and voice settings stay unreachable until then.
- Voice controls require the sibling packages. Without the playback package the mute and auto-speak policy entries and the voice catalog are unavailable, and the card explains that instead of offering settings.
- Desktop form profiles only. A Web page keeps the classic presentation, so no page-level orb fallback exists here.
- Light-theme and reduced-motion scenes were not inspected in the assembled form window; the dark-theme orb, chat box, menu, and Escape transition are covered by driven component and plugin tests, and a light/reduced-motion review still belongs with the form carrier.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
