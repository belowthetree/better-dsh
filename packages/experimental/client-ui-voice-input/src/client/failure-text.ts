/** Locale-owned messages shared by microphone preview and dictation. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { VoiceCaptureFailure } from '@deepseek-ai/dsh-client-voice-capture/client'
import type { NS } from './locales.ts'

/** Every member of the closed capture-failure union, used to validate a rejection's tag. */
const FAILURES: readonly VoiceCaptureFailure[] = [
  'unavailable', 'permission', 'empty', 'cancelled', 'interrupted', 'deviceMissing', 'transcribe',
]

/**
 * Read the capture failure member a command rejection carries.
 * @param error - rejection from one capture command.
 * @returns the named failure member, or null when the rejection names none.
 */
export function captureFailureOf(error: unknown): VoiceCaptureFailure | null {
  if (!(error instanceof Error) || !('failure' in error)) return null
  return FAILURES.find(member => member === error.failure) ?? null
}

/**
 * Translate a capture or transcription failure.
 * @param error - the rejected value.
 * @param t - the active voice-input translator.
 * @returns localized failure text; unrecognized rejections keep their diagnostic message.
 */
export function failureText(error: unknown, t: PropsLocale<typeof NS>['t']): string {
  const failure = captureFailureOf(error)
  if (failure !== null && failure !== 'transcribe') return t(failure)
  return t('failed', { message: error instanceof Error ? error.message : String(error) })
}
