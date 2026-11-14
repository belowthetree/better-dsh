/** Compact context menu of the floating orb, rendered inside the orb window. */
import { useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { MenuSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { VoiceOutputPolicy } from '@deepseek-ai/dsh-client-ui-voice-output/client'
import { policyLabelKey } from './state.ts'
import type { NS } from './locales.ts'
import css from './OrbForm.module.css'

/** One selectable entry of the orb's context menu. */
export type OrbMenuEntryId = 'voice' | 'pin' | 'mute' | 'policy' | 'settings'

/** Props of the orb's context menu; the overlay owns its open state. */
export interface OrbMenuProps {
  /** Whether the panel presentation stays above other windows. */
  readonly pinned: boolean
  /** Playback mute state, or null while the playback plugin is unmounted. */
  readonly muted: boolean | null
  /** Auto-speak policy, or null while the playback plugin is unmounted. */
  readonly policy: VoiceOutputPolicy | null
  /** Whether a capture is active, or null while the capture plugin is unmounted. */
  readonly capturing: boolean | null
  /**
   * Run one entry; the overlay closes the menu.
   * @param entry - selected entry.
   */
  readonly onSelect: (entry: OrbMenuEntryId) => void
  /** Translate one dictionary key of the orb namespace. */
  readonly t: TranslateNS<typeof NS>
}

/**
 * Render the orb's pin, mute, policy, and settings entries.
 * @param props - current pin and playback state, the selection callback, and localized copy.
 * @returns the menu card.
 */
export function OrbMenu({ pinned, muted, policy, capturing, onSelect, t }: OrbMenuProps) {
  const card = useRef<HTMLDivElement | null>(null)

  /**
   * Walk the rows with the arrow keys; Escape is the overlay's own handler.
   * @param event - key press inside the menu card.
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    /* v8 ignore start -- the card is attached while its own keydown handler runs, and both branches render rows. */
    const rows = [...card.current?.querySelectorAll<HTMLButtonElement>('button') ?? []]
    if (rows.length === 0) return
    /* v8 ignore stop */
    const active = document.activeElement
    const from = active instanceof HTMLButtonElement ? rows.indexOf(active) : -1
    const step = event.key === 'ArrowDown' ? 1 : -1
    rows[(from + step + rows.length) % rows.length]?.focus()
    event.preventDefault()
  }

  return <MenuSurface ref={card} compact className={css.menu} data-orb-menu role="menu"
    aria-label={t('orb.menu')} onKeyDown={onKeyDown}>
    {capturing !== null && <button type="button" role="menuitem" className={css.menuRow} data-orb-menu-entry="voice"
      onClick={() => { onSelect('voice') }}>{t(capturing ? 'menu.voiceStop' : 'menu.voiceStart')}</button>}
    <button type="button" role="menuitem" className={css.menuRow} data-orb-menu-entry="pin"
      onClick={() => { onSelect('pin') }}>{t(pinned ? 'menu.unpin' : 'menu.pin')}</button>
    {muted === null || policy === null
      ? <p className={css.menuNote} data-orb-menu-note>{t('menu.voiceMissing')}</p>
      : <>
        <button type="button" role="menuitem" className={css.menuRow} data-orb-menu-entry="mute"
          onClick={() => { onSelect('mute') }}>{t(muted ? 'menu.unmute' : 'menu.mute')}</button>
        <button type="button" role="menuitem" className={css.menuRow} data-orb-menu-entry="policy"
          onClick={() => { onSelect('policy') }}>{t('menu.policy', { policy: t(policyLabelKey(policy)) })}</button>
      </>}
    <button type="button" role="menuitem" className={css.menuRow} data-orb-menu-entry="settings"
      onClick={() => { onSelect('settings') }}>{t('menu.settings')}</button>
  </MenuSurface>
}
