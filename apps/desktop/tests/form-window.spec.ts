import { describe, expect, it } from 'vitest'
import {
  MODAL_SIZE,
  MODAL_WINDOW_MARGIN,
  ORB_SIZE,
  PANEL_MIN_SIZE,
  PANEL_SIZE,
  SCREEN_MARGIN,
  formWindowOptions,
  BUBBLES_GAP,
  BUBBLES_WIDTH,
  BUBBLES_WINDOW_MARGIN,
  bubblesBounds,
  containsPoint,
  modalBounds,
  orbBounds,
  panelBounds,
  presentationResizable,
} from '../src/form-window.ts'
import type { DesktopFormLayout, DesktopWorkArea } from '../src/form-layout.ts'

const WORK_AREA: DesktopWorkArea = { x: 0, y: 0, width: 1920, height: 1080 }
const LAYOUT: DesktopFormLayout = { version: 1, orb: { x: 300, y: 200 }, pinned: false }

describe('form presentation constants', () => {
  it('pins the orb, panel, modal, margin, and minimum panel sizes', () => {
    expect(ORB_SIZE).toBe(112)
    expect(PANEL_SIZE).toEqual({ width: 560, height: 160 })
    expect(PANEL_MIN_SIZE).toEqual({ width: 420, height: 120 })
    expect(MODAL_SIZE).toEqual({ width: 768, height: 560 })
    expect(MODAL_WINDOW_MARGIN).toBe(72)
    expect(BUBBLES_WINDOW_MARGIN).toBe(24)
    expect(SCREEN_MARGIN).toBe(24)
  })
})

describe('orb bounds', () => {
  it('places the orb square at the layout position', () => {
    expect(orbBounds(LAYOUT, WORK_AREA)).toEqual({ x: 300, y: 200, width: ORB_SIZE, height: ORB_SIZE })
  })

  it('clamps an orb whose layout lies outside the work area', () => {
    const outside: DesktopFormLayout = { version: 1, orb: { x: 5000, y: -50 }, pinned: false }
    expect(orbBounds(outside, WORK_AREA)).toEqual({ x: 1808, y: 0, width: ORB_SIZE, height: ORB_SIZE })
  })
})

describe('panel bounds', () => {
  it('opens left of the orb when that side fits', () => {
    expect(panelBounds({ version: 1, orb: { x: 1784, y: 484 }, pinned: false }, WORK_AREA))
      .toEqual({ x: 1224, y: 484, width: PANEL_SIZE.width, height: PANEL_SIZE.height })
  })

  it('opens right of the orb when the left side does not fit', () => {
    expect(panelBounds({ version: 1, orb: { x: 0, y: 0 }, pinned: false }, WORK_AREA))
      .toEqual({ x: 112, y: 0, width: PANEL_SIZE.width, height: PANEL_SIZE.height })
  })

  it('clamps to the work area edge when neither side fits', () => {
    const small: DesktopWorkArea = { x: 0, y: 0, width: 800, height: 800 }
    expect(panelBounds({ version: 1, orb: { x: 300, y: 600 }, pinned: false }, small))
      .toEqual({ x: 240, y: 600, width: PANEL_SIZE.width, height: PANEL_SIZE.height })
  })

  it('follows a work area that starts at a negative screen origin', () => {
    const display: DesktopWorkArea = { x: -1920, y: 0, width: 1920, height: 1080 }
    expect(panelBounds({ version: 1, orb: { x: -136, y: 484 }, pinned: false }, display))
      .toEqual({ x: -696, y: 484, width: PANEL_SIZE.width, height: PANEL_SIZE.height })
  })
})

