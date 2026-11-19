---
description: "Desktop orb-form agent surface: ambient answer bubbles above the resident orb, and a floating workspace-paged workbench with Session bookmarks and keyboard shortcuts."
kind: "package-reference"
---

# @deepseek-ai/dsh-better-interact

English | [中文](README.zh.md)

## Summary

Better DSH turns the agent from a place you visit into a presence on the desktop. A resident orb keeps the agent present; answers rise beside it as bubbles, and Ctrl+Alt+W opens a floating workbench where each Workspace is a page and each Session a bookmark. Keyboard-first: Ctrl+Tab for Workspaces, Ctrl+Q for Session navigation, Ctrl+Alt+N to add a Workspace from a folder; right-clicking a Session bookmark opens the shared Session menu, including archive. It reuses the shell's conversation, so transcripts, tools, and the composer are unchanged. It is a Desktop orb-form experience, not a replacement for the classic shell.

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

Better DSH is built on three ideas. **Presence over navigation**: an agent used all day should not sit behind a window, so the orb stays resident and the workbench opens over it. **Ambient output**: the answer being written rises beside the orb as a streaming bubble and completed answers join the history there, so progress never needs a window switch. **The Workspace as the unit of work**: the workbench gives every Workspace a page, and the page's Sessions become bookmarks beside the conversation.

The orb stays resident on the desktop. Pointer entry raises the history column; a streaming answer raises it on its own and keeps it up until the agent stops. A bubble opens the workbench, which floats over the surface window and restores the previous presentation when dismissed.

The workbench is the wide, chrome-less surface: Fluent cards for the Workspace pages above a centered conversation panel, and the page's Sessions as bookmark cards outside the panel's left edge. The current Session carries the accent bar; the keyboard cursor carries an independent selection ring. Ctrl+Tab and Shift+Ctrl+Tab cycle pages. Ctrl+Q moves focus to the bookmarks; the arrow keys move the selection without switching, and Enter opens the focused Session. Ctrl+Alt+N picks a folder and adds or reuses a Workspace page, and Ctrl+N creates a Session in the active page's Workspace. Hovering a card or a bookmark shows its full label and the bound shortcut. The dialog restores the last page and Session when it reopens.

### When to choose it

Choose Better DSH for a Desktop workflow where the agent should stay present and the conversation should be reachable from the keyboard without a classic shell around it. Choose the classic shell, or compose [ui-conversation](../../client/ui-conversation/README.md) directly, when the sidebar, panels, and title bar are part of the workflow or when no orb presentation exists.

### Minimal configuration

Add the `better-interact` row to a profile whose form declares the orb presentation, together with [client-surface](../../client/surface/README.md), the surface-aware [ui-layout](../../client/ui-layout/README.md), and [client-ui-workspace](../../client/ui-workspace/README.md). The package injects `surface`, `slots`, `locale`, `shortcuts`, `resources`, `sessions`, `workspaces`, and `uiWorkspace`, and takes no configuration fields.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin places two entries in the frame: the `shell.overlay` bubbles entry in the orb and bubble-column windows, and the `shell.modal` workbench entry in the surface window. The bubble column reads the Chat target of the Session the catalog lists first; committed assistant messages become history bubbles, and the live partial is the streaming bubble. The stack owns its sequencing and the half-second leave rule, and it asks the carrier for the `bubbles` presentation through `surface.presentBubbles()` and `surface.dismissBubbles()`.

The workbench reuses `conversation.content` through `renderFactorySlot`, replacing only the View ring with the Chat view; that is what removes the shell chrome without forking the conversation. The pages are a persisted snapshot store under `dsh.better-interact.workbench-pages.v1`: the active Workspace and the Session each page records. Activating a page opens the remembered or newest Session through the injected `uiWorkspace` navigation service; a Workspace without a Session connects its blank. The plugin records the main view's retained Session on its Workspace page, selects that page while the dialog is open, and prunes both pages and Session choices against the Workspace and Session catalogs. The focus command only raises a counter in the dialog's inject face; the component moves focus, paints the cursor ring as component-local state, and opens the focused Session on Enter. The shortcut hints come from the effective entries in the shortcut catalog.

| Area | Source |
|---|---|
| Entries, commands, pages | [src/client/index.ts](src/client/index.ts) |
| Bubble column | [src/client/bubbles.tsx](src/client/bubbles.tsx) |
| Workbench dialog | [src/client/workbench.tsx](src/client/workbench.tsx) |
| Page store | [src/client/workbench-pages.ts](src/client/workbench-pages.ts) |
| Desktop windows and presentations | [apps/desktop](../../../apps/desktop/README.md) |

</details>

<a id="further-exploration"></a>
## Further Exploration

- [client-surface](../../client/surface/README.md): the presentation protocol and the carrier service.
- [ui-layout](../../client/ui-layout/README.md): the frame that renders overlays and the modal layer.
- [ui-conversation](../../client/ui-conversation/README.md): the Conversation target and View contracts.
- [client-ui-orb](../client-ui-orb/README.md): the orb chrome the column stands in for while it is visible.

<a id="model-experience"></a>
## Model Experience

None, as the package sends no model request, registers no tool, and adds no model-visible input.

#### KV Cache effect

No direct effect; the bubbles and the workbench only read Session events the transcript already renders.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The column reports the Session the catalog lists first, so a second Session that produces output while another is ahead in the catalog is not reported.
- The column has its own window, so a panel or modal presentation never replaces it; a column requested while the workbench modal is up appears when the modal closes.
- A tool-only phase before the first answer text shows no streaming bubble; the column appears when answer text starts.
- History is limited to the Turn previews in the loaded window, so scrolling further back in the transcript does not extend it.
- The strip shows every Workspace in the catalog; activating a Workspace that has no Session connects its blank, which may create a Session in it.
- Each page records one Session per Workspace. The main view's retained Session replaces that record, so a Session opened outside this dialog becomes the page's Session instead of staying a separate page.
- The pages store is browser storage shared by the form's renderers; only the surface window changes it, so the orb and bubble renderers hold stale copies until a reload.
- Ctrl+Tab, Ctrl+Q, and Ctrl+Alt+N are bound on Windows and macOS Desktop only; Desktop main consumes the chords while the orb profile runs even when the dialog is closed.

<a id="dev-note"></a>
### Dev Note

The column's timing constants are driven by fake timers in its component spec; the `bubbles` window role, the column presentation, and the workbench hold rule are covered by the Desktop surface-controller spec.
