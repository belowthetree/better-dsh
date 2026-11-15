/** Desktop resource locations and signing-aware verification for the shared runtime builder. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expectedPrimaryRuntimeManifest, preparePrimaryRuntime as preparePayload, smokePrimaryRuntime as smokePayload } from '../../../scripts/primary-runtime/prepare.ts'
import { parsePrimaryRuntime, readPrimaryRuntime, resolvePrimaryRuntime, workspaceDependencyPaths, type PrimaryRuntimeManifest } from '../../../packages/skill/tool-workspace-dependencies/src/index.ts'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { scrubWindowsSigningEnvironment } from './windows-sign.mjs'

/** How one caller wants a prepared payload reused and verified. */
export interface PreparePrimaryRuntimeOptions {
  /** Reuse a payload whose manifest already records this release; preparation is skipped. */
  readonly reuse?: boolean
  /** Skip the native-target execution checks; signed Windows packaging runs them later. */
  readonly deferSmoke?: boolean
  /** Execute the native-target checks even for a reused payload. */
  readonly forceSmoke?: boolean
}

/**
 * Resolve the development launch's payload policy.
 * @param environment - Launcher environment.
 * @returns Reuse unless `DSH_DESKTOP_REUSE_PRIMARY_RUNTIME=0`; execution checks only when this launch rebuilt the payload, or always with
 * `DSH_DESKTOP_SMOKE_PRIMARY_RUNTIME=1`.
 */
export function developmentPreparationOptions(environment: NodeJS.ProcessEnv): PreparePrimaryRuntimeOptions {
  return {
    reuse: environment.DSH_DESKTOP_REUSE_PRIMARY_RUNTIME !== '0',
    forceSmoke: environment.DSH_DESKTOP_SMOKE_PRIMARY_RUNTIME === '1',
  }
}

/**
 * Prepare Desktop resources for its selected packaging target.
 * @param options - Reuse and execution-check policy owned by the caller.
 * @returns Resolves after preparation and, unless deferred or reused, native-target execution checks.
 */
export async function preparePrimaryRuntime(options: PreparePrimaryRuntimeOptions = {}): Promise<void> {
  const paths = resolveDesktopTargetBuildPaths()
  const target = resolveDesktopBuildTarget()
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  const root = join(paths.runtime, 'primary-runtime')
  const reused = options.reuse === true && await reusablePrimaryRuntime(root, expectedPrimaryRuntimeManifest({ target, version }))
  if (reused) console.log(`desktop development: reusing the prepared primary runtime at ${root}`)
  else await preparePayload({ target, output: paths.runtime, cache: paths.downloads, version })
  if (options.deferSmoke !== true && (!reused || options.forceSmoke === true)) smokePrimaryRuntime(root)
}

/**
 * Report whether an installed payload already carries everything this release locks.
 * @param root - Prepared payload directory.
 * @param expected - Manifest whose inputs and versions identify this release.
 * @returns True when the installed manifest matches and every declared entry is present.
 */
export async function reusablePrimaryRuntime(root: string, expected: PrimaryRuntimeManifest): Promise<boolean> {
  try { return await matchesPrimaryRuntime(root, expected) } catch (error) {
    console.log(`desktop development: preparing a fresh primary runtime: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

async function matchesPrimaryRuntime(root: string, expected: PrimaryRuntimeManifest): Promise<boolean> {
  if (JSON.stringify(await readPrimaryRuntime(root)) !== JSON.stringify(expected)) return false
  await resolvePrimaryRuntime(root)
  return true
}

/**
 * Verify Desktop's complete payload after preparation or platform signing.
 * @param root - Final payload directory, including any platform signatures.
 */
export function smokePrimaryRuntime(root: string): void {
  const manifest = parsePrimaryRuntime(JSON.parse(readFileSync(join(root, 'runtime.json'), 'utf8')))
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) return
  if (Object.keys(manifest.pythonPackages).length === 0) throw new Error('primary runtime: missing Python distribution versions; prepare the payload before running its smoke checks.')
  const entries = workspaceDependencyPaths(root, manifest)
  if (entries.node === undefined || entries.pnpm === undefined) throw new Error('primary runtime: the Desktop payload must declare node and pnpm components.')
  smokePayload(root, scrubWindowsSigningEnvironment(process.env))
}

if (import.meta.main) await preparePrimaryRuntime()
