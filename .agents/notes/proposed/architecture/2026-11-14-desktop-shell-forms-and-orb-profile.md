# Agent Note: Desktop shell forms and the orb profile

Status: proposed

English | [中文](2026-11-14-desktop-shell-forms-and-orb-profile.zh.md)

## Problem

The Desktop application presents one workspace window. [apps/desktop/src/main.ts](../../../../apps/desktop/src/main.ts) creates a single primary `BrowserWindow` plus a welcome window, and every other surface — the update dialog, the mandatory update UI, the Platform account view — is an embedded `WebContentsView`, not a window. Nothing in the shell uses always-on-top, transparent or frameless windows, or `globalShortcut`; [apps/desktop/tests/main-startup.spec.ts](../../../../apps/desktop/tests/main-startup.spec.ts) even asserts that `setAlwaysOnTop` is never called. Microphone authorization is limited to the primary `dsh-app://app` frame in [apps/desktop/src/microphone-permissions.ts](../../../../apps/desktop/src/microphone-permissions.ts), the Host authentication cookie is attached only to that window's WebSocket, and the in-app shortcut catalog has one keyboard bridge. The client has one frame: [ui-layout](../../../../packages/client/ui-layout/src/client/index.ts) registers the single `root` occupant and declares every frame seat other UI plugins register into.

Voice input exists but is composer-scoped. [client-ui-voice-input](../../../../packages/experimental/client-ui-voice-input/src/client/mount.ts) mounts a recording control in `conversation.input.activity` and tears capture down when that control unmounts, loses focus, or the page hides. The Host half provides a speech-to-text seam with an authenticated Remote, while the optional experimental bundle ships only a local SenseVoice recognizer; the [speech-to-text reference](../../../../packages/experimental/speech-to-text/README.md) records that speech synthesis has no service method. The out-of-tree `@dsh-external/dsh-deepseek-suite` bundle, installed per profile and not part of this repository, already wraps the official DeepSeek speech endpoints as the model-facing `deepseek_asr` and `deepseek_tts` tools, but it registers no Cordis service, so neither the UI nor another plugin can use either interface without a model turn. No audio playback, text-to-speech service, or voice-output consumer exists anywhere in the repository.

Profiles are the composition unit. Shipped templates are `acp`, `web`, `headless`, `sdk` and `sdk-minimal` in [official-bundles](../../../../packages/util/official-bundles/src/bundles.ts); Electron owns `$DSH_HOME/profiles/desktop` and boots exactly the `desktop` profile name from the fixed path in [paths.ts](../../../../apps/desktop/src/paths.ts). Desktop cannot boot another profile, so a different desktop form cannot be selected by profile at all.

This note proposes a new dsh form activated by a new `better` profile: a desktop side floating orb, a side popover panel, a desktop modal presentation, OS-global shortcuts, and voice input plus voice output over the official DeepSeek interfaces. The form stays a Cordis composition over the one shipped runtime and the one Host↔page protocol; it is not a fork of the application.


## Proposal

The proposal has three parts that ship together. First, a product shell capability renders whichever form a profile declares: one product window with three presentations, a client surface service, and system-scope commands. Second, an experimental optional bundle composes the orb form from that capability and new client plugins. Third, a voice layer separates microphone capture from the composer, routes recognition and synthesis through the official DeepSeek interfaces owned by the external suite bundle, and adds the missing speech-synthesis seam and playback consumer. The official interfaces stay in the out-of-tree suite, which gains two provider registrations; product changes are additive, and the classic profile keeps its current window, shortcut, and voice behavior.


### Profile-declared forms

A profile manifest gains two optional fields. `form` names the shell presentation the profile requests; `owner` marks a profile whose executable packages only Desktop manages, which is the rule already applied to `profiles/desktop`.

```text
interface DshProfileManifest {
  bundles?: string[]
  owner?: 'desktop'
  form?: { kind: 'classic' | 'orb' }
}
```

