/** Browser entry for the composer control over the shared capture service. */
import type { Context } from '@deepseek-ai/cordis'
import { mountVoiceInput } from './mount.ts'

export { inject } from './mount.ts'

/**
 * Activate the experimental microphone control.
 * @param ctx - client runtime.
 */
export function apply(ctx: Context): void {
  mountVoiceInput(ctx)
}
