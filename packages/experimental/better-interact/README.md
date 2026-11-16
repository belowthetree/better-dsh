---
description: "Agent output bubbles and the workbench dialog for the Desktop orb form: live agent text above the orb, the conversation without shell side panels."
kind: "package-reference"
---

# @deepseek-ai/dsh-better-interact

English | [中文](README.zh.md)

## Summary

The orb form's agent interactivity: a `shell.overlay` entry with history bubbles for completed answers and a streaming bubble for the answer being written, above the orb; plus a workbench dialog without the shell's side panels. The streaming bubble raises the column on its own and stays until the agent stops; history bubbles appear while the pointer is on the orb or the column, and the column leaves half a second after the pointer is off both. Bubbles pop in and out from the right in sequence from the newest answer outward. The workbench renders the shared Conversation content with the Chat view alone, plus a rebindable command that opens it.

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

Add the `better-interact` row to a profile whose form declares the orb presentation, together with [client-surface](../../client/surface/README.md) and the surface-aware [ui-layout](../../client/ui-layout/README.md). The package injects `surface`, `slots`, `locale`, `shortcuts`, `resources`, and `sessions`.

The overlay entry `better-interact.bubbles` binds the Session the catalog lists first, retains it through the `betterinteract` resource, and renders its bubbles only while the carrier presents the `bubbles` presentation. Two categories share the same stack: history bubbles for completed answers and a streaming bubble for the answer being written. History bubbles raise the column when the pointer enters the resident orb, and the column leaves half a second after the pointer is off both the orb and the column; hovering either one cancels the countdown. The streaming bubble raises the column on its own as soon as answer text arrives and keeps it until the agent stops, even while the pointer is elsewhere. A streaming column the pointer is away from shows only the streaming bubble; hovering the orb or the column expands the history above it. Each bubble previews at most seven lines and marks the omitted remainder with an ellipsis, and bubbles pop in and out from the right 230ms apart, lifting slightly while hovered. The column renders in the surface window while the orb keeps its own window, so neither surface replaces the other. Each bubble opens the workbench, which the carrier raises over the surface window and restores on dismissal.

The modal entry `better-interact.workbench` renders the workbench dialog for the catalog's current Session: the shared Conversation content in its embedded variant with the Chat view alone, so no sidebar, right panel, or title bar appears. The dialog marks itself `data-shell-modal-fill`, so the frame gives the card the dialog height, and it asks the carrier for four fifths of the work area height and scrolls its own transcript. The `betterInteract.workbench` command, bound by default to Ctrl+Alt+W on Windows and macOS, opens the same dialog and is rebindable in Settings. An empty catalog renders the dialog's empty state instead of a conversation.

## Understand the implementation

The bubble text comes from the Chat target of the bound Session: one entry per loaded Turn from its navigation previews, plus the streaming prefix from the partial accumulator while the agent writes. The newest live partial is the streaming bubble; every committed assistant message is a history bubble, and each bubble carries `data-kind` so the categories are addressable. The stack owns its sequencing inside one component: each bubble carries a per-bubble animation delay, so the column pops in and out from the right, newest answer first. A half-second leave timer runs only when neither the orb nor the column is hovered and no run is active; while output streams, the column stays and the streaming bubble remains on screen. A committed message while the run continues becomes a history bubble and the column stays for the rest of the run. The preview helper caps a bubble at seven lines or 190 characters and appends an ellipsis to anything it omits; the workbench always shows the complete answer. `surface.presentBubbles()` and `surface.dismissBubbles()` are the only carrier commands the entry issues, so a profile without a form carrier keeps the classic presentation. The orb window's renderer reports pointer activity only for the snapshot's `orb` role. Main publishes that hover in every surface snapshot; the orb window's overlay asks for the column when it turns true, and the surface stack requests the column itself when a streaming answer appears. The column never replaces an open panel or modal.

The workbench reuses `conversation.content` through `renderFactorySlot` rather than composing transcript parts itself; only the View ring is replaced with the Chat view, which is what removes the side panels without forking the conversation. The `bubbles` presentation, its window geometry, and its click-through live in `apps/desktop`; the plugin only asks for it.

## Further Exploration

- [client-surface](../../client/surface/README.md): the presentation protocol and the carrier service.
- [ui-layout](../../client/ui-layout/README.md): the frame that renders overlays and the modal layer.
- [ui-conversation](../../client/ui-conversation/README.md): the Conversation target and View contracts.
- [client-ui-orb](../client-ui-orb/README.md): the orb chrome the column stands in for while it is visible.


## Dev Note

The column's timing constants are driven by fake timers in its component spec; the `bubbles` presentation and its window geometry are covered by the Desktop form-window and surface-controller specs.

## Model Experience

None, as the package sends no model request, registers no tool, and adds no model-visible input.

#### KV Cache effect

No direct effect; the bubbles and the workbench only read Session events the transcript already renders.

## Known Limitations and Deferred Work

- The column reports the Session the catalog lists first, so a second Session that produces output while another is ahead in the catalog is not reported.
- The column renders in the surface window; a panel or modal presented there is not replaced by a hovered orb.
- A tool-only phase before the first answer text shows no streaming bubble; the column appears when answer text starts.
- History is limited to the Turn previews in the loaded window, so scrolling further back in the transcript does not extend it.