describe('bubble bounds', () => {
  it('places the column above the orb inside its shadow margin', () => {
    const bounds = bubblesBounds(
      { version: 1, orb: { x: 1800, y: 400 }, pinned: false },
      { x: 0, y: 0, width: 1920, height: 1080 },
    )
    expect(bounds).toEqual({
      x: 1532 - BUBBLES_WINDOW_MARGIN,
      y: SCREEN_MARGIN - BUBBLES_WINDOW_MARGIN,
      width: BUBBLES_WIDTH + 2 * BUBBLES_WINDOW_MARGIN,
      height: 364 + 2 * BUBBLES_WINDOW_MARGIN,
    })
    // The visible column still ends just above the orb, which lives in its own resident window.
    expect(bounds.y + bounds.height - BUBBLES_WINDOW_MARGIN).toBe(400 - BUBBLES_GAP)
  })

  it('shrinks the column to the room above an orb near the top edge', () => {
    const layout = { version: 1, orb: { x: 1800, y: 160 }, pinned: false } as const
    const bounds = bubblesBounds(layout, { x: 0, y: 0, width: 1920, height: 1080 })
    expect(bounds).toEqual({
      x: 1532 - BUBBLES_WINDOW_MARGIN,
      y: SCREEN_MARGIN - BUBBLES_WINDOW_MARGIN,
      width: BUBBLES_WIDTH + 2 * BUBBLES_WINDOW_MARGIN,
      height: 124 + 2 * BUBBLES_WINDOW_MARGIN,
    })
  })

  it('keeps the column inside a work area it would overflow and reaches the screen edge with the margin', () => {
    const layout = { version: 1, orb: { x: 0, y: 0 }, pinned: false } as const
    expect(bubblesBounds(layout, { x: 0, y: 0, width: 320, height: 400 }))
      .toEqual({ x: -BUBBLES_WINDOW_MARGIN, y: 0, width: 320 + 2 * BUBBLES_WINDOW_MARGIN,
        height: ORB_SIZE + 2 * BUBBLES_WINDOW_MARGIN })
  })
})

describe('modal bounds', () => {
  it('centers the dialog and its shadow margin inside the display work area', () => {
    expect(modalBounds({ x: -1920, y: -200, width: 1920, height: 1080 }))
      .toEqual({ x: -1416, y: -12, width: 912, height: 704 })
  })

  it('leaves room for the card window shadow on every side', () => {
    const bounds = modalBounds(WORK_AREA)
    expect(bounds.width - MODAL_SIZE.width).toBe(2 * MODAL_WINDOW_MARGIN)
    expect(bounds.height - MODAL_SIZE.height).toBe(2 * MODAL_WINDOW_MARGIN)
  })

  it('shrinks to a work area smaller than the dialog box', () => {
    expect(modalBounds({ x: 0, y: 0, width: 640, height: 480 }))
      .toEqual({ x: SCREEN_MARGIN, y: SCREEN_MARGIN, width: 640 - 2 * SCREEN_MARGIN, height: 480 - 2 * SCREEN_MARGIN })
  })

  it('grows to the requested work-area height fraction', () => {
    expect(modalBounds({ x: 0, y: 0, width: 2560, height: 1440 }, { heightRatio: 0.8 }))
      .toEqual({ x: 824, y: 72, width: 912, height: 1296 })
  })

  it('keeps the dialog height on a work area the fraction would shrink below it', () => {
    expect(modalBounds({ x: 0, y: 0, width: 1280, height: 600 }, { heightRatio: 0.8 }))
      .toEqual({ x: 184, y: SCREEN_MARGIN, width: 912, height: 600 - 2 * SCREEN_MARGIN })
  })

  it('grows to the requested dialog width', () => {
    expect(modalBounds({ x: 0, y: 0, width: 2560, height: 1440 }, { width: 1488 }))
      .toEqual({ x: 464, y: 368, width: 1632, height: 704 })
  })

  it('keeps the dialog width on a hint narrower than it', () => {
    expect(modalBounds({ x: 0, y: 0, width: 2560, height: 1440 }, { width: 600 }))
      .toEqual({ x: 824, y: 368, width: 912, height: 704 })
  })

  it('clamps the requested dialog width to the work area', () => {
    expect(modalBounds({ x: 0, y: 0, width: 1280, height: 600 }, { width: 1488 }))
      .toEqual({ x: SCREEN_MARGIN, y: SCREEN_MARGIN, width: 1280 - 2 * SCREEN_MARGIN, height: 600 - 2 * SCREEN_MARGIN })
  })

  it('treats an empty size hint as the dialog size', () => {
    expect(modalBounds({ x: 0, y: 0, width: 1920, height: 1080 }, {}))
      .toEqual(modalBounds({ x: 0, y: 0, width: 1920, height: 1080 }))
  })
})

