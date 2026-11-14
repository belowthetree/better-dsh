/** Mount the experimental speech Remote contribution and provide the shared capture service. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { VoiceCaptureService } from './service.ts'

/**
 * Mount one speech Remote contribution and provide `ctx.voiceCapture`.
 * @param ctx - client runtime owning the Remote mount and the capture service.
 * @param contribution - generated speech Remote definitions.
 * @returns disposer withdrawing the service and the Remote mount.
 */
export async function mountVoiceCapture(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const service = new VoiceCaptureService(ctx)
  ctx.effect(() => () => service.dispose(), 'voice capture: service disposal')
  const withdraw = ctx.provide('voiceCapture', service)
  return async () => {
    withdraw()
    await service.dispose()
    await disposeRemote()
  }
}
