/** Window geometry and presentation options for the desktop form window. */

import type { BrowserWindowConstructorOptions } from 'electron'
import { FORM_WINDOW_ARGUMENT } from './ipc.ts'
import { clampFormLayout, type DesktopFormLayout, type DesktopWorkArea } from './form-layout.ts'

/** Orb width and height in logical pixels. */
export const ORB_SIZE = 112

/** Expanded quick-prompt size in logical pixels. */
export const PANEL_SIZE = { width: 560, height: 160 } as const

/** Smallest quick-prompt size the user may resize to, in logical pixels. */
export const PANEL_MIN_SIZE = { width: 420, height: 120 } as const

/** Gap between a presentation and the work area edge, in logical pixels. */
export const SCREEN_MARGIN = 24

/** A presentation's position and size in logical screen coordinates. */
export interface FormPresentationBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
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
 * Fill the display work area, because the modal presentation centers a dialog of its own size within it.
 * @param workArea - target display work area.
 * @returns bounds equal to the work area.
 */
export function modalBounds(workArea: DesktopWorkArea): FormPresentationBounds {
  return { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height }
}

/**
 * Build the Electron options for the form product window.
 * One window hosts every presentation: frameless, transparent, always on top, absent from the taskbar, created at the orb bounds.
 * @param input - preload bundle path, current layout, and the display work area.
 * @returns Electron options for the form product window.
 */
export function formWindowOptions(input: {
  preload: string
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
      additionalArguments: [FORM_WINDOW_ARGUMENT],
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
 * @param presentation - current form presentation.
 * @returns true for the panel presentation, false for the orb and modal presentations.
 */
export function presentationResizable(presentation: 'orb' | 'panel' | 'modal'): boolean {
  return presentation === 'panel'
}
