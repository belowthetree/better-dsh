/** Mount the experimental speech Remote contribution and provide the shared capture service. */
import type { Context } from '@deepseek-ai/cordis'
import { mountRemoteContribution } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-surface/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { VoiceCaptureService } from './service.ts'

/**
 * Mount one speech Remote contribution and provide `ctx.voiceCapture`.
 * @param ctx - client runtime owning the Remote mount and the capture service.
 * @param contribution - generated speech Remote definitions.
 * @returns disposer withdrawing the service and the Remote mount.
 */
export async function mountVoiceCapture(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const surface = ctx.get('surface')?.snapshot()
  if (surface?.form === 'orb' && surface.role !== 'surface') return async () => {}
  // The namespace service lives inside the Remote gateway's own fiber. The
  // capture service runs in a scope that injects the namespace, like every
  // consumer of a generated Remote, so its calls resolve through the scope.
  return mountRemoteContribution(ctx, contribution, () => ctx.inject(['remote.speech'], (scoped) => {
    const service = new VoiceCaptureService(scoped)
    scoped.effect(() => () => service.dispose(), 'voice capture: service disposal')
    scoped.provide('voiceCapture', service)
  }))
}
