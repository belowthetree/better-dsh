/**
 * Desktop shell-form protocol shared by the Electron main/preload process and
 * the Client surface plugin. Pure type declarations: importing this module
 * creates no runtime dependency.
 */

/** Shell forms a desktop carrier can present. */
export type SurfaceForm = 'classic' | 'orb'

/**
 * Window role that owns one renderer. A form profile runs the resident orb, the
 * surface window that hosts the panel and the modal, the bubble column window,
 * and the standalone first-run window as separate renderers; the classic
 * workspace has no orb and reports itself.
 */
export type SurfaceWindowRole = 'classic' | 'orb' | 'surface' | 'bubbles' | 'onboarding'

/** Optional size of one modal presentation. */
export interface ModalSizeHint {
  /**
   * Fraction of the work area height the modal occupies, greater than 0 and at most 1.
   * Omitted keeps the carrier's dialog size; the carrier never exceeds the work area.
   */
  readonly heightRatio?: number
  /**
   * Dialog width in CSS pixels, at least the carrier's dialog width; the carrier
   * never exceeds the work area. Omitted keeps the carrier's dialog width.
   */
  readonly width?: number
}

/**
 * Window presentation of one product window. `classic` is listed because the
 * classic frame reports its own presentation: a form profile must be able to
 * collapse back to it, and every carrier starts there.
 */
export type SurfacePresentation = 'classic' | 'orb' | 'panel' | 'modal' | 'bubbles'

/** Geometry of the open orb options ring inside the enlarged orb window. */
export interface OrbMenuSnapshot {
  /** Orb square left edge inside the orb window content, in CSS pixels. */
  readonly anchorX: number
  /** Orb square top edge inside the orb window content, in CSS pixels. */
  readonly anchorY: number
  /**
   * Direction in radians from the orb center toward the work-area center. The
   * ring spans a half circle around it, so the options open away from the
   * display edge the orb rests against.
   */
  readonly direction: number
}

/** Presentation state shared by the carrier, the client service, and tests. */
export interface SurfaceSnapshot {
  /** Shell form this window was created for. */
  readonly form: SurfaceForm
  /** Window role this snapshot was published to. */
  readonly role: SurfaceWindowRole
  /** Current window presentation. */
  readonly presentation: SurfacePresentation
  /** Whether the panel presentation stays above other windows. */
  readonly pinned: boolean
  /** False when the current carrier cannot change the presentation (Web, non-form Desktop profiles). */
  readonly available: boolean
  /**
   * Active `shell.modal` entry while the modal presentation is up; null
   * otherwise. The id selects the registered entry, so the modal presentation
   * carries its id instead of rendering content itself.
   */
  readonly modal: string | null
  /**
   * Whether the orb square rests within the carrier's snap distance of a
   * work-area edge, which selects its docked artwork. Carriers without an orb
   * report false.
   */
  readonly orbDocked: boolean
  /**
   * Geometry of the open orb options ring, or null while the orb square rests
   * alone. An open ring means the carrier grew the orb window into a
   * transparent pad around the orb; the renderer draws the ring there.
   */
  readonly orbMenu: OrbMenuSnapshot | null
  /**
   * Whether the pointer is over the resident orb window. A form profile's
   * surface window keeps the bubble column while the orb is hovered, even when
   * the pointer is not on the column itself.
   */
  readonly orbHovered: boolean
  /**
   * Whether the surface window currently presents a modal entry. The bubble
   * column stays while it is true, so opening the workbench from a bubble never
   * dismisses the column that opened it.
   */
  readonly modalOpen: boolean
}

/** Boot descriptor the carrier publishes before Client plugins load. */
export type SurfaceDescriptor = SurfaceSnapshot

/** Form window that may receive a renderer-to-renderer message. */
export type SurfaceMessageRole = Exclude<SurfaceWindowRole, 'classic' | 'onboarding'>

/** One role-addressed message delivered without interpretation by the Desktop carrier. */
export interface SurfaceMessage {
  /** Renderer role that sent the message. */
  readonly origin: SurfaceMessageRole
  /** Consumer-owned channel, parsed and bounded by the carrier. */
  readonly channel: string
  /** Consumer-owned JSON payload, bounded by the carrier. */
  readonly payload: unknown
}

/** Desktop preload capability; the only privileged surface boundary. */
export interface DesktopSurfaceApi {
  /** @returns the carrier's current presentation snapshot. */
  snapshot(): Promise<SurfaceSnapshot>
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
   * Move the orb by a pointer delta; main clamps it to the work area.
   * @param deltaX - horizontal pointer delta in logical pixels.
   * @param deltaY - vertical pointer delta in logical pixels.
   */
  dragBy(deltaX: number, deltaY: number): Promise<void>
  /**
   * Snap the orb flush to the nearest work-area edge while it rests within the snap distance.
   */
  snap(): Promise<void>
  /**
   * Grow the resident orb window into its options ring, or restore the orb square.
   * @param open - whether the options ring is shown.
   */
  setOrbMenu(open: boolean): Promise<void>
  /**
   * Report whether the pointer is over interactive content, so main can pass
   * clicks through.
   * @param inside - whether the pointer is over the reporting window's content.
   */
  pointerInside(inside: boolean): void
  /**
   * Send one bounded JSON message to another form renderer without giving it window authority.
   * @param target - role that receives the message.
   * @param channel - consumer-owned message channel.
   * @param payload - JSON payload interpreted only by that consumer.
   */
  sendMessage(target: SurfaceMessageRole, channel: string, payload: unknown): Promise<void>
  /**
   * Observe messages delivered to this renderer and publish the channel's readiness.
   * @param channel - exact channel to observe; the first subscriber marks it ready.
   * @param listener - receives the carrier-authenticated origin and consumer payload.
   * @returns disposer removing the listener and marking the channel unready after its last subscriber.
   */
  subscribeMessages(channel: string, listener: (message: SurfaceMessage) => void): () => void
}

/** Typed global apps/web writes from the boot payload before injections run. */
export interface SurfaceBootGlobal {
  /** Carrier bootstrap snapshot stored before Client plugins load. */
  __DSH_SURFACE__?: SurfaceDescriptor
}
