import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { materializeBundledProfile, readBundledProfileDefaults } from '../src/bundled-profile.ts'
import { DEFAULT_DESKTOP_PROFILE } from '../src/profile-selection.ts'

const temporary: string[] = []

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-bundled-profile-'))
  temporary.push(root)
  return root
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('readBundledProfileDefaults', () => {
  it('keeps the classic profile for a development launch', () => {
    expect(readBundledProfileDefaults({ dshDesktopDefaultProfile: 'better' }, false))
      .toEqual({ defaultProfile: DEFAULT_DESKTOP_PROFILE, template: undefined })
  })

  it('keeps the classic profile when a packaged build declares nothing', () => {
    expect(readBundledProfileDefaults({ dshDesktopAppId: 'com.deepseek.dsh' }, true))
      .toEqual({ defaultProfile: DEFAULT_DESKTOP_PROFILE, template: undefined })
  })

  it('reads the launch profile and template a packaged build declares', () => {
    expect(readBundledProfileDefaults(
      { dshDesktopDefaultProfile: 'better', dshDesktopProfileTemplate: 'form-profile' },
      true,
    )).toEqual({ defaultProfile: 'better', template: 'form-profile' })
  })

  it('rejects declarations that are not one directory segment', () => {
    expect(() => readBundledProfileDefaults({ dshDesktopDefaultProfile: 'a/b' }, true))
      .toThrow('dshDesktopDefaultProfile')
    expect(() => readBundledProfileDefaults({ dshDesktopDefaultProfile: '' }, true))
      .toThrow('dshDesktopDefaultProfile')
    expect(() => readBundledProfileDefaults({ dshDesktopDefaultProfile: 7 }, true))
      .toThrow('dshDesktopDefaultProfile')
    expect(() => readBundledProfileDefaults({ dshDesktopProfileTemplate: '../escape' }, true))
      .toThrow('dshDesktopProfileTemplate')
  })

  it('rejects a packaged manifest that is not an object', () => {
    expect(() => readBundledProfileDefaults(undefined, true)).toThrow('invalid application manifest')
  })
})

describe('materializeBundledProfile', () => {
  function template(root: string): string {
    const directory = join(root, 'resources', 'form-profile')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), '{"name":"dsh-profile-better"}\n')
    writeFileSync(join(directory, 'cordis.yml'), '[]\n')
    return directory
  }

  it('copies the template when the profile does not exist yet', () => {
    const root = fixture()
    const profile = join(root, 'dsh', 'profiles', 'better')
    materializeBundledProfile(template(root), profile)
    expect(JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))).toEqual({ name: 'dsh-profile-better' })
  })

  it('never overwrites a profile that already exists', () => {
    const root = fixture()
    const profile = join(root, 'dsh', 'profiles', 'better')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), '{"name":"edited"}\n')
    materializeBundledProfile(template(root), profile)
    expect(JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))).toEqual({ name: 'edited' })
  })

  it('fails when neither the profile nor its template exists', () => {
    const root = fixture()
    expect(() => { materializeBundledProfile(join(root, 'missing'), join(root, 'dsh', 'profiles', 'better')) })
      .toThrow('bundled profile template')
    expect(existsSync(join(root, 'dsh'))).toBe(false)
  })
})
