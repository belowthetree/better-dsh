---
description: "Orb form chrome for the desktop shell: floating orb, centered chat dialog, and system commands."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-orb

English | [中文](README.zh.md)

## Summary

The orb form's client plugins: a floating orb overlay with an appearance and theme menu, a centered quick chat dialog whose accepted prompt raises a management workbench on the dedicated `manage` conversation, and the system-scope `orb.toggle`, `orb.workbench`, and `voice.pushToTalk` commands. The orb profile renders no classic frame; voice capture and playback states appear when the sibling service packages are mounted. The dialog's voice toggle records on the shared capture service and appends the recognized text to its input instead of submitting it.

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

Add the `client-ui-orb` row to a profile whose form declares the orb presentation, together with [client-surface](../../client/surface/README.md) and the surface-aware [ui-layout](../../client/ui-layout/README.md). The package injects `surface`, `slots`, `locale`, `shortcuts`, `sessions`, and `theme`, and reads the optional `workspaces` and `settingsUi` services to place the management conversation in the Host default Workspace and to open the settings panel; the Desktop carrier owns window geometry, transparency, click-through, and presentation transitions, so the renderer only reports intent. The chat resolves its management Session under the `manage` Agent preset, which the [better bundle](../better-bundle/README.md) declares with the read-only [session-query tools](../tool-session-query/README.md) and without file-write or shell plugins.

The overlay entry draws only in the snapshot's `orb` role and renders nothing in the `surface` window, the bubble column window, or a classic window, so a panel, bubble column, or modal presented beside the orb never replaces it. In the orb window it draws one square button showing the selected artwork set, the docked peek while the surface snapshot reports `orbDocked` and the free-standing pose otherwise, and publishes its visual state as data attributes: `data-orb` carries `data-state` (`idle`, `capturing`, `transcribing`, `speaking`, or `running`), `data-appearance` (`cute` or `mature`), and `data-reduced-motion`, while the button carries `data-hovered`, `data-pressed`, and `data-dragging`. Each state has its own localized accessibility label. Clicking presents the centered chat dialog; dragging past four logical pixels reports throttled deltas through `surface.dragBy` and suppresses the click it would have produced. Releasing a drag whose orb rests within the snap gap of a work-area edge snaps it flush to that edge. Entering or leaving the orb and its drag handle reports `surface.setPointerInside` so the carrier can pass clicks through elsewhere. A secondary click opens the menu inside the square: the management workbench, the settings panel, the cute or mature artwork set, and the light, dark, or system theme preference, with the chosen set persisted in the orb window. The Settings row calls the optional `settingsUi` service, which raises the settings modal in the surface window and shows the desktop application's settings panel. Escape, a click elsewhere in the orb window, or the orb window losing focus to the desktop or another application closes the menu without a carrier command; session creation and quitting stay with the Desktop shell.

The `shell.modal` entry `orb.chat` renders the quick chat dialog inside the frame's focus-trapped modal layer: a "Manage conversation" heading, one auto-focused textarea, a voice input toggle, and a send button. The dialog draws its own surface — a Fluent card on the shared composer's material: the elevated input fill, a hairline stroke, a two-pixel accent underline while the draft has focus, a hairline above the control row, the 34-pixel info-fill send circle, and the 28-pixel ghost microphone — so it reads as the same control as the workbench prompt. It marks the frame's modal card bare so the frame keeps only the dismissal layer, focus trap, and dismissal. Enter submits, Shift+Enter inserts a newline, and Escape or a backdrop click dismisses the presentation through the frame. A successful submission clears the box and raises the management workbench in place of the dialog, while a rejected one keeps the text and shows a localized failure line inside the box. The prompt goes through the injected `sessions` service to the orb's management Session: the Session runs the `manage` preset in the Host default Workspace and is remembered in the orb window, so the chat stays one dedicated management conversation. While the capture service is mounted, the microphone toggle starts a recording, shows the requesting, recording, and transcribing states, and appends a finished transcript to the end of the input without inserting a separator or submitting it; without that service the toggle is absent and the box keeps working as a plain prompt. Closing the dialog while it records discards the recording this box started.

The `shell.modal` entry `orb.workbench` is the management conversation's workbench: a wide card holding only that Session's Chat view, without the general workbench's Workspace pages and Session bookmarks. It composes the shared `conversation.content` factory in its embedded form and fixes the visible View to the Chat transcript, so the composer, streaming answer, tool cards, approvals, and questions come from the conversation packages instead of this package. The modal's injected face carries the retained management `SessionReference`; the plugin retains it when the carrier snapshot reports this modal and releases it when the card closes. A prompt accepted by the quick dialog raises this workbench, and the orb's settings menu and the `orb.workbench` command present it again without sending anything.