The type extends [DshProfileManifest](../../../../packages/util/package-manifest/src/types.ts). Absent `form` means `classic` and preserves every existing profile. An unknown or malformed kind fails the Desktop launch with one visible error naming the profile and the supported kinds; it never silently falls back, because a profile that asked for a form must not boot as a different one. [app-boot](../../../../packages/boot/app-boot/README.md) validates the field when it loads a profile directory so CLI previews and dumps report the same objects.

Desktop reads the profile manifest synchronously before it starts the Host, because window options such as transparency and always-on-top cannot change after construction. That rules out declaring the form through a bundle patch row or a Host boot injection, both of which are only known after Host readiness. Profile creation is a Desktop flow: the Settings form surface lists installed optional bundles that declare `dsh.bundle.form`, and creating a form profile from one writes the web template bundle list, the bundles the form declaration names, and the form bundle itself into a new Desktop-owned profile. The declaration exists on both sides for different readers: bundle metadata advertises a form to the creator, and the profile manifest is the runtime authority.

Launch selection uses an explicit profile name: a packaged-app `--profile <name>` argument and a `dsh://open?profile=<name>` deep link. Omitted selection keeps the `desktop` profile. The CLI keeps refusing profile names with `owner: 'desktop'` for `dsh plugin` and profile initialization, exactly as it refuses the reserved `desktop` name today, so two managers never write one profile's executable packages.

### Presentations of one product window

The form uses one product window and changes its presentation instead of creating one window per surface. A presentation is shell state; the content is the same client application. The three presentations are the requested desktop surfaces.

| Presentation | Geometry | Window behavior | Content seat |
|---|---|---|---|
| `orb` | 112×112 logical pixels, placed by the user, clamped to the display work area | frameless, transparent, always-on-top, skipped from the taskbar, click-through outside the orb | `shell.overlay` |
| `panel` | 420×720 default, anchored beside the orb or to the screen edge, resizable within work-area bounds | frameless, transparent card, always-on-top while unfocused unless pinned, collapses on outside click | the classic frame in its compact layout |
| `modal` | centered card of at most 720 pixels on a display-sized dimmed backdrop | frameless, transparent, always-on-top, focus-trapping, Escape dismisses the top layer | `shell.modal` |

One window is a deliberate constraint. Every renderer is an independent consumer of the same authenticated streams: approvals and user questions are Remote waterfalls with one answer, and a second renderer would claim them concurrently, duplicate microphone authorization, widen the cookie filter, and duplicate the shortcut catalog. The panel therefore renders the existing frame in its narrow layout rather than a second, divergent conversation implementation; the existing conversation, composer, approval, question, settings, and modal code keeps working unchanged inside it. A later split into separate surface renderers is recorded under deferred work, not assumed here.

Presentation transitions are owned by the Electron main process and requested by the renderer through the surface API. Clicking the orb, pressing the toggle command, or receiving an attention event expands the panel and focuses the composer. Escape, collapsing the window, clicking outside an unpinned panel, or pressing the toggle command returns to the orb; a pinned panel stays visible. `presentModal` raises the modal presentation from whatever presentation is current, and dismissing it restores the previous presentation and focus. The last pinned state and the orb position persist in `userData/form-layout.json` with a schema version; an unreadable or future file falls back to defaults, and the window is re-clamped whenever display metrics change.

Click-through is required for a transparent orb: the renderer reports pointer presence and main calls `setIgnoreMouseEvents(true, { forward: true })` while the pointer is outside the orb and its drag handle. Dragging the orb and the panel title strip uses explicit pointer tracking plus throttled position IPC rather than CSS app-region dragging, because app-region drag regions do not deliver the pointer events the click-through hit test needs. Bounds writes are clamped in main against the target display work area; the renderer never sets raw screen coordinates.

### Startup, lifecycle, and window ownership

A form profile changes startup in four places. The product window is created with the form's window options before navigation instead of the 1280×820 workspace window. The welcome window, onboarding, login, and update flows keep their current behavior, with the product window created after entering the workspace when the first run needed onboarding. Closing the product window hides it, as today; the tray icon, second launch, dock activation, and `dsh://open` restore the last presentation. Quit confirmation, update installation, task interruption, and scheduled-task reporting are unchanged.

