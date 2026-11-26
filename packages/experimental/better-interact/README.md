---
description: "Desktop orb-form agent surface: ambient answer bubbles above the resident orb, and a floating workspace-paged workbench with Session bookmarks and keyboard shortcuts."
kind: "package-reference"
---

# @deepseek-ai/dsh-better-interact

English | [中文](README.zh.md)

## Summary

Better DSH makes the agent a desktop presence: answers rise beside the resident orb as bubbles, and a speech balloon reports a Session awaiting permission, an answer, or a plan review. Clicking the orb or pressing Ctrl+Alt+D raises a half ring of round plugin options facing the desktop center. Ctrl+Alt+W opens a floating workbench where the managed conversation leads, each Workspace is a page, and each Session a bookmark, navigable by Ctrl+Tab and Ctrl+Q. It reuses the shell's conversation, so transcripts, tools, and the composer stay unchanged, and it is a Desktop orb-form experience, not a classic-shell replacement.

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

The orb stays resident on the desktop. Pointer entry raises the history column; a streaming answer raises it on its own and keeps it up until the agent stops. A pending request raises the same column as a speech balloon and keeps it up until the request is settled; clicking the balloon opens that Session's workbench page. The `orb_balloon` tool lets the management conversation speak for itself: its text appears in the bottom balloon, whose tail points at the orb, and an optional Session id makes a click open that Session. The history bubbles open the same workbench, which floats over the surface window and restores the previous presentation when dismissed.

Balloon text is read aloud by default: the voice narration section in Settings offers a toggle (on by default), the voice choice, and a preview. A recorded playback failure shows its own notice there while the choice and the preview stay usable, since the next successful playback clears it. Narration uses the shared `voiceOutput` synthesis and playback service, so the audio lives in browser memory only; each waiting-request balloon and each new remark is spoken once. A tool result carrying `speak` presentation metadata — the built-in `deepseek-suite`'s `deepseek_speak`, for example — is spoken once too; the renderer that owns playback watches the main-view Session for it, so a closed bubble column never silences the request. The voice is the same selection the orb context menu and the auto-speak policy use.

Clicking the orb or pressing Ctrl+Alt+D raises the options ring: a half circle of round buttons around the mascot on the side facing the work-area center. The built-in **Assistant dialog** option opens `orb.chat`, a focused prompt for the management conversation. Clicking the orb again, clicking the transparent pad around the buttons, pressing Escape, or moving focus to another application closes the ring; dragging the orb closes it and keeps the drag. An accepted prompt opens the single-Session `orb.workbench`; its composer, transcript, tools, approvals, and questions come from the shared Conversation packages. The quick prompt, dedicated workbench, and managed page resolve their Session through one controller and retain the existing `dsh.orb.management-session.v2` preference. Creation uses the Host default Workspace, then the registered Workspace that owns the main view's Session; when neither is available it fails through the existing prompt or workbench error instead of creating an unregistered Session. Voice input and playback appear when their sibling services are mounted. A microphone click reports why it cannot record while the recognition catalog has no selected recognizer, that recognizer is still preparing, or its service has not answered yet, instead of starting a recording that is bound to fail. A transcription rejection carrying the DeepSeek provider's sign-in code shows localized Settings > Account guidance instead of the generic retry notice.

### Add an option to the orb

A Client plugin that wants its own round option injects the `orbActions` service and registers one action; the orb draws the button chrome and the arc placement. The label function is read whenever the ring renders, so a dictionary-bound `t` follows the active locale. The glyph is a keyed `orb.action.icon` component: register it with the same key as the action's `icon.key`, and it receives the action's icon metadata, including an optional image URL.

```ts ignore-check
import type { Context } from '@deepseek-ai/cordis'

export const inject = ['orbActions', 'slots', 'locale']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orbActions.register({
    id: 'my-plugin.review',
    label: () => ctx.locale.bind('myPlugin')('orb.review'),
    icon: { key: 'my-plugin.review' },
    order: 100,
    run: () => { /* open the plugin's own surface */ },
  }), 'my plugin: orb option')
  ctx.slots.inject('orb.action.icon', () => ctx.slots.register({
    name: 'orb.action.icon', key: 'my-plugin.review',
  }, ReviewGlyph))
}
```

Registration throws for a duplicate id or when the ring already holds eight actions, so a conflicting composition fails at mount rather than hiding an option. The action's `run` is called after the ring closes; a modal it opens uses the form's normal modal presentation.

The workbench is the wide, chrome-less surface: Fluent cards for the managed-conversation and Workspace pages above a centered conversation panel, and the page's Sessions as bookmark cards outside the panel's left edge. The managed page always leads the strip, and the strip scrolls horizontally — with the wheel, a trackpad, or the arrow keys — when the Workspaces outgrow it. The current Session carries the accent bar; the keyboard cursor carries an independent selection ring. Ctrl+Tab and Shift+Ctrl+Tab cycle pages. Ctrl+Q moves focus to the bookmarks; the arrow keys move the selection without switching, and Enter opens the focused Session. Ctrl+Alt+N picks a folder and adds or reuses a Workspace page, and Ctrl+N creates a Session in the active page's Workspace. Hovering a card or a bookmark shows its full label and the bound shortcut. The dialog restores the last page and Session when it reopens.

### When to choose it

Choose Better DSH for a Desktop workflow where the agent should stay present and the conversation should be reachable from the keyboard without a classic shell around it. Choose the classic shell, or compose [ui-conversation](../../client/ui-conversation/README.md) directly, when the sidebar, panels, and title bar are part of the workflow or when no orb presentation exists.

