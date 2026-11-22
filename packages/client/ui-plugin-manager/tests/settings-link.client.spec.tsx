// @vitest-environment jsdom
/** The Settings entry that leads to the Plugins page. */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginsSettingsLink, type PluginsSettingsLinkProps } from '../src/client/PluginsSettingsLink.tsx'

afterEach(cleanup)

/** The entry's own members; the standard seats stay unused. */
function entryProps(dismissSettings: boolean) {
  const calls: string[] = []
  const props = {
    close: vi.fn(() => { calls.push('close') }),
    openPlugins: vi.fn(() => { calls.push('open') }),
    dismissSettings,
  } satisfies Pick<PluginsSettingsLinkProps, 'close' | 'openPlugins' | 'dismissSettings'>
  return { calls, props }
}

describe('PluginsSettingsLink', () => {
  it('closes Settings and opens the Plugins page when selected, rendering nothing', () => {
    const { calls, props } = entryProps(true)
    const { container } = render(<PluginsSettingsLink {...props as PluginsSettingsLinkProps} />)
    expect(calls).toEqual(['close', 'open'])
    expect(container.childElementCount).toBe(0)
  })

  it('presents the Plugins page into the modal Settings occupies without dismissing it first', () => {
    const { calls, props } = entryProps(false)
    render(<PluginsSettingsLink {...props as PluginsSettingsLinkProps} />)
    expect(calls).toEqual(['open'])
  })
})
