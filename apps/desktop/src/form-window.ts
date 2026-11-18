/** Window geometry and presentation options for the desktop form window. */

import type { BrowserWindowConstructorOptions } from 'electron'
import type { ModalSizeHint } from '@deepseek-ai/dsh-client-surface/protocol'
import { FORM_WINDOW_ARGUMENT, FORM_WINDOW_ROLE_ARGUMENT } from './ipc.ts'
import { clampFormLayout, type DesktopFormLayout, type DesktopWorkArea } from './form-layout.ts'

/** Role of one form window: the resident orb, the surface window, or the bubble column. */
export type DesktopFormRole = 'orb' | 'surface' | 'bubbles'

/** Orb width and height in logical pixels; the square carrier shows the mascot artwork unbounded. */
export const ORB_SIZE = 160

/** Expanded quick-prompt size in logical pixels. */
export const PANEL_SIZE = { width: 560, height: 160 } as const

/** Smallest quick-prompt size the user may resize to, in logical pixels. */
export const PANEL_MIN_SIZE = { width: 420, height: 120 } as const

/**
 * Default modal dialog window size in logical pixels: the frame's default card
 * plus its own padding. A modal entry may request a wider dialog through
 * `ModalSizeHint.width`; this default applies when it does not.
 */
export const MODAL_SIZE = { width: 768, height: 560 } as const

/**
 * Transparent margin around a modal dialog. The frame card's window shadow is
 * painted inside the carrier window, so the window extends past the dialog;
 * without the margin the shadow is cut off at the window edge and reads as a
 * hard border. Keep in sync with `--dsh-modal-window-margin` in ui-layout's
 * `AppFrame.module.css`, which reserves the same room for the card.
 */
export const MODAL_WINDOW_MARGIN = 72

/** Bubble column width in logical pixels; its height follows the display work area. */
export const BUBBLES_WIDTH = 380

/**
 * Transparent margin around the bubble column. The cards' window shadow is
 * painted inside the carrier window, so the window extends past the column;
 * without the margin the shadow is cut off at the window edge and reads as a
 * hard border. Keep in sync with `--dsh-bubbles-window-margin` in
 * better-interact's `Bubbles.module.css`, which insets the stack by the same
 * room.
 */
export const BUBBLES_WINDOW_MARGIN = 24

/** Vertical gap between the bubble column and the orb it belongs to, in logical pixels. */
export const BUBBLES_GAP = 12

/** Gap between a presentation and the work area edge, in logical pixels. */
export const SCREEN_MARGIN = 24

/** Grab distance in logical pixels within which a released orb snaps flush to the nearest work-area edge. */
export const ORB_SNAP_GAP = 24

/** A presentation's position and size in logical screen coordinates. */
export interface FormPresentationBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Whether one screen point lies inside a presentation rectangle.
 * @param rect - presentation bounds in logical screen coordinates.
 * @param point - pointer position in the same coordinates.
 * @returns true when the point is at or inside the left/top edges and before the right/bottom edges.
 */
export function containsPoint(
  rect: FormPresentationBounds,
  point: { readonly x: number; readonly y: number },
): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width
    && point.y >= rect.y && point.y < rect.y + rect.height
}

/**
 * Place the orb square at the layout's orb position after clamping it into the work area.
 * @param layout - current orb layout.
 * @param workArea - target work area; it must be at least ORB_SIZE wide and tall.
 * @returns the orb bounds fully inside the work area.
 */
export function orbBounds(layout: DesktopFormLayout, workArea: DesktopWorkArea): FormPresentationBounds {
  const clamped = clampFormLayout(layout, workArea)
  return { x: clamped.orb.x, y: clamped.orb.y, width: ORB_SIZE, height: ORB_SIZE }
}

/**
 * Place the expanded panel beside the orb, fully inside the work area.
 * The panel sits left of the orb when that side fits, otherwise to its right; its top follows the orb top and stays clamped inside.
 * @param layout - current orb layout.
 * @param workArea - target work area; it must be at least PANEL_SIZE wide and tall.
 * @returns the panel bounds fully inside the work area.
 */
export function panelBounds(layout: DesktopFormLayout, workArea: DesktopWorkArea): FormPresentationBounds {
  const { orb } = clampFormLayout(layout, workArea)
  const left = orb.x - PANEL_SIZE.width
  return {
    x: left >= workArea.x ? left : Math.min(orb.x + ORB_SIZE, workArea.x + workArea.width - PANEL_SIZE.width),
    y: Math.min(orb.y, workArea.y + workArea.height - PANEL_SIZE.height),
    width: PANEL_SIZE.width,
    height: PANEL_SIZE.height,
  }
}

