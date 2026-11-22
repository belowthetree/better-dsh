/** Carrier adapters for the surface service: the Desktop preload bridge and the inert Web carrier. */
import type {
  DesktopSurfaceApi, ModalSizeHint, SurfaceBootGlobal, SurfaceDescriptor, SurfaceMessage, SurfaceMessageRole, SurfaceSnapshot,
} from '../protocol.ts'

/** Presentation of a carrier that cannot change it: Web pages and classic Desktop windows. */
const INERT_SNAPSHOT: SurfaceSnapshot = Object.freeze({
  form: 'classic', role: 'classic', presentation: 'classic', pinned: false, available: false, modal: null,
  orbDocked: false, orbHovered: false, modalOpen: false,
})

/** Desktop window with the preload product API exposed as `window.dshDesktop`. */
interface DesktopWindow extends Window {
  readonly dshDesktop?: { readonly surface?: DesktopSurfaceApi }
}

/* jscpd:ignore-start -- restates the preload carrier commands because it adds initial/read and owns its layer documentation. */
/** Carrier commands, initial snapshot, and change notifications for one surface service. */
export interface SurfaceAdapter {
  /** @returns the snapshot known before the first carrier notification. */
  initial(): SurfaceSnapshot
  /** @returns the carrier's current snapshot. */
  read(): Promise<SurfaceSnapshot>
  /**
   * Observe carrier presentation changes.
   * @param listener - called with each changed snapshot.
   * @returns disposer removing the listener.
   */
  subscribe(listener: (snapshot: SurfaceSnapshot) => void): () => void
  /** Expand the orb into the panel presentation. */
  expand(): Promise<void>
  /** Collapse the panel back into the orb presentation. */
  collapse(): Promise<void>
  /**
   * Raise the modal presentation over the current one.
   * @param id - registered `shell.modal` entry id to display.
   * @param size - optional presentation size; omitted keeps the dialog size.
   */
  presentModal(id: string, size?: ModalSizeHint): Promise<void>
  /** Dismiss the modal presentation and restore the previous one. */
  dismissModal(): Promise<void>
  /**
   * Show the bubble column window: a topmost column above the orb.
   * It never takes focus, so it can appear while the user works in another application.
   */
  presentBubbles(): Promise<void>
  /** Dismiss the bubble column window. */
  dismissBubbles(): Promise<void>
  /**
   * Keep a collapsed or panel presentation above other windows.
   * @param pinned - whether the presentation stays visible.
   */
  setPinned(pinned: boolean): Promise<void>
  /**
   * Move the orb by a pointer delta.
   * @param deltaX - horizontal pointer delta in logical pixels.
   * @param deltaY - vertical pointer delta in logical pixels.
   */
  dragBy(deltaX: number, deltaY: number): Promise<void>
  /** Snap the orb flush to the nearest work-area edge while it rests within the snap distance. */
  snap(): Promise<void>
  /**
   * Report whether the pointer is over interactive content.
   * @param inside - whether the pointer is over the reporting window's content.
   */
  pointerInside(inside: boolean): void
  /** Send one consumer-owned message to another form renderer. */
  sendMessage(target: SurfaceMessageRole, channel: string, payload: unknown): Promise<void>
  /** Observe messages and report readiness for one channel. */
  subscribeMessages(channel: string, listener: (message: SurfaceMessage) => void): () => void
}
/* jscpd:ignore-end */

/**
 * Read the Desktop preload surface capability.
 * @param window - product window.
 * @returns the restricted surface API, or undefined while the preload is unavailable.
 */
export function desktopSurfaceApi(window: Window): DesktopSurfaceApi | undefined {
  return (window as DesktopWindow).dshDesktop?.surface
}

/**
 * The inert carrier: reports the classic presentation and cannot change it.
 * @returns adapter whose commands resolve without effect.
 */
export function inertSurfaceAdapter(): SurfaceAdapter {
  return {
    initial: () => INERT_SNAPSHOT,
    read: () => Promise.resolve(INERT_SNAPSHOT),
    subscribe: () => () => {},
    expand: () => Promise.resolve(),
    collapse: () => Promise.resolve(),
    presentModal: () => Promise.resolve(),
    dismissModal: () => Promise.resolve(),
    presentBubbles: () => Promise.resolve(),
    dismissBubbles: () => Promise.resolve(),
    setPinned: () => Promise.resolve(),
    dragBy: () => Promise.resolve(),
    snap: () => Promise.resolve(),
    pointerInside: () => {},
    sendMessage: () => Promise.resolve(),
    subscribeMessages: () => () => {},
  }
}

/**
 * The Desktop carrier: forwards commands to the preload and seeds the presentation from the boot descriptor.
 * @param api - preload surface capability.
 * @param descriptor - boot descriptor stored before Client plugins load, when present.
 * @returns adapter forwarding to the preload capability.
 */
export function electronSurfaceAdapter(api: DesktopSurfaceApi, descriptor: SurfaceDescriptor | undefined): SurfaceAdapter {
  return {
    initial: () => descriptor ?? {
      form: 'classic', role: 'classic', presentation: 'classic', pinned: false, available: true, modal: null,
      orbDocked: false, orbHovered: false, modalOpen: false,
    },
    read: () => api.snapshot(),
    subscribe: listener => api.subscribe(listener),
    expand: () => api.expand(),
    collapse: () => api.collapse(),
    presentModal: (id, size) => api.presentModal(id, size),
    dismissModal: () => api.dismissModal(),
    presentBubbles: () => api.presentBubbles(),
    dismissBubbles: () => api.dismissBubbles(),
    setPinned: pinned => api.setPinned(pinned),
    dragBy: (deltaX, deltaY) => api.dragBy(deltaX, deltaY),
    snap: () => api.snap(),
    pointerInside: (inside) => { api.pointerInside(inside) },
    sendMessage: (target, channel, payload) => api.sendMessage(target, channel, payload),
    subscribeMessages: (channel, listener) => api.subscribeMessages(channel, listener),
  }
}

/**
 * Select the carrier adapter for one page.
 * @param window - product window.
 * @returns the Desktop adapter when the preload exposes the surface capability, otherwise the inert adapter.
 */
export function createSurfaceAdapter(window: Window): SurfaceAdapter {
  const api = desktopSurfaceApi(window)
  const descriptor = (globalThis as SurfaceBootGlobal).__DSH_SURFACE__
  return api === undefined ? inertSurfaceAdapter() : electronSurfaceAdapter(api, descriptor)
}
