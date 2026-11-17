---
description: "Agent output bubbles and the workbench dialog for the Desktop orb form: live agent text above the orb, the conversation without shell side panels."
kind: "package-reference"
---

# @deepseek-ai/dsh-better-interact

English | [中文](README.zh.md)

## Summary

The orb form's agent interactivity: a `shell.overlay` entry with history bubbles and the answer being written above the orb; plus a workbench dialog hosting one card per workbench and no shell side panels. A streaming bubble raises the column and holds it until the agent stops; history bubbles follow the pointer on the orb or the column, and the column leaves half a second after it is on neither. The workbench renders the shared Conversation content with the Chat view alone; Ctrl+Tab switches cards, and Ctrl+Alt+W reopens the most recently used one.

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

The modal entry `better-interact.workbench` shows the workbench as a strip of cards above the shared Conversation content in its embedded variant with the Chat view alone, so no sidebar, right panel, or title bar appears: one card per Session the dialog has hosted, in the order they were opened, with the active card ringed. A card names its Session, or the localized New Session label while that Session is still blank; clicking a card switches the dialog, and the strip scrolls horizontally once it overflows. The dialog marks itself `data-shell-modal-fill` and `data-shell-modal-surface="bare"`, so the frame gives it the dialog height while the cards stand on the transparent window above the conversation panel. It asks the carrier for four fifths of the work area height, and the conversation panel scrolls its own transcript. `betterInteract.workbench` opens the most recently used card and is bound by default to Ctrl+Alt+W on Windows and macOS; `betterInteract.workbench.next` and `betterInteract.workbench.previous`, bound to Ctrl+Tab and Shift+Ctrl+Tab, cycle the cards while the dialog is open. Each bubble opens its own Session's card. On Windows and macOS Desktop, Ctrl+N inside the open workbench starts a new workbench conversation: the shared New Session command creates a fresh Session instead of reopening the blank hidden behind the dialog, and the strip appends and selects that Session. The strip persists, so reopening the dialog returns to the card used last. An empty catalog renders the dialog's empty state and no strip.

## Understand the implementation

The bubble text comes from the Chat target of the bound Session: one entry per loaded Turn from its navigation previews, plus the streaming prefix from the partial accumulator while the agent writes. The newest live partial is the streaming bubble; every committed assistant message is a history bubble, and each bubble carries `data-kind` so the categories are addressable. The stack owns its sequencing inside one component: each bubble carries a per-bubble animation delay, so the column pops in and out from the right, newest answer first. A half-second leave timer runs only when neither the orb nor the column is hovered, no run is active, and the workbench modal is closed; while output streams, the column stays and the streaming bubble remains on screen. A committed message while the run continues becomes a history bubble and the column stays for the rest of the run. The preview helper caps a bubble at seven lines or 190 characters and appends an ellipsis to anything it omits; the workbench always shows the complete answer. `surface.presentBubbles()` and `surface.dismissBubbles()` are the only carrier commands the entry issues, so a profile without a form carrier keeps the classic presentation. Each renderer reports pointer activity for its own window: the orb window reports the orb hover, and the bubble column window reports whether the pointer is over the stack. Main publishes the hover in every surface snapshot; the orb window's overlay asks for the column when the hover turns true, and the orb window's stack asks for it when a streaming answer appears. The orb window keeps that stack mounted for both triggers; the column window mounts its stack only while the column is up, and the surface window renders none. The column is independent of the surface presentation, so an open panel or modal neither replaces it nor dismisses it.

The workbench reuses `conversation.content` through `renderFactorySlot` rather than composing transcript parts itself; only the View ring is replaced with the Chat view, which is what removes the side panels without forking the conversation. The strip is a persisted snapshot store under `dsh.better-interact.workbenches.v1`: showing a Session appends its card, the active card follows clicks and the cycle commands, cards whose Session leaves the catalog are dropped, and the oldest card is dropped past eight. While the dialog is open, a change of the main view's retained Session adds and selects that Session's card, which is how the shared New Session command becomes a new workbench without this package depending on the workspace package. The modal entry receives the strip and its selection action through its inject face; the frame publishes the active modal id as the shortcut context, so the cycle commands resolve only inside this dialog. The `bubbles` presentation, its window geometry, and its click-through live in `apps/desktop`; the plugin only asks for it.

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
- Workbench cards come only from the dialog's own paths: a bubble click, the launcher while no card exists, or New Session while the dialog is open. A Session opened by another window or by the classic shell does not become a card.
- The strip keeps at most eight cards; adding a ninth drops the oldest even if that Session is still running.
- The strip is browser storage shared by the form's renderers; only the surface window changes it, so the orb and bubble renderers hold stale copies until a reload.
- Ctrl+Tab is bound on Windows and macOS Desktop only, where Desktop main consumes the chord while the orb profile runs even when the dialog is closed.
