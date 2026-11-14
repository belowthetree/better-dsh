/** Filesystem ownership for the Electron-managed desktop installation. */

import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DEFAULT_DESKTOP_PROFILE } from './profile-selection.ts'

/** Stable desktop installation paths under the shared Harness home. */
export interface DesktopPaths {
  /** Desktop profile name this installation owns. */
  readonly name: string
  /** Initialized profile directory for that name. */
  readonly profile: string
  /** Single-writer lock file inside the profile directory. */
  readonly lock: string
}

/**
 * Resolve every Electron-owned path without changing the shared data roots.
 * @param dshHome - Harness home shared with npm-installed dsh.
 * @param name - profile name Desktop owns; defaults to {@link DEFAULT_DESKTOP_PROFILE}.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(
  dshHome: string = resolveDshHome(), name: string = DEFAULT_DESKTOP_PROFILE,
): DesktopPaths {
  const profile = join(dshHome, 'profiles', name)
  return { name, profile, lock: join(profile, 'lock') }
}
