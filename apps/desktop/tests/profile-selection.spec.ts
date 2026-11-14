import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import {
  DEFAULT_DESKTOP_PROFILE,
  deepLinkProfileName,
  desktopLaunchSelection,
} from '../src/profile-selection.ts'

const homes: string[] = []
function fixtureHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'desktop-profile-selection-'))
  homes.push(home)
  return home
}

afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

describe('deep link profile name', () => {
  it('reads the profile a dsh:// open link names', () => {
    expect(deepLinkProfileName('dsh://open?profile=better')).toBe('better')
    expect(deepLinkProfileName('dsh://open/?profile=better&other=1')).toBe('better')
    expect(deepLinkProfileName('dsh://open?other=1&profile=better')).toBe('better')
  })

  it('names no profile for links without the parameter or for values that are not dsh:// links', () => {
    expect(deepLinkProfileName('dsh://open')).toBeUndefined()
    expect(deepLinkProfileName('dsh://open/')).toBeUndefined()
    expect(deepLinkProfileName('dsh://open?other=1')).toBeUndefined()
    expect(deepLinkProfileName('https://open?profile=better')).toBeUndefined()
    expect(deepLinkProfileName('--profile=better')).toBeUndefined()
    expect(deepLinkProfileName('not a URL')).toBeUndefined()
    expect(deepLinkProfileName('E:\\Project\\deepseek-harness')).toBeUndefined()
  })

  it('names no profile when the link carries a control character', () => {
    expect(deepLinkProfileName('dsh://open?profile=better\u0000')).toBeUndefined()
    expect(deepLinkProfileName('dsh://open\u0007?profile=better')).toBeUndefined()
    expect(deepLinkProfileName('dsh://open?profile=bet%00ter')).toBeUndefined()
  })

  it('refuses an empty or repeated profile parameter', () => {
    expect(() => deepLinkProfileName('dsh://open?profile=')).toThrow('desktop: profile name must not be empty')
    expect(() => deepLinkProfileName('dsh://open?profile')).toThrow('desktop: profile name must not be empty')
    expect(() => deepLinkProfileName('dsh://open?profile=a&profile=b'))
      .toThrow('desktop: profile selected more than once')
  })
})

describe('desktop launch selection', () => {
  it('boots the desktop profile when no argument selects one', () => {
    const home = fixtureHome()
    const selection = desktopLaunchSelection(['C:\\Program Files\\DeepSeek\\desktop.exe', '--no-sandbox'], home)
    expect(selection).toEqual({ name: DEFAULT_DESKTOP_PROFILE, dir: join(home, 'profiles', 'desktop') })
    expect(selection.name).toBe('desktop')
  })

  it('boots a profile named by any supported argument form at any position', () => {
    const home = fixtureHome()
    expect(desktopLaunchSelection(['app', '--profile', 'better'], home).name).toBe('better')
    expect(desktopLaunchSelection(['app', '--profile=better'], home)).toMatchObject({
      name: 'better',
      dir: join(home, 'profiles', 'better'),
    })
    expect(desktopLaunchSelection(['app', '--no-sandbox', 'dsh://open?profile=better'], home).name).toBe('better')
    expect(desktopLaunchSelection(['dsh://open?profile=better', '--no-sandbox'], home).name).toBe('better')
  })

  it('boots the desktop profile when the deep link names no profile', () => {
    const home = fixtureHome()
    expect(desktopLaunchSelection(['app', 'dsh://open'], home).name).toBe(DEFAULT_DESKTOP_PROFILE)
  })

  it('resolves the default Harness home for a selected profile', () => {
    expect(desktopLaunchSelection(['app', '--profile=better']).dir).toBe(resolveProfileDir('better'))
  })

  it('refuses two selections across argument forms', () => {
    const home = fixtureHome()
    const duplicate = 'desktop: profile selected more than once'
    expect(() => desktopLaunchSelection(['app', '--profile=a', '--profile=b'], home)).toThrow(duplicate)
    expect(() => desktopLaunchSelection(['app', '--profile=a', '--profile=a'], home)).toThrow(duplicate)
    expect(() => desktopLaunchSelection(['app', '--profile=a', 'dsh://open?profile=b'], home)).toThrow(duplicate)
    expect(() => desktopLaunchSelection(['app', 'dsh://open?profile=a', 'dsh://open?profile=b'], home)).toThrow(duplicate)
  })

  it('refuses an empty selection', () => {
    const home = fixtureHome()
    const empty = 'desktop: profile name must not be empty'
    expect(() => desktopLaunchSelection(['app', '--profile='], home)).toThrow(empty)
    expect(() => desktopLaunchSelection(['app', '--profile'], home)).toThrow(empty)
    expect(() => desktopLaunchSelection(['app', 'dsh://open?profile='], home)).toThrow(empty)
  })

  it('rejects an invalid profile name with the profile-directory diagnostic', () => {
    const home = fixtureHome()
    let expected: string | undefined
    try {
      resolveProfileDir('a/b', home)
    } catch (error) {
      expected = 'desktop: ' + (error as Error).message
    }
    expect(expected).toBeDefined()
    expect(() => desktopLaunchSelection(['app', '--profile=a/b'], home)).toThrow(expected)
    expect(() => desktopLaunchSelection(['app', '--profile=node_modules'], home))
      .toThrow('desktop: dsh: invalid profile name "node_modules"')
  })
})
