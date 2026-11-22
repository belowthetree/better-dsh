/**
 * The Settings navigation entry that leads to the Plugins page: the classic
 * shell's entry leaves the dialog for the main column, and the form profile's
 * entry replaces the Settings modal with the page's own card.
 */
import { useEffect, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the `settings.section` declaration this entry registers into.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

/** What the entry receives from the plugin manager. */
export interface PluginsSettingsLinkInjected {
  /** Show the Plugins page's main list where this shell renders it. */
  readonly openPlugins: () => void
  /**
   * Whether the entry dismisses the Settings surface before opening the page.
   * False where that surface is the modal the page itself replaces.
   */
  readonly dismissSettings: boolean
}

/** Full component props assembled by the settings shell. */
export type PluginsSettingsLinkProps = PropsRuntime<'settings.section'> & InjectFace<PluginsSettingsLinkInjected>

/**
 * Selecting the entry opens the Plugins page; the entry has no page of its own.
 * @param props - the shell's close action and the injected navigation.
 * @returns nothing; the entry renders no content.
 */
export function PluginsSettingsLink({ close, openPlugins, dismissSettings }: PluginsSettingsLinkProps): ReactNode {
  // Mounting is the selection: the shell mounts a page only when its navigation entry is chosen.
  useEffect(() => {
    // A form profile presents the page into the same modal the settings panel
    // occupies, so dismissing it first would hide the window about to show it.
    if (dismissSettings) close()
    openPlugins()
  }, [close, dismissSettings, openPlugins])
  return null
}
