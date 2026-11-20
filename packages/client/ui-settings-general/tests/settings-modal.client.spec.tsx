// @vitest-environment jsdom
/** Driven settings modal: card fill, section navigation, and the dismissal action. */
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SettingsModalSurface } from '../src/client/SettingsModalSurface.tsx'
import type { SettingsModalSurfaceProps } from '../src/client/SettingsModalSurface.tsx'
import type { SettingsSectionRow } from '../src/client/shell-contract.ts'
import { en } from '../src/client/locales.ts'

const scrollIntoView = vi.fn()
let scrollIntoViewDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
  scrollIntoView.mockClear()
})
afterEach(() => {
  cleanup()
  if (scrollIntoViewDescriptor === undefined) Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  else Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoViewDescriptor)
})

const ROWS: readonly SettingsSectionRow[] = [
  { id: 'general', order: 0, label: 'General' },
  { id: 'models', order: 10, label: 'Models' },
]

/**
 * Mount the modal entry with driven hooks.
 * @param options - navigation rows the binding reports.
 * @returns the dismissal action, the factory renderer, and the render result.
 */
function mount({ rows = ROWS }: { rows?: readonly SettingsSectionRow[] } = {}) {
  const close = vi.fn()
  const renderFactorySlot = vi.fn((name: string, factoryProps: { id: string }) =>
    name === 'settings.section.view' ? <div data-testid={`section-${factoryProps.id}`} /> : null)
  // The entry consumes only its injected hooks; the shell owns the global seats.
  const globals = {} as GlobalStandardProps
  const props = {
    ...globals,
    useSections: (select: (value: readonly SettingsSectionRow[]) => unknown) => select(rows),
    close,
    renderFactorySlot,
    t: makeTranslate(en),
  } as SettingsModalSurfaceProps
  const view = render(<SettingsModalSurface {...props} />)
  return { close, renderFactorySlot, view }
}

it('fills the modal card with the shared panel and shows the first section', () => {
  mount()
  const root = document.querySelector('[data-settings-dialog]') as HTMLElement
  expect(root).not.toBeNull()
  expect(root.hasAttribute('data-shell-modal-fill')).toBe(true)
  expect(root.getAttribute('data-shell-modal-surface')).toBe('bare')
  expect(screen.getByRole('region', { name: en.title })).not.toBeNull()
  expect(screen.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe('true')
  expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBeNull()
  expect(screen.getByTestId('section-general')).not.toBeNull()
})

it('switches the rendered section and dismisses through the supplied action', () => {
  const b = mount()
  fireEvent.click(screen.getByRole('button', { name: 'Models' }))
  expect(screen.getByTestId('section-models')).not.toBeNull()
  expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: en.close }))
  expect(b.close).toHaveBeenCalledOnce()
})

it('falls back to the first section when the ledger loses the selected one', () => {
  const b = mount()
  fireEvent.click(screen.getByRole('button', { name: 'Models' }))
  expect(screen.getByTestId('section-models')).not.toBeNull()
  const globals = {} as GlobalStandardProps
  b.view.rerender(<SettingsModalSurface {...({
    ...globals,
    useSections: (select: (value: readonly SettingsSectionRow[]) => unknown) => select([ROWS[0]!]),
    close: b.close,
    renderFactorySlot: b.renderFactorySlot,
    t: makeTranslate(en),
  } as SettingsModalSurfaceProps)} />)
  expect(screen.getByTestId('section-general')).not.toBeNull()
  expect(screen.queryByTestId('section-models')).toBeNull()
})

it('renders an empty panel when no settings section is registered', () => {
  mount({ rows: [] })
  expect(document.querySelector('[data-settings-dialog]')).not.toBeNull()
  expect(screen.queryByRole('button', { name: 'General' })).toBeNull()
  expect(screen.queryByTestId(/^section-/u)).toBeNull()
})
