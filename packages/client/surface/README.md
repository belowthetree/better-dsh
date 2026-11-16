---
description: "Desktop shell-form presentation service over the preload surface bridge, with an inert Web fallback."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-surface

English | [中文](README.zh.md)

## Summary

Provides the client surface capability: one presentation snapshot for the renderer that owns it plus the commands that change the profile's shared presentation. Desktop's preload bridge backs the live service; Web pages and Desktop windows without that bridge receive an inert adapter that reports the classic presentation and cannot change it. [ui-layout](../ui-layout/README.md) renders the classic frame when no surface service is mounted. The boot descriptor is read from a typed global before Client plugins load.

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

When a profile mounts this package, `ctx.surface` exposes `snapshot()`, `follow(signal)`, `expand()`, `collapse()`, `presentModal(id, size?)`, `dismissModal()`, `presentBubbles()`, `dismissBubbles()`, `setPinned(pinned)`, `dragBy(deltaX, deltaY)`, and `setPointerInside(inside)`. `snapshot()` returns one identity-stable value until a presentation field changes; `follow(signal)` yields the current snapshot and each change until the signal aborts. Command methods resolve only after the carrier acknowledges; a rejected carrier command rejects the caller and leaves the last snapshot in place. The plugin requires no injected service, so it mounts in any Client composition.

`SurfaceSnapshot` carries the form (`classic` or `orb`), the window's `role` (`classic`, the resident `orb`, or the `surface` window), the presentation (`classic`, `orb`, `panel`, `modal`, or `bubbles`), pinning, whether the current carrier can change the presentation, the active `shell.modal` entry id, and `orbHovered`, whether the pointer is over the resident orb window. A form profile runs the orb and surface windows as separate renderers: the orb window always reports the `orb` presentation, and the surface window reports the real one. The classic frame reports `classic` so a form profile can collapse back to it, and the modal id lets the frame select modal content from the shared slot registry instead of owning that content. A modal entry may also pass a `ModalSizeHint`: `heightRatio` asks for a dialog that fraction of the work area height, while omitting it keeps the carrier's dialog size. The `bubbles` presentation is the carrier's output column above the orb, which holds only the overlay seat.

Desktop publishes the boot descriptor through the `dsh-desktop:boot` payload; [apps/web](../../../apps/web/src/main.ts) stores it as `globalThis.__DSH_SURFACE__` before Client injections run. The Electron adapter reads `window.dshDesktop.surface` and seeds its first snapshot from that descriptor. A page without the bridge gets the inert adapter: `available: false`, classic presentation, and commands that resolve without effect.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The `/protocol` export is pure type declarations shared with the Electron main and preload processes; it imports nothing at runtime. The `/client` export is the Cordis plugin: it selects the adapter once per activation, provides `ctx.surface`, and follows carrier notifications in one `ctx.effect`, so plugin disposal removes the preload subscription. Each command publishes the snapshot its carrier settled into, and an identical snapshot keeps the previous reference. `follow` retains changes published between reads, ends without throwing when the signal aborts, and still yields the current snapshot once for an already-aborted signal.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-layout](../ui-layout/README.md) — consumes the service for the presentation-aware frame.
- [Desktop application](../../../apps/desktop/README.md) — owns the preload bridge and the form windows.
- [Web client architecture](../../../docs/subsystems/web-client.md) — how Client plugins load and receive services.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exposes browser presentation state and window commands without registering model input.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No Web presentation** — a Web page keeps the classic presentation; the inert adapter reports availability without ever changing it, and a page-level orb fallback is deferred work.
- **Fixed window roles** — a renderer's role comes from its boot descriptor; moving an existing renderer to the other role requires a reload.
- **Two renderers, one presentation** — a form profile loads the full Web client in the orb and surface windows and shares only presentation state through main; synchronizing other client state across the two renderers is outside this service.
- **Carrier-owned geometry** — the service forwards pointer deltas and pinning to main; screen coordinates, work-area clamping, and layout persistence remain in the Electron process.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
