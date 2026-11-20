/** Launch profile a packaged build declares, and the template that materializes it. */

import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_DESKTOP_PROFILE } from './profile-selection.ts'

/** Launch-profile defaults one build declares in its application manifest. */
export interface BundledProfileDefaults {
  /** Profile this build starts when no launch argument selects one. */
  readonly defaultProfile: string
  /** Template directory name under the resources root; undefined when the build ships none. */
  readonly template: string | undefined
}

/** A profile or template name is one directory segment, never a path. */
const DIRECTORY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

/**
 * Validate one manifest field that names a directory segment.
 * @param value - candidate value.
 * @param field - manifest field named in the diagnostic.
 * @returns the validated name.
 * @throws when the value is not a single directory-segment name.
 */
function directoryName(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DIRECTORY_NAME.test(value)) {
    throw new Error(`desktop: ${field} must be one directory-segment name`)
  }
  return value
}

/**
 * Read the launch-profile defaults a packaged build declares in its application manifest.
 * A development launch and a build without declarations keep the shipped default profile
 * and materialize no template, so only a form build changes launch behavior.
 * @param manifest - parsed application manifest.
 * @param packaged - whether this launch runs the packaged application.
 * @returns declared profile name and optional template directory name.
 * @throws when a declaration is present but malformed.
 */
export function readBundledProfileDefaults(manifest: unknown, packaged: boolean): BundledProfileDefaults {
  if (!packaged) return { defaultProfile: DEFAULT_DESKTOP_PROFILE, template: undefined }
  if (typeof manifest !== 'object' || manifest === null) throw new Error('desktop: invalid application manifest')
  const declared = manifest as Record<string, unknown>
  return {
    defaultProfile: declared.dshDesktopDefaultProfile === undefined
      ? DEFAULT_DESKTOP_PROFILE
      : directoryName(declared.dshDesktopDefaultProfile, 'dshDesktopDefaultProfile'),
    template: declared.dshDesktopProfileTemplate === undefined
      ? undefined
      : directoryName(declared.dshDesktopProfileTemplate, 'dshDesktopProfileTemplate'),
  }
}

/**
 * Materialize a launch profile from its bundled template while it does not exist.
 * An existing profile is never overwritten, so user edits and plugin installs survive
 * upgrades; a build that declares a template always ships it.
 * @param templateRoot - absolute template directory inside the application resources.
 * @param profileDir - absolute harness profile directory to create.
 * @throws when the profile is missing and its template is absent.
 */
export function materializeBundledProfile(templateRoot: string, profileDir: string): void {
  if (existsSync(join(profileDir, 'package.json'))) return
  if (!existsSync(templateRoot)) throw new Error(`desktop: bundled profile template ${templateRoot} is missing`)
  cpSync(templateRoot, profileDir, { recursive: true })
}