describe('form window options', () => {
  it('builds the transparent always-on-top product window at the orb bounds', () => {
    const options = formWindowOptions({ preload: '/app/preload-app.js', role: 'orb', layout: LAYOUT, workArea: WORK_AREA })
    expect(options).toMatchObject({
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
      x: 300,
      y: 200,
      width: ORB_SIZE,
      height: ORB_SIZE,
      minWidth: ORB_SIZE,
      minHeight: ORB_SIZE,
    })
    expect(options.webPreferences).toEqual({
      preload: '/app/preload-app.js',
      additionalArguments: ['--dsh-desktop-form-window', '--dsh-desktop-form-role=orb'],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: true,
      devTools: true,
    })
    if (process.platform !== 'darwin') expect(options.titleBarStyle).toBeUndefined()
  })

  it('marks each form window with its role and keeps the same native options', () => {
    const orb = formWindowOptions({ preload: '/app/preload-app.js', role: 'orb', layout: LAYOUT, workArea: WORK_AREA })
    const nativeOptions = ({ webPreferences: _webPreferences, ...rest }: typeof orb): Omit<typeof orb, 'webPreferences'> => rest
    for (const role of ['surface', 'bubbles'] as const) {
      const options = formWindowOptions({ preload: '/app/preload-app.js', role, layout: LAYOUT, workArea: WORK_AREA })
      expect(options.webPreferences).toMatchObject({
        additionalArguments: ['--dsh-desktop-form-window', `--dsh-desktop-form-role=${role}`],
      })
      expect(nativeOptions(options)).toEqual(nativeOptions(orb))
    }
  })

  it('clamps the constructed bounds into the work area', () => {
    const options = formWindowOptions({
      preload: '/app/preload-app.js',
      role: 'surface',
      layout: { version: 1, orb: { x: -40, y: 5000 }, pinned: true },
      workArea: WORK_AREA,
    })
    expect(options).toMatchObject({ x: 0, y: 968, width: ORB_SIZE, height: ORB_SIZE })
  })

  it('hides the title bar on macOS', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    try {
      expect(formWindowOptions({ preload: '/app/preload-app.js', role: 'orb', layout: LAYOUT, workArea: WORK_AREA }).titleBarStyle)
        .toBe('hidden')
    } finally {
      if (platform !== undefined) Object.defineProperty(process, 'platform', platform)
    }
  })
})

describe('presentation resizing', () => {
  it('allows resizing only the expanded panel', () => {
    expect(presentationResizable('panel')).toBe(true)
    expect(presentationResizable('orb')).toBe(false)
    expect(presentationResizable('modal')).toBe(false)
  })
})

describe('containsPoint', () => {
  const RECT = { x: 100, y: 200, width: 40, height: 20 }

  it('accepts the left and top edges and rejects the right and bottom edges', () => {
    expect(containsPoint(RECT, { x: 100, y: 200 })).toBe(true)
    expect(containsPoint(RECT, { x: 139, y: 219 })).toBe(true)
    expect(containsPoint(RECT, { x: 140, y: 210 })).toBe(false)
    expect(containsPoint(RECT, { x: 110, y: 220 })).toBe(false)
  })

  it('rejects points outside on either axis', () => {
    expect(containsPoint(RECT, { x: 99, y: 210 })).toBe(false)
    expect(containsPoint(RECT, { x: 110, y: 199 })).toBe(false)
    expect(containsPoint({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0 })).toBe(false)
  })
})
