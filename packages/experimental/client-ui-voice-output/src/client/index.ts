/** Browser entry: mount the speechOutput Remote and provide the shared playback service. */
import type { Context } from '@deepseek-ai/cordis'
import speechOutputRemote from '@deepseek-ai/dsh-api-text-to-speech/remote'
import { mountVoiceOutput } from './mount.ts'

export type {
  VoiceOutput, VoiceOutputFailure, VoiceOutputPolicy, VoiceOutputSnapshot, VoiceOutputVoice,
} from '../protocol.ts'

export const inject = ['remote']

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Speech playback over the experimental speechOutput Remote. */
    voiceOutput: import('../protocol.ts').VoiceOutput
  }
}

/**
 * Activate the browser speech playback capability.
 * @param ctx - client runtime.
 * @returns disposer withdrawing the service, the Session observation, and the Remote contribution.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountVoiceOutput(ctx, speechOutputRemote)
}
