---
description: "Agent output bubbles and the workbench dialog for the Desktop orb form: live agent text above the orb, the conversation without shell side panels."
kind: "package-reference"
---

# @deepseek-ai/dsh-better-interact

English | [中文](README.zh.md)

## Summary

The orb form's agent interactivity: a `shell.overlay` entry that reports agent output as a bubble column above the orb, and a `shell.modal` entry that hosts the current conversation in a workbench dialog without the shell's side panels. The bubble column appears when the pointer enters the orb, pops in and out from the right in sequence from the newest answer outward, stays while the pointer is on the orb or the column, and expands the earlier answers on hover. The workbench renders the shared Conversation content with the Chat view alone, plus a rebindable command that opens it.

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

The overlay entry `better-interact.bubbles` binds the Session the catalog lists first, retains it through the `betterinteract` resource, and renders its bubbles only while the carrier presents the `bubbles` presentation. Pointer activity over the resident orb window asks the carrier for that presentation; the carrier places the column above the orb's own window without taking focus, so it can appear while the user works in another application. The column draws the newest answer as one card, previewing at most seven lines and marking the omitted remainder with an ellipsis. Bubbles pop in from the right one after another, 230ms apart from the newest answer outward, and a hovered bubble lifts slightly. Resting the pointer on the column expands the earlier answers upward and keeps them open. The column leaves half a second after the pointer is off both the orb and the column, popping every bubble out to the right in the same order; hovering either one cancels the countdown. The column renders in the surface window while the orb keeps its own window, so neither surface replaces the other. Each bubble opens the workbench, which the carrier raises over the surface window and restores on dismissal.

The modal entry `better-interact.workbench` renders the workbench dialog for the catalog's current Session: the shared Conversation content in its embedded variant with the Chat view alone, so no sidebar, right panel, or title bar appears. The dialog marks itself `data-shell-modal-fill`, so the frame gives the card the dialog height, and it asks the carrier for four fifths of the work area height and scrolls its own transcript. The `betterInteract.workbench` command, bound by default to Ctrl+Alt+W on Windows and macOS, opens the same dialog and is rebindable in Settings. An empty catalog renders the dialog's empty state instead of a conversation.

## Understand the implementation

The bubble text comes from the Chat target of the bound Session: one entry per loaded Turn from its navigation previews, plus the streaming prefix from the partial accumulator while the agent writes. The stack owns its sequencing inside one component: each bubble carries a per-bubble animation delay, so the column pops in and out from the right, newest answer first; the orb or the column under the pointer keeps the bubbles, and a half-second leave timer starts the ordered exit. The preview helper caps a bubble at seven lines or 190 characters and appends an ellipsis to anything it omits; the workbench always shows the complete answer. `surface.presentBubbles()` and `surface.dismissBubbles()` are the only carrier commands the entry issues, so a profile without a form carrier keeps the classic presentation. The orb window's renderer reports pointer activity only for the snapshot's `orb` role. Main publishes that hover in every surface snapshot; the orb window's overlay asks for the column when it turns true, and the surface stack starts the half-second leave timer when neither the orb nor the column is hovered. The column never replaces an open panel or modal.

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
- The column does not appear on its own for new output; the pointer must enter the orb.
- The hover request re-arms only when the pointer leaves the orb window, so a pointer resting on the orb does not reopen a column that has just left.
- History is limited to the Turn previews in the loaded window, so scrolling further back in the transcript does not extend it.