Shell-owned overlays assume a normal-sized owner. Before the update dialog or mandatory update overlay opens on a form window, main asks the form for the panel presentation, so an update prompt is never rendered on a 112-pixel orb. The update overlay then attaches to the product window as its owner. If the renderer cannot reach the panel presentation, the shell falls back to a message-box confirmation path rather than showing a clipped overlay.

The scattered `mainWindow` assumptions become one product-window registry that also holds the form window: microphone authorization, the Host cookie WebSocket filter, keyboard attachment, theme and locale fan-out, update-overlay ownership, and quit inspection all resolve from the registry instead of from one variable. This registry is the main refactor of the shell and is required for the welcome window, the form window, and any future surface to share one lifecycle.

### Client surface capability

A new product client package, `packages/client/surface`, defines the client surface capability: a Cordis service `ctx.surface` over a shared protocol type that the preload, the Electron adapters, and tests all import. The service exposes one snapshot plus commands.

```text
interface SurfaceSnapshot {
  form: 'classic' | 'orb'
  presentation: 'orb' | 'panel' | 'modal'
  pinned: boolean
  available: boolean
}
interface SurfaceService {
  snapshot(): SurfaceSnapshot
  follow(signal: AbortSignal): AsyncIterable<SurfaceSnapshot>
  expand(): void
  collapse(): void
  presentModal(id: string): void
  dismissModal(): void
  setPinned(pinned: boolean): void
}
```

The Electron adapter calls the new `surface` block of the preload product API, which main validates against the form window, the `dsh-app://app` origin, and the top frame. The inert carrier adapter reports `available: false` and `classic`; a Web page keeps the classic presentation, and the page-level orb fallback is explicitly out of scope for this proposal. Boot payloads change: the `dsh-desktop:boot` handler currently returns one global object for every renderer, and it becomes per-sender, returning the same Host injections plus the surface descriptor. [apps/web/src/main.ts](../../../../apps/web/src/main.ts) stores that descriptor before it applies injections, so the client service reads one typed global instead of inferring a form from DOM state.

### Presentation-aware frame

[ui-layout](../../../../packages/client/ui-layout/src/client/index.ts) stays the frame owner and gains a presentation-aware branch. It reads the optional `ctx.get('surface')` service, so a classic profile without the surface row renders exactly today's frame. For `orb` and `modal` presentations it renders a transparent root, the existing `shell.overlay` seat, and a new `shell.modal` list seat, and it sets a `data-surface` attribute for CSS. For `panel` it renders the classic frame with `data-surface="panel"`, which removes window-chrome clearance, narrows paddings, and uses the existing narrow-layout behavior. Product dialogs that already use the in-document `Modal` primitive therefore keep working inside the panel without a second implementation.

`shell.modal` is the modal content seat. The form bundle registers modal content there, and `ctx.surface.presentModal(id)` selects the active entry; ui-layout renders the backdrop, the active entry, and the focus trap, and routes Escape and backdrop clicks back to `dismissModal()`. This keeps modal presentation a composition result instead of a shell fork.

### System-scope shortcuts

[shortcuts](../../../../packages/client/shortcuts/README.md) currently models application commands whose bindings main intercepts only while a product window is focused. The command definition gains a `scope` field: `application` by default, or `system` for OS-global registration. System commands are desktop-only, accept exactly one ordinary key with zero to four modifiers, reject two-key chords, bare modifiers, and Web profile defaults, and cannot duplicate an application binding. The command owner keeps its existing `resolve` contract, so a command can decide from modal and focus state just as it does today.

The desktop keyboard bridge gains a global registration module beside the focused-window interception. After boot, the renderer sends the system command definitions and the accepted bindings; main derives Electron accelerators, calls `globalShortcut.register`, and reports per-command registration results. A failed registration — already taken by the OS or another application — is reported to the renderer and shown in Settings, and the previous accepted binding stays in place. Registration is suspended while the shortcut recording UI is active and released on quit. A global activation is forwarded to the product window as a revision-tagged command event, and the client registry executes it exactly like a focused-window binding.

