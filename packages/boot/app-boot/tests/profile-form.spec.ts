/**
 * Desktop carrier declarations of a profile manifest: form validation, owner
 * tolerance, exposure through a loaded profile, and preservation by the
 * sanitize recovery path.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  initProfile,
  loadProfileDirectory,
  PROFILE_FORM_KINDS,
  PROFILE_PATCH_FILENAME,
  readProfileIdentity,
  readProfileManifest,
  sanitizeProfile,
  writeProfileManifest,
  type ProfileManifest,
} from '../src/index.ts'

const roots: string[] = []
afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tmp(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-profile-form-')))
  roots.push(dir)
  return dir
}

/** Stage an installed app package that provides the bundle-resolution anchor. */
function stageInstallation(appName = 'dsh-app'): string {
  const appDir = join(tmp(), appName)
  mkdirSync(join(appDir, 'node_modules'), { recursive: true })
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({
    name: appName, version: '0.0.0', type: 'module', dependencies: {},
  }))
  return join(appDir, 'package.json')
}

/** Write one package.json and read it back through the profile manifest reader. */
function manifestAt(json: string): ProfileManifest {
  const dir = tmp()
  writeFileSync(join(dir, 'package.json'), json)
  return readProfileManifest('dsh', dir)
}

describe('readProfileIdentity form', () => {
  it('defaults an undeclared form to classic', () => {
    expect(PROFILE_FORM_KINDS).toEqual(['classic', 'orb'])
    expect(readProfileIdentity('dsh', 'better', {})).toEqual({ form: { kind: 'classic' }, owner: undefined })
    expect(readProfileIdentity('dsh', 'better', { dsh: { profile: { bundles: ['a'] } } }))
      .toEqual({ form: { kind: 'classic' }, owner: undefined })
  })

  it.each([...PROFILE_FORM_KINDS])('accepts the declared %s form', (kind) => {
    expect(readProfileIdentity('dsh', 'better', { dsh: { profile: { form: { kind } } } }))
      .toEqual({ form: { kind }, owner: undefined })
  })

  it('rejects an unsupported kind, naming the profile and the supported forms', () => {
    expect(() => readProfileIdentity('dsh', 'better', manifestAt('{"dsh":{"profile":{"form":{"kind":"orbx"}}}}')))
      .toThrow('dsh: profile "better" declares unsupported form "orbx"; supported forms: classic, orb')
  })

  it.each([
    ['null', 'null'],
    ['a string', '"orb"'],
    ['a number', '7'],
    ['an array', '[]'],
    ['an empty object', '{}'],
    ['a non-string kind', '{"kind":7}'],
    ['a null kind', '{"kind":null}'],
  ])('rejects a form declared as %s', (_label, form) => {
    expect(() => readProfileIdentity('dsh', 'better', manifestAt(`{"dsh":{"profile":{"form":${form}}}}`)))
      .toThrow('dsh: profile "better" has a malformed dsh.profile.form declaration; supported forms: classic, orb')
  })
})

describe('readProfileIdentity owner', () => {
  it('resolves a declared Desktop owner and ignores an unrecognized or absent one', () => {
    expect(readProfileIdentity('dsh', 'better', manifestAt('{"dsh":{"profile":{"owner":"desktop"}}}')).owner).toBe('desktop')
    expect(readProfileIdentity('dsh', 'better', manifestAt('{"dsh":{"profile":{"owner":"orbit"}}}')).owner).toBeUndefined()
    expect(readProfileIdentity('dsh', 'better', manifestAt('{"dsh":{"profile":{"owner":7}}}')).owner).toBeUndefined()
    expect(readProfileIdentity('dsh', 'better', { dsh: {} }).owner).toBeUndefined()
  })
})

describe('loadProfileDirectory identity', () => {
  it('exposes a profile with no declaration as classic and unowned', () => {
    const anchor = stageInstallation()
    const dir = join(tmp(), 'profiles', 'plain')
    initProfile(dir, [])
    const profile = loadProfileDirectory('dsh', dir, anchor)
    expect(profile.form).toEqual({ kind: 'classic' })
    expect(profile.owner).toBeUndefined()
  })

  it('exposes the declared form and owner of the loaded profile', () => {
    const anchor = stageInstallation()
    const dir = join(tmp(), 'profiles', 'better')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-better', private: true,
      dsh: { profile: { bundles: [], form: { kind: 'orb' }, owner: 'desktop' } },
    }))
    const profile = loadProfileDirectory('dsh', dir, anchor)
    expect(profile.form).toEqual({ kind: 'orb' })
    expect(profile.owner).toBe('desktop')
  })

  it('validates the form before resolving bundles', () => {
    const anchor = stageInstallation()
    const dir = join(tmp(), 'profiles', 'better')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-better', private: true,
      dsh: { profile: { bundles: ['missing-bundle'], form: { kind: 'orbx' } } },
    }))
    expect(() => loadProfileDirectory('dsh', dir, anchor))
      .toThrow('dsh: profile "better" declares unsupported form "orbx"')
  })

  it('preserves the declaration while dropping a retired bundle', () => {
    const anchor = stageInstallation()
    const dir = join(tmp(), 'profiles', 'better')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-better', private: true,
      dsh: {
        profile: {
          bundles: ['@deepseek-ai/dsh-experimental-schedule-bundle'],
          form: { kind: 'orb' },
          owner: 'desktop',
        },
      },
    }))
    loadProfileDirectory('dsh', dir, anchor)
    expect(readProfileManifest('dsh', dir).dsh?.profile).toEqual({
      bundles: [], form: { kind: 'orb' }, owner: 'desktop',
    })
  })
})

describe('sanitizeProfile identity', () => {
  it('preserves the declared form and owner while resetting the bundle list', () => {
    const dir = join(tmp(), 'profiles', 'better')
    initProfile(dir, ['retired-bundle'])
    writeProfileManifest(dir, {
      name: 'dsh-profile-better',
      private: true,
      dependencies: { 'some-plugin': '1.0.0' },
      dsh: { profile: { bundles: ['retired-bundle'], owner: 'desktop', form: { kind: 'orb' } } },
    })
    writeFileSync(join(dir, PROFILE_PATCH_FILENAME), '- id: broken\n')
    const backup = sanitizeProfile('dsh', dir, ['bundle-a'])
    expect(backup).toMatch(/cordis\.patch\.yml\.bak-\d+$/)
    expect(readProfileManifest('dsh', dir)).toEqual({
      name: 'dsh-profile-better',
      private: true,
      dependencies: { 'some-plugin': '1.0.0' },
      dsh: { profile: { bundles: ['bundle-a'], owner: 'desktop', form: { kind: 'orb' } } },
    })
  })
})
