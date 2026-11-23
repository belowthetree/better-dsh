/** Shared identity of the orb balloon tool and the presentation payload its result persists. */

/** Tool name the bubble column watches for its character balloon. */
export const ORB_BALLOON_TOOL = 'orb_balloon'

/** Longest balloon text one call may speak; the column clamps it to three lines. */
export const ORB_BALLOON_MAX_CHARS = 280

/** Click behaviour one balloon may carry. */
export type OrbBalloonAction = 'none' | 'open'

/** Persisted presentation payload the bubble column reads back from `tool/result`. */
export interface OrbBalloonMeta {
  readonly balloon: {
    /** Text the balloon shows and the narration speaks. */
    readonly text: string
    /** Session the balloon opens on click; absent for a plain remark. */
    readonly sessionId?: string
    /** Click behaviour. */
    readonly action: OrbBalloonAction
  }
}
