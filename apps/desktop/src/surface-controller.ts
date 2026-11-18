/** Presentation state machine and validated command surface for a form profile's orb, surface, and bubble column windows. */
import type { ModalSizeHint, SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/protocol'
import type { DesktopFormLayout, DesktopWorkArea } from './form-layout.ts'
import { clampFormLayout } from './form-layout.ts'
import type { DesktopFormRole, FormPresentationBounds } from './form-window.ts'
import { bubblesBounds, modalBounds, orbBounds, ORB_SNAP_GAP, panelBounds, presentationResizable } from './form-window.ts'

/** Presentations the surface window hosts; the orb window always presents the orb. */
type SurfacePresentation = 'orb' | 'panel' | 'modal'

/** Longest accepted `shell.modal` entry id. */
export const MAX_MODAL_ID_CHARS = 128

/** One validated command from a form renderer. */
export type SurfaceCommand =
  | { readonly kind: 'expand' }
  | { readonly kind: 'collapse' }
  | { readonly kind: 'presentModal'; readonly id: string; readonly size?: ModalSizeHint }
  | { readonly kind: 'dismissModal' }
  | { readonly kind: 'presentBubbles' }
  | { readonly kind: 'dismissBubbles' }
  | { readonly kind: 'setPinned'; readonly pinned: boolean }
  | { readonly kind: 'dragBy'; readonly deltaX: number; readonly deltaY: number }
  | { readonly kind: 'snap' }
  | { readonly kind: 'pointerInside'; readonly inside: boolean }

/** Native effects the controller applies to the three form windows. */
export interface SurfaceWindowEffects {
  /** Apply presentation bounds to one window. */
  setBounds(role: DesktopFormRole, bounds: FormPresentationBounds): void
  /** Allow or forbid user resizing for one window's current presentation. */
  setResizable(role: DesktopFormRole, resizable: boolean): void
  /** Pass clicks through one window when the pointer is outside its content. */
  setIgnoreMouseEvents(role: DesktopFormRole, ignore: boolean): void
  /** Reveal the surface window without taking focus. */
  revealSurface(): void
  /** Reveal and focus the surface window for the modal presentation. */
  focusSurface(): void
  /** Hide the surface window while its presentation is the orb. */
  hideSurface(): void
  /** Reveal the bubble column window without taking focus. */
  revealBubbles(): void
  /** Hide the bubble column window. */
  hideBubbles(): void
  /** Publish the resident orb window's snapshot. */
  publishOrb(snapshot: SurfaceSnapshot): void
  /** Publish the surface window's snapshot. */
  publishSurface(snapshot: SurfaceSnapshot): void
  /** Publish the bubble column window's snapshot. */
  publishBubbles(snapshot: SurfaceSnapshot): void
  /** Persist the orb position and pinning. */
  persist(layout: DesktopFormLayout): void
  /** Work area of the display the orb window currently occupies. */
  workArea(): DesktopWorkArea
}

/** Pointer presence reported by one window's renderer. */
interface PointerState {
  /** Whether the renderer reported pointer presence at least once. */
  reported: boolean
  inside: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Presentations that take keyboard focus when they appear. */
function focusable(presentation: SurfacePresentation): boolean {
  return presentation === 'modal'
}

/**
 * Validate the optional modal presentation size.
 * @param raw - untrusted IPC payload field.
 * @returns the accepted size, undefined when the renderer sent none, or null when the payload is invalid.
 */
function parseModalSizeHint(raw: unknown): ModalSizeHint | null | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) return null
  const { heightRatio, width } = raw
  if (heightRatio === undefined && width === undefined) return {}
  if (heightRatio !== undefined
    && (typeof heightRatio !== 'number' || !Number.isFinite(heightRatio) || heightRatio <= 0 || heightRatio > 1)) {
    return null
  }
  if (width !== undefined && (typeof width !== 'number' || !Number.isFinite(width) || width <= 0)) return null
  const hint: { heightRatio?: number; width?: number } = {}
  if (heightRatio !== undefined) hint.heightRatio = heightRatio
  if (width !== undefined) hint.width = width
  return hint
}

/** Whether two modal size hints ask for the same window. */
function sameModalSize(left: ModalSizeHint | undefined, right: ModalSizeHint | undefined): boolean {
  return (left?.heightRatio ?? null) === (right?.heightRatio ?? null)
    && (left?.width ?? null) === (right?.width ?? null)
}

/**
 * Validate one renderer-supplied command against the closed union.
 * @param raw - untrusted IPC payload.
 * @returns the validated command, or undefined when the payload names no known command or carries invalid fields.
 */
