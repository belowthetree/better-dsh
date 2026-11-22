---
description: "Desktop orb-form agent surface: ambient answer bubbles above the resident orb, and a floating workspace-paged workbench with Session bookmarks and keyboard shortcuts."
kind: "package-reference"
---

# @deepseek-ai/dsh-better-interact

English | [中文](README.zh.md)

## Summary

Better DSH makes the agent a presence on the desktop. Answers rise beside the resident orb as bubbles, and a comic speech balloon reports a Session waiting for permission, an answer, or a plan review. Ctrl+Alt+W opens a floating workbench where the managed conversation leads, each Workspace is a page, and each Session a bookmark. Keyboard-first: Ctrl+Tab for pages, Ctrl+Q for Session navigation, Ctrl+Alt+N to add a Workspace; a bookmark's menu archives or deletes it. It reuses the shell's conversation, so transcripts, tools, and the composer are unchanged. It is a Desktop orb-form experience, not a classic-shell replacement.

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

Better DSH is built on three ideas. **Presence over navigation**: an agent used all day should not sit behind a window, so the orb stays resident and the workbench opens over it. **Ambient output**: the answer being written rises beside the orb as a streaming bubble and completed answers join the history there, so progress never needs a window switch. **The Workspace as the unit of work**: the workbench gives the managed conversation a page ahead of every real Workspace, and each page's Sessions become bookmarks beside the conversation.

The orb stays resident on the desktop. Pointer entry raises the history column; a streaming answer raises it on its own and keeps it up until the agent stops. A pending request raises the same column as a speech balloon and keeps it up until the request is settled; clicking the balloon opens that Session's workbench page. The history bubbles open the same workbench, which floats over the surface window and restores the previous presentation when dismissed.

Clicking the orb opens `orb.chat`, a focused prompt for the management conversation. An accepted prompt opens the single-Session `orb.workbench`; its composer, transcript, tools, approvals, and questions come from the shared Conversation packages. The quick prompt, dedicated workbench, and managed page resolve their Session through one controller and retain the existing `dsh.orb.management-session.v2` preference. Creation uses the Host default Workspace, then the registered Workspace that owns the main view's Session; when neither is available it fails through the existing prompt or workbench error instead of creating an unregistered Session. Voice input and playback appear when their sibling services are mounted. A microphone click reports why it cannot record while the recognition catalog has no selected recognizer, that recognizer is still preparing, or its service has not answered yet, instead of starting a recording that is bound to fail. A transcription rejection carrying the DeepSeek provider's sign-in code shows localized Settings > Account guidance instead of the generic retry notice.

The workbench is the wide, chrome-less surface: Fluent cards for the managed-conversation and Workspace pages above a centered conversation panel, and the page's Sessions as bookmark cards outside the panel's left edge. The managed page always leads the strip, and the strip scrolls horizontally — with the wheel, a trackpad, or the arrow keys — when the Workspaces outgrow it. The current Session carries the accent bar; the keyboard cursor carries an independent selection ring. Ctrl+Tab and Shift+Ctrl+Tab cycle pages. Ctrl+Q moves focus to the bookmarks; the arrow keys move the selection without switching, and Enter opens the focused Session. Ctrl+Alt+N picks a folder and adds or reuses a Workspace page, and Ctrl+N creates a Session in the active page's Workspace. Hovering a card or a bookmark shows its full label and the bound shortcut. The dialog restores the last page and Session when it reopens.

### When to choose it

Choose Better DSH for a Desktop workflow where the agent should stay present and the conversation should be reachable from the keyboard without a classic shell around it. Choose the classic shell, or compose [ui-conversation](../../client/ui-conversation/README.md) directly, when the sidebar, panels, and title bar are part of the workflow or when no orb presentation exists.

### Minimal configuration

Add the `better-interact` row to a profile whose form declares the orb presentation, together with [client-surface](../../client/surface/README.md), the surface-aware [ui-layout](../../client/ui-layout/README.md), and [client-ui-workspace](../../client/ui-workspace/README.md). The package injects `surface`, `slots`, `locale`, `shortcuts`, `resources`, `sessions`, `workspaces`, `uiWorkspace`, `uiSession`, and `theme`, reads the optional settings and voice services, and takes no configuration fields.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin contributes the orb overlay, quick prompt, dedicated management workbench, general workbench, and bubble column. The bubble column reads the Chat target of the running or most recently output-producing Session, keeping a running target stable until it settles; committed assistant messages become history bubbles, and the live partial is the streaming bubble. The stack owns its sequencing and the half-second leave rule, and it asks the carrier for the `bubbles` presentation through `surface.presentBubbles()` and `surface.dismissBubbles()`. The same entry publishes `ctx.uiSession.pendingInteractions`; the stack projects the highest-priority request into one reminder, renders it as the column's last bubble with a tail toward the orb, keeps the column up while it waits, and opens its Session on click.

