import { describe, expect, it } from 'vitest'
import { normalizeBinding, SYSTEM_SHORTCUT_CODES, systemAccelerator } from '../src/protocol.ts'
import type { NormalizedBinding, ShortcutPlatform } from '../src/protocol.ts'

const namedKeys: Readonly<Record<string, string>> = {
  Space: 'Space', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Escape: 'Esc',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
}
const binding = (code: string, modifiers: NormalizedBinding['modifiers'] = []): NormalizedBinding => ({ code, modifiers })
const expectedKey = (code: string): string => code.startsWith('Key') ? code.slice(3)
  : code.startsWith('Digit') ? code.slice(5) : namedKeys[code] ?? code
const platforms = ['macos', 'windows', 'linux'] as const

describe('system accelerator derivation', () => {
  it('lists every supported physical code once in family then named order', () => {
    const expected = [
      ...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', letter => `Key${letter}`),
      ...Array.from({ length: 10 }, (_unused, digit) => `Digit${digit}`),
      ...Array.from({ length: 24 }, (_unused, index) => `F${index + 1}`),
      ...Object.keys(namedKeys),
    ]
    expect(SYSTEM_SHORTCUT_CODES).toEqual(expected)
    expect(new Set(SYSTEM_SHORTCUT_CODES).size).toBe(SYSTEM_SHORTCUT_CODES.length)
  })

  it('maps every supported code to the accelerator key name', () => {
    for (const code of SYSTEM_SHORTCUT_CODES) {
      for (const platform of platforms) expect(systemAccelerator(binding(code), platform)).toBe(expectedKey(code))
    }
    expect(systemAccelerator(binding('F1'), 'windows')).toBe('F1')
    expect(systemAccelerator(binding('F24'), 'windows')).toBe('F24')
    expect(systemAccelerator(binding('Digit0'), 'windows')).toBe('0')
    expect(systemAccelerator(binding('KeyZ'), 'windows')).toBe('Z')
  })

  it.each(platforms)('maps each modifier in normalized order on %s', (platform: ShortcutPlatform) => {
    const meta = platform === 'macos' ? 'Command' : 'Super'
    expect(systemAccelerator(binding('KeyK'), platform)).toBe('K')
    expect(systemAccelerator(binding('KeyK', ['control']), platform)).toBe('Control+K')
    expect(systemAccelerator(binding('KeyK', ['alt']), platform)).toBe('Alt+K')
    expect(systemAccelerator(binding('KeyK', ['shift']), platform)).toBe('Shift+K')
    expect(systemAccelerator(binding('KeyK', ['meta']), platform)).toBe(`${meta}+K`)
    expect(systemAccelerator(binding('KeyK', ['control', 'alt', 'shift', 'meta']), platform))
      .toBe(`Control+Alt+Shift+${meta}+K`)
    expect(systemAccelerator(normalizeBinding({ code: 'KeyK', modifiers: ['primary'] }, platform), platform))
      .toBe(platform === 'macos' ? 'Command+K' : 'Control+K')
  })

  it('rejects physical codes Electron cannot register as a system accelerator', () => {
    for (const code of ['Tab', 'Slash', 'Comma', 'KeyAA', 'Digit10', 'F25', 'Arrow', '']) {
      expect(() => systemAccelerator(binding(code), 'windows')).toThrow(`Unsupported system shortcut code: ${code}`)
    }
  })
})
