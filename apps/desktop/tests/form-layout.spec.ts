import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DesktopFormLayoutStore,
  clampFormLayout,
  defaultFormLayout,
  formLayoutPath,
  parseFormLayout,
  type DesktopFormLayout,
  type DesktopWorkArea,
} from '../src/form-layout.ts'

const roots: string[] = []
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-form-layout-'))
  roots.push(root)
  return root
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const WORK_AREA: DesktopWorkArea = { x: 0, y: 0, width: 1920, height: 1080 }
const LAYOUT: DesktopFormLayout = { version: 1, orb: { x: 300, y: 200 }, pinned: true }

describe('form layout defaults', () => {
  it('places the orb at the right edge cut by the screen margin, vertically centred, unpinned', () => {
    expect(defaultFormLayout({ x: 100, y: 50, width: 800, height: 600 }))
      .toEqual({ version: 1, orb: { x: 716, y: 270 }, pinned: false })
  })

  it('places the default orb on a display left of the primary one', () => {
    expect(defaultFormLayout({ x: -1920, y: 0, width: 1920, height: 1080 }))
      .toEqual({ version: 1, orb: { x: -184, y: 460 }, pinned: false })
  })
})

describe('form layout clamping', () => {
  it('keeps an inside orb and the pinned flag unchanged', () => {
    expect(clampFormLayout(LAYOUT, WORK_AREA)).toEqual(LAYOUT)
  })

  it('moves an orb past the right and bottom edges back inside', () => {
    expect(clampFormLayout({ version: 1, orb: { x: 5000, y: 5000 }, pinned: true }, WORK_AREA))
      .toEqual({ version: 1, orb: { x: 1760, y: 920 }, pinned: true })
  })

  it('moves an orb past the left and top edges back inside', () => {
    expect(clampFormLayout({ version: 1, orb: { x: -50, y: -50 }, pinned: false }, WORK_AREA))
      .toEqual({ version: 1, orb: { x: 0, y: 0 }, pinned: false })
  })

  it('puts fractional coordinates on whole logical pixels', () => {
    expect(clampFormLayout({ version: 1, orb: { x: 1.6, y: -0.4 }, pinned: false }, WORK_AREA))
      .toEqual({ version: 1, orb: { x: 2, y: 0 }, pinned: false })
  })

  it('clamps against a work area that starts at a negative screen origin', () => {
    expect(clampFormLayout({ version: 1, orb: { x: -5000, y: -5000 }, pinned: false }, { x: -1920, y: -200, width: 1920, height: 1080 }))
      .toEqual({ version: 1, orb: { x: -1920, y: -200 }, pinned: false })
  })
})

describe('form layout parsing', () => {
  it('reads a supported layout and drops unknown fields', () => {
    expect(parseFormLayout(JSON.stringify({ ...LAYOUT, extra: true }))).toEqual(LAYOUT)
    expect(parseFormLayout(JSON.stringify({ version: 1, orb: { x: 1, y: 2, width: 112 }, pinned: false })))
      .toEqual({ version: 1, orb: { x: 1, y: 2 }, pinned: false })
  })

  it('falls back to defaults for absent or unparseable content', () => {
    expect(parseFormLayout(null)).toBeUndefined()
    expect(parseFormLayout('not json')).toBeUndefined()
    expect(parseFormLayout('')).toBeUndefined()
  })

  it('falls back to defaults for JSON that is not an object', () => {
    expect(parseFormLayout('1')).toBeUndefined()
    expect(parseFormLayout('null')).toBeUndefined()
    expect(parseFormLayout('[]')).toBeUndefined()
    expect(parseFormLayout('"layout"')).toBeUndefined()
  })

  it('falls back to defaults for an unsupported schema version', () => {
    expect(parseFormLayout(JSON.stringify({ version: 2, orb: { x: 0, y: 0 }, pinned: false }))).toBeUndefined()
    expect(parseFormLayout(JSON.stringify({ orb: { x: 0, y: 0 }, pinned: false }))).toBeUndefined()
  })

  it('falls back to defaults for a missing or malformed orb position', () => {
    expect(parseFormLayout(JSON.stringify({ version: 1, pinned: false }))).toBeUndefined()
    expect(parseFormLayout(JSON.stringify({ version: 1, orb: 'orb', pinned: false }))).toBeUndefined()
    expect(parseFormLayout(JSON.stringify({ version: 1, orb: { x: 0 }, pinned: false }))).toBeUndefined()
    expect(parseFormLayout(JSON.stringify({ version: 1, orb: { x: '0', y: 0 }, pinned: false }))).toBeUndefined()
    expect(parseFormLayout(JSON.stringify({ version: 1, orb: { x: 0, y: Number.NaN }, pinned: false }))).toBeUndefined()
    expect(parseFormLayout(JSON.stringify({ version: 1, orb: { x: 0, y: Number.POSITIVE_INFINITY }, pinned: false })))
      .toBeUndefined()
    expect(parseFormLayout(JSON.stringify({ version: 1, orb: { x: 0, y: Number.MAX_SAFE_INTEGER + 1 }, pinned: false })))
      .toBeUndefined()
  })

  it('restores a scaled-display position as whole logical pixels', () => {
    expect(parseFormLayout('{"version":1,"orb":{"x":2400,"y":622.6666259765625},"pinned":false}'))
      .toEqual({ version: 1, orb: { x: 2400, y: 623 }, pinned: false })
  })

  it('falls back to defaults for a non-boolean pinned flag', () => {
    expect(parseFormLayout(JSON.stringify({ version: 1, orb: { x: 0, y: 0 }, pinned: 'yes' }))).toBeUndefined()
    expect(parseFormLayout(JSON.stringify({ version: 1, orb: { x: 0, y: 0 } }))).toBeUndefined()
  })
})

