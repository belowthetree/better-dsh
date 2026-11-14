import { describe, expect, it } from 'vitest'
import { bindingIssue, editShortcutDocument, effectiveShortcuts, effectiveSystemShortcuts, isSystemCommand, normalizeBinding,
  overlappingBindings, parseBinding, parseShortcutDefinitions, parseShortcutDocument, parseShortcutEdit, systemShortcutIssue } from '../src/protocol.ts'
import type { ShortcutBinding, ShortcutCommandId, ShortcutDefinition, ShortcutDocument, ShortcutPlatform } from '../src/protocol.ts'

const id = (value: string) => value as ShortcutCommandId
it('distinguishes identical two-key chords from pairs sharing only one key', () => {
  const left = { code: 'KeyA', secondCode: 'KeyB', modifiers: [] }
  expect(overlappingBindings(left, { code: 'KeyB', secondCode: 'KeyA', modifiers: [] })).toBe(true)
  expect(overlappingBindings(left, { code: 'KeyB', secondCode: 'KeyC', modifiers: [] })).toBe(false)
})
it.each(['macos', 'windows', 'linux'] as const)('accepts Mod+Shift+Period on %s without permitting shift-only Web bindings', (platform) => {
  const binding = normalizeBinding({ code: 'Period', modifiers: ['primary', 'shift'] }, platform)
  for (const runtime of ['web', 'desktop'] as const) expect(bindingIssue(binding, runtime, platform)).toBeNull()
  for (const code of ['Period', 'F12', 'KeyJ']) {
    expect(bindingIssue(normalizeBinding({ code, modifiers: ['shift'] }, platform), 'web', platform)).toBe('modifier-required')
  }
})
it('reserves the macOS Web control-command combination', () => {
  expect(bindingIssue({ code: 'KeyB', modifiers: ['control', 'meta'] }, 'web', 'macos')).toBe('reserved')
})
const primary = (code: string) => ({ code, modifiers: ['primary'] as const })
const definitions: readonly ShortcutDefinition[] = [
  { id: id('test.one'), defaults: {
    'desktop:macos': primary('KeyB'),
    'desktop:windows': primary('KeyB'),
    'desktop:linux': primary('KeyB'),
  } },
  { id: id('test.two'), defaults: {
    'desktop:macos': primary('KeyJ'),
    'desktop:windows': primary('KeyJ'),
    'desktop:linux': primary('KeyJ'),
  } },
]

