/** Desktop profile selection from launcher arguments and dsh:// deep links. */

import { resolveProfileDir } from '@deepseek-ai/dsh-app-boot'

/** Profile an Electron launch boots when no argument selects another. */
export const DEFAULT_DESKTOP_PROFILE = 'desktop'

/** The profile a Desktop launch boots and its resolved directory. */
export interface DesktopLaunchSelection {
  /** Selected profile name. */
  readonly name: string
  /** Absolute profile directory; the profile may not exist yet. */
  readonly dir: string
}

const PROFILE_FLAG = '--profile'
const PROFILE_FLAG_PREFIX = '--profile='
/** Control characters never belong in a URL or a profile name, so a value carrying one names no profile. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u

/** One duplicate-selection diagnostic. */
function duplicateProfileError(): Error {
  return new Error('desktop: profile selected more than once')
}

/** One empty-name diagnostic. */
function emptyProfileError(): Error {
  return new Error('desktop: profile name must not be empty')
}

/**
 * Read the profile name one launch argument names.
 * Only a dsh:// URL with one profile query parameter names a profile; other schemes, control characters, and unparseable values name none.
 * @param url - one argument of the launch argv.
 * @returns the decoded profile name, or undefined when the argument names no profile.
 * @throws when the profile query parameter is empty or appears more than once.
 */
export function deepLinkProfileName(url: string): string | undefined {
  if (CONTROL_CHARACTERS.test(url)) return undefined
  let link: URL
  try {
    link = new URL(url)
  } catch {
    // A value that is not a URL cannot name a profile.
    return undefined
  }
  if (link.protocol !== 'dsh:') return undefined
  const name = link.searchParams.get('profile')
  if (name === null) return undefined
  if (link.searchParams.getAll('profile').length > 1) throw duplicateProfileError()
  if (name === '') throw emptyProfileError()
  if (CONTROL_CHARACTERS.test(name)) return undefined
  return name
}

/**
 * Resolve the profile a Desktop launch boots from its launcher arguments.
 * Any position may carry `--profile <name>`, `--profile=<name>`, or a `dsh://open?profile=<name>` deep link; none boots the default.
 * @param argv - launcher argv, including the executable path.
 * @param home - Harness home holding profiles; defaults to the current Harness home.
 * @param defaultName - profile a launch without a selection boots; a build declares its own through the application manifest.
 * @returns the selected profile name and its resolved directory.
 * @throws when a profile is selected more than once, a name is empty, or a name is not a valid profile name.
 */
export function desktopLaunchSelection(
  argv: readonly string[],
  home?: string,
  defaultName: string = DEFAULT_DESKTOP_PROFILE,
): DesktopLaunchSelection {
  let selected: string | undefined
  const select = (name: string): void => {
    if (selected !== undefined) throw duplicateProfileError()
    if (name === '') throw emptyProfileError()
    selected = name
  }
  for (const [index, argument] of argv.entries()) {
    if (argument === PROFILE_FLAG) {
      const value = argv[index + 1]
      if (value === undefined) throw emptyProfileError()
      select(value)
    } else if (argument.startsWith(PROFILE_FLAG_PREFIX)) {
      select(argument.slice(PROFILE_FLAG_PREFIX.length))
    } else {
      const name = deepLinkProfileName(argument)
      if (name !== undefined) select(name)
    }
  }
  const name = selected ?? defaultName
  let dir: string
  try {
    dir = resolveProfileDir(name, home)
  } catch (error) {
    throw new Error(`desktop: ${(error as Error).message}`, { cause: error })
  }
  return { name, dir }
}
