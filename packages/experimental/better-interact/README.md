---
description: "Agent output bubbles and the workbench dialog for the Desktop orb form: live agent text above the orb, the conversation without shell side panels."
kind: "package-reference"
---

# @deepseek-ai/dsh-better-interact

English | [中文](README.zh.md)

## Summary

The orb form's agent interactivity: a `shell.overlay` entry with history bubbles for completed answers and a streaming bubble for the answer being written, above the orb; plus a workbench dialog without the shell's side panels. A streaming bubble raises the column and holds it until the agent stops; history bubbles follow the pointer on the orb or the column, and the column leaves half a second after the pointer is off both. Bubbles enter and leave from the right, newest first. The workbench renders the shared Conversation content with the Chat view alone, plus a rebindable command.

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

The overlay entry `better-interact.bubbles` binds the Session the catalog lists first, retains it through the `betterinteract` resource, and renders its bubbles only while the carrier presents the `bubbles` presentation in the bubble column window. Two categories share the same stack: history bubbles for completed answers and a streaming bubble for the answer being written. History bubbles raise the column when the pointer enters the resident orb, and the column leaves half a second after the pointer is off both the orb and the column; hovering either one cancels the countdown. The streaming bubble raises the column on its own as soon as answer text arrives and keeps it until the agent stops, even while the pointer is elsewhere. A streaming column the pointer is away from shows only the streaming bubble; hovering the orb or the column expands the history above it. Each bubble previews at most seven lines and marks the omitted remainder with an ellipsis, and bubbles pop in and out from the right 230ms apart, lifting slightly while hovered. The column lives in its own window while the orb and the surface window keep theirs, so no presentation replaces another. Each bubble opens the workbench, which the carrier raises over the surface window and restores on dismissal; the open workbench holds the column, and closing it resumes the half-second rule.

The modal entry `better-interact.workbench` renders the workbench dialog for the catalog's current Session: the shared Conversation content in its embedded variant with the Chat view alone, so no sidebar, right panel, or title bar appears. The dialog marks itself `data-shell-modal-fill`, so the frame gives the card the dialog height, and it asks the carrier for four fifths of the work area height and scrolls its own transcript. The `betterInteract.workbench` command, bound by default to Ctrl+Alt+W on Windows and macOS, opens the same dialog and is rebindable in Settings. On Windows and macOS Desktop, Ctrl+N inside the open workbench starts a new workbench conversation: the shared New Session command creates a fresh Session instead of reopening the blank hidden behind the dialog, and the dialog follows the catalog to it. An empty catalog renders the dialog's empty state instead of a conversation.

## Understand the implementation

The bubble text comes from the Chat target of the bound Session: one entry per loaded Turn from its navigation previews, plus the streaming prefix from the partial accumulator while the agent writes. The newest live partial is the streaming bubble; every committed assistant message is a history bubble, and each bubble carries `data-kind` so the categories are addressable. The stack owns its sequencing inside one component: each bubble carries a per-bubble animation delay, so the column pops in and out from the right, newest answer first. A half-second leave timer runs only when neither the orb nor the column is hovered, no run is active, and the workbench modal is closed; while output streams, the column stays and the streaming bubble remains on screen. A committed message while the run continues becomes a history bubble and the column stays for the rest of the run. The preview helper caps a bubble at seven lines or 190 characters and appends an ellipsis to anything it omits; the workbench always shows the complete answer. `surface.presentBubbles()` and `surface.dismissBubbles()` are the only carrier commands the entry issues, so a profile without a form carrier keeps the classic presentation. Each renderer reports pointer activity for its own window: the orb window reports the orb hover, and the bubble column window reports whether the pointer is over the stack. Main publishes the hover in every surface snapshot; the orb window's overlay asks for the column when the hover turns true, and the orb window's stack asks for it when a streaming answer appears. The orb window keeps that stack mounted for both triggers; the column window mounts its stack only while the column is up, and the surface window renders none. The column is independent of the surface presentation, so an open panel or modal neither replaces it nor dismisses it.

The workbench reuses `conversation.content` through `renderFactorySlot` rather than composing transcript parts itself; only the View ring is replaced with the Chat view, which is what removes the side panels without forking the conversation. The `bubbles` presentation, its window geometry, and its click-through live in `apps/desktop`; the plugin only asks for it.

## Further Exploration

- [client-surface](../../client/surface/README.md): the presentation protocol and the carrier service.
- [ui-layout](../../client/ui-layout/README.md): the frame that renders overlays and the modal layer.
- [ui-conversation](../../client/ui-conversation/README.md): the Conversation target and View contracts.
- [client-ui-orb](../client-ui-orb/README.md): the orb chrome the column stands in for while it is visible.


## Dev Note

The column's timing constants are driven by fake timers in its component spec; the `bubbles` window role, the column presentation, and the workbench hold rule are covered by the Desktop surface-controller spec.

## Model Experience

None, as the package sends no model request, registers no tool, and adds no model-visible input.

#### KV Cache effect

No direct effect; the bubbles and the workbench only read Session events the transcript already renders.

## Known Limitations and Deferred Work

- The column reports the Session the catalog lists first, so a second Session that produces output while another is ahead in the catalog is not reported.
- The column has its own window, so a panel or modal presentation never replaces it; a column requested while the workbench modal is up appears when the modal closes.
- A tool-only phase before the first answer text shows no streaming bubble; the column appears when answer text starts.
- History is limited to the Turn previews in the loaded window, so scrolling further back in the transcript does not extend it.
