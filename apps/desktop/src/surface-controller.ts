/** Presentation state machine and validated command surface for a form profile's product window. */
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/protocol'
import type { DesktopFormLayout, DesktopWorkArea } from './form-layout.ts'
import { clampFormLayout } from './form-layout.ts'
import type { FormPresentationBounds } from './form-window.ts'
import { modalBounds, orbBounds, panelBounds, presentationResizable } from './form-window.ts'

/** Longest accepted `shell.modal` entry id. */
export const MAX_MODAL_ID_CHARS = 128

/** One validated command from the product renderer. */
export type SurfaceCommand =
  | { readonly kind: 'expand' }
  | { readonly kind: 'collapse' }
  | { readonly kind: 'presentModal'; readonly id: string }
  | { readonly kind: 'dismissModal' }
  | { readonly kind: 'setPinned'; readonly pinned: boolean }
  | { readonly kind: 'dragBy'; readonly deltaX: number; readonly deltaY: number }
  | { readonly kind: 'pointerInside'; readonly inside: boolean }

/** Native effects the controller applies through its window owner. */
export interface SurfaceWindowEffects {
  /** Apply presentation bounds to the product window. */
  setBounds(bounds: FormPresentationBounds): void
  /** Allow or forbid user resizing for the current presentation. */
  setResizable(resizable: boolean): void
  /** Pass clicks through to the desktop when the pointer is outside the orb. */
  setIgnoreMouseEvents(ignore: boolean): void
  /** Reveal and focus the product window. */
  focus(): void
  /** Publish the current snapshot to the product renderer. */
  publish(snapshot: SurfaceSnapshot): void
  /** Persist the orb position and pinning. */
  persist(layout: DesktopFormLayout): void
  /** Work area of the display the product window currently occupies. */
  workArea(): DesktopWorkArea
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
      return { kind: raw.kind }
    case 'presentModal':
      return typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= MAX_MODAL_ID_CHARS
        ? { kind: 'presentModal', id: raw.id } : undefined
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
 * Owns one form profile's presentation, pinning, modal selection, and orb position.
 * The controller is the only writer of presentation state and asks its window
 * owner to apply the resulting native effects.
 */
export class DesktopSurfaceController {
  readonly #effects: SurfaceWindowEffects
  #layout: DesktopFormLayout
  #presentation: 'orb' | 'panel' | 'modal' = 'orb'
  /** Presentation restored when the modal presentation dismisses. */
  #restore: 'orb' | 'panel' = 'orb'
  #modal: string | null = null
  /** Whether the renderer reported pointer presence at least once. */
  #pointerReported = false
  #pointerInside = false

  /**
   * @param input - persisted layout and the native effects owner.
   */
  constructor(input: { layout: DesktopFormLayout; effects: SurfaceWindowEffects }) {
    this.#effects = input.effects
    this.#layout = clampFormLayout(input.layout, input.effects.workArea())
  }

  /**
   * Current presentation state for the product renderer.
   * @returns the snapshot the service and the modal seat consume.
   */
  snapshot(): SurfaceSnapshot {
    return { form: 'orb', presentation: this.#presentation, pinned: this.#layout.pinned,
      available: true, modal: this.#modal }
  }

  /**
   * Apply one command. Commands that do not apply to the current presentation
   * are ignored rather than failed, because the renderer can race a transition.
   * @param command - validated renderer command.
   */
  dispatch(command: SurfaceCommand): void {
    switch (command.kind) {
      case 'expand':
        if (this.#presentation === 'orb') this.#show('panel')
        return
      case 'collapse':
        if (this.#presentation !== 'orb') { this.#modal = null; this.#show('orb') }
        return
      case 'presentModal':
        if (this.#presentation === 'modal') { this.#modal = command.id; this.#publish() } else { this.#restore = this.#presentation; this.#modal = command.id; this.#show('modal') }
        return
      case 'dismissModal':
        if (this.#presentation === 'modal') { this.#modal = null; this.#show(this.#restore) }
        return
      case 'setPinned':
        this.#layout = { ...this.#layout, pinned: command.pinned }
        this.#effects.persist(this.#layout)
        this.#publish()
        return
      case 'dragBy':
        if (this.#presentation !== 'orb') return
        this.#layout = clampFormLayout({ ...this.#layout,
          orb: { x: this.#layout.orb.x + command.deltaX, y: this.#layout.orb.y + command.deltaY } }, this.#effects.workArea())
        this.#effects.setBounds(orbBounds(this.#layout, this.#effects.workArea()))
        this.#effects.persist(this.#layout)
        return
      case 'pointerInside':
        this.#pointerReported = true
        this.#pointerInside = command.inside
        this.#effects.setIgnoreMouseEvents(this.#ignoreMouse())
        return
      default:
        command satisfies never
    }
  }

  /**
   * Raise the panel presentation for a shell-owned document that needs a normal-sized owner.
   * A form-owned modal already owns the whole display, so it is left in place.
   * @returns whether the panel is the current presentation after the request.
   */
  ensurePanel(): boolean {
    if (this.#presentation === 'modal') return false
    if (this.#presentation === 'orb') this.#show('panel')
    return true
  }

  /** Collapse an unpinned panel when its window loses focus. */
  blurred(): void {
    if (this.#presentation === 'panel' && !this.#layout.pinned) this.#show('orb')
  }

  /** Re-clamp the orb position and current bounds after a display change. */
  reflow(): void {
    this.#layout = clampFormLayout(this.#layout, this.#effects.workArea())
    this.#effects.persist(this.#layout)
    this.#effects.setBounds(this.#bounds())
  }

  /** Re-apply bounds, resizing, and click-through after the product window is created or shown. */
  restore(): void {
    this.#effects.setBounds(this.#bounds())
    this.#effects.setResizable(presentationResizable(this.#presentation))
    this.#effects.setIgnoreMouseEvents(this.#ignoreMouse())
    this.#publish()
  }

  #show(presentation: 'orb' | 'panel' | 'modal'): void {
    this.#presentation = presentation
    this.#effects.setBounds(this.#bounds())
    this.#effects.setResizable(presentationResizable(presentation))
    this.#effects.setIgnoreMouseEvents(this.#ignoreMouse())
    if (presentation !== 'orb') this.#effects.focus()
    this.#publish()
  }

  #bounds(): FormPresentationBounds {
    const workArea = this.#effects.workArea()
    switch (this.#presentation) {
      case 'orb': return orbBounds(this.#layout, workArea)
      case 'panel': return panelBounds(this.#layout, workArea)
      case 'modal': return modalBounds(workArea)
    }
  }

  #ignoreMouse(): boolean {
    // The renderer owns the hit test; until it reports pointer presence the orb
    // stays interactive so a first click is never lost to click-through.
    return this.#presentation === 'orb' && this.#pointerReported && !this.#pointerInside
  }

  #publish(): void {
    this.#effects.publish(this.snapshot())
  }
}
