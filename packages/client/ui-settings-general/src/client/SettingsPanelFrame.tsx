/**
 * Shared body of the settings domain's panel: title seat, section navigation
 * rail, header actions and close control, and the active section. The sidebar
 * shell renders it inside its body-portaled dialog and the form profile renders
 * it inside the frame's modal card, so both surfaces show one panel.
 */
import type { ReactNode, Ref } from 'react'
import clsx from 'clsx'
import {
  IconAgentPresetOutlineMedium, IconArchiveOutlineMedium, IconCloseOutlineRegular, IconDataOutlineMedium,
  IconPersonalizationOutlineMedium, IconSettingsOutlineMedium, IconUserOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsSectionRow } from './shell-contract.ts'
import css from './SettingsRoot.module.css'

/**
 * Nav glyph for one settings section.
 * @param id - registered `settings.section` entry id.
 * @returns the section's glyph; unknown ids fall back to the settings gear.
 */
export function navIcon(id: string): ReactNode {
  if (id === 'account') return <IconUserOutlineMedium size={16} />
  if (id === 'models') return <IconDataOutlineMedium size={16} />
  if (id === 'agent-presets') return <IconAgentPresetOutlineMedium size={16} />
  if (id === 'plugins') return <IconPersonalizationOutlineMedium size={16} />
  if (id === 'archived-sessions') return <IconArchiveOutlineMedium size={16} />
  return <IconSettingsOutlineMedium size={16} />
}

/** Props of the shared settings panel body. */
export interface SettingsPanelFrameProps {
  /** Id of the title node the panel is labelled by. */
  readonly titleId: string
  /** Rendered panel title. */
  readonly title: ReactNode
  /** Header actions rendered before the close control. */
  readonly actions: ReactNode
  /** Visually hidden close-control label. */
  readonly closeLabel: ReactNode
  /** Ordered navigation rows projected from the section ledger. */
  readonly rows: readonly SettingsSectionRow[]
  /** Id of the section the panel shows. */
  readonly active: string | undefined
  /** @param id - section the user selected. */
  readonly onSelect: (id: string) => void
  /** Leave the panel. */
  readonly onClose: () => void
  /**
   * Render one row's nav glyph.
   * @param id - section id.
   * @param active - whether the row is the selected section.
   */
  readonly renderIcon: (id: string, active: boolean) => ReactNode
  /** Active section content. */
  readonly children: ReactNode
  /** Dialog semantics for the shell's portaled panel; the settings modal renders the panel as a card fill. */
  readonly dialog: boolean
  /** Whether the panel fills its host card instead of sizing itself from the viewport. */
  readonly fill?: boolean
  /** Dialog panel element, used by the shell for its focus trap. */
  readonly panelRef?: Ref<HTMLDivElement>
}

/**
 * Render the settings panel body shared by the sidebar shell and the settings modal.
 * @param props - navigation rows, the active section, chrome content, and the surface's semantics.
 * @returns the panel grid with its four seats.
 */
export function SettingsPanelFrame({
  titleId, title, actions, closeLabel, rows, active, onSelect, onClose, renderIcon, children,
  dialog, fill = false, panelRef,
}: SettingsPanelFrameProps) {
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className={clsx(css.panel, fill && css.panelFill)}
      {...(dialog ? { role: 'dialog', 'aria-modal': true, 'data-shortcut-modal': 'settings' } : { role: 'region' })}
      aria-labelledby={titleId}
    >
      {/* The four seats stay direct children of the panel and take their
          places from its grid: title and header share the first row, the
          navigation and the active section the second. */}
      <div className={css.navTitle} id={titleId} tabIndex={-1}
        data-modal-autofocus={dialog && active === undefined ? '' : undefined}>{title}</div>
      <nav className={css.nav}>
        <div className={css.navList}>
          {rows.map(row => (
            <button
              key={row.id}
              type="button"
              className={clsx(css.navCell, row.id === active && css.active)}
              aria-current={row.id === active ? 'true' : undefined}
              data-modal-autofocus={dialog && row.id === active ? '' : undefined}
              onFocus={(event) => { event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }}
              onClick={() => { onSelect(row.id) }}
            >
              <span className={css.navIcon} aria-hidden="true">{renderIcon(row.id, row.id === active)}</span>
              <span className={css.navLabel}>{row.label}</span>
            </button>
          ))}
        </div>
      </nav>
      <div className={css.header}>
        <div className={css.actions}>{actions}</div>
        <button type="button" className={css.close} onClick={onClose}>
          <IconCloseOutlineRegular size={14} />
          <span className={css.hiddenLabel}>{closeLabel}</span>
        </button>
      </div>
      <div className={css.options}>{children}</div>
    </div>
  )
}