Persistence extends `userData/keybindings.json` with a `system` override map and a new schema version; existing version 1 and version 2 files keep their current behavior, and unreadable or future files still block edits. [ui-shortcuts](../../../../packages/client/ui-shortcuts/src/client/index.ts) gains a Global group that shows registration state and unavailable platform combinations. The Web and Linux focused-window model is unchanged.

Electron `globalShortcut` exposes no key-up callback, so push-to-talk is press-to-start, press-to-stop in this proposal. A held-key gesture needs native key-state polling; that is recorded under deferred work rather than simulated. macOS combinations that the system reserves, media keys, and Wayland compositor limits surface as registration failures through the same Settings state.

### Voice input

Capture becomes a client service instead of a composer component. A new experimental client package hosts `ctx.voiceCapture`: it owns the recorder, microphone device preference, WAV encoding, and the `remote.speech.transcribe` call, and it exposes begin, cancel, and finish with a snapshot that surfaces and tests can observe. The existing [client-ui-voice-input](../../../../packages/experimental/client-ui-voice-input/src/client/mount.ts) package becomes one consumer: its composer control keeps its current interaction, but the recorder lifetime no longer ends when that control unmounts. Two new consumers ride the same service: an orb voice control and a global push-to-talk command.

Recognition uses the official DeepSeek interface, not a local model. The external `@dsh-external/dsh-deepseek-suite` bundle registers a `SpeechProvider` on the existing speech-to-text seam with id `deepseek-cloud`; it posts the canonical 16 kHz mono PCM16 WAV from `remote.speech.transcribe` to `POST /v1/tools/asr` as multipart form data and returns the response `text`. The provider advertises processing location `cloud` and only the `auto` language hint, advertises no preparation task, resolves the `DEEPSEEK_API_KEY` credential per call through `ctx.credentials` with the suite's configured fallback, and reuses the suite's `baseUrl`, request timeout, and typed error classification. Missing credentials, invalid keys, insufficient balance, rate limits, oversized audio, timeouts, and server failures map to the seam's typed failures; the panel shows localized copy with an action that opens the model settings, and no request is retried automatically because every retry is billable.

Delivery stays explicit. A finished transcript first fills the active session's composer draft through the existing `InputActions.insertText` path when the panel is open; when the form is collapsed, the surface service expands the panel, then inserts the draft and focuses the composer. The active session is the form's own client-side selection, defaulting to the most recently interacted session. A hands-free setting may submit the transcript instead of pre-filling it; that submission goes through the ordinary `session.prompt` path, so the model-visible text is an ordinary durable `user/message`. Recognition alone writes no Session event, the recorded audio never touches disk or attachment storage, and the upload is disclosed as a billed request to the configured DeepSeek endpoint.

Microphone authorization follows the window registry: the form window's `dsh-app://app` main frame is authorized like the classic primary frame, only while the form profile is active. Permission denial, missing devices, and a two-minute capture cap release tracks and discard the recording. Because recognition is cloud-hosted, the recording leaves the machine only after the user finishes a capture and the transcript is requested; cancelling never uploads.


### Voice output

Voice output becomes a Host capability seam plus a client playback consumer, because the official DeepSeek synthesis interface is a credentialed Host call while audio playback belongs to the renderer. A new experimental Host package defines `ctx.textToSpeech`: named providers with voice and format catalogs, volatile `defaultProvider`, `voiceId`, and `format` selection persisted through the settings service, a snapshot and `follow`, and `resolve`, `synthesize`, and cancellation that mirror the speech-to-text seam. A new `api-text-to-speech` package exposes the same operations through the authenticated Remote as the `speechOutput` namespace with bounded `maxTextChars`, `maxAudioBytes`, and `timeoutMs`; the result carries base64 WAV bytes that are transient, never a Session event or attachment.

