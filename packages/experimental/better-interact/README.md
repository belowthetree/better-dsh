---
description: "Agent output bubbles and the workbench dialog for the Desktop orb form: live agent text above the orb, and one conversation page per Workspace without shell side panels."
kind: "package-reference"
---

# @deepseek-ai/dsh-better-interact

English | [中文](README.zh.md)

## Summary

The orb form's agent interactivity: a `shell.overlay` entry with history bubbles and the answer being written above the orb; plus a workbench dialog with one page per Workspace and no shell side panels. A streaming bubble raises the column and holds it until the agent stops; history bubbles follow the pointer on the orb or the column, and the column leaves half a second after it is on neither. The workbench renders the shared Conversation content with the Chat view alone; Ctrl+Tab switches Workspace pages, and Ctrl+Alt+W reopens the most recently used one.

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

Add the `better-interact` row to a profile whose form declares the orb presentation, together with [client-surface](../../client/surface/README.md), the surface-aware [ui-layout](../../client/ui-layout/README.md), and [client-ui-workspace](../../client/ui-workspace/README.md). The package injects `surface`, `slots`, `locale`, `shortcuts`, `resources`, `sessions`, `workspaces`, and `uiWorkspace`.

The overlay entry `better-interact.bubbles` binds the Session the catalog lists first, retains it through the `betterinteract` resource, and renders its bubbles only while the carrier presents the `bubbles` presentation in the bubble column window. Two categories share the same stack: history bubbles for completed answers and a streaming bubble for the answer being written. History bubbles raise the column when the pointer enters the resident orb, and the column leaves half a second after the pointer is off both the orb and the column; hovering either one cancels the countdown. The streaming bubble raises the column on its own as soon as answer text arrives and keeps it until the agent stops, even while the pointer is elsewhere. A streaming column the pointer is away from shows only the streaming bubble; hovering the orb or the column expands the history above it. Each bubble previews at most seven lines and marks the omitted remainder with an ellipsis, and bubbles pop in and out from the right 230ms apart, lifting slightly while hovered. The column lives in its own window while the orb and the surface window keep theirs, so no presentation replaces another. Each bubble opens the workbench, which the carrier raises over the surface window and restores on dismissal; the open workbench holds the column, and closing it resumes the half-second rule.

The modal entry `better-interact.workbench` shows one page per Workspace in the catalog, in catalog order, as a strip of Fluent tab cards above the shared Conversation content in its embedded variant with the Chat view alone, so no sidebar, right panel, or title bar appears. The entry asks the carrier for a 1488-pixel dialog: the frame's 1440-pixel wide card centers a 1120-pixel conversation panel, the Session bookmarks sit outside the panel in the left margin, and the matching margin stays empty on the right; a narrower window clamps the card and the panel takes the room beside the bookmarks. The active page is marked by an accent indicator along its card's bottom edge; clicking a card shows that Workspace's page, and a long strip scrolls horizontally. The active page's Sessions appear as a column of bookmark cards to the left of the panel, outside its surface: one single-line card per Session in the Workspace's order, blank Sessions showing the localized New session label, archived Sessions omitted, and the current Session carrying the accent bar; clicking a card switches the conversation. A page shows the Session it last recorded — the main view's Session for that Workspace — or, without one, the Workspace's newest Session; a Workspace with no Session connects its blank when its page is activated. `betterInteract.workbench` opens the most recently used page and is bound by default to Ctrl+Alt+W on Windows and macOS; `betterInteract.workbench.next` and `betterInteract.workbench.previous`, bound to Ctrl+Tab and Shift+Ctrl+Tab, cycle the pages while the dialog is open. `betterInteract.workbench.sessions`, bound by default to Ctrl+Q, moves keyboard focus to the current bookmark; Up/Left and Down/Right move a selection ring between Sessions without switching, and Enter activates the focused bookmark. Hovering a Workspace card or a Session bookmark shows its full label and the bound shortcut in a Fluent tooltip: the next-page key on Workspace cards and the Session focus key on bookmarks. `betterInteract.workspace.new`, bound by default to Ctrl+Alt+N, opens the Host's native folder picker and turns the chosen directory into a Workspace page, reusing the Workspace already registered for that path; a refused pick or creation shows an inline failure line in the dialog. Each bubble opens its own Session's page. On Windows and macOS Desktop, Ctrl+N inside the open workbench starts a fresh Session in the active page's Workspace: the page activation makes that Workspace's Session the main view, which the shared New Session command targets, and the page records the new Session. The strip persists the active page and each page's Session, so reopening the dialog returns to the page and Session used last. The dialog marks itself `data-shell-modal-fill` and `data-shell-modal-surface="bare"`, so the frame gives it the dialog height while the cards stand on the transparent window above the conversation panel. It asks the carrier for four fifths of the work area height, and the conversation panel scrolls its own transcript. An empty catalog renders the dialog's empty state and no strip.

