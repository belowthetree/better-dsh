/** Profile form read from a desktop-managed profile manifest before the Host starts. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readProfileIdentity, readProfileManifest } from '@deepseek-ai/dsh-app-boot'
import type { DshProfileForm } from '@deepseek-ai/dsh-package-manifest'

/** A desktop-owned profile and the shell form its manifest declares. */
export interface DesktopFormProfile {
  /** Profile name selected for this launch. */
  readonly name: string
  /** Absolute profile directory. */
  readonly dir: string
  /** Shell form the profile requests; classic when the manifest omits it. */
  readonly form: DshProfileForm
}

/**
 * Read the shell form a profile declares before Desktop starts the Host.
 * Window options such as transparency and always-on-top cannot change after construction, so the caller reads this before the Host starts.
 * @param dir - absolute profile directory from the launch selection.
 * @param name - profile name used in diagnostics.
 * @returns the profile identity and the form its manifest requests.
 * @throws when the profile has no manifest, its manifest cannot be read, or its form declaration is malformed.
 */
export function readDesktopFormProfile(dir: string, name: string): DesktopFormProfile {
  if (!existsSync(join(dir, 'package.json'))) {
    throw new Error(`desktop: profile ${JSON.stringify(name)} does not exist at ${dir}`)
  }
  const manifest = readProfileManifest('desktop', dir)
  return { name, dir, form: readProfileIdentity('desktop', name, manifest).form }
}