export function parseSurfaceCommand(raw: unknown): SurfaceCommand | undefined {
  if (!isRecord(raw)) return undefined
  switch (raw.kind) {
    case 'expand':
    case 'collapse':
    case 'dismissModal':
    case 'presentBubbles':
    case 'dismissBubbles':
    case 'snap':
      return { kind: raw.kind }
    case 'presentModal': {
      if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > MAX_MODAL_ID_CHARS) return undefined
      const size = parseModalSizeHint(raw.size)
      if (size === null) return undefined
      return size === undefined
        ? { kind: 'presentModal', id: raw.id }
        : { kind: 'presentModal', id: raw.id, size }
    }
    case 'setPinned':
      return typeof raw.pinned === 'boolean' ? { kind: 'setPinned', pinned: raw.pinned } : undefined
    case 'dragBy':
      return typeof raw.deltaX === 'number' && Number.isFinite(raw.deltaX)
        && typeof raw.deltaY === 'number' && Number.isFinite(raw.deltaY)
        ? { kind: 'dragBy', deltaX: raw.deltaX, deltaY: raw.deltaY } : undefined
    case 'pointerInside':
      return typeof raw.inside === 'boolean' ? { kind: 'pointerInside', inside: raw.inside } : undefined
    default:
      // Merge-extensible command names from a newer renderer do not apply to this shell.
      return undefined
  }
}

/**
 * Owns one form profile's presentation, pinning, modal selection, orb position,
 * and bubble column visibility. The controller is the only writer of
 * presentation state and asks its window owner to apply the resulting native
 * effects to one of the three windows. Commands may arrive from any window:
 * window presentations apply to the surface window, the bubble column is
 * independent of them, and pointer and drag commands stay with the window that
 * reported them.
 */
