import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readProfileIdentity, readProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { readDesktopFormProfile } from '../src/desktop-profile.ts'

const roots: string[] = []
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-form-profile-'))
  roots.push(root)
  return root
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function writeProfileDirectory(dir: string, manifest: unknown): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, undefined, 2) + '\n')
}

function profileDirectory(root: string, name: string): string {
  return join(root, 'profiles', name)
}

describe('desktop form profile read', () => {
  it('reads the classic form when the manifest omits a declaration', () => {
    const dir = profileDirectory(fixture(), 'better')
    writeProfileDirectory(dir, { name: 'dsh-profile-better', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } })
    expect(readDesktopFormProfile(dir, 'better')).toEqual({ name: 'better', dir, form: { kind: 'classic' } })
  })

  it('reads the classic form when the manifest declares no profile fields at all', () => {
    const dir = profileDirectory(fixture(), 'plain')
    writeProfileDirectory(dir, { name: 'dsh-profile-plain', private: true, dependencies: {} })
    expect(readDesktopFormProfile(dir, 'plain').form).toEqual({ kind: 'classic' })
  })

  it('reads the orb form a desktop-owned profile declares', () => {
    const dir = profileDirectory(fixture(), 'better')
    writeProfileDirectory(dir, {
      name: 'dsh-profile-better',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [], owner: 'desktop', form: { kind: 'orb' } } },
    })
    expect(readDesktopFormProfile(dir, 'better')).toEqual({ name: 'better', dir, form: { kind: 'orb' } })
  })

  it('reports a profile that is not initialized before reading its manifest', () => {
    const dir = profileDirectory(fixture(), 'better')
    const diagnostic = 'desktop: profile "better" does not exist at ' + dir
    expect(() => readDesktopFormProfile(dir, 'better')).toThrow(diagnostic)
    mkdirSync(dir, { recursive: true })
    expect(() => readDesktopFormProfile(dir, 'better')).toThrow(diagnostic)
  })

  it('rethrows the manifest form diagnostic unchanged', () => {
    const dir = profileDirectory(fixture(), 'better')
    writeProfileDirectory(dir, {
      name: 'dsh-profile-better',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [], form: { kind: 'floating' } } },
    })
    let expected: string | undefined
    try {
      readProfileIdentity('desktop', 'better', readProfileManifest('desktop', dir))
    } catch (error) {
      expected = (error as Error).message
    }
    expect(expected).toBeDefined()
    expect(expected).toContain('better')
    expect(() => readDesktopFormProfile(dir, 'better')).toThrow(expected)
  })

  it('rejects a malformed form declaration through the shared reader', () => {
    const root = fixture()
    const stringForm = profileDirectory(root, 'string-form')
    writeProfileDirectory(stringForm, {
      name: 'dsh-profile-string-form',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [], form: 'orb' } },
    })
    expect(() => readDesktopFormProfile(stringForm, 'string-form')).toThrow(/string-form/u)
    const unknownKind = profileDirectory(root, 'unknown-kind')
    writeProfileDirectory(unknownKind, {
      name: 'dsh-profile-unknown-kind',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [], form: { kind: 7 } } },
    })
    expect(() => readDesktopFormProfile(unknownKind, 'unknown-kind')).toThrow(/unknown-kind/u)
  })
})
