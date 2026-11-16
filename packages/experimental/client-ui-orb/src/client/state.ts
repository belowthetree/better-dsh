/** Pure derivations for the orb overlay: visual state, label keys, and the active Session. */
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { VoiceCaptureSnapshot } from '@deepseek-ai/dsh-client-voice-capture/client'
import type { VoiceOutputSnapshot } from '@deepseek-ai/dsh-client-ui-voice-output/client'

/** Visual state the orb reflects; each state carries its own localized label. */
export type OrbVisualState = 'idle' | 'capturing' | 'transcribing' | 'running' | 'speaking'

/** Localized label key of one orb visual state. */
export type OrbLabelKey =
  | 'orb.open'
  | 'orb.openCapturing'
  | 'orb.openTranscribing'
  | 'orb.openRunning'
  | 'orb.openSpeaking'

/** Voice observations the orb reflects; an unmounted sibling plugin reports null. */
export interface OrbVoiceObservation {
  /** Microphone capture snapshot from `ctx.voiceCapture`, or null while that plugin is unmounted. */
  readonly capture: VoiceCaptureSnapshot | null
  /** Playback snapshot from `ctx.voiceOutput`, or null while that plugin is unmounted. */
  readonly voice: VoiceOutputSnapshot | null
}

/**
 * Resolve the one visual state the orb shows.
 * @param observation - current capture and playback snapshots.
 * @param running - whether the active Session is busy.
 * @returns capture first, then playback, then Session work, then idle.
 */
export function orbVisualState(observation: OrbVoiceObservation, running: boolean): OrbVisualState {
  const phase = observation.capture?.phase
  if (phase === 'capturing') return 'capturing'
  if (phase === 'transcribing') return 'transcribing'
  if (observation.voice?.speaking === true) return 'speaking'
  return running ? 'running' : 'idle'
}

/**
 * Map one visual state onto its accessibility-label key.
 * @param state - resolved visual state.
 * @returns dictionary key of that state's label.
 */
export function orbLabelKey(state: OrbVisualState): OrbLabelKey {
  switch (state) {
    case 'capturing':
      return 'orb.openCapturing'
    case 'transcribing':
      return 'orb.openTranscribing'
    case 'speaking':
      return 'orb.openSpeaking'
    case 'running':
      return 'orb.openRunning'
    case 'idle':
      return 'orb.open'
  }
}

/**
 * Find the Session the frame's main view currently shows.
 * @param list - Session list snapshot from the `useSessions` seat.
 * @returns the retained main-view row, or undefined while no Session is current.
 */
export function activeSession(list: SessionListState): SessionSummary | undefined {
  for (const id of list.ids) {
    const row = list.byId[id]
    if (row !== undefined && (row.retainedBy.mainView ?? 0) > 0) return row
  }
  return undefined
}