The provider is the external suite. `@dsh-external/dsh-deepseek-suite` registers a `TextToSpeechProvider` with id `deepseek-tts`, reusing its existing `synthesizeSpeech` client: `POST /v1/tools/tts` with `{ text, voice_id, format, filter_markdown: true }`, the `stella` and `tide` voices, and `wav` output. Credential resolution, base URL, request timeout, and error classification stay in the suite and match the recognition provider. The provider returns audio bytes and never writes a file, so synthesis has no durable artifact; the existing `deepseek_tts` tool keeps its file-writing behavior for explicit model-facing use.

A new client consumer, `client-ui-voice-output`, owns playback policy: auto-speak off, replies to voice-initiated turns, or all replies; voice and mute selection; queueing and interruption on a new turn, Escape, or an explicit stop; speaking-state publication for the orb; and localized failure copy. It sends the assistant text of the active session, capped at the Remote limit, and the provider's `filter_markdown` request strips Markdown before synthesis. Audio playback, queues, and speaking state stay process-local and are never Session events; tool output is never spoken, and synthesis never enters a model request.


### The better bundle and its packages

The form is one optional experimental bundle, shipped with the installation the way the existing voice-input bundle is, with an icon and locale metadata. Its manifest declares the form it provides; its patch inserts the surface, orb, capture, and speech rows the form needs, and configures the provider ids the external suite registers. New experimental packages use the unprefixed `@deepseek-ai/dsh-<name>` form and join `EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS`, while the existing legacy-prefixed speech packages keep their names.

```yaml
- insert:
    - id: client-surface
      name: '@deepseek-ai/dsh-client-surface'
    - id: client-ui-orb
      name: '@deepseek-ai/dsh-client-ui-orb'
    - id: client-voice-capture
      name: '@deepseek-ai/dsh-client-voice-capture'
    - id: speech-to-text
      name: '@deepseek-ai/dsh-experimental-speech-to-text'
      config:
        defaultProvider: deepseek-cloud
        language: auto
    - id: api-speech-to-text
      name: '@deepseek-ai/dsh-experimental-api-speech-to-text'
    - id: ui-voice-input
      name: '@deepseek-ai/dsh-experimental-client-ui-voice-input'
    - id: text-to-speech
      name: '@deepseek-ai/dsh-text-to-speech'
      config:
        defaultProvider: deepseek-tts
        voiceId: stella
        format: wav
    - id: api-text-to-speech
      name: '@deepseek-ai/dsh-api-text-to-speech'
    - id: client-ui-voice-output
      name: '@deepseek-ai/dsh-client-ui-voice-output'
```

| Package | Role | Status |
|---|---|---|
| `packages/client/surface` | Client surface service definition, Electron adapter, inert adapter, shared protocol | product, optional classification |
| `packages/experimental/better-bundle` | Form composition, optional bundle metadata, form declaration | experimental |
| `packages/experimental/client-ui-orb` | Orb rendering, states, menus, commands, form settings | experimental |
| `packages/experimental/client-voice-capture` | Recorder service extracted from the existing voice-input UI | experimental |
| `packages/experimental/text-to-speech` | Host speech-synthesis Service Definition and provider registry | experimental |
| `packages/experimental/api-text-to-speech` | Authenticated speech-synthesis Remote consumer | experimental |
| `packages/experimental/client-ui-voice-output` | Playback consumer, auto-speak policy, voice controls | experimental |

The profile recipe is the web template bundles plus the better bundle, with the out-of-tree suite installed into the same profile through the plugin manager from its local folder, and with `form: { kind: 'orb' }` and `owner: 'desktop'` in the profile manifest. The bundle configures the provider ids `deepseek-cloud` and `deepseek-tts`, and both speech seams fail loudly at load when the suite is missing or registers a different id, naming the expected provider and the installation step. The better bundle is admitted to `OPTIONAL_BUNDLES` and therefore to the installation's dependencies, which is exactly the isolation exception that lets an optional experimental bundle ship switched off ([decision](../../implemented/architecture/2026-09-21-experimental-capabilities-as-optional-bundles.md)). It appears in no shipped profile template.


### Interaction design

