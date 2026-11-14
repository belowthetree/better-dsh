/** Browser entry: mount the experimental speech Remote and provide the shared capture service. */
import type { Context } from '@deepseek-ai/cordis'
import speechRemote from '@deepseek-ai/dsh-experimental-api-speech-to-text/remote'
import { mountVoiceCapture } from './mount.ts'

export type {
  MicrophoneDevice, VoiceCapture, VoiceCaptureCatalog, VoiceCaptureError, VoiceCaptureFailure,
  VoiceCapturePreview, VoiceCaptureResult, VoiceCaptureSnapshot,
} from '../protocol.ts'

export const inject = ['remote']

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Shared microphone capture service over the experimental speech Remote. */
    voiceCapture: import('../protocol.ts').VoiceCapture
  }
}

/**
 * Activate the browser microphone capture capability.
 * @param ctx - client runtime.
 * @returns disposer withdrawing the service and the speech Remote contribution.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountVoiceCapture(ctx, speechRemote)
}
