/** Modal presentation identity of the settings panel. */
import type { ModalSizeHint } from '@deepseek-ai/dsh-client-surface/client'

/** Registered `shell.modal` entry id of the settings panel; also its shortcut modal context. */
export const SETTINGS_MODAL_ID = 'settings'

/**
 * Dialog size: the panel's 800-pixel card plus the frame backdrop's 24-pixel
 * margin on each side (the carrier already adds its 72-pixel shadow margin to
 * the window). The panel fills the card, so the height only needs to give the
 * section column room to scroll.
 */
export const SETTINGS_MODAL_SIZE: ModalSizeHint = { heightRatio: 0.8, width: 848 }