The orb reflects state rather than text: it dims when idle, reacts on hover, shows a waveform while capturing, spins while the active session runs, pulses while speaking, and shows an attention dot when an approval or question waits. Drag moves it, click expands the panel, and the context menu offers a new session, the voice toggle, mute, pinning, settings, and quit. A reduced-motion setting removes the spin and pulse animations, and every orb state has a localized accessibility label.

The panel's top strip holds the collapse, pin, and settings controls and the active-session title; below it the existing conversation and composer render. The voice control next to the composer starts capture without opening the composer menu, its neighbouring controls select the `stella` or `tide` synthesis voice and mute playback, and the panel shows the recorder or synthesis state and the last failure inline. Approval and question cards stay in the conversation where the existing plugins already render them; when the panel is collapsed and an attention event arrives, the form expands the panel if the attention setting allows it and otherwise only badges the orb.

The modal presentation is form-owned: first-use credential or voice setup, permission repair, fatal form errors, and the quick voice-settings card use `shell.modal`. Escape and the backdrop dismiss it, focus returns to the previous presentation, and a modal opened from the orb keeps the orb's screen position as its anchor. Nothing in the modal presentation replaces the existing product dialogs; those keep their in-panel `Modal` behavior.


### Logging and durability

The form introduces no Session event, no persistence-format change, and no model request content beyond ordinary user messages. Voice transcripts become model-visible only through ordinary submission, which already records `user/message` and the composer draft path; recorded audio and synthesized audio are transient bytes that never reach the Session log, attachments, or disk. The assistant text sent for synthesis is the already-logged message; speech playback, presentations, pinned state, and orb geometry are process-local or user settings. The profile `form` and `owner` fields are local configuration read by the Desktop app and profile tooling, with no relationship to the Session format version. This keeps the "model-visible means logged" rule and the released-session-format rules untouched.


### Security

The new surface API is the only new privileged renderer boundary. Main accepts it only from the form window's `dsh-app://app` top frame, validates every command against a closed union, clamps all geometry to a connected display work area, and never exposes arbitrary window or screen control. The global shortcut sync validates a closed catalog shape and a bound command count, and registration failures cannot crash the shell. Profile `owner: 'desktop'` is enforced by the CLI refusal path, not by hiding files. Microphone authorization is added to the form window only; the classic window's checks are unchanged. The form layout file is versioned and treated as untrusted input. The Host↔main Node IPC protocol is not extended: window and shortcut control flows through the typed preload API, matching the existing directory-picker, keyboard, and file-drag boundaries.

Voice crosses the network by design and is handled as credentialed, billable user data. The suite's providers resolve the `DEEPSEEK_API_KEY` credential per call through `ctx.credentials`, accept only HTTPS base URLs except a loopback test server, never log or persist the key, and keep it out of the renderer and the Remote payloads. The browser sends only WAV bytes or text; the Host sends them to the configured DeepSeek endpoint, so both the recording and the spoken reply leave the machine, and the settings copy states this and the per-call billing. DSH retains no audio, no synthesis request is retried automatically, the Remote bounds text length, audio size, and timeout, and synthesis failures are reported without exposing provider diagnostics or credentials.


### Testing and documentation

Tests follow the repository ladder. Unit specs cover profile form parsing and rejection, window geometry persistence and clamping, global registration results with a mocked Electron API, the surface protocol validation, presentation-aware frame rendering, the speech-to-text and text-to-speech seams with stub providers, the Remote bounds and typed errors, the capture service, and the playback consumer. The suite's own unit and integration tests keep covering the official API client against a local HTTP stub, including multipart layout and TTS byte handling, and the repository tests reuse that stub pattern instead of the real endpoint. The mocked main-startup harness gains the new window registry and form window, and the existing assertion that always-on-top is unused is replaced by assertions about the form window's options. A REAL-composition Loader test boots a test profile with the better bundle, a stub speech provider, and the form declaration, and asserts the injected rows, default provider ids, and form metadata. GUI tests cover the panel, orb, and modal presentations with driven props, and the keyless Web replay suite covers the classic profile unchanged. Package READMEs, an apps/desktop README section for forms and system shortcuts, a subsystem page for the shell form surface and the speech-synthesis seam, and the group README rows land with the implementation. The experimental bundle is admitted through `OPTIONAL_BUNDLES`; the product client package is classified optional in [product-package-policy](../../../../scripts/product-package-policy.ts) because only explicitly selected forms mount it.