The workbench reuses `conversation.content` through `renderFactorySlot`, replacing only the View ring with the Chat view; that is what removes the shell chrome without forking the conversation. The pages are a persisted snapshot store under `dsh.better-interact.workbench-pages.v1`: the active page and the Session each page records. The synthetic managed page is not a Workspace: it is derived from Session summaries whose recorded preset is `manage`, always leads the strip, and removes those Sessions from their real Workspace pages. Activating a page opens the remembered or newest Session through the injected `uiWorkspace` navigation service; a Workspace without a Session connects its blank, and the managed page without one starts a management conversation under the `manage` preset in the Host default Workspace or the registered current Workspace. The plugin records the main view's retained Session on its page, selects that page while the dialog is open, and prunes both pages and Session choices against the page and Session catalogs. The focus command only raises a counter in the dialog's inject face; the component moves focus, paints the cursor ring as component-local state, and opens the focused Session on Enter. The shortcut hints come from the effective entries in the shortcut catalog.

The surface renderer owns page writes, Session navigation, and the real capture and playback services. Orb and bubble renderers send bounded intents through `ctx.surface`; the primary returns only the orb's capture-phase and speaking projections. Audio and complete recorder state stay in the primary renderer, and snapshot requests restore those projections after an orb reload.

| Area | Source |
|---|---|
| Entries, commands, pages | [src/client/index.ts](src/client/index.ts) |
| Orb entries and commands | [src/client/orb.ts](src/client/orb.ts) |
| Shared management Session | [src/client/management-session.ts](src/client/management-session.ts) |
| Shared embedded Conversation | [src/client/embedded-conversation.tsx](src/client/embedded-conversation.tsx) |
| Bubble column | [src/client/bubbles.tsx](src/client/bubbles.tsx) |
| Reminder projection | [src/client/reminders.ts](src/client/reminders.ts) |
| Workbench dialog | [src/client/workbench.tsx](src/client/workbench.tsx) |
| Page store | [src/client/workbench-pages.ts](src/client/workbench-pages.ts) |
| Desktop windows and presentations | [apps/desktop](../../../apps/desktop/README.md) |

</details>

<a id="further-exploration"></a>
## Further Exploration

- [client-surface](../../client/surface/README.md): the presentation protocol and the carrier service.
- [ui-layout](../../client/ui-layout/README.md): the frame that renders overlays and the modal layer.
- [ui-conversation](../../client/ui-conversation/README.md): the Conversation target and View contracts.
- [Orb implementation](src/client/orb.ts): the resident orb, quick prompt, dedicated workbench, and system commands.

<a id="model-experience"></a>
## Model Experience

None, as the package sends no model request, registers no tool, and adds no model-visible input.

#### KV Cache effect

No direct effect; the bubbles and the workbench only read Session events the transcript already renders.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The quick dialog has no transcript; an accepted prompt opens the dedicated management workbench, which owns history and follow-up input.
- The dedicated `orb.workbench` is intentionally single-Session and has no Workspace strip or Session bookmarks; those belong to the general workbench.
- Voice controls and playback states require the sibling capture and playback services; without them the prompt and orb keep their text and pointer behavior.
- The column reports one Session at a time: running activity leads, then the latest completed output, and the running target stays stable until it settles.
- The column has its own window, so a panel or modal presentation never replaces it; a column requested while the workbench modal is up appears when the modal closes.
- A tool-only phase before the first answer text shows no streaming bubble; the column appears when answer text starts.
- History is limited to the Turn previews in the loaded window, so scrolling further back in the transcript does not extend it.
- The strip always starts with the managed conversation page, then every Workspace in the catalog; no visible scrollbar means a long strip scrolls with the wheel, a trackpad, or the arrow keys.
- The managed page is a workbench grouping, not a Workspace: its Sessions keep their real Workspace cwd and membership. Activating it while it holds no Session starts a management conversation in the Host default Workspace, falling back to the registered Workspace that owns the main view's Session. If neither resolves, creation fails visibly and no unregistered Session is created.
- Activating a Workspace that has no Session connects its blank, which may create a Session in it.
- The speech balloon reports one request: the highest-priority pending interaction (permission, plan review, then question), and counts the rest. Its tail points toward the column's right edge, where the orb normally rests.
- The balloon reports pending interactions only; an unread completed answer stays in the output bubbles.
- Each page records one Session per Workspace. The main view's retained Session replaces that record, so a Session opened outside this dialog becomes the page's Session instead of staying a separate page.
- Ctrl+Tab, Ctrl+Q, and Ctrl+Alt+N are bound on Windows and macOS Desktop only; Desktop main consumes the chords while the orb profile runs even when the dialog is closed.

<a id="dev-note"></a>
### Dev Note

The column's timing constants are driven by fake timers in its component spec, the reminder projection has its own spec, and the `bubbles` window role, the column presentation, and the workbench hold rule are covered by the Desktop surface-controller spec.
