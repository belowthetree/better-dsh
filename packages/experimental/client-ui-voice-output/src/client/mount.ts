/** Mount the speechOutput Remote contribution and provide the shared playback service. */
import type { Context } from '@deepseek-ai/cordis'
import { mountRemoteContribution } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-voice-capture/client'
import type {} from '@deepseek-ai/dsh-client-surface/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { VoiceOutputService, type VoiceOutputOptions } from './service.ts'

/**
 * Mount one speech-output Remote contribution and provide `ctx.voiceOutput`.
 * @param ctx - client runtime owning the Remote mount and the playback service.
 * @param contribution - generated speech-output Remote definitions.
 * @param options - optional audio element factory.
 * @returns disposer withdrawing the service, the Session observation, and the Remote mount.
 */
export async function mountVoiceOutput(
  ctx: Context,
  contribution: TypertRemoteContribution,
  options: VoiceOutputOptions = {},
): Promise<() => Promise<void>> {
  const surface = ctx.get('surface')?.snapshot()
  if (surface?.form === 'orb' && surface.role !== 'surface') return async () => {}
  // The namespace service lives inside the Remote gateway's own fiber, so the
  // playback service runs in a scope that injects the namespace.
  return mountRemoteContribution(ctx, contribution, () => ctx.inject(['remote.speechOutput'], (scoped) => {
    const service = new VoiceOutputService(scoped, options)
    scoped.effect(() => () => { service.dispose() }, 'voice output: playback disposal')
    void scoped.inject(['sessions'], inner => service.observe(inner.sessions))
    void scoped.inject(['voiceCapture'], inner => service.observeCapture(inner.voiceCapture))
    scoped.provide('voiceOutput', service)
  }))
}
