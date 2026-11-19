/** The Desktop-owned orb profile composes the better bundle's rows through the real installation. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { DEFAULT_PROFILE_BUNDLES, OPTIONAL_BUNDLES, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-official-bundles'

const installAnchor = fileURLToPath(new URL('../package.json', import.meta.url))
const betterBundle = '@deepseek-ai/dsh-better-bundle'

/** Write the documented Desktop form profile: web template bundles, the better bundle, orb form, Desktop owner. */
function createFormProfile(home: string): void {
  const dir = resolveProfileDir('better', home)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-better',
    private: true,
    dependencies: {},
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', betterBundle],
        form: { kind: 'orb' },
        owner: 'desktop',
      },
    },
  }, undefined, 2) + '\n')
  writeFileSync(join(dir, 'cordis.patch.yml'), '[]\n')
}

describe('the better bundle form profile', () => {
  it('composes the orb rows from the documented recipe', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-profile-better-'))
    try {
      createFormProfile(home)
      const profile = loadProfile('dsh', 'better', installAnchor, home)
      expect(profile.skippedBundles).toEqual([])
      expect(profile.form).toEqual({ kind: 'orb' })
      expect(profile.owner).toBe('desktop')
      expect(profile.layers.map(layer => layer.packageName)).toEqual([
        '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', betterBundle,
      ])
      const warnings: string[] = []
      const rows = composeEntries([...profile.layers.map(layer => layer.patches), profile.patches],
        message => warnings.push(message))
      expect(warnings).toEqual([])
      const byId = new Map(rows.map(row => [row.id, row]))
      expect(byId.get('client-surface')).toMatchObject({ name: '@deepseek-ai/dsh-client-surface' })
      expect(byId.get('client-ui-orb')).toMatchObject({ name: '@deepseek-ai/dsh-client-ui-orb' })
      expect(byId.get('client-voice-capture')).toMatchObject({ name: '@deepseek-ai/dsh-client-voice-capture' })
      expect(byId.get('speech-to-text')).toMatchObject({
        name: '@deepseek-ai/dsh-experimental-speech-to-text',
        config: { defaultProvider: 'deepseek-cloud', language: 'auto' },
      })
      expect(byId.get('text-to-speech')).toMatchObject({
        name: '@deepseek-ai/dsh-text-to-speech',
        config: { defaultProvider: 'deepseek-tts', voiceId: 'stella', format: 'wav' },
      })
      expect(byId.get('api-text-to-speech')).toMatchObject({ name: '@deepseek-ai/dsh-api-text-to-speech' })
      expect(byId.get('client-ui-voice-output')).toMatchObject({ name: '@deepseek-ai/dsh-client-ui-voice-output' })
      expect(byId.get('ui-voice-input')).toMatchObject({ name: '@deepseek-ai/dsh-experimental-client-ui-voice-input' })
      expect(byId.get('preset-manage')).toMatchObject({
        name: '@deepseek-ai/dsh-agent-preset',
        config: { id: 'manage', name: '管理对话' },
      })
      // The orb's management Session names the preset, so the bundle must install it.
      const bundleManifest = JSON.parse(readFileSync(
        createRequire(installAnchor).resolve('@deepseek-ai/dsh-better-bundle/package.json'), 'utf8',
      )) as { readonly dependencies?: Readonly<Record<string, string>> }
      expect(bundleManifest.dependencies).toHaveProperty('@deepseek-ai/dsh-tool-session-query')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('stays out of shipped templates and is admitted as an optional bundle', () => {
    for (const template of Object.values(PROFILE_TEMPLATES)) expect(template.bundles).not.toContain(betterBundle)
    expect(DEFAULT_PROFILE_BUNDLES).not.toContain(betterBundle)
    expect(OPTIONAL_BUNDLES).toContain(betterBundle)
  })
})