/**
 * Center the modal dialog in the work area, adding a transparent margin around
 * it for the card's window shadow and shrinking both when the work area is
 * smaller. The window keeps a screen margin on every side, so it never covers a
 * whole display and covered applications keep rendering.
 * @param workArea - target display work area.
 * @param size - optional presentation size; a taller height or wider width grows the box, never past the work area.
 * @returns centered modal window bounds inside the work area.
 */
export function modalBounds(workArea: DesktopWorkArea, size: ModalSizeHint = {}): FormPresentationBounds {
  const wantedWidth = size.width === undefined ? MODAL_SIZE.width : Math.max(MODAL_SIZE.width, Math.round(size.width))
  const dialogWidth = Math.min(wantedWidth, workArea.width)
  const wanted = size.heightRatio === undefined
    ? MODAL_SIZE.height
    : Math.max(MODAL_SIZE.height, Math.round(workArea.height * size.heightRatio))
  const dialogHeight = Math.min(wanted, workArea.height)
  // A topmost window that spans the whole display stops the covered application from rendering.
  const availableWidth = Math.max(0, workArea.width - 2 * SCREEN_MARGIN)
  const availableHeight = Math.max(0, workArea.height - 2 * SCREEN_MARGIN)
  const width = Math.min(dialogWidth + 2 * MODAL_WINDOW_MARGIN, availableWidth)
  const height = Math.min(dialogHeight + 2 * MODAL_WINDOW_MARGIN, availableHeight)
  return {
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + Math.floor((workArea.height - height) / 2),
    width,
    height,
  }
}

/**
 * Stack the bubble column above the orb and add the window's transparent shadow
 * margin. The column shrinks to the room above the orb and never covers a whole
 * display, so covered applications keep rendering; the orb lives in its own
 * window. The margin stays transparent and click-through and may extend past the
 * work area at a screen edge, where the shadow would be clipped anyway.
 * @param layout - current orb layout.
 * @param workArea - target display work area.
 * @returns bubble column window bounds inside the work area.
 */
export function bubblesBounds(layout: DesktopFormLayout, workArea: DesktopWorkArea): FormPresentationBounds {
  const orb = orbBounds(layout, workArea)
  const top = workArea.y + SCREEN_MARGIN
  const width = Math.min(BUBBLES_WIDTH, workArea.width)
  const room = Math.max(ORB_SIZE, orb.y - BUBBLES_GAP - top)
  const height = Math.min(Math.max(ORB_SIZE, Math.round(workArea.height * 0.6)), room)
  const x = Math.min(Math.max(workArea.x, orb.x + ORB_SIZE - width), workArea.x + workArea.width - width)
  const y = Math.max(top, orb.y - BUBBLES_GAP - height)
  return {
    x: x - BUBBLES_WINDOW_MARGIN,
    y: y - BUBBLES_WINDOW_MARGIN,
    width: width + 2 * BUBBLES_WINDOW_MARGIN,
    height: height + 2 * BUBBLES_WINDOW_MARGIN,
  }
}

/**
 * Build the Electron options for one form product window.
 * All roles are frameless, transparent, always on top, and absent from the
 * taskbar. Every window starts at the orb square and is moved to its own bounds
 * once the surface controller places it: the orb window keeps the orb bounds for
 * its lifetime, the surface window takes each presentation's bounds, and the
 * bubble column window takes the column bounds.
 * @param input - preload bundle path, window role, current layout, and the display work area.
 * @returns Electron options for the form window.
 */
export function formWindowOptions(input: {
  preload: string
  role: DesktopFormRole
  layout: DesktopFormLayout
  workArea: DesktopWorkArea
}): BrowserWindowConstructorOptions {
  const bounds = orbBounds(input.layout, input.workArea)
  return {
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    maximizable: false,
    fullscreenable: false,
    resizable: false,
    minimizable: true,
    roundedCorners: false,
    backgroundColor: '#00000000',
    ...bounds,
    minWidth: ORB_SIZE,
    minHeight: ORB_SIZE,
    // macOS shows the traffic lights over a hidden title bar; other platforms keep their native frame decorations.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' as const } : {}),
    webPreferences: {
      preload: input.preload,
      // The page skips titlebar chrome that only the classic workspace window owns.
      additionalArguments: [FORM_WINDOW_ARGUMENT, `${FORM_WINDOW_ROLE_ARGUMENT}${input.role}`],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: true,
      devTools: true,
    },
  }
}

/**
 * Whether the user may resize a presentation; only the expanded panel is resizable.
 * @param presentation - current surface presentation.
 * @returns true for the panel presentation, false for the orb and modal presentations.
 */
export function presentationResizable(presentation: 'orb' | 'panel' | 'modal'): boolean {
  return presentation === 'panel'
}
