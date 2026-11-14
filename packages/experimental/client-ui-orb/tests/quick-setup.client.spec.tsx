// @vitest-environment jsdom
/** Driven quick setup card: voice selection, mute, policy, billing note, and dismissal. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { VoiceOutputSnapshot } from '@deepseek-ai/dsh-client-ui-voice-output/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { OrbQuickSetupCard } from '../src/client/QuickSetupCard.tsx'
import type { OrbQuickSetupProps } from '../src/client/QuickSetupCard.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const PLAYBACK: VoiceOutputSnapshot = {
  policy: 'voice',
  voiceId: 'stella',
  voices: [{ id: 'stella', name: 'Stella' }, { id: 'tide', name: 'Tide' }],
  muted: false,
  speaking: false,
  queued: 0,
  failure: null,
  limit: 4096,
}

function fixture() {
  const voice = createSnapshotStore<VoiceOutputSnapshot | null>(PLAYBACK)
  const dismiss = vi.fn(), setMuted = vi.fn(), setPolicy = vi.fn(), setVoice = vi.fn()
  const props = {
    useVoice: bindSnapshotSelector(voice),
    dismiss, setMuted, setPolicy, setVoice,
    t: makeTranslate(zh),
  } as OrbQuickSetupProps
  render(<OrbQuickSetupCard {...props} />)
  return { voice, dismiss, setMuted, setPolicy, setVoice }
}

it('selects a voice, mute state, and auto-speak policy, and discloses billed synthesis', () => {
  const b = fixture()
  expect(screen.getByRole('heading', { name: zh['setup.title'] })).toBeTruthy()
  expect(screen.getByText(zh['setup.description'])).toBeTruthy()
  expect(screen.getByText(zh['setup.billed'])).toBeTruthy()
  const stella = screen.getByRole('button', { name: 'Stella' })
  expect(stella.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: 'Tide' }).getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: 'Tide' }))
  expect(b.setVoice).toHaveBeenCalledExactlyOnceWith('tide')

  const policyVoice = screen.getByRole('button', { name: zh['policy.voice'] })
  expect(policyVoice.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: zh['policy.all'] }))
  expect(b.setPolicy).toHaveBeenCalledExactlyOnceWith('all')

  const mute = screen.getByRole('button', { name: zh['setup.mute'] })
  expect(mute.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(mute)
  expect(b.setMuted).toHaveBeenCalledExactlyOnceWith(true)

  fireEvent.click(document.querySelector('[data-orb-setup-close]') as HTMLElement)
  expect(b.dismiss).toHaveBeenCalledOnce()
})

it('reflects a muted snapshot and closes without changing a selection', () => {
  const b = fixture()
  act(() => { b.voice.set({ ...PLAYBACK, muted: true, policy: 'all', voiceId: null }) })
  expect(screen.getByRole('button', { name: zh['setup.mute'] }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: zh['policy.all'] }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: 'Stella' }).getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(document.querySelector('[data-orb-setup-close]') as HTMLElement)
  expect(b.dismiss).toHaveBeenCalledOnce()
  expect(b.setVoice).not.toHaveBeenCalled()
  expect(b.setPolicy).not.toHaveBeenCalled()
  expect(b.setMuted).not.toHaveBeenCalled()
})

it('explains an unmounted voice plugin instead of offering settings', () => {
  const voice = createSnapshotStore<VoiceOutputSnapshot | null>(null)
  const dismiss = vi.fn()
  const props = {
    useVoice: bindSnapshotSelector(voice),
    dismiss, setMuted: vi.fn(), setPolicy: vi.fn(), setVoice: vi.fn(),
    t: makeTranslate(zh),
  } as OrbQuickSetupProps
  render(<OrbQuickSetupCard {...props} />)
  const empty = document.querySelector('[data-orb-setup-empty]') as HTMLElement
  expect(empty.textContent).toContain(zh['setup.noVoiceTitle'])
  expect(empty.textContent).toContain(zh['setup.noVoiceBody'])
  expect(document.querySelector('[data-orb-setup-voice]')).toBeNull()
  expect(document.querySelector('[data-orb-setup-policy]')).toBeNull()
  fireEvent.click(document.querySelector('[data-orb-setup-close]') as HTMLElement)
  expect(dismiss).toHaveBeenCalledOnce()
})
