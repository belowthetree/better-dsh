/** Top strip of the panel presentation: collapse, pin, settings, and the active Session title. */
import {
  IconChevronDownOutlineRegular, IconPinFillRegular, IconPinOutlineRegular, IconSettingsOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import { usePointerDrag } from './use-pointer-drag.ts'
import css from './OrbForm.module.css'

/** Props of the panel presentation's top strip. */
export interface PanelStripProps {
  /** Whether the panel stays above other windows. */
  readonly pinned: boolean
  /** Display title of the active Session; absent while none is current. */
  readonly title: string | undefined
  /** Collapse the panel back into the orb. */
  readonly onCollapse: () => void
  /**
   * Change the pin state.
   * @param pinned - whether the panel should stay on top.
   */
  readonly onPin: (pinned: boolean) => void
  /** Raise the form's quick voice settings card. */
  readonly onSettings: () => void
  /**
   * Move the window by one pointer delta.
   * @param deltaX - horizontal movement in logical pixels.
   * @param deltaY - vertical movement in logical pixels.
   */
  readonly onDrag: (deltaX: number, deltaY: number) => void
  /** Translate one dictionary key of the orb namespace. */
  readonly t: TranslateNS<typeof NS>
}

/**
 * Render the compact strip above the conversation.
 * @param props - pin state, Session title, callbacks, and localized copy.
 * @returns the strip; only its title grip and controls take pointer input.
 */
export function PanelStrip({ pinned, title, onCollapse, onPin, onSettings, onDrag, t }: PanelStripProps) {
  const drag = usePointerDrag(onDrag)
  const pinLabel = pinned ? t('panel.unpin') : t('panel.pin')
  return <div className={css.strip} data-orb-strip role="toolbar" aria-label={t('panel.title')}>
    <span className={css.stripTitle} data-orb-strip-handle title={t('panel.drag')} {...drag.handlers}>
      {title === undefined ? t('panel.noSession') : title}
    </span>
    <div className={css.stripControls}>
      <button type="button" className={css.stripButton} data-orb-strip-collapse
        aria-label={t('panel.collapse')} title={t('panel.collapse')} onClick={onCollapse}>
        <IconChevronDownOutlineRegular />
      </button>
      <button type="button" className={css.stripButton} data-orb-strip-pin aria-pressed={pinned}
        aria-label={pinLabel} title={pinLabel} onClick={() => { onPin(!pinned) }}>
        {pinned ? <IconPinFillRegular /> : <IconPinOutlineRegular />}
      </button>
      <button type="button" className={css.stripButton} data-orb-strip-settings
        aria-label={t('panel.settings')} title={t('panel.settings')} onClick={onSettings}>
        <IconSettingsOutlineRegular />
      </button>
    </div>
  </div>
}
