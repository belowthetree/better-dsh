---
description: "Agent output bubbles and the workbench dialog for the Desktop orb form: live agent text at the right edge, the conversation without shell side panels."
kind: "package-reference"
---

# @deepseek-ai/dsh-better-interact

English | [中文](README.zh.md)

## Summary

The orb form's agent interactivity: a `shell.overlay` entry that reports agent output as a bubble column at the display's right edge, and a `shell.modal` entry that hosts the current conversation in a workbench dialog without the shell's side panels. The bubble column shows the answer being written, keeps the newest answer for three seconds after the output settles, and expands the earlier answers while the pointer rests on it. The workbench renders the shared Conversation content with the Chat view alone, plus a rebindable command that opens it.

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

The overlay entry `better-interact.bubbles` binds the Session the catalog lists first, retains it through the `betterinteract` resource, and renders its bubbles only while the carrier presents the `bubbles` presentation. While the agent streams an answer, the entry asks the carrier for that presentation; the carrier places the column at the work area's right edge without taking focus, so it can appear while the user works in another application. The column draws the newest answer as one card and fades three seconds after the output settles, then returns the carrier to the orb. Resting the pointer on the column expands the earlier answers upward and keeps them open; three seconds after the pointer leaves, the column collapses back to the newest answer. Each bubble opens the workbench, which the carrier raises over the column and restores on dismissal.

The modal entry `better-interact.workbench` renders the workbench dialog for the catalog's current Session: the shared Conversation content in its embedded variant with the Chat view alone, so no sidebar, right panel, or title bar appears. The `betterInteract.workbench` command, bound by default to Ctrl+Alt+W on Windows and macOS, opens the same dialog and is rebindable in Settings. An empty catalog renders the dialog's empty state instead of a conversation.

## Understand the implementation

The bubble text comes from the Chat target of the bound Session: one entry per loaded Turn from its navigation previews, plus the streaming prefix from the partial accumulator while the agent writes. The stack owns its timers inside one component: two effects keep the column on screen while output is in progress and schedule the fade and the dismissal after it settles, and a third schedules the collapse after the pointer leaves. `surface.presentBubbles()` and `surface.dismissBubbles()` are the only carrier commands the entry issues, so a profile without a form carrier keeps the classic presentation.

The workbench reuses `conversation.content` through `renderFactorySlot` rather than composing transcript parts itself; only the View ring is replaced with the Chat view, which is what removes the side panels without forking the conversation. The `bubbles` presentation, its window geometry, and its click-through live in `apps/desktop`; the plugin only asks for it.

## Further Exploration

- [client-surface](../../client/surface/README.md): the presentation protocol and the carrier service.
- [ui-layout](../../client/ui-layout/README.md): the frame that renders overlays and the modal layer.
- [ui-conversation](../../client/ui-conversation/README.md): the Conversation target and View contracts.
- [client-ui-orb](../client-ui-orb/README.md): the orb chrome the column stands in for while it is visible.

## Model Experience

None, as the package sends no model request, registers no tool, and adds no model-visible input.

#### KV Cache effect

No direct effect; the bubbles and the workbench only read Session events the transcript already renders.

## Known Limitations and Deferred Work

- The column reports the Session the catalog lists first, so a second Session that produces output while another is ahead in the catalog is not reported.
- The `bubbles` presentation replaces the orb while it is visible; the orb returns when the column fades or is dismissed.
- History is limited to the Turn previews in the loaded window, so scrolling further back in the transcript does not extend it.

## Dev Note

The column's timing constants are driven by fake timers in its component spec; the `bubbles` presentation and its window geometry are covered by the Desktop form-window and surface-controller specs.
