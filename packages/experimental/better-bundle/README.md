---
description: "Enable the experimental orb form on Desktop from the plugin manager."
kind: "package-bundle"
---

# @deepseek-ai/dsh-better-bundle

English | [中文](README.zh.md)

## Summary

This optional bundle composes the orb form for Desktop: the surface service, the orb and panel chrome, shared microphone capture, official speech recognition and synthesis seams, the authenticated speech Remotes, the speech playback consumer, and the orb's `manage` Agent preset. A Desktop-owned profile that declares the orb form mounts it; shipped profiles keep the classic window and leave it disabled.

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

The bundle is Desktop-only. In Plugins it appears switched off; enabling it makes the packages available but does not change the classic profile. Create a profile whose manifest requests the orb form, as documented in the Desktop shell forms section, then launch Desktop with `--profile <name>`. The window opens as a collapsed orb; clicking it raises a centered quick chat dialog holding a prompt input, a voice input toggle, and a send button. Enter or the send button sends the prompt to the orb's dedicated `manage` conversation — created in the Host default workspace on first use — and raises the management workbench, a wide card showing the shared conversation transcript, streaming answer, and follow-up composer; Shift+Enter inserts a newline, a rejected prompt stays in the dialog with a failure line, and Escape or a backdrop click dismisses either card. The orb context menu and the `orb.workbench` command reopen the workbench without sending anything. The dialog draws its own card surface with the shared elevation material. The dialog's voice toggle records on the shared capture service and appends the recognized text to the input without sending it. Ctrl+Alt+D opens the quick chat dialog through an OS-global shortcut on Windows and macOS, and the orb toggle remains unbound until assigned under Settings, Shortcuts, Global. The orb can be dragged, and the orb context menu selects the synthesis voice, mutes playback, and cycles the auto-speak policy. A microphone button on the orb and the `voice.pushToTalk` system command start a capture while the orb is collapsed; finishing raises the dialog and fills its input. Speech recognition and synthesis are provided by the built-in `deepseek-suite` row, which registers the `deepseek-cloud` and `deepseek-tts` providers in the same composition; both are billed cloud requests. The bundle declares the `manage` preset (管理对话) that the orb's chat creates its management Session under: it mounts the session list tools with `workspaceAccess: current`, exposing only the management Session's registered default Workspace and rejecting other workspace IDs during execution, session-query, latest-reply, and message tools, and no file, shell, or deletion/rewrite tool. Tools registered in the root scope are inherited down the scope chain, so the management Agent also sees better-interact's `orb_balloon` (show one sentence as a speech balloon) and the external suite's `deepseek_speak` (read it aloud); balloon text is narrated by default, with the toggle, voice, and preview under Settings, Voice narration. To review the assembled form without a packaged build, follow the local form review steps in the [Desktop README](../../../apps/desktop/README.md).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The static `cordis.patch.yml` builds on the Web app's surface row and inserts the orb plugin, the capture service, the recognition and synthesis seams with their DeepSeek provider ids, both authenticated Remotes, the composer microphone control, and the playback consumer. A second static patch, `presets/manage.patch.yml`, declares the `manage` Agent preset the orb's management Session mounts. The form itself is not declared here: window options are read synchronously from the profile manifest before the Host starts, so the profile manifest is the runtime authority and the bundle only composes the plugins that form needs. The classic window, its focused-window shortcuts, and Web behavior stay unchanged because none of these rows mount without the profile selection.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Client surface](../../../docs/subsystems/client-surface.md)
- [Voice input](../../../docs/subsystems/voice-input.md)
- [Speech synthesis](../../../docs/subsystems/text-to-speech.md)
- [Desktop shell forms](../../../apps/desktop/README.md)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `manage` preset, whose fixed Chinese persona, workspace agent instructions, current time, current-workspace-only session list, session-query, latest-reply, and message tool schemas, and user-question tool enter a request only while a Session mounts it, and compaction may drop older tool results.

#### KV Cache effect

No direct effect outside the `manage` preset. Repeated management turns keep the persona, instructions, and tool schemas in one stable prefix while appended transcripts grow the suffix; compaction rewrites history when it runs.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Desktop only. Web keeps the classic presentation and has no page-level orb fallback; the form profile is created from the documented recipe because Settings does not yet create form profiles.
- Both speech seams get their providers from the built-in `deepseek-suite` row; disabling that row makes them fail at first use rather than at load.
- The orb has no attention badge, the context menu does not offer new session or quit, and a collapsed panel does not focus the composer automatically.
- Push-to-talk is press-to-start, press-to-stop: Electron global shortcuts expose no key-up event, and playback is not streaming.
- The `manage` preset publishes its own Chinese name and description, so the roster groups it with custom presets instead of the localized built-in four.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
