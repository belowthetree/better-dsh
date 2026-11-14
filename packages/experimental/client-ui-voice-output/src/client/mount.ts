/** Mount the speechOutput Remote contribution and provide the shared playback service. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
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
  const disposeRemote = await ctx.remote.$mount(contribution)
  const service = new VoiceOutputService(ctx, options)
  ctx.effect(() => () => { service.dispose() }, 'voice output: playback disposal')
  void ctx.inject(['sessions'], scoped => service.observe(scoped.sessions))
  const withdraw = ctx.provide('voiceOutput', service)
  return async () => {
    withdraw()
    service.dispose()
    await disposeRemote()
  }
}
