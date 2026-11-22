/**
 * Form-profile host of the Plugins page. A form profile renders no main
 * column, so the page occupies the frame's wide modal card instead: the card
 * is bare, and this surface draws the chrome the page relies on.
 */
import type { ReactNode } from 'react'
import { PluginManagerPage, type PluginManagerPageProps } from './PluginManagerPage.tsx'
import css from './PluginsModalPage.module.css'

/** Props of the page's modal placement: the page's own shares, forwarded unchanged. */
export type PluginsModalPageProps = PluginManagerPageProps

/**
 * Render the page inside the modal card surface.
 * @param props - the page's derived shares.
 * @returns the card surface around the page.
 */
export function PluginsModalPage(props: PluginsModalPageProps): ReactNode {
  return (
    <section
      className={css.frame}
      aria-label={props.t('title')}
      data-shell-modal-fill=""
      data-shell-modal-surface="bare"
      data-shell-modal-wide=""
    >
      <PluginManagerPage {...props} />
    </section>
  )
}
