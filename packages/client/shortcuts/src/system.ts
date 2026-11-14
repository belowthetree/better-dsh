/** System-scope accelerator derivation and OS registration state shared by Client and Desktop main. */
import type { NormalizedBinding, ShortcutCommandId, ShortcutPlatform } from './binding.ts'

/** Named physical keys outside the letter, digit, and function families, mapped to Electron's accelerator name. */
const namedCodes: ReadonlyArray<readonly [string, string]> = [
  ['Space', 'Space'], ['Enter', 'Enter'], ['Backspace', 'Backspace'], ['Delete', 'Delete'],
  ['Escape', 'Esc'], ['ArrowUp', 'Up'], ['ArrowDown', 'Down'], ['ArrowLeft', 'Left'], ['ArrowRight', 'Right'],
]
/** Electron accelerator name of every physical code a system binding may occupy. */
const acceleratorCodes: Readonly<Record<string, string>> = Object.fromEntries([
  ...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', (letter): [string, string] => [`Key${letter}`, letter]),
  ...Array.from({ length: 10 }, (_unused, digit): [string, string] => [`Digit${digit}`, String(digit)]),
  ...Array.from({ length: 24 }, (_unused, index): [string, string] => [`F${index + 1}`, `F${index + 1}`]),
  ...namedCodes,
])
/** Modifier names shared by every platform; meta is resolved from the receiving device. */
const acceleratorModifiers = { control: 'Control', alt: 'Alt', shift: 'Shift' } as const

/**
 * Physical codes a system-scope binding may occupy: `KeyA`..`KeyZ`, `Digit0`..`Digit9`, `F1`..`F24`, `Space`, `Enter`,
 * `Backspace`, `Delete`, `Escape`, and the four arrow keys. Validation and accelerator derivation both read this set.
 */
export const SYSTEM_SHORTCUT_CODES: readonly string[] = Object.keys(acceleratorCodes)

/** One command's OS-global registration result. */
export interface SystemShortcutRegistration {
  /** Command whose accepted binding was translated. */
  readonly id: ShortcutCommandId
  /** Electron accelerator derived from the accepted binding. */
  readonly accelerator: string
  /** Whether the operating system accepted this accelerator for the current run. */
  readonly status: 'registered' | 'failed'
}

/** OS-global registration state published to the product renderer. */
export interface SystemShortcutState {
  /** One entry per command requested for global registration. */
  readonly registrations: readonly SystemShortcutRegistration[]
  /** Registration is released while the shortcut recording UI owns input. */
  readonly suspended: boolean
  /** Why global registration cannot run at all; absent means this device can attempt it. */
  readonly unavailable?: 'platform' | 'carrier'
}

/**
 * Translate one normalized system binding into an Electron accelerator.
 * @param binding - normalized system binding with one physical code and zero to four modifiers.
 * @param platform - receiving device; macOS spells meta as `Command` and every other device as `Super`.
 * @returns modifiers in normalized order followed by the key, joined with `+`.
 * @throws Error when the binding codes a key outside {@link SYSTEM_SHORTCUT_CODES}.
 */
export function systemAccelerator(binding: NormalizedBinding, platform: ShortcutPlatform): string {
  const code = acceleratorCodes[binding.code]
  if (code === undefined) throw new Error(`Unsupported system shortcut code: ${binding.code}`)
  const meta = platform === 'macos' ? 'Command' : 'Super'
  return [...binding.modifiers.map(modifier => modifier === 'meta' ? meta : acceleratorModifiers[modifier]), code].join('+')
}
