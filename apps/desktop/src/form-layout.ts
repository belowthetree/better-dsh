/** Persisted orb placement and pinning for the desktop form window. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { ORB_SIZE, SCREEN_MARGIN } from './form-window.ts'

/** File name of the layout file inside Electron's userData directory. */
const FORM_LAYOUT_FILENAME = 'form-layout.json'

/** Persisted orb placement for the desktop form window. */
export interface DesktopFormLayout {
  /** Layout schema version; a future version falls back to defaults. */
  readonly version: 1
  /** Orb top-left in display work-area coordinates. */
  readonly orb: { readonly x: number; readonly y: number }
  /** Whether the expanded panel stays visible while the user works elsewhere. */
  readonly pinned: boolean
}

/** A display work area in logical coordinates; never zero-sized. */
export interface DesktopWorkArea {
  /** Work area left edge in logical screen coordinates. */
  readonly x: number
  /** Work area top edge in logical screen coordinates. */
  readonly y: number
  /** Work area width in logical pixels. */
  readonly width: number
  /** Work area height in logical pixels. */
  readonly height: number
}

/** Whether a parsed JSON value is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read one finite position coordinate as a whole logical pixel.
 * Renderer drag deltas may be fractional on scaled displays, so a persisted
 * layout carrying such a position still restores instead of falling back to the default.
 * @param value - raw coordinate read from untrusted file content.
 * @returns the coordinate rounded to the nearest whole logical pixel, or undefined for every other value.
 */
function positionCoordinate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
    ? Math.round(value)
    : undefined
}

/**
 * Place the orb at the work area's right edge with a 24 px margin, vertically centred, rounded to the nearest pixel, and unpinned.
 * @param workArea - work area of the display the orb should appear on.
 * @returns the default layout for that display.
 */
export function defaultFormLayout(workArea: DesktopWorkArea): DesktopFormLayout {
  return {
    version: 1,
    orb: {
      x: workArea.x + workArea.width - ORB_SIZE - SCREEN_MARGIN,
      y: workArea.y + Math.round((workArea.height - ORB_SIZE) / 2),
    },
    pinned: false,
  }
}

/**
 * Parse one persisted layout without trusting its content.
 * Absent, unparseable, wrong-version, wrong-type, and out-of-range content yields undefined; the file is untrusted user data.
 * Fractional coordinates are rounded to whole logical pixels.
 * @param raw - file content, or null when the file is absent.
 * @returns the parsed layout, or undefined when the content is not a supported layout.
 */
export function parseFormLayout(raw: string | null): DesktopFormLayout | undefined {
  if (raw === null) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  if (parsed.version !== 1) return undefined
  if (!isRecord(parsed.orb)) return undefined
  const x = positionCoordinate(parsed.orb.x)
  const y = positionCoordinate(parsed.orb.y)
  if (x === undefined || y === undefined) return undefined
  const pinned = parsed.pinned
  if (typeof pinned !== 'boolean') return undefined
  return { version: 1, orb: { x, y }, pinned }
}

/**
 * Clamp the orb's top-left so the full orb square stays inside the work area.
 * @param layout - persisted or candidate layout.
 * @param workArea - target work area; it must be at least ORB_SIZE wide and tall.
 * @returns the layout with the orb moved inside the work area, its coordinates on whole logical pixels, and its pinned flag preserved.
 */
export function clampFormLayout(layout: DesktopFormLayout, workArea: DesktopWorkArea): DesktopFormLayout {
  return {
    version: 1,
    orb: {
      x: Math.min(Math.max(Math.round(layout.orb.x), workArea.x), workArea.x + workArea.width - ORB_SIZE),
      y: Math.min(Math.max(Math.round(layout.orb.y), workArea.y), workArea.y + workArea.height - ORB_SIZE),
    },
    pinned: layout.pinned,
  }
}

/**
 * Resolve the persisted layout path inside Electron's userData directory.
 * @param userData - absolute Electron userData directory.
 * @returns absolute path of the layout file.
 */
export function formLayoutPath(userData: string): string {
  return join(userData, FORM_LAYOUT_FILENAME)
}

/** File-backed single-writer store for the persisted layout. */
export class DesktopFormLayoutStore {
  private queue: Promise<void> = Promise.resolve()

  /** @param path - absolute layout file path from {@link formLayoutPath}. */
  constructor(private readonly path: string) {}

  /**
   * Read the persisted layout.
   * @returns the parsed layout, or undefined when the file is absent or unreadable and the caller should use defaults.
   */
  async read(): Promise<DesktopFormLayout | undefined> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (error) {
      // Layout geometry is cosmetic state; a file the desktop cannot read falls back to defaults.
      void error
      return undefined
    }
    return parseFormLayout(raw)
  }

  /**
   * Persist a layout, serialized with every other save to this store; the last writer wins.
   * @param layout - complete layout to write atomically with owner-only permissions.
   */
  async save(layout: DesktopFormLayout): Promise<void> {
    const write = this.queue.then(async () => {
      await writeFileAtomic(this.path, `${JSON.stringify(layout)}\n`, { mode: 0o600, dirMode: 0o700 })
    })
    // A failed write must not reject every later save, so the queue records the settled attempt instead of the rejection.
    this.queue = write.catch(() => undefined)
    await write
  }
}
