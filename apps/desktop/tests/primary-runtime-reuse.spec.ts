/** Development launches reuse a payload that already matches this release, and verify only what they prepare. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { workspaceDependencyPaths } from '../../../packages/skill/tool-workspace-dependencies/src/index.ts'

const state = vi.hoisted(() => ({
  root: '',
  prepare: vi.fn(),
  smoke: vi.fn(),
  manifest: null as null | {
    desktopVersion: string
    platform: string
    arch: string
    payloadDigest: string
    python: string
    node: string
    pnpm: string
    pythonPackages: Record<string, string>
  },
}))
vi.mock('../scripts/desktop-build-paths.mjs', async importOriginal => ({
  ...await importOriginal<typeof import('../scripts/desktop-build-paths.mjs')>(),
  resolveDesktopBuildTarget: () => 'win-x64',
  resolveDesktopTargetBuildPaths: () => ({
    runtime: join(state.root, 'runtime'), electron: join(state.root, 'electron'), downloads: join(state.root, 'downloads'),
  }),
}))
vi.mock('../../../scripts/primary-runtime/prepare.ts', () => ({
  expectedPrimaryRuntimeManifest: () => manifest(),
  preparePrimaryRuntime: state.prepare,
  smokePrimaryRuntime: state.smoke,
}))

const { developmentPreparationOptions, preparePrimaryRuntime } = await import('../scripts/prepare-primary-runtime.ts')

type FixtureManifest = NonNullable<typeof state.manifest>

function manifest(): FixtureManifest {
  if (state.manifest === null) throw new Error('primary runtime reuse: manifest fixture is not initialized')
  return state.manifest
}

/** Write the entry files a complete payload declares for its manifest. */
async function writePayload(root: string, payloadManifest: FixtureManifest): Promise<void> {
  const entries = workspaceDependencyPaths(root, payloadManifest)
  if (entries.node === undefined || entries.pnpm === undefined || entries.nodePackages === undefined) {
    throw new Error('primary runtime reuse: the manifest fixture must declare node and pnpm')
  }
  for (const file of [entries.python, entries.node, entries.pnpm]) {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, '')
  }
  await mkdir(entries.pythonPackages, { recursive: true })
  await mkdir(entries.nodePackages, { recursive: true })
}

function payloadRoot(): string {
  return join(state.root, 'runtime', 'primary-runtime')
}

beforeEach(async () => {
  vi.clearAllMocks()
  state.root = await mkdtemp(join(tmpdir(), 'desktop-primary-reuse-'))
  state.manifest = {
    desktopVersion: '1.0.0', platform: process.platform, arch: process.arch, payloadDigest: 'a'.repeat(64),
    python: '3.12.14', node: '24.21.0', pnpm: '11.28.5', pythonPackages: { numpy: '2.3.5' },
  }
})

afterEach(async () => {
  state.manifest = null
  await rm(state.root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
})

it('reuses a complete payload that already records this release without preparing or verifying it', async () => {
  const root = payloadRoot()
  await writePayload(root, manifest())
  await writeFile(join(root, 'runtime.json'), JSON.stringify(manifest()))
  await preparePrimaryRuntime({ reuse: true })
  expect(state.prepare).not.toHaveBeenCalled()
  expect(state.smoke).not.toHaveBeenCalled()
})

it('prepares and verifies a payload recorded for other inputs', async () => {
  const root = payloadRoot()
  await writePayload(root, manifest())
  await writeFile(join(root, 'runtime.json'), JSON.stringify({ ...manifest(), payloadDigest: 'b'.repeat(64) }))
  await preparePrimaryRuntime({ reuse: true })
  expect(state.prepare).toHaveBeenCalledOnce()
  expect(state.smoke).toHaveBeenCalledOnce()
})

it('prepares a payload whose manifest matches but whose entries are incomplete', async () => {
  const root = payloadRoot()
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'runtime.json'), JSON.stringify(manifest()))
  await preparePrimaryRuntime({ reuse: true })
  expect(state.prepare).toHaveBeenCalledOnce()
  expect(state.smoke).toHaveBeenCalledOnce()
})

it('prepares a payload recorded for another platform', async () => {
  const root = payloadRoot()
  await writePayload(root, manifest())
  await writeFile(join(root, 'runtime.json'), JSON.stringify({ ...manifest(), platform: process.platform === 'win32' ? 'darwin' : 'win32' }))
  await preparePrimaryRuntime({ reuse: true })
  expect(state.prepare).toHaveBeenCalledOnce()
})

it.each([true, false])('defers the execution checks while reuse is %s', async (reuse) => {
  await preparePrimaryRuntime({ reuse, deferSmoke: true })
  expect(state.prepare).toHaveBeenCalledOnce()
  expect(state.smoke).not.toHaveBeenCalled()
})

it('verifies a reused payload when the caller forces the checks', async () => {
  const root = payloadRoot()
  await writePayload(root, manifest())
  await writeFile(join(root, 'runtime.json'), JSON.stringify(manifest()))
  await preparePrimaryRuntime({ reuse: true, forceSmoke: true })
  expect(state.prepare).not.toHaveBeenCalled()
  expect(state.smoke).toHaveBeenCalledOnce()
})

it.each([
  [{}, { reuse: true, forceSmoke: false }],
  [{ DSH_DESKTOP_REUSE_PRIMARY_RUNTIME: '0' }, { reuse: false, forceSmoke: false }],
  [{ DSH_DESKTOP_SMOKE_PRIMARY_RUNTIME: '1' }, { reuse: true, forceSmoke: true }],
])('resolves the development policy from %o', (environment, expected) => {
  expect(developmentPreparationOptions(environment)).toEqual(expected)
})
