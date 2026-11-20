/**
 * Settings presentation contract: the capability the settings shell provides so
 * another shell surface (the form profile's orb menu) can ask for the settings
 * panel without knowing how that renderer presents it.
 */

/** Presentation request accepted by the settings shell. */
export interface SettingsUiService {
  /** Present the settings panel through the shell this renderer hosts. */
  open(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Settings presentation capability, provided by the settings shell while
     * the current Peer may read the settings description. A renderer that
     * hosts the classic frame opens its sidebar dialog; a form renderer raises
     * the settings modal instead.
     */
    settingsUi: SettingsUiService
  }
}