## Understand the implementation

The bubble text comes from the Chat target of the bound Session: one entry per loaded Turn from its navigation previews, plus the streaming prefix from the partial accumulator while the agent writes. The newest live partial is the streaming bubble; every committed assistant message is a history bubble, and each bubble carries `data-kind` so the categories are addressable. The stack owns its sequencing inside one component: each bubble carries a per-bubble animation delay, so the column pops in and out from the right, newest answer first. A half-second leave timer runs only when neither the orb nor the column is hovered, no run is active, and the workbench modal is closed; while output streams, the column stays and the streaming bubble remains on screen. A committed message while the run continues becomes a history bubble and the column stays for the rest of the run. The preview helper caps a bubble at seven lines or 190 characters and appends an ellipsis to anything it omits; the workbench always shows the complete answer. `surface.presentBubbles()` and `surface.dismissBubbles()` are the only carrier commands the entry issues, so a profile without a form carrier keeps the classic presentation. Each renderer reports pointer activity for its own window: the orb window reports the orb hover, and the bubble column window reports whether the pointer is over the stack. Main publishes the hover in every surface snapshot; the orb window's overlay asks for the column when the hover turns true, and the orb window's stack asks for it when a streaming answer appears. The orb window keeps that stack mounted for both triggers; the column window mounts its stack only while the column is up, and the surface window renders none. The column is independent of the surface presentation, so an open panel or modal neither replaces it nor dismisses it.

The workbench reuses `conversation.content` through `renderFactorySlot` rather than composing transcript parts itself; only the View ring is replaced with the Chat view, which is what removes the side panels without forking the conversation. The pages are a persisted snapshot store under `dsh.better-interact.workbench-pages.v1`: it keeps the active Workspace and the Session each page records, while the cards themselves come from the Workspace catalog. The bookmark column derives from the active page's Workspace session order minus archived Sessions. Activating a page opens its recorded (or newest) Session through the injected `uiWorkspace` navigation service; a Workspace without a Session connects its blank the same way. The focus command only raises a counter in the dialog's inject face, and the component moves focus to the current bookmark; arrow movement stays local to the column, and Enter switches the page's Session. The cursor is component-local presentation state drawn as an outline independent of the focus ring, so it stays visible while the pointer hovers the list. The plugin reads its commands' effective key labels from the shortcut catalog and publishes them as the card hints. The plugin records the main view's retained Session on its Workspace page and, while the dialog is open, selects that page; behind the dialog it only records the Session. Both catalogs prune pages and Session choices whose referents leave. The modal entry receives the pages store and its selection action through its inject face; the frame publishes the active modal id as the shortcut context, so the cycle commands resolve only inside this dialog. The `bubbles` presentation, its window geometry, and its click-through live in `apps/desktop`; the plugin only asks for it.

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
- The strip shows every Workspace in the catalog; activating a Workspace that has no Session connects its blank, which may create a Session in it.
- Each page records one Session per Workspace. The main view's retained Session replaces that record, so a Session opened outside this dialog becomes the page's Session instead of staying a separate page.
- The pages store is browser storage shared by the form's renderers; only the surface window changes it, so the orb and bubble renderers hold stale copies until a reload.
- Ctrl+Tab and Ctrl+Q are bound on Windows and macOS Desktop only, where Desktop main consumes the chords while the orb profile runs even when the dialog is closed.