## Alternatives considered

**Ship the form as a second Electron application.** The application-launch rule allows only dsh profiles to launch supported Node applications, and a second shell would duplicate packaging, signing, updates, and the Host runtime. The profile selector reuses the one signed shell instead.

**Build the orb as a page-level overlay inside the existing window.** The shape plugin's prior art proves this is cheap for in-page surfaces, but it cannot float over other applications, receive OS-global shortcuts, or present a real desktop modal, and it disappears with the page. It is the right design only for a future Web fallback.

**Enable the form through the existing desktop profile instead of a new profile.** This would leak the new form to every Desktop launch and make the voice and orb plugins inseparable from the classic workspace. The user's requirement is a profile-activated form, and profiles are exactly the composition unit for that.

**Use three separate windows for orb, panel, and modal.** Separate renderers would each consume the same Remote waterfalls and claim approvals and questions concurrently, each need microphone and cookie authorization, and each duplicate the shortcut catalog. One window with three presentations keeps one UI owner while still meeting the three requested surfaces. Splitting later is possible once surface-scoped client graphs exist.

**Drive windows from a Host-side plugin through a new Host↔main protocol.** There is no generic request/response channel today, only a closed event union for lifecycle and diagnostics. Adding one would create a second plugin-facing native boundary and a new lifecycle owner for windows. Renderer-driven typed preload APIs match the existing native capability pattern and keep the Host out of window management.

**Declare the form through a bundle patch row or a Host boot injection.** Both are only known after Host readiness, while transparent and always-on-top windows must choose their options at construction time. The profile manifest is readable synchronously and is already the composition record.

**Ship a `better` profile template in `PROFILE_TEMPLATES`.** The default-product isolation gate rejects experimental packages in shipped templates, and an experimental form must stay opt-in. The form profile is created as a Desktop-owned profile instead, and the bundle is admitted through `OPTIONAL_BUNDLES`.

**Keep the local SenseVoice recognizer and platform system voices.** The optional bundle already ships an offline recognizer and the browser exposes system voices for playback, but the form must use the official DeepSeek interfaces, and mixing engines would split quality, credential, billing, and failure semantics across two paths. The local provider and system voices stay available to profiles that choose them, not to this form.

**Call the suite's model-facing `deepseek_asr` and `deepseek_tts` tools through an agent turn.** The tools already wrap the same endpoints, but a push-to-talk interaction must not wait for a model decision, spend tokens, or produce a tool call just to transcribe or speak; the provider roles expose the same client functions without changing the model contract.

**Duplicate the official API client in new repository provider packages.** The suite already owns credential resolution, base URL validation, timeouts, multipart encoding, and the error taxonomy; copying it would create two clients that drift and two places that handle billing errors. Keeping one owner in the suite leaves this repository with service, Remote, and consumer roles only.

**Implement push-to-talk with a native key-state listener.** Electron exposes no key-up for global shortcuts, so this needs a new native module and packaging work in the first version. Toggle semantics ship now; held-key capture remains a deferred provider decision.

**Scope client plugins per surface and render each surface with its own graph.** That is the long-term shape for memory and isolation, but it changes the module graph, every frame registration, and the dialog arbitration between documents. One window makes the question unnecessary for this proposal.


## Acceptance criteria

The `better` profile is created from Settings or from the documented recipe, lists the web template bundles plus the voice-input and better bundles, declares `form: { kind: 'orb' }`, and is marked Desktop-owned; the CLI refuses to manage it.

Launching Desktop with the profile shows the orb collapsed, above other applications, with no taskbar entry and with clicks passing through outside the orb.

