/** Placement of registered orb actions on the half circle facing the work-area center. */
import { expect, it } from 'vitest'
import {
  MAX_ORB_ACTIONS, ORB_ACTION_RADIUS, ORB_ACTION_SIZE, ORB_SIZE, orbActionPlacements,
} from '../src/client/orb-action-layout.ts'

/** Center of the orb square for a window-relative anchor. */
const center = (anchorX: number, anchorY: number) => ({ x: anchorX + ORB_SIZE / 2, y: anchorY + ORB_SIZE / 2 })

/** Distance between two placements' button centers. */
function distance(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

it('places one action directly toward the work-area center', () => {
  const [placement] = orbActionPlacements(1, 70, 70, 0)
  const centerPoint = center(70, 70)
  expect(placement).toEqual({
    x: Math.round(centerPoint.x + ORB_ACTION_RADIUS - ORB_ACTION_SIZE / 2),
    y: Math.round(centerPoint.y - ORB_ACTION_SIZE / 2),
  })
})

it('spreads several actions over a half circle around the direction', () => {
  const placements = orbActionPlacements(3, 70, 70, Math.PI)
  const centerPoint = center(70, 70)
  expect(placements).toHaveLength(3)
  // The outer actions sit at the vertical ends of the half circle, the middle
  // action on the center line, all at the ring radius.
  expect(placements[0]?.x).toBe(Math.round(centerPoint.x - ORB_ACTION_SIZE / 2))
  expect(placements[0]?.y).toBe(Math.round(centerPoint.y + ORB_ACTION_RADIUS - ORB_ACTION_SIZE / 2))
  expect(placements[1]?.x).toBe(Math.round(centerPoint.x - ORB_ACTION_RADIUS - ORB_ACTION_SIZE / 2))
  expect(placements[1]?.y).toBe(Math.round(centerPoint.y - ORB_ACTION_SIZE / 2))
  expect(placements[2]?.y).toBe(Math.round(centerPoint.y - ORB_ACTION_RADIUS - ORB_ACTION_SIZE / 2))
  expect(distance(placements[0]!, placements[1]!)).toBeGreaterThan(ORB_ACTION_SIZE)
})

it('caps the ring at the number of actions it can hold', () => {
  expect(orbActionPlacements(MAX_ORB_ACTIONS + 4, 0, 0, 0)).toHaveLength(MAX_ORB_ACTIONS)
  expect(orbActionPlacements(0, 0, 0, 0)).toEqual([])
})

it('follows the anchor so a clamped window keeps the ring around the orb', () => {
  const [unclamped] = orbActionPlacements(1, 70, 70, 0)
  const [clamped] = orbActionPlacements(1, 140, 0, 0)
  expect((unclamped?.x ?? 0) - 70).toBe((clamped?.x ?? 0) - 140)
  expect((unclamped?.y ?? 0) - 70).toBe((clamped?.y ?? 0) - 0)
})
