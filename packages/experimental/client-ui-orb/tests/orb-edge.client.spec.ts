// @vitest-environment node
/** Screen-edge docking predicate that selects the orb artwork. */
import { describe, expect, it } from 'vitest'
import { ORB_EDGE_THRESHOLD, isOrbAtScreenEdge } from '../src/client/orb-edge.ts'

const AREA = { x: 0, y: 0, width: 1000, height: 800 }
const ORB = { x: 400, y: 300, width: 160, height: 160 }

describe('orb screen-edge docking', () => {
  it('counts each work-area side within the threshold as docked', () => {
    expect(isOrbAtScreenEdge({ ...ORB, x: 0 }, AREA)).toBe(true)
    expect(isOrbAtScreenEdge({ ...ORB, x: 840 }, AREA)).toBe(true)
    expect(isOrbAtScreenEdge({ ...ORB, y: 0 }, AREA)).toBe(true)
    expect(isOrbAtScreenEdge({ ...ORB, y: 640 }, AREA)).toBe(true)
  })

  it('uses the docking threshold as an inclusive boundary on both sides', () => {
    expect(isOrbAtScreenEdge({ ...ORB, x: ORB_EDGE_THRESHOLD }, AREA)).toBe(true)
    expect(isOrbAtScreenEdge({ ...ORB, x: ORB_EDGE_THRESHOLD + 1 }, AREA)).toBe(false)
    expect(isOrbAtScreenEdge({ ...ORB, x: AREA.width - ORB.width - ORB_EDGE_THRESHOLD }, AREA)).toBe(true)
    expect(isOrbAtScreenEdge({ ...ORB, x: AREA.width - ORB.width - ORB_EDGE_THRESHOLD - 1 }, AREA)).toBe(false)
  })

  it('floats free in the middle of the work area', () => {
    expect(isOrbAtScreenEdge(ORB, AREA)).toBe(false)
  })
})
