# Client surface

English | [中文](client-surface.zh.md)

The client surface capability reports one renderer window's role, shell form, and presentation, together with the commands that change the profile's shared presentation. [ui-layout](../../packages/client/ui-layout/README.md) consumes it for the presentation-aware frame, and the [Desktop application](../../apps/desktop/README.md) owns the native window state behind it.

## Presentation state

`SurfaceSnapshot` carries the window role (`classic`, the resident `orb`, or the `surface` window), the shell form (`classic` or `orb`), the presentation (`classic`, `orb`, `panel`, `modal`, or `bubbles`), panel pinning, carrier availability, the active `shell.modal` entry id, and `orbHovered`, whether the pointer is over the resident orb window. A form profile runs the orb and surface windows as separate renderers: the orb window always reports the `orb` presentation, and the surface window reports the real one. `snapshot()` keeps one reference until a field changes, and `follow(signal)` yields the current snapshot plus each change until the signal aborts. The classic frame reports the `classic` presentation, so a form profile can collapse back to it; a page without a carrier reports `available: false` and can never change the presentation.

## Carrier ownership

The Client plugin selects one adapter at activation: the Desktop preload capability `window.dshDesktop.surface` seeded from the `__DSH_SURFACE__` boot descriptor, or an inert adapter whose commands resolve without effect. A command resolves only after the carrier acknowledges it, and a rejected command leaves the last snapshot in place. Presentation commands from either form window drive the shared presentation, while pointer and drag reports stay with the window that sent them. Window geometry, work-area clamping, click-through, and layout persistence stay in the Electron main process; the renderer forwards pointer deltas and pointer presence. No presentation change writes a Session event or enters a model request.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<!-- END GENERATED cordis-surface -->