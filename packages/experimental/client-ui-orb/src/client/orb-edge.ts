/** Screen-edge proximity that chooses the docked peek or the free-standing artwork. */

/**
 * Gap in logical pixels within which the orb counts as resting against a screen edge.
 * Keep in sync with ORB_SNAP_GAP in apps/desktop/src/form-window.ts: beyond the
 * snap distance the artwork returns to the free-standing pose.
 */
export const ORB_EDGE_THRESHOLD = 24

/** A rectangle in logical screen coordinates. */
export interface ScreenRectangle {
  /** Left edge in logical screen coordinates. */
  readonly x: number
  /** Top edge in logical screen coordinates. */
  readonly y: number
  /** Width in logical pixels. */
  readonly width: number
  /** Height in logical pixels. */
  readonly height: number
}

/**
 * Report whether any orb side rests within the docking threshold of the work-area edge it faces.
 * @param orb - orb window rectangle in logical screen coordinates.
 * @param area - display work area in the same coordinates.
 * @param threshold - largest gap that still counts as docked against an edge.
 * @returns true while the orb sits near a work-area edge, false once it floats free.
 */
export function isOrbAtScreenEdge(orb: ScreenRectangle, area: ScreenRectangle, threshold = ORB_EDGE_THRESHOLD): boolean {
  return orb.x - area.x <= threshold
    || orb.y - area.y <= threshold
    || area.x + area.width - (orb.x + orb.width) <= threshold
    || area.y + area.height - (orb.y + orb.height) <= threshold
}
