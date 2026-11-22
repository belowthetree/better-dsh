# Client surface

English | [中文](client-surface.zh.md)

The client surface capability reports one renderer window's role, shell form, and presentation, together with the commands that change the profile's shared presentation. [ui-layout](../../packages/client/ui-layout/README.md) consumes it for the presentation-aware frame, and the [Desktop application](../../apps/desktop/README.md) owns the native window state behind it.

## Presentation state

`SurfaceSnapshot` carries the window role (`classic`, the resident `orb`, the `surface` window, or the `bubbles` column window), the shell form (`classic` or `orb`), the presentation (`classic`, `orb`, `panel`, `modal`, or `bubbles`), panel pinning, carrier availability, the active `shell.modal` entry id, `orbDocked`, whether the orb square rests within the carrier's snap distance of a work-area edge, `orbHovered`, whether the pointer is over the resident orb window, and `modalOpen`, whether the surface window currently presents a modal entry. A form profile runs the orb, surface, and bubble column windows as separate renderers: the orb window always reports the `orb` presentation, the surface window reports its own presentation (`orb`, `panel`, or `modal`) with the active modal id, and the bubble column window reports `bubbles` only while the column is up. `snapshot()` keeps one reference until a field changes, and `follow(signal)` yields the current snapshot plus each change until the signal aborts. The classic frame reports the `classic` presentation, so a form profile can collapse back to it; a page without a carrier reports `available: false` and can never change the presentation.

## Carrier ownership

The Client plugin selects one adapter at activation: the Desktop preload capability `window.dshDesktop.surface` seeded from the `__DSH_SURFACE__` boot descriptor, or an inert adapter whose commands resolve without effect. A command resolves only after the carrier acknowledges it, and a rejected command leaves the last snapshot in place. Presentation commands from any form window drive the shared state, the bubble column shows and hides independently of the surface presentation, and pointer and drag reports stay with the window that sent them. Window geometry, work-area clamping, click-through, and layout persistence stay in the Electron main process; the renderer forwards pointer deltas and pointer presence. No presentation change writes a Session event or enters a model request.

## Renderer messages

`sendMessage(target, channel, payload)` delivers bounded JSON to the `orb`, `surface`, or `bubbles` role, and `onMessage(channel, listener)` subscribes to one exact channel. Main authenticates the origin and validates the channel and payload size without interpreting consumer fields. Consumers own message parsing, authority, cancellation, and disposal; the carrier does not replicate Session, recorder, or audio state.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<!-- END GENERATED cordis-surface -->