`orb.open` is a `scope: 'system'` command bound by default to Ctrl+Alt+D on Windows and macOS: it presents the chat dialog and focuses its input, and presenting again while it is open leaves it in place. Rebind it in Settings, General, Global; Linux keeps its focused-window model and reports no OS-global registration. `orb.toggle` is a second system command with no default binding: resolving it presents the chat dialog while the snapshot reports `orb`, dismisses the modal presentation otherwise, and collapses the panel presentation back to the orb, so one command both opens and hides the form. `orb.workbench` is a third system command with no default binding: it presents the management workbench, which the menu's first row also opens. `voice.pushToTalk` is a fourth system command with no default binding: it starts a capture while idle and otherwise finishes the active one, so a global key dictates without opening the dialog. The settings modal has no command in this package; the menu row and the settings shell's own `settings.open` command reach it. `ctx.shortcuts` owns OS registration and reports conflicts.

Optional services keep the same chrome working alone. When [client-voice-capture](../client-voice-capture/README.md) is mounted, the orb shows its recording and transcription phases and the dialog offers its voice toggle; when the playback package is mounted, the orb reflects its speaking state. Without either service the orb still opens the dialog, drags, and submits prompts.

## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`apply` registers the eight dictionaries once, then builds one snapshot store per observation: the carrier surface, the reduced-motion media query, each voice service that is mounted, and the client theme preference. The surface observation and the two optional voice observations share one helper that follows a signal-scoped stream into a store and aborts with the fiber; the theme store follows `theme/change` and closes with the fiber; optional services are observed through `ctx.inject`, so unmounting one clears its store and leaves the chrome functional. The overlay, chat, and workbench entries and the workbench's conversation slot register through `ctx.slots.inject`, which waits for the frame's declaration and removes the contribution when that declaration collapses. The commands register through `ctx.shortcuts.register`, whose disposer runs with the plugin. A submission resolves the management Session — the remembered one while the Host still lists it, otherwise a create under the `manage` preset in the Host default Workspace when the optional `workspaces` service initialized one — and retains it through `ctx.sessions.using` with this package's `orbPrompt` reference source before `prompt(content, 'queue')` without a local submission echo because the dialog shows no optimistic transcript. The accepted prompt presents the workbench; a surface-store subscription then retains the same Session through `ctx.sessions.retain` with the `orbChat` source and the conversation facet, stores that reference for the modal's injected face, and releases it when the modal closes or the plugin stops. Every carrier command is issued from one closure that contains rejections and reports them once.

The components receive plain data and callbacks only: `hooks` compartment sources become `useSurface`, `useCapture`, `useVoice`, `useReducedMotion`, and `useTheme` selector hooks, the standard `useSessions` seat supplies the running state, and `actions` carries the callbacks. The overlay face carries `openChat`, `openWorkbench`, `openSettings`, the drag command, `toggleVoice`, and `setTheme`; the chat face additionally carries `takeTranscript`, `submit`, and the dictation commands over the shared capture service, so the dialog never owns a recorder; the workbench face carries the retained conversation reference, and its conversation entry composes the shared `conversation.content` factory. Drag state, hover, pressed, the artwork set, and the menu visibility are local component state, while the docked pose follows the carrier's surface snapshot; the drag hook coalesces pointer movement into one report per animation frame, measures it in screen coordinates so the carrier moving the window under the pointer cannot cancel the next delta, and flushes the remainder on release, which is also what decides whether the gesture counts as a drag. The dialog's text, submission failure, and dictation notice are local component state; a transcript append is the only write into that text from outside the input.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [client-surface](../../client/surface/README.md) — the presentation snapshot and carrier commands this overlay issues.
- [ui-layout](../../client/ui-layout/README.md) — the frame that declares `shell.overlay` and `shell.modal` and owns the modal presentation.
- [ui-conversation](../../client/ui-conversation/README.md) — the shared conversation factory the management workbench composes.
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

- The settings menu is deliberately small. It opens the management workbench and the settings modal, and it switches the artwork set and the theme preference; pinning, playback mute, the auto-speak policy, voice selection, session creation, and quitting have no form UI, and the playback service keeps its configured defaults.
- No settings page of its own. The settings modal renders the desktop application's settings sections through the optional `settingsUi` service; this package only asks for it, and the appearance choice stays orb-local instead of becoming a settings row.
- No attention badge in the orb itself. Pending approvals and questions stay in the conversation, and better-interact's speech balloon reports them beside the orb; this package only renders the orb chrome.
- No quick-dialog transcript. The dialog shows only prompt entry; the accepted prompt raises the management workbench, which owns the conversation history, streaming answer, and follow-up composer.
- The workbench card is intentionally single-Session. It has no Workspace strip, Session bookmarks, or page selection; those stay in the general workbench, and this card always binds the orb's management conversation.
- Voice controls require the sibling packages. Without the capture package the orb has no recording or transcription states and the dialog has no voice toggle; without the playback package the orb only stays idle.
- The management chat is read-only and single-workspace. Its preset carries the session-query read tools but no file writes, shell, terminal, subagent, or goal tools; the session-query authority exposes the Host default workspace only, so sessions in other workspaces stay unreadable and the chat cannot prompt another conversation.
- Desktop form profiles only. A Web page keeps the classic presentation, so no page-level orb fallback exists here.
- Light-theme and reduced-motion scenes were not inspected in the assembled form window; the dark-theme orb, chat dialog, and Escape transition are covered by driven component and plugin tests, and a light/reduced-motion review still belongs with the form carrier.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