Clicking the orb or pressing the toggle shortcut expands the panel containing the existing conversation, composer, approvals, and questions; Escape, collapse, or outside click returns to the orb; a pinned panel stays open; geometry and pinning survive restart and remain inside the work area after a display change.

`presentModal` shows a dimmed, focus-trapped modal presentation, dismisses on Escape or backdrop, and restores the previous presentation and focus.

The default system shortcuts register on Windows and macOS, a conflicting binding reports its failure in Settings and keeps the previous binding, recording suspends registration, and quitting releases every accelerator; the classic profile registers none and Web stays unchanged.

Push-to-talk captures while the orb is collapsed, requests the official DeepSeek ASR provider `deepseek-cloud`, inserts the transcript into the active session's draft after expanding, submits only when hands-free is enabled, and produces an ordinary `user/message` in that case; a missing or invalid API key, insufficient balance, rate limit, oversized recording, and timeout each show localized, actionable copy, and no local model is downloaded.

Replies are synthesized through the official DeepSeek TTS provider `deepseek-tts` with the selected `stella` or `tide` voice under the configured auto-speak policy, stop on a new turn or an explicit stop, never speak tool output, and leave no audio in the Session log, attachments, or disk; synthesis requests are not retried automatically.

The main-startup, geometry, shortcut, surface, speech provider, Remote, and composition specs pass; `pnpm run test:gui`, `DSH_SNAPSHOT=replay pnpm run test:web`, `pnpm run typecheck`, `pnpm run lint` and the documentation gates are green; the isolation gate stays green with the better bundle admitted as an optional bundle.

## Risks

Transparent, frameless, and always-on-top windows behave differently across Windows, macOS, and Linux compositors; focus, click-through, fullscreen Spaces, and animation timing need a per-platform manual matrix, and the existing startup assertion about always-on-top must change deliberately rather than incidentally.

One morphing window avoids duplicate renderers but concentrates layout risk: the panel reuses a narrow classic frame, which may feel cramped, and presentation transitions can flicker while bounds and content change together. A dedicated panel UI and animated transitions are follow-up work.

Electron `globalShortcut` cannot report key release, has no atomic conflict check, and is unreliable under some Wayland compositors; the toggle interaction and Settings reporting are honest limits, not full parity with the focused-window shortcuts.

Broadening microphone and WebSocket authorization to the form window weakens a security invariant that is currently a single-variable check; the window registry, the closed command union, and denial-path tests must land in the same change.

The official voice path depends on an external bundle that lives outside this repository and installs through a profile link: its provider ids, credential name, base URL default, and error taxonomy become a contract this design references, and a suite upgrade must keep both provider registrations compatible or the form fails loudly at load. Ownership, review, and release of that package stay with the suite.

Voice now depends on network, credentials, and billing. Recognition and synthesis add round-trip latency, cost money per request, fail under 401/402/429/5xx, and send the recording or the spoken reply to the configured DeepSeek endpoint; offline use and privacy-sensitive deployments have no local fallback in the first version, and the settings and failure copy must disclose this.

The form profile is Desktop-owned data under `$DSH_HOME`; older dsh versions ignore the new manifest fields, but any downgrade after the profile was written must keep launching the profile as classic rather than failing, which the tolerant reader above explicitly supports.

The first version ships without a Web fallback, without a held-key push-to-talk gesture, and without streaming synthesis or partial transcripts; these are visible product gaps that the form's experimental status must state, not hide.

## Deferred work

Streaming synthesis and playback, partial ASR transcripts, a per-message read-aloud action, and an optional local or offline speech fallback for deployments that cannot send audio to a cloud endpoint.

Native key-state polling for held-key push-to-talk, including its packaging and permission consequences.

Surface-scoped client plugin graphs and separate renderers for the orb and modal surfaces, if memory or dialog arbitration requires them.

A Web carrier fallback that renders the orb and panel in the page for profiles viewed outside Desktop.

A dedicated lightweight panel UI, motion design for presentation transitions, and a screen-reader audit on every supported platform.

Wake-word activation, multi-display anchoring preferences, and per-surface attention routing when several sessions need the user at once.
