import { describe, expect, it } from 'vitest'
import {
  MODAL_SIZE,
  ORB_SIZE,
  PANEL_MIN_SIZE,
  PANEL_SIZE,
  SCREEN_MARGIN,
  formWindowOptions,
  BUBBLES_WIDTH,
  bubblesBounds,
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
  it('spans the column and the orb, growing upward from the orb bottom edge', () => {
    const bounds = bubblesBounds(
      { version: 1, orb: { x: 1800, y: 400 }, pinned: false },
      { x: 0, y: 0, width: 1920, height: 1080 },
    )
    expect(bounds).toEqual({ x: 1920 - BUBBLES_WIDTH - 8, y: SCREEN_MARGIN, width: BUBBLES_WIDTH, height: 648 })
  })

  it('keeps the column inside a work area it would overflow', () => {
    const layout = { version: 1, orb: { x: 0, y: 0 }, pinned: false } as const
    expect(bubblesBounds(layout, { x: 0, y: 0, width: 320, height: 400 }))
      .toEqual({ x: 0, y: 0, width: 320, height: 264 })
  })
})

describe('modal bounds', () => {
  it('centers the dialog box inside the display work area', () => {
    expect(modalBounds({ x: -1920, y: -200, width: 1920, height: 1080 }))
      .toEqual({ x: -1344, y: 60, width: MODAL_SIZE.width, height: MODAL_SIZE.height })
  })

  it('shrinks to a work area smaller than the dialog box', () => {
    expect(modalBounds({ x: 0, y: 0, width: 640, height: 480 }))
      .toEqual({ x: 0, y: 0, width: 640, height: 480 })
  })

  it('grows to the requested work-area height fraction', () => {
    expect(modalBounds({ x: 0, y: 0, width: 2560, height: 1440 }, { heightRatio: 0.8 }))
      .toEqual({ x: 896, y: 144, width: MODAL_SIZE.width, height: 1152 })
  })

  it('keeps the dialog height on a work area the fraction would shrink below it', () => {
    expect(modalBounds({ x: 0, y: 0, width: 1280, height: 600 }, { heightRatio: 0.8 }))
      .toEqual({ x: 256, y: 20, width: MODAL_SIZE.width, height: MODAL_SIZE.height })
  })

  it('treats an empty size hint as the dialog size', () => {
    expect(modalBounds({ x: 0, y: 0, width: 1920, height: 1080 }, {}))
      .toEqual(modalBounds({ x: 0, y: 0, width: 1920, height: 1080 }))
  })
})

describe('form window options', () => {
  it('builds the transparent always-on-top product window at the orb bounds', () => {
    const options = formWindowOptions({ preload: '/app/preload-app.js', layout: LAYOUT, workArea: WORK_AREA })
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
      additionalArguments: ['--dsh-desktop-form-window'],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: true,
      devTools: true,
    })
    if (process.platform !== 'darwin') expect(options.titleBarStyle).toBeUndefined()
  })

  it('clamps the constructed bounds into the work area', () => {
    const options = formWindowOptions({
      preload: '/app/preload-app.js',
      layout: { version: 1, orb: { x: -40, y: 5000 }, pinned: true },
      workArea: WORK_AREA,
    })
    expect(options).toMatchObject({ x: 0, y: 968, width: ORB_SIZE, height: ORB_SIZE })
  })

  it('hides the title bar on macOS', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    try {
      expect(formWindowOptions({ preload: '/app/preload-app.js', layout: LAYOUT, workArea: WORK_AREA }).titleBarStyle)
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
