// @vitest-environment node
/** The better bundle ships the orb's management preset, installs every plugin it names, and validates their configs. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import AgentPreset from '@deepseek-ai/dsh-agent-preset'
import { Config as AgentInstructionsConfig } from '@deepseek-ai/dsh-agent-instructions'
import BasicCompaction from '@deepseek-ai/dsh-compaction-basic'
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import { Config as PersonaConfig } from '@deepseek-ai/dsh-persona'
import { Config as TimeContextConfig } from '@deepseek-ai/dsh-time-context'
import { Config as AskUserConfig } from '@deepseek-ai/dsh-tool-ask-user'
import { Config as SessionQueryConfig } from '@deepseek-ai/dsh-tool-session-query'

const BUNDLE_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** One nested row of a preset declaration; a group carries its rows in `config`. */
interface PresetRow {
  readonly name: string
  readonly config?: unknown
}

/** The preset declaration this bundle ships. */
interface PresetConfig {
  readonly id: string
  readonly name?: string
  readonly plugins: readonly PresetRow[]
}

/** One validated plain-object configuration. */
type ObjectConfig = Readonly<Record<string, unknown>>

/** Plugin rows without a configuration schema, which must declare no config. */
const UNCONFIGURED = new Set(['@deepseek-ai/dsh-command-compact'])

/**
 * Wrap one plugin configuration schema as a row-config validator.
 * @param config - callable schemastery schema for the plugin.
 * @returns a validator accepting one parsed row configuration.
 */
function validator<T>(config: (value: T) => T): (value: ObjectConfig) => unknown {
  return value => config(value as T)
}

/** Validate each named plugin's row config through that plugin's own schema. */
const validators: Readonly<Record<string, (value: ObjectConfig) => unknown>> = {
  '@deepseek-ai/dsh-agent-instructions': validator(AgentInstructionsConfig),
  '@deepseek-ai/dsh-compaction-basic': validator(BasicCompaction.Config),
  '@deepseek-ai/dsh-compaction-tool-result-pruner': validator(ToolResultPruner.Config),
  '@deepseek-ai/dsh-persona': validator(PersonaConfig),
  '@deepseek-ai/dsh-time-context': validator(TimeContextConfig),
  '@deepseek-ai/dsh-tool-ask-user': validator(AskUserConfig),
  '@deepseek-ai/dsh-tool-session-query': validator(SessionQueryConfig),
}

/** Names of every plugin row, including the rows a group carries in `config`. */
function pluginNames(rows: readonly PresetRow[]): string[] {
  return rows.flatMap(row => [row.name, ...(Array.isArray(row.config) ? pluginNames(row.config as readonly PresetRow[]) : [])])
}

/** Validate one preset row tree, naming the failing row. */
function validateRows(rows: readonly PresetRow[]): void {
  for (const row of rows) {
    if (row.name === 'cordis:group') {
      if (!Array.isArray(row.config)) throw new Error(`${row.name} carries no rows`)
      validateRows(row.config as readonly PresetRow[])
      continue
    }
    const validate = validators[row.name]
    if (validate === undefined) {
      if (UNCONFIGURED.has(row.name) && row.config === undefined) continue
      throw new Error(`${row.name} has no configuration validator`)
    }
    const config = row.config ?? {}
    if (typeof config !== 'object' || config === null) throw new Error(`${row.name} config must be an object`)
    try {
      validate(config as ObjectConfig)
    } catch (error) {
      throw new Error(`preset row ${row.name} has an invalid config: ${(error as Error).message}`, { cause: error })
    }
  }
}

/** The bundle's shipped preset declaration. */
function presetDeclaration(): PresetConfig {
  const rows = loadOverlayPatches('better-bundle', `${BUNDLE_ROOT}/presets/manage.patch.yml`)
    .flatMap(patch => patch.insert ?? [])
  expect(rows).toHaveLength(1)
  return rows[0]!.config as PresetConfig
}

it('ships the management preset with a declared dependency for every plugin it mounts', () => {
  const config = presetDeclaration()
  expect(config.id).toBe('manage')
  expect(config.name).toBe('管理对话')
  const manifest = JSON.parse(readFileSync(`${BUNDLE_ROOT}/package.json`, 'utf8')) as {
    readonly dependencies: Readonly<Record<string, string>>
    readonly dsh: { readonly bundle: { readonly patch: readonly string[] } }
  }
  expect(manifest.dsh.bundle.patch).toContain('./presets/manage.patch.yml')
  const installed = pluginNames(config.plugins).filter(name => !name.startsWith('cordis:'))
  expect(installed.length).toBeGreaterThan(0)
  for (const name of installed) expect(manifest.dependencies).toHaveProperty(name)
})

it('validates the declaration and every preset row against its plugin config schema', () => {
  const config = presetDeclaration()
  AgentPreset.Config(config)
  validateRows(config.plugins)
})
