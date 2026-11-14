import { describe, expect, it } from 'vitest'
import {
  ORB_SIZE,
  PANEL_MIN_SIZE,
  PANEL_SIZE,
  SCREEN_MARGIN,
  formWindowOptions,
  modalBounds,
  orbBounds,
  panelBounds,
  presentationResizable,
} from '../src/form-window.ts'
import type { DesktopFormLayout, DesktopWorkArea } from '../src/form-layout.ts'

const WORK_AREA: DesktopWorkArea = { x: 0, y: 0, width: 1920, height: 1080 }
const LAYOUT: DesktopFormLayout = { version: 1, orb: { x: 300, y: 200 }, pinned: false }

describe('form presentation constants', () => {
  it('pins the orb, panel, margin, and minimum panel sizes', () => {
    expect(ORB_SIZE).toBe(112)
    expect(PANEL_SIZE).toEqual({ width: 420, height: 720 })
    expect(PANEL_MIN_SIZE).toEqual({ width: 320, height: 480 })
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
      .toEqual({ x: 1364, y: 360, width: PANEL_SIZE.width, height: PANEL_SIZE.height })
  })

  it('opens right of the orb when the left side does not fit', () => {
    expect(panelBounds({ version: 1, orb: { x: 0, y: 0 }, pinned: false }, WORK_AREA))
      .toEqual({ x: 112, y: 0, width: PANEL_SIZE.width, height: PANEL_SIZE.height })
  })

  it('clamps to the work area edge when neither side fits', () => {
    const small: DesktopWorkArea = { x: 0, y: 0, width: 800, height: 800 }
    expect(panelBounds({ version: 1, orb: { x: 300, y: 600 }, pinned: false }, small))
      .toEqual({ x: 380, y: 80, width: PANEL_SIZE.width, height: PANEL_SIZE.height })
  })

  it('follows a work area that starts at a negative screen origin', () => {
    const display: DesktopWorkArea = { x: -1920, y: 0, width: 1920, height: 1080 }
    expect(panelBounds({ version: 1, orb: { x: -136, y: 484 }, pinned: false }, display))
      .toEqual({ x: -556, y: 360, width: PANEL_SIZE.width, height: PANEL_SIZE.height })
  })
})

describe('modal bounds', () => {
  it('covers the whole display work area', () => {
    expect(modalBounds({ x: -1920, y: -200, width: 1920, height: 1080 }))
      .toEqual({ x: -1920, y: -200, width: 1920, height: 1080 })
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
