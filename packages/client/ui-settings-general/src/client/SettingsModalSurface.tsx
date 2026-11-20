/**
 * Settings modal surface: the settings domain's panel inside the frame's
 * focus-trapped modal presentation. The orb form's menu raises it through the
 * `settingsUi` service, and the panel, navigation, and sections are the same
 * ones the sidebar shell renders.
 */
import { useId, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsSectionRow } from './shell-contract.ts'
import { navIcon, SettingsPanelFrame } from './SettingsPanelFrame.tsx'
import css from './SettingsModal.module.css'

/** Injected face of the `shell.modal` entry that renders the settings panel. */
export interface SettingsModalInjected {
  hooks: {
    /** settings.section ledger projected into ordered nav rows. */
    sections: HostObservable<readonly SettingsSectionRow[]>
  }
  /** Dismiss the modal presentation. */
  close: () => void
}

/** Props of the settings modal entry. */
export type SettingsModalSurfaceProps =
  & PropsRuntime<'shell.modal'>
  & PropsRenderFactories
  & PropsLocale<'settings'>
  & InjectFace<SettingsModalInjected>

/**
 * Render the settings panel inside the frame's modal card.
 * @param props - section rows, the dismissal action, and the localized copy seat.
 * @returns the panel filling the dialog card.
 */
export function SettingsModalSurface(props: SettingsModalSurfaceProps) {
  const rows = props.useSections(rows => rows)
  const [activeId, setActiveId] = useState<string | undefined>()
  const titleId = useId()
  const { close, renderFactorySlot, t } = props
  // Entries can unmount underneath the requested id, so the render-time
  // projection falls back to the first row when the id is gone.
  const active = rows.find(row => row.id === activeId)?.id ?? rows[0]?.id
  return (
    <div className={css.root} data-settings-dialog data-shell-modal-fill data-shell-modal-surface="bare">
      <SettingsPanelFrame
        titleId={titleId}
        title={t('title')}
        actions={null}
        closeLabel={t('close')}
        rows={rows}
        active={active}
        onSelect={setActiveId}
        onClose={close}
        renderIcon={id => navIcon(id)}
        dialog={false}
        fill
      >
        {active !== undefined && renderFactorySlot('settings.section.view', { id: active, close })}
      </SettingsPanelFrame>
    </div>
  )
}
