# Client surface

English | [中文](client-surface.zh.md)

The client surface capability reports one product window's shell form and presentation together with the commands that change it. [ui-layout](../../packages/client/ui-layout/README.md) consumes it for the presentation-aware frame, and the [Desktop application](../../apps/desktop/README.md) owns the native window state behind it.

## Presentation state

`SurfaceSnapshot` carries the shell form (`classic` or `orb`), the presentation (`classic`, `orb`, `panel`, or `modal`), panel pinning, carrier availability, and the active `shell.modal` entry id. `snapshot()` keeps one reference until a field changes, and `follow(signal)` yields the current snapshot plus each change until the signal aborts. The classic frame reports the `classic` presentation, so a form profile can collapse back to it; a page without a carrier reports `available: false` and can never change the presentation.

## Carrier ownership

The Client plugin selects one adapter at activation: the Desktop preload capability `window.dshDesktop.surface` seeded from the `__DSH_SURFACE__` boot descriptor, or an inert adapter whose commands resolve without effect. A command resolves only after the carrier acknowledges it, and a rejected command leaves the last snapshot in place. Window geometry, work-area clamping, click-through, and layout persistence stay in the Electron main process; the renderer forwards pointer deltas and pointer presence. No presentation change writes a Session event or enters a model request.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<!-- END GENERATED cordis-surface -->