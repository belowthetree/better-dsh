/**
 * Geometry of the orb's options ring. The orb window is a 160-pixel square at
 * rest; while the ring is open the carrier grows it into a 300-pixel pad, so
 * the ring can sit outside the mascot artwork.
 */

/** Orb square edge in CSS pixels; keep in sync with `ORB_SIZE` in apps/desktop/src/form-window.ts. */
export const ORB_SIZE = 160

/** Radius from the orb center to one action button's center, in CSS pixels. */
export const ORB_ACTION_RADIUS = 118

/** Diameter of one round action button, in CSS pixels. */
export const ORB_ACTION_SIZE = 40

/** Actions the half ring holds without crowding its neighbours. */
export const MAX_ORB_ACTIONS = 8

/** Top-left corner of one action button, relative to the orb window content. */
export interface OrbActionPlacement {
  readonly x: number
  readonly y: number
}

/**
 * Place the registered action buttons on the half circle that opens toward the
 * work-area center.
 * @param count - number of registered actions, at most `MAX_ORB_ACTIONS`.
 * @param anchorX - orb square left edge inside the orb window content.
 * @param anchorY - orb square top edge inside the orb window content.
 * @param direction - direction in radians from the orb center toward the work-area center.
 * @returns one top-left corner per action, in registration order.
 */
export function orbActionPlacements(
  count: number,
  anchorX: number,
  anchorY: number,
  direction: number,
): OrbActionPlacement[] {
  const total = Math.min(count, MAX_ORB_ACTIONS)
  const centerX = anchorX + ORB_SIZE / 2
  const centerY = anchorY + ORB_SIZE / 2
  const placements: OrbActionPlacement[] = []
  for (let index = 0; index < total; index += 1) {
    const offset = total === 1 ? 0 : (index / (total - 1) - 0.5) * Math.PI
    const angle = direction + offset
    placements.push({
      x: Math.round(centerX + ORB_ACTION_RADIUS * Math.cos(angle) - ORB_ACTION_SIZE / 2),
      y: Math.round(centerY + ORB_ACTION_RADIUS * Math.sin(angle) - ORB_ACTION_SIZE / 2),
    })
  }
  return placements
}