export class DesktopSurfaceController {
  readonly #effects: SurfaceWindowEffects
  #layout: DesktopFormLayout
  #presentation: SurfacePresentation = 'orb'
  /** Surface presentation restored when the modal presentation dismisses. */
  #restore: Exclude<SurfacePresentation, 'modal'> = 'orb'
  #modal: string | null = null
  /** Size hint of the active modal entry; undefined keeps the dialog size. */
  #modalSize: ModalSizeHint | undefined
  /** Whether the bubble column is up; the bubble window hides while it is false. */
  #bubblesVisible = false
  readonly #pointer: Record<DesktopFormRole, PointerState> = {
    orb: { reported: false, inside: false },
    surface: { reported: false, inside: false },
    bubbles: { reported: false, inside: false },
  }

  /**
   * @param input - persisted layout and the native effects owner.
   */
  constructor(input: { layout: DesktopFormLayout; effects: SurfaceWindowEffects }) {
    this.#effects = input.effects
    this.#layout = clampFormLayout(input.layout, input.effects.workArea())
  }

  /**
   * Current snapshot for one window's renderer.
   * @param role - window role receiving the snapshot; the orb window always reports the orb presentation,
   * and the bubble column window reports the column presentation only while that column is up.
   * @returns the snapshot published to that window.
   */
  snapshot(role: DesktopFormRole = 'surface'): SurfaceSnapshot {
    return {
      form: 'orb',
      role,
      presentation: role === 'surface'
        ? this.#presentation
        : role === 'bubbles' && this.#bubblesVisible ? 'bubbles' : 'orb',
      pinned: this.#layout.pinned,
      available: true,
      modal: role === 'surface' ? this.#modal : null,
      orbHovered: this.#pointer.orb.inside,
      modalOpen: this.#presentation === 'modal',
    }
  }

  /**
   * Apply one command from one window. Commands that do not apply to the current
   * presentation are ignored rather than failed, because the renderer can race a
   * transition.
   * @param command - validated renderer command.
   * @param origin - window that reported the command.
   */
  dispatch(command: SurfaceCommand, origin: DesktopFormRole = 'surface'): void {
    switch (command.kind) {
      case 'expand':
        if (this.#presentation === 'orb') this.#show('panel')
        return
      case 'collapse':
        if (this.#presentation !== 'orb') { this.#modal = null; this.#show('orb') }
        return
      case 'presentModal':
        if (this.#presentation === 'modal') {
          this.#modal = command.id
          if (!sameModalSize(this.#modalSize, command.size)) {
            this.#modalSize = command.size
            this.#effects.setBounds('surface', this.#bounds())
          }
          // The orb or the bubble column asked for the dialog, so the surface window takes the pointer back.
          if (origin !== 'surface') this.#effects.focusSurface()
          this.#publish()
        } else {
          this.#restore = this.#presentation
          this.#modal = command.id
          this.#modalSize = command.size
          this.#show('modal')
        }
        return
      case 'dismissModal':
        if (this.#presentation === 'modal') { this.#modal = null; this.#show(this.#restore) }
        return
      case 'presentBubbles':
        this.#presentBubbles()
        return
      case 'dismissBubbles':
        this.#dismissBubbles()
        return
      case 'setPinned':
        this.#layout = { ...this.#layout, pinned: command.pinned }
        this.#effects.persist(this.#layout)
        this.#publish()
        return
      case 'dragBy':
        if (origin !== 'orb') return
        this.#layout = clampFormLayout({ ...this.#layout,
          orb: { x: this.#layout.orb.x + command.deltaX, y: this.#layout.orb.y + command.deltaY } }, this.#effects.workArea())
        this.#effects.setBounds('orb', orbBounds(this.#layout, this.#effects.workArea()))
        if (this.#bubblesVisible) this.#effects.setBounds('bubbles', bubblesBounds(this.#layout, this.#effects.workArea()))
        this.#effects.persist(this.#layout)
        return
      case 'snap': {
        if (origin !== 'orb') return
        const area = this.#effects.workArea()
        const current = orbBounds(this.#layout, area)
        const left = current.x - area.x
        const top = current.y - area.y
        const right = area.x + area.width - (current.x + current.width)
        const bottom = area.y + area.height - (current.y + current.height)
        const nearest = Math.min(left, top, right, bottom)
        if (nearest > ORB_SNAP_GAP) return
        let x = this.#layout.orb.x
        let y = this.#layout.orb.y
        if (nearest === left) x = area.x
        else if (nearest === right) x = area.x + area.width - current.width
        if (nearest === top) y = area.y
        else if (nearest === bottom) y = area.y + area.height - current.height
        this.#layout = clampFormLayout({ ...this.#layout, orb: { x, y } }, area)
        this.#effects.setBounds('orb', orbBounds(this.#layout, area))
        if (this.#bubblesVisible) this.#effects.setBounds('bubbles', bubblesBounds(this.#layout, area))
        this.#effects.persist(this.#layout)
        return
      }
      case 'pointerInside': {
        const orbHoverChanged = origin === 'orb' && this.#pointer.orb.inside !== command.inside
        this.#pointer[origin] = { reported: true, inside: command.inside }
        this.#effects.setIgnoreMouseEvents(origin, this.#ignoreMouse(origin))
        // The orb renderer decides when the bubble column leaves from the orb hover fact.
        if (orbHoverChanged) this.#publish()
        return
      }
      default:
        command satisfies never
    }
  }

  /**
   * Raise the panel presentation for a shell-owned document that needs a normal-sized owner.
   * A form-owned modal is already the active presentation, so it is left in place.
   * @returns whether the panel is the current presentation after the request.
   */
  ensurePanel(): boolean {
    if (this.#presentation === 'modal') return false
    if (this.#presentation !== 'panel') this.#show('panel')
    return true
  }

  /**
   * Collapse an unpinned panel, and dismiss the modal, when the surface window
   * loses focus. The modal window covers only the dialog, so leaving it is how
   * the user dismisses the presentation by activating another application. The
   * orb window never owns this focus and keeps presenting the orb; the bubble
   * column keeps its own visibility.
   */
  blurred(): void {
    if (this.#presentation === 'modal') {
      const restore = this.#restore
      this.#modal = null
      this.#show(restore === 'panel' && !this.#layout.pinned ? 'orb' : restore, false)
      return
    }
    if (this.#presentation === 'panel' && !this.#layout.pinned) this.#show('orb', false)
  }

  /** Re-clamp the orb position and all three windows' bounds after a display change. */
  reflow(): void {
    this.#layout = clampFormLayout(this.#layout, this.#effects.workArea())
    this.#effects.persist(this.#layout)
    this.#effects.setBounds('orb', orbBounds(this.#layout, this.#effects.workArea()))
    if (this.#presentation !== 'orb') this.#effects.setBounds('surface', this.#bounds())
    this.#effects.setBounds('bubbles', bubblesBounds(this.#layout, this.#effects.workArea()))
  }

  /** Re-apply bounds, resizing, visibility, and click-through after a window is created or shown. */
  restore(): void {
    const workArea = this.#effects.workArea()
    this.#effects.setBounds('orb', orbBounds(this.#layout, workArea))
    this.#effects.setResizable('orb', false)
    this.#effects.setIgnoreMouseEvents('orb', this.#ignoreMouse('orb'))
    if (this.#presentation === 'orb') {
      this.#effects.hideSurface()
    } else {
      this.#effects.setBounds('surface', this.#bounds())
      this.#effects.setResizable('surface', presentationResizable(this.#presentation))
      this.#effects.setIgnoreMouseEvents('surface', this.#ignoreMouse('surface'))
      if (focusable(this.#presentation)) this.#effects.focusSurface()
      else this.#effects.revealSurface()
    }
    this.#placeBubbles()
    if (this.#bubblesVisible && this.#presentation !== 'modal') this.#effects.revealBubbles()
    else this.#effects.hideBubbles()
    this.#publish()
  }

  #show(presentation: SurfacePresentation, focus = true): void {
    const wasModal = this.#presentation === 'modal'
    this.#presentation = presentation
    this.#effects.setBounds('orb', orbBounds(this.#layout, this.#effects.workArea()))
    this.#effects.setResizable('orb', false)
    this.#effects.setIgnoreMouseEvents('orb', this.#ignoreMouse('orb'))
    if (presentation === 'orb') {
      this.#effects.hideSurface()
    } else {
      this.#effects.setBounds('surface', this.#bounds())
      this.#effects.setResizable('surface', presentationResizable(presentation))
      this.#effects.setIgnoreMouseEvents('surface', this.#ignoreMouse('surface'))
      if (focus && focusable(presentation)) this.#effects.focusSurface()
      else this.#effects.revealSurface()
    }
    // The surface presentation never owns the column; a column held through the
    // workbench returns when the modal leaves.
    if (wasModal && presentation !== 'modal') this.#revealHeldBubbles()
    this.#publish()
  }

  #bounds(): FormPresentationBounds {
    const workArea = this.#effects.workArea()
    switch (this.#presentation) {
      case 'orb': return orbBounds(this.#layout, workArea)
      case 'panel': return panelBounds(this.#layout, workArea)
      case 'modal': return modalBounds(workArea, this.#modalSize)
    }
  }

  /**
   * Show the bubble column. It belongs to no surface presentation: it appears
   * above the orb while the surface window shows whatever it showed before.
   */
  #presentBubbles(): void {
    if (this.#bubblesVisible) return
    this.#bubblesVisible = true
    this.#placeBubbles()
    // A column raised over the workbench would cover the dialog it opened; the
    // modal's dismissal reveals the held column instead.
    if (this.#presentation !== 'modal') this.#effects.revealBubbles()
    this.#publish()
  }

  /**
   * Hide the bubble column. The column that opened the workbench stays while the
   * modal is up, so closing the workbench keeps the outputs the user was reading.
   */
  #dismissBubbles(): void {
    if (!this.#bubblesVisible || this.#presentation === 'modal') return
    this.#bubblesVisible = false
    this.#effects.hideBubbles()
    this.#publish()
  }

  /** Reveal a column held through the workbench once the modal presentation leaves. */
  #revealHeldBubbles(): void {
    if (!this.#bubblesVisible) return
    this.#placeBubbles()
    this.#effects.revealBubbles()
  }

  /** Apply the column's geometry, resizing, and click-through without changing its visibility. */
  #placeBubbles(): void {
    this.#effects.setBounds('bubbles', bubblesBounds(this.#layout, this.#effects.workArea()))
    this.#effects.setResizable('bubbles', false)
    this.#effects.setIgnoreMouseEvents('bubbles', this.#ignoreMouse('bubbles'))
  }

  #ignoreMouse(role: DesktopFormRole): boolean {
    // The square orb window is the artwork itself, so it stays interactive: a
    // click-through orb can swallow the pointer re-entry that would restore it.
    if (role === 'orb') return false
    const pointer = this.#pointer[role]
    // The renderer owns the hit test; until it reports pointer presence the window
    // stays interactive so a first click is never lost to click-through.
    if (!pointer.reported || pointer.inside) return false
    // The surface window presents the panel and the modal, which keep every pixel interactive.
    if (role === 'surface') return false
    // The bubble column is click-through everywhere but its own content.
    return this.#bubblesVisible
  }

  #publish(): void {
    this.#effects.publishOrb(this.snapshot('orb'))
    this.#effects.publishSurface(this.snapshot('surface'))
    this.#effects.publishBubbles(this.snapshot('bubbles'))
  }
}