describe('preference document validation and conflict resolution', () => {
  it('distinguishes inherited, cleared, reset, and dormant preferences without touching other profiles', () => {
    const document: ShortcutDocument = { schemaVersion: 1, profiles: {
      'desktop:macos': { 'dormant.command': primary('KeyU'), 'test.one': null },
      'web:windows': { 'test.one': primary('Slash') },
    } }
    expect(parseShortcutDocument(JSON.stringify(document))).toEqual(document)
    expect(effectiveShortcuts(definitions, document, 'desktop', 'macos')[0]).toMatchObject({ modified: true, binding: null })
    const reset = editShortcutDocument(document, { type: 'reset', id: id('test.one') }, 'desktop', 'macos')
    expect(reset.profiles['desktop:macos']).toEqual({ 'dormant.command': primary('KeyU') })
    expect(effectiveShortcuts(definitions, reset, 'desktop', 'macos')[0]).toMatchObject({ modified: false, binding: { code: 'KeyB' } })
    expect(editShortcutDocument(document, { type: 'reset-all' }, 'desktop', 'macos').profiles)
      .toEqual({ 'desktop:macos': {}, 'web:windows': document.profiles['web:windows'] })
  })

  it.each(['{', 'null', '[]', '{"schemaVersion":0,"profiles":{}}', '{"schemaVersion":1,"profiles":{"alien":{}}}',
    '{"schemaVersion":1,"profiles":{"web:macos":{"bad":null}}}', '{"schemaVersion":1,"profiles":{},"extra":1}',
    '{"schemaVersion":1,"profiles":{"web:macos":{"test.one":{"code":"KeyB","modifiers":["bogus"]}}}}'])('retains invalid documents: %s', (raw) => {
    expect(parseShortcutDocument(raw)).toBe('invalid')
  })
  it('refuses future versions without interpreting their fields', () => {
    expect(parseShortcutDocument('{"schemaVersion":4,"profiles":17}')).toBe('future')
    expect(parseShortcutDocument(null)).toEqual({ schemaVersion: 1, profiles: {} })
    expect(() => parseBinding({ code: 'KeyB', modifiers: ['primary'], extra: true })).toThrow()
    expect(() => parseBinding({ code: 'Unknown', modifiers: [] })).toThrow()
  })

  it('lets explicit overrides displace new defaults, but disables both conflicting explicit overrides', () => {
    const document: ShortcutDocument = { schemaVersion: 1, profiles: { 'desktop:windows': { 'test.one': primary('KeyJ') } } }
    const rows = effectiveShortcuts(definitions, document, 'desktop', 'windows')
    expect(rows.map(row => row.conflicts)).toEqual([[], [id('test.one')]])
    const both = editShortcutDocument(document, { type: 'set', id: id('test.two'), binding: { code: 'KeyJ', modifiers: ['control'] } }, 'desktop', 'windows')
    expect(effectiveShortcuts([...definitions].reverse(), both, 'desktop', 'windows').map(row => row.conflicts))
      .toEqual([[id('test.one')], [id('test.two')]])
  })

  it('keeps Linux desktop and browser reservations', () => {
    const platform = 'linux'
    const check = (code: string, modifiers: readonly ('primary' | 'control' | 'alt' | 'shift' | 'meta')[], runtime: 'web' | 'desktop' = 'desktop') =>
      bindingIssue(normalizeBinding({ code, modifiers }, platform), runtime, platform)
    for (const code of ['KeyC', 'KeyV', 'KeyX', 'KeyZ', 'KeyY', 'KeyQ', 'Tab', 'Escape', 'Space', 'Enter']) expect(check(code, ['primary'])).toBe('reserved')
    expect(check('KeyA', ['primary', 'shift'])).toBeNull()
    expect(check('KeyA', ['primary'])).toBe('reserved')
    expect(check('KeyJ', [])).toBe('modifier-required')
    expect(check('KeyJ', ['shift'])).toBe('modifier-required')
    expect(check('KeyJ', ['primary'])).toBeNull()
    for (const code of ['KeyN', 'KeyP', 'KeyW', 'KeyR', 'KeyO', 'KeyJ']) expect(check(code, ['primary'], 'web')).toBe('unsupported-browser')
    for (const code of ['Comma', 'Period']) expect(check(code, ['primary', 'shift'], 'web')).toBeNull()
    expect(check('Slash', ['primary'], 'web')).toBeNull()
    expect(check('F4', ['alt'], 'desktop')).toBe('reserved')
    expect(check('KeyL', ['meta', 'control'], 'desktop')).toBe('reserved')
  })

  it.each(['macos', 'windows'] as const)('accepts %s desktop editing and system combinations, and single keys', (platform) => {
    for (const [code, modifiers] of [
      ...['KeyC', 'KeyV', 'KeyX', 'KeyZ', 'KeyY', 'KeyA', 'KeyQ', 'KeyH', 'Tab', 'Space'].map(code => [code, ['primary']] as const),
      ['KeyC', ['control']], ['KeyX', ['control']], ['KeyN', ['shift']], ['Tab', ['control']], ['Tab', ['shift']],
      ['Escape', ['alt']], ['F4', ['alt']], ['KeyL', ['meta']], ['Delete', ['control', 'alt']],
      ['KeyL', ['control', 'meta']], ['ArrowLeft', ['alt']],
    ] as const) expect(bindingIssue(normalizeBinding({ code, modifiers }, platform), 'desktop', platform)).toBeNull()
    expect(bindingIssue(normalizeBinding({ code: 'KeyC', modifiers: [] }, platform), 'desktop', platform)).toBeNull()
    expect(bindingIssue(normalizeBinding(primary('KeyC'), platform), 'web', platform)).toBe('reserved')
    let document: ShortcutDocument = { schemaVersion: 1, profiles: {} }
    for (const entry of definitions) document = editShortcutDocument(document, { type: 'set', id: entry.id, binding: primary('KeyC') }, 'desktop', platform)
    expect(effectiveShortcuts(definitions, document, 'desktop', platform).map(row => row.conflicts))
      .toEqual([[id('test.two')], [id('test.one')]])
  })

  it.each([
    ['web', 'macos'], ['web', 'windows'], ['desktop', 'macos'], ['desktop', 'windows'],
  ] as const)('accepts three and four distinct modifiers in %s on %s and still detects conflicts', (runtime, platform) => {
    for (const modifiers of [
      ['control', 'alt', 'shift'], ['control', 'alt', 'meta'], ['control', 'shift', 'meta'],
      ['alt', 'shift', 'meta'], ['control', 'alt', 'shift', 'meta'],
    ] as const) {
      for (const code of ['KeyN', 'KeyR', 'KeyX', 'Tab', 'F4']) {
        expect(bindingIssue(normalizeBinding({ code, modifiers }, platform), runtime, platform)).toBeNull()
      }
    }
    const binding = { code: 'KeyX', modifiers: ['primary', 'alt', 'shift'] as const }
    let document: ShortcutDocument = { schemaVersion: 1, profiles: {} }
    for (const entry of definitions) document = editShortcutDocument(document, { type: 'set', id: entry.id, binding }, runtime, platform)
    expect(effectiveShortcuts(definitions, document, runtime, platform).map(row => row.conflicts))
      .toEqual([[id('test.two')], [id('test.one')]])
    expect(bindingIssue(normalizeBinding({ code: 'KeyN', modifiers: [] }, platform), runtime, platform)).toBe(runtime === 'desktop' ? null : 'modifier-required')
  })

  it('counts expanded distinct modifiers and keeps Linux reservations', () => {
    expect(normalizeBinding({ code: 'KeyX', modifiers: ['primary', 'meta', 'shift'] }, 'macos').modifiers).toEqual(['shift', 'meta'])
    expect(bindingIssue(normalizeBinding({ code: 'KeyN', modifiers: ['primary', 'control', 'control'] }, 'windows'), 'web', 'windows')).toBe('unsupported-browser')
    expect(bindingIssue(normalizeBinding({ code: 'KeyN', modifiers: ['control', 'alt', 'shift'] }, 'linux'), 'web', 'linux')).toBe('unsupported-browser')
  })

  it('selects each owner-declared profile without inheriting or rewriting another profile', () => {
    const entry: ShortcutDefinition = { id: id('page.refresh'), defaults: {
      'desktop:macos': primary('KeyR'), 'desktop:windows': primary('KeyR'),
      'web:macos': { code: 'KeyP', modifiers: ['primary', 'shift'] },
      'web:windows': { code: 'KeyJ', modifiers: ['primary', 'alt'] },
    } }
    const document: ShortcutDocument = { schemaVersion: 1, profiles: {} }
    const effective = (runtime: 'desktop' | 'web', platform: 'macos' | 'windows' | 'linux', source = document) =>
      effectiveShortcuts([entry], source, runtime, platform)[0]?.binding
    expect(effective('desktop', 'macos')).toEqual({ code: 'KeyR', modifiers: ['meta'] })
    expect(effective('desktop', 'windows')).toEqual({ code: 'KeyR', modifiers: ['control'] })
    expect(effective('web', 'macos')).toEqual({ code: 'KeyP', modifiers: ['shift', 'meta'] })
    expect(effective('web', 'windows')).toEqual({ code: 'KeyJ', modifiers: ['control', 'alt'] })
    expect(effective('desktop', 'linux')).toBeNull()
    expect(effective('web', 'linux')).toBeNull()
    const override = editShortcutDocument(document, { type: 'set', id: entry.id, binding: null }, 'web', 'macos')
    expect(effective('web', 'macos', override)).toBeNull()
    const reset = editShortcutDocument(override, { type: 'reset', id: entry.id }, 'web', 'macos')
    expect(effective('web', 'macos', reset)).toEqual({ code: 'KeyP', modifiers: ['shift', 'meta'] })
    expect(() => parseShortcutDefinitions([entry])).not.toThrow()
    expect(() => parseShortcutDefinitions([entry, { ...entry, id: id('other.refresh') }])).toThrow('Conflicting')
  })

  it('keeps browser admission separate from per-profile default selection', () => {
    for (const platform of ['macos', 'windows'] as const) {
      const primary = platform === 'macos' ? 'meta' : 'control'
      for (const other of ['alt', 'shift'] as const) {
        expect(bindingIssue(normalizeBinding({ code: 'KeyX', modifiers: [primary, other] }, platform), 'web', platform)).toBeNull()
      }
    }
    expect(bindingIssue(normalizeBinding(primary('Backquote'), 'macos'), 'web', 'macos')).toBe('unsupported-browser')
    expect(bindingIssue(normalizeBinding({ code: 'KeyB', modifiers: ['alt'] }, 'macos'), 'web', 'macos')).toBe('reserved')
    expect(bindingIssue(normalizeBinding(primary('KeyN'), 'windows'), 'web', 'windows')).toBe('unsupported-browser')
  })

  it('validates IPC edits and active definitions rather than trusting renderer fields', () => {
    expect(parseShortcutDefinitions(definitions)).toEqual(definitions)
    expect(parseShortcutEdit({ type: 'set', id: 'test.one', binding: null })).toEqual({ type: 'set', id: 'test.one', binding: null })
    expect(parseShortcutEdit({ type: 'reset', id: 'test.one' }).type).toBe('reset')
    expect(parseShortcutEdit({ type: 'reset-all' }).type).toBe('reset-all')
    for (const value of [null, {}, { type: 'recover' }, { type: 'reset', id: '../x' }, { type: 'reset-all', path: '/tmp' }, { type: 'other', id: 'test.one' }]) expect(() => parseShortcutEdit(value)).toThrow()
    for (const value of [null, [{ ...definitions[0], defaults: {
      'desktop:macos': null,
      'desktop:windows': null,
      'desktop:linux': null,
    } }], [...definitions, definitions[0]],
    [{ ...definitions[0], defaults: { other: primary('KeyJ') } }], [{ ...definitions[0], defaults: {
      'web:macos': primary('KeyN'),
      'web:windows': primary('KeyN'),
      'web:linux': primary('KeyN'),
    } }],
    [{ ...definitions[0], defaults: {
      'desktop:macos': primary('KeyC'),
      'desktop:windows': primary('KeyC'),
      'desktop:linux': primary('KeyC'),
    } }]]) expect(() => parseShortcutDefinitions(value)).toThrow()
  })
})

