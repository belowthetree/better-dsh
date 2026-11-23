/** Stable identities and limits shared by the plugin entry and its tests. */

/** Stable code of a speech-recognition failure caused by a missing account sign-in. */
export const ASR_SIGN_IN_CODE = 'DEEPSEEK_ASR_SIGN_IN_REQUIRED'

/** Stable code of a speech-recognition failure caused by a Host without the account API. */
export const ASR_ACCOUNT_API_CODE = 'DEEPSEEK_ASR_ACCOUNT_API_UNAVAILABLE'

/** Longest text one playback request accepts. */
export const SPEAK_MAX_CHARS = 4_000

/** Registered synthesis provider id the orb composition selects. */
export const TTS_PROVIDER_ID = 'deepseek-tts'

/** Registered recognition provider id the orb composition selects. */
export const SPEECH_PROVIDER_ID = 'deepseek-cloud'