describe('desktop form layout store', () => {
  it('resolves the layout file inside the userData directory', () => {
    expect(formLayoutPath(join('/tmp', 'user-data'))).toBe(join('/tmp', 'user-data', 'form-layout.json'))
  })

  it('reads undefined for an absent file', async () => {
    const store = new DesktopFormLayoutStore(formLayoutPath(fixture()))
    expect(await store.read()).toBeUndefined()
  })

  it('round-trips a layout with an atomic replacement holding only the layout file', async () => {
    const userData = join(fixture(), 'user-data')
    const store = new DesktopFormLayoutStore(formLayoutPath(userData))
    await store.save(LAYOUT)
    expect(await store.read()).toEqual(LAYOUT)
    expect(readFileSync(formLayoutPath(userData), 'utf8')).toBe(JSON.stringify(LAYOUT) + '\n')
    expect(readdirSync(userData)).toEqual(['form-layout.json'])
    if (process.platform !== 'win32') {
      expect(statSync(formLayoutPath(userData)).mode & 0o777).toBe(0o600)
      expect(statSync(userData).mode & 0o777).toBe(0o700)
    }
  })

  it('reads undefined for unreadable content and unsupported versions', async () => {
    const userData = fixture()
    const path = formLayoutPath(userData)
    const store = new DesktopFormLayoutStore(path)
    writeFileSync(path, 'not json')
    expect(await store.read()).toBeUndefined()
    writeFileSync(path, JSON.stringify({ version: 2, orb: { x: 0, y: 0 }, pinned: false }))
    expect(await store.read()).toBeUndefined()
  })

  it('reads undefined when the layout path is not a regular file', async () => {
    const userData = fixture()
    mkdirSync(formLayoutPath(userData))
    const store = new DesktopFormLayoutStore(formLayoutPath(userData))
    expect(await store.read()).toBeUndefined()
  })

  it('serializes concurrent saves so the last writer wins', async () => {
    const store = new DesktopFormLayoutStore(formLayoutPath(fixture()))
    const first: DesktopFormLayout = { version: 1, orb: { x: 1, y: 2 }, pinned: false }
    const second: DesktopFormLayout = { version: 1, orb: { x: 3, y: 4 }, pinned: true }
    await Promise.all([store.save(first), store.save(second)])
    expect(await store.read()).toEqual(second)
  })

  it('keeps saving after a failed write', async () => {
    const root = fixture()
    const blocker = join(root, 'blocked')
    writeFileSync(blocker, 'not a directory')
    const store = new DesktopFormLayoutStore(join(blocker, 'form-layout.json'))
    await expect(store.save(LAYOUT)).rejects.toThrow()
    rmSync(blocker)
    await store.save(LAYOUT)
    expect(await store.read()).toEqual(LAYOUT)
  })
})