const systemToggle = id('orb.toggle')
const systemCapture = id('orb.capture')
const systemDefaults = (code: string, modifiers: ShortcutBinding['modifiers']) => ({
  'desktop:macos': { code, modifiers }, 'desktop:windows': { code, modifiers }, 'desktop:linux': { code, modifiers },
})
const systemDefinitions: readonly ShortcutDefinition[] = [
  { id: systemToggle, scope: 'system', defaults: systemDefaults('KeyK', ['control', 'shift']) },
  { id: systemCapture, scope: 'system', defaults: systemDefaults('F13', []) },
]
const catalog: readonly ShortcutDefinition[] = [...definitions, ...systemDefinitions]
const systemDocument = (system: Readonly<Record<string, ShortcutBinding | null>>): ShortcutDocument =>
  ({ schemaVersion: 3, profiles: {}, system })

describe('system-scope commands', () => {
  it('distinguishes system commands from application commands', () => {
    expect(isSystemCommand(systemDefinitions[0]!)).toBe(true)
    expect(isSystemCommand(definitions[0]!)).toBe(false)
    expect(isSystemCommand({ ...definitions[0]!, scope: 'application' })).toBe(false)
  })

  it('admits Desktop system bindings and rejects browser, chord, unknown, and bare ordinary keys', () => {
    const check = (code: string, modifiers: readonly ('control' | 'alt' | 'shift' | 'meta')[],
      runtime: 'desktop' | 'web' = 'desktop', platform: ShortcutPlatform = 'windows') =>
      systemShortcutIssue(normalizeBinding({ code, modifiers }, platform), runtime, platform)
    expect(check('KeyK', ['control'])).toBeNull()
    expect(check('F12', [])).toBeNull()
    expect(check('F1', [], 'desktop', 'macos')).toBeNull()
    expect(check('F24', [], 'desktop', 'linux')).toBeNull()
    expect(check('KeyK', [], 'web')).toBe('unsupported-browser')
    expect(check('KeyK', ['control'], 'web')).toBe('unsupported-browser')
    expect(systemShortcutIssue({ code: 'KeyA', secondCode: 'KeyB', modifiers: ['control'] }, 'desktop'))
      .toBe('unsupported-key')
    expect(check('Tab', ['control'])).toBe('unsupported-key')
    expect(check('KeyK', [])).toBe('modifier-required')
    expect(check('Digit5', [])).toBe('modifier-required')
    expect(check('Space', [])).toBe('modifier-required')
  })

  it('resolves system defaults, overrides, clears, and unavailable overrides for one device', () => {
    const rows = (document: ShortcutDocument, platform: ShortcutPlatform = 'windows') =>
      effectiveSystemShortcuts(catalog, document, platform)
    expect(rows({ schemaVersion: 3, profiles: {} }).map(row => row.id)).toEqual([systemToggle, systemCapture])
    expect(rows({ schemaVersion: 3, profiles: {} })[0]).toEqual({ id: systemToggle,
      binding: { code: 'KeyK', modifiers: ['control', 'shift'] }, modified: false, issue: null, conflicts: [] })
    expect(rows({ schemaVersion: 3, profiles: {} })[1]?.binding).toEqual({ code: 'F13', modifiers: [] })
    expect(rows({ schemaVersion: 3, profiles: {} }, 'macos')[0]?.binding)
      .toEqual({ code: 'KeyK', modifiers: ['control', 'shift'] })
    expect(rows(systemDocument({ [systemToggle]: { code: 'KeyK', modifiers: ['primary'] } }), 'macos')[0]?.binding)
      .toEqual({ code: 'KeyK', modifiers: ['meta'] })
    expect(rows(systemDocument({ [systemToggle]: { code: 'KeyJ', modifiers: ['alt'] } }))[0]).toEqual({ id: systemToggle,
      binding: { code: 'KeyJ', modifiers: ['alt'] }, modified: true, issue: null, conflicts: [] })
    expect(rows(systemDocument({ [systemToggle]: null }))[0])
      .toEqual({ id: systemToggle, binding: null, modified: true, issue: null, conflicts: [] })
    expect(rows(systemDocument({ [systemToggle]: { code: 'KeyA', modifiers: [] } }))[0])
      .toMatchObject({ issue: 'modifier-required' })
    expect(rows(systemDocument({ [systemToggle]: { code: 'Tab', modifiers: ['control'] } }))[0])
      .toMatchObject({ issue: 'unsupported-key' })
  })

  it('displaces a system default for an explicit override and ignores unavailable system rows', () => {
    expect(effectiveSystemShortcuts(catalog, systemDocument({ [systemToggle]: { code: 'F13', modifiers: [] } }), 'windows')
      .map(row => row.conflicts)).toEqual([[], [systemToggle]])
    const both = systemDocument({ [systemToggle]: { code: 'KeyJ', modifiers: ['alt'] },
      [systemCapture]: { code: 'KeyJ', modifiers: ['alt'] } })
    expect(effectiveSystemShortcuts(catalog, both, 'windows').map(row => row.conflicts))
      .toEqual([[systemCapture], [systemToggle]])
    const unavailable = systemDocument({ [systemToggle]: { code: 'KeyA', modifiers: [] },
      [systemCapture]: { code: 'KeyA', modifiers: [] } })
    expect(effectiveSystemShortcuts(catalog, unavailable, 'windows').map(row => [row.issue, row.conflicts]))
      .toEqual([['modifier-required', []], ['modifier-required', []]])
  })

  it('reports cross-scope conflicts in both directions and keeps system rows out of application rows', () => {
    const systemOverride = systemDocument({ [systemToggle]: { code: 'KeyB', modifiers: ['control'] } })
    expect(effectiveSystemShortcuts(catalog, systemOverride, 'windows').map(row => row.conflicts))
      .toEqual([[id('test.one')], []])
    const applicationRows = effectiveShortcuts(catalog, systemOverride, 'desktop', 'windows')
    expect(applicationRows.map(row => row.id)).toEqual([id('test.one'), id('test.two')])
    expect(applicationRows.map(row => row.conflicts)).toEqual([[systemToggle], []])
    const applicationOverride: ShortcutDocument = { schemaVersion: 3, profiles: {
      'desktop:windows': { 'test.one': { code: 'KeyK', modifiers: ['control', 'shift'] } } } }
    expect(effectiveSystemShortcuts(catalog, applicationOverride, 'windows').map(row => row.conflicts))
      .toEqual([[id('test.one')], []])
    expect(effectiveShortcuts(catalog, applicationOverride, 'desktop', 'windows').map(row => row.conflicts))
      .toEqual([[systemToggle], []])
  })

  it('does not count unavailable application rows as system conflicts on Linux', () => {
    const withReserved: readonly ShortcutDefinition[] = [...catalog,
      { id: id('app.reserved'), defaults: { 'desktop:linux': { code: 'KeyC', modifiers: ['control'] } } }]
    const reserved = systemDocument({ [systemToggle]: { code: 'KeyC', modifiers: ['control'] } })
    expect(effectiveSystemShortcuts(withReserved, reserved, 'linux')[0]).toEqual({ id: systemToggle,
      binding: { code: 'KeyC', modifiers: ['control'] }, modified: true, issue: null, conflicts: [] })
  })

  it('writes system overrides into a version 3 document without touching profiles', () => {
    const profileDocument: ShortcutDocument = { schemaVersion: 2, profiles: {
      'web:macos': { 'test.one': primary('Slash') } } }
    const set = editShortcutDocument(profileDocument, { type: 'set', id: systemToggle,
      binding: { code: 'KeyJ', modifiers: ['alt'] }, scope: 'system' }, 'desktop', 'windows', 'system')
    expect(set).toEqual({ schemaVersion: 3, profiles: profileDocument.profiles,
      system: { [systemToggle]: { code: 'KeyJ', modifiers: ['alt'] } } })
    const both = editShortcutDocument(set, { type: 'set', id: systemCapture, binding: { code: 'F14', modifiers: [] },
      scope: 'system' }, 'desktop', 'macos', 'system')
    expect(both.system).toEqual({ [systemToggle]: { code: 'KeyJ', modifiers: ['alt'] },
      [systemCapture]: { code: 'F14', modifiers: [] } })
    expect(editShortcutDocument(both, { type: 'reset', id: systemToggle, scope: 'system' },
      'desktop', 'macos', 'system').system).toEqual({ [systemCapture]: { code: 'F14', modifiers: [] } })
    expect(editShortcutDocument(both, { type: 'reset-all', scope: 'system' }, 'desktop', 'macos', 'system'))
      .toEqual({ schemaVersion: 3, profiles: profileDocument.profiles, system: {} })
    const application = editShortcutDocument(profileDocument,
      { type: 'set', id: id('test.one'), binding: primary('KeyB') }, 'desktop', 'windows')
    expect(application.profiles['desktop:windows']).toEqual({ 'test.one': primary('KeyB') })
    expect(application.schemaVersion).toBe(2)
  })

  it('keeps version 3 and system overrides through application edits', () => {
    const document: ShortcutDocument = { schemaVersion: 3, profiles: {}, system: { [systemToggle]: null } }
    const edited = editShortcutDocument(document, { type: 'set', id: id('test.one'), binding: primary('KeyB') },
      'desktop', 'windows')
    expect(edited).toMatchObject({ schemaVersion: 3, system: { [systemToggle]: null },
      profiles: { 'desktop:windows': { 'test.one': primary('KeyB') } } })
    expect(editShortcutDocument(edited, { type: 'reset-all' }, 'desktop', 'windows'))
      .toMatchObject({ schemaVersion: 3, system: { [systemToggle]: null }, profiles: { 'desktop:windows': {} } })
    expect(editShortcutDocument({ schemaVersion: 1, profiles: {} }, { type: 'reset-all' }, 'web', 'linux').schemaVersion).toBe(1)
    expect(editShortcutDocument({ schemaVersion: 1, profiles: {} }, { type: 'reset-all' }, 'desktop', 'macos').schemaVersion).toBe(2)
  })

  it('reads version 3 documents with a system override map and rejects invalid system fields', () => {
    const document: ShortcutDocument = { schemaVersion: 3, profiles: { 'desktop:windows': { 'test.one': null } },
      system: { [systemToggle]: { code: 'KeyK', modifiers: ['control', 'shift'] }, [systemCapture]: null } }
    expect(parseShortcutDocument(JSON.stringify(document))).toEqual(document)
    expect(parseShortcutDocument('{"schemaVersion":3,"profiles":{}}')).toEqual({ schemaVersion: 3, profiles: {} })
    for (const raw of [
      '{"schemaVersion":2,"profiles":{},"system":{}}',
      '{"schemaVersion":1,"profiles":{},"system":{}}',
      '{"schemaVersion":3,"profiles":{},"system":17}',
      '{"schemaVersion":3,"profiles":{},"system":{"bad":null}}',
      '{"schemaVersion":3,"profiles":{},"system":{"orb.toggle":{"code":"KeyA","modifiers":["bogus"]}}}',
      '{"schemaVersion":3,"profiles":{},"extra":1}',
      '{"schemaVersion":1,"profiles":{"web:macos":{"test.one":{"code":"KeyA","secondCode":"KeyB","modifiers":["primary"]}}}}',
    ]) expect(parseShortcutDocument(raw)).toBe('invalid')
    expect(parseShortcutDocument('{"schemaVersion":4,"profiles":{}}')).toBe('future')
  })

  it('accepts an optional edit scope and rejects other values', () => {
    expect(parseShortcutEdit({ type: 'set', id: 'test.one', binding: null, scope: 'system' }))
      .toEqual({ type: 'set', id: 'test.one', binding: null, scope: 'system' })
    expect(parseShortcutEdit({ type: 'reset', id: 'test.one', scope: 'application' }))
      .toEqual({ type: 'reset', id: 'test.one', scope: 'application' })
    expect(parseShortcutEdit({ type: 'reset-all', scope: 'system' })).toEqual({ type: 'reset-all', scope: 'system' })
    for (const value of [
      { type: 'reset-all', scope: 'carrier' },
      { type: 'set', id: 'test.one', binding: null, scope: 'system', extra: true },
      { type: 'reset', scope: 'system' },
    ]) expect(() => parseShortcutEdit(value)).toThrow()
  })

  it('accepts Desktop-only system catalogs and rejects invalid system defaults', () => {
    expect(parseShortcutDefinitions(catalog)).toEqual(catalog)
    const entry = { id: 'orb.toggle', scope: 'system', defaults: {
      'desktop:macos': { code: 'KeyK', modifiers: ['control', 'shift'] },
      'desktop:linux': { code: 'KeyK', modifiers: ['control', 'shift'] },
    } }
    expect(parseShortcutDefinitions([entry])).toEqual([entry])
    expect(parseShortcutDefinitions([{ ...entry, scope: 'application' }])).toHaveLength(1)
    for (const value of [
      [{ ...entry, scope: 'carrier' }],
      [{ ...entry, defaults: { 'web:macos': { code: 'KeyK', modifiers: ['control'] } } }],
      [{ ...entry, defaults: { 'desktop:macos': { code: 'KeyA', modifiers: [] } } }],
      [{ ...entry, defaults: { 'desktop:macos': { code: 'Tab', modifiers: ['control'] } } }],
      [{ ...entry, defaults: { 'desktop:macos': { code: 'KeyA', secondCode: 'KeyB', modifiers: ['control'] } } }],
      [entry, { id: 'orb.capture', scope: 'system', defaults: { 'desktop:macos': {
        code: 'KeyK', modifiers: ['control', 'shift'] } } }],
      [entry, { id: 'page.refresh', defaults: { 'desktop:macos': { code: 'KeyK', modifiers: ['control', 'shift'] } } }],
      [{ id: 'orb.fixed', scope: 'system', defaults: {}, fixed: [{ code: 'KeyL', modifiers: ['control'] }] }],
    ]) expect(() => parseShortcutDefinitions(value)).toThrow()
  })
})