### Minimal configuration

Add the `better-interact` row to a profile whose form declares the orb presentation, together with [client-surface](../../client/surface/README.md), the surface-aware [ui-layout](../../client/ui-layout/README.md), and [client-ui-workspace](../../client/ui-workspace/README.md). The package injects `surface`, `slots`, `locale`, `shortcuts`, `resources`, `sessions`, `workspaces`, `uiWorkspace`, `uiSession`, and `theme`, reads the optional settings and voice services, provides `orbActions` for other plugins, and takes no configuration fields.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin contributes the orb overlay, quick prompt, dedicated management workbench, general workbench, and bubble column. The bubble column reads the Chat target of the running or most recently output-producing Session, keeping a running target stable until it settles; committed assistant messages become history bubbles, and the live partial is the streaming bubble. The stack owns its sequencing and the half-second leave rule, and it asks the carrier for the `bubbles` presentation through `surface.presentBubbles()` and `surface.dismissBubbles()`. The same entry publishes `ctx.uiSession.pendingInteractions`; the stack projects the highest-priority request into one reminder, renders it as the column's last bubble with a tail toward the orb, keeps the column up while it waits, and opens its Session on click.

The workbench reuses `conversation.content` through `renderFactorySlot`, replacing only the View ring with the Chat view; that is what removes the shell chrome without forking the conversation. The pages are a persisted snapshot store under `dsh.better-interact.workbench-pages.v1`: the active page and the Session each page records. The synthetic managed page is not a Workspace: it is derived from Session summaries whose recorded preset is `manage`, always leads the strip, and removes those Sessions from their real Workspace pages. Activating a page opens the remembered or newest Session through the injected `uiWorkspace` navigation service; a Workspace without a Session connects its blank, and the managed page without one starts a management conversation under the `manage` preset in the Host default Workspace or the registered current Workspace. The plugin records the main view's retained Session on its page, selects that page while the dialog is open, and prunes both pages and Session choices against the page and Session catalogs. The focus command only raises a counter in the dialog's inject face; the component moves focus, paints the cursor ring as component-local state, and opens the focused Session on Enter. The shortcut hints come from the effective entries in the shortcut catalog.

The surface renderer owns page writes, Session navigation, and the real capture and playback services. Orb and bubble renderers send bounded intents through `ctx.surface`; the primary returns only the orb's capture-phase and speaking projections. Audio and complete recorder state stay in the primary renderer, and snapshot requests restore those projections after an orb reload.

The options ring stays in the resident orb window. `ctx.orbActions` publishes registered actions as presentation views; the orb renderer reads the arc geometry from the carrier's `orbMenu` snapshot and places each button on a half circle around the orb anchor. Opening or closing the ring is an `ctx.surface.setOrbMenu()` carrier command: the carrier grows the orb window into a 300-pixel pad around the orb, keeps the orb square at its screen position, and orients the ring away from the nearest display edge. The carrier collapses the ring when another presentation takes over or the orb window loses focus.

| Area | Source |
|---|---|
| Entries, commands, pages | [src/client/index.ts](src/client/index.ts) |
| Orb entries and commands | [src/client/orb.ts](src/client/orb.ts) |
| Orb options registry | [src/client/orb-actions.ts](src/client/orb-actions.ts) |
| Orb options layout | [src/client/orb-action-layout.ts](src/client/orb-action-layout.ts) |
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

### Orb balloon tool

#### What the model sees

The generated `orb_balloon` schema: one required `text` string, an optional `sessionId`, and an optional `action` enum of `none` and `open`. The description tells the model that the text appears in the character's balloon and is read aloud to the user, and that `action: "open"` with a `sessionId` opens that Session when the balloon is clicked.

#### Token effect

Fixed schema cost on every request of every Agent in a profile that mounts this package. An accepted call returns one confirmation line; a rejected call returns one stable argument error.

#### KV Cache effect

Prefix-stable while the composition is unchanged. Each accepted call appends its confirmation line to the suffix, and the persisted `balloon` presentation metadata stays out of model content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The quick dialog has no transcript; an accepted prompt opens the dedicated management workbench, which owns history and follow-up input.
- The options ring holds at most eight plugin actions; a ninth registration fails at mount instead of crowding the arc.
- The ring's buttons lie inside the enlarged orb window, so an orb resting in a display corner can have the far end of the arc clipped by the work-area edge. The carrier keeps the orb square in place rather than moving the user's orb.
- The assistant dialog remains the only shipped option; other options require a Client plugin that injects `orbActions`.
- The ring takes keyboard focus while it is open, so dismissing it returns the keyboard to the orb window rather than to the previously active application.
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
- The character balloon comes from an `orb_balloon` result in the transcript of the Session the column currently binds, so it appears only there; retargeting the column drops it.
- Narration requires the mounted `voiceOutput` service (the better bundle composes it). A renderer without playback still shows the balloon but stays silent, and failures keep the playback service's closed failure enum without retrying.
- Each page records one Session per Workspace. The main view's retained Session replaces that record, so a Session opened outside this dialog becomes the page's Session instead of staying a separate page.
- Ctrl+Tab, Ctrl+Q, and Ctrl+Alt+N are bound on Windows and macOS Desktop only; Desktop main consumes the chords while the orb profile runs even when the dialog is closed.

<a id="dev-note"></a>
### Dev Note

The column's timing constants are driven by fake timers in its component spec, the reminder projection has its own spec, and the `bubbles` window role, the column presentation, and the workbench hold rule are covered by the Desktop surface-controller spec.
