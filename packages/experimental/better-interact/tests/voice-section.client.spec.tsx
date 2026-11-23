// @vitest-environment jsdom
/** The narration settings section: toggle, voice choice, and preview. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VoiceOutputSnapshot } from '@deepseek-ai/dsh-client-ui-voice-output/protocol'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { VoiceSection } from '../src/client/VoiceSection.tsx'
import type { VoiceSectionInjected, VoiceSectionProps } from '../src/client/VoiceSection.tsx'

afterEach(() => { cleanup(); localStorage.clear() })

/** One playback observation with the DeepSeek voices. */
function playback(patch: Partial<VoiceOutputSnapshot> = {}): VoiceOutputSnapshot {
  return {
    policy: 'off',
    voiceId: 'stella',
    voices: [{ id: 'stella', name: 'Stella' }, { id: 'tide', name: 'Tide' }],
    muted: false,
    speaking: false,
    queued: 0,
    failure: null,
    limit: 4000,
    ...patch,
  }
}

function section(voice: VoiceOutputSnapshot | null, options: { readonly enabled?: boolean } = {}) {
  const narration = createSnapshotStore({ enabled: options.enabled ?? true })
  const voiceStore = createSnapshotStore<VoiceOutputSnapshot | null>(voice)
  const speak = vi.fn()
  const setNarration = vi.fn((enabled: boolean) => { narration.set({ enabled }) })
  const selectVoice = vi.fn()
  const preview = vi.fn()
  const face: VoiceSectionInjected = {
    hooks: { narration, voice: voiceStore },
    setNarration,
    selectVoice,
    preview,
  }
  const props = {
    close: () => {},
    t: (key: string) => key,
    useNarration: (select: (value: { readonly enabled: boolean }) => unknown) => select(narration.getSnapshot()),
    useVoice: (select: (value: VoiceOutputSnapshot | null) => unknown) => select(voiceStore.getSnapshot()),
    ...face,
  } as unknown as VoiceSectionProps
  return { props, setNarration, selectVoice, preview, speak, narration }
}

describe('VoiceSection', () => {
  it('shows the toggle, the voices, and the preview for an available service', () => {
    const { props } = section(playback())
    render(createElement(VoiceSection, props))
    expect(screen.getByRole('heading', { name: 'voice.title' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'voice.toggle' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('tablist', { name: 'voice.voice' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Stella' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: 'voice.preview' }).hasAttribute('disabled')).toBe(false)
  })

  it('persists the toggle, selects a voice, and previews in the chosen voice', () => {
    const { props, setNarration, selectVoice, preview } = section(playback())
    render(createElement(VoiceSection, props))
    fireEvent.click(screen.getByRole('switch', { name: 'voice.toggle' }))
    expect(setNarration).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('tab', { name: 'Tide' }))
    expect(selectVoice).toHaveBeenCalledWith('tide')
    fireEvent.click(screen.getByRole('button', { name: 'voice.preview' }))
    expect(preview).toHaveBeenCalledOnce()
  })

  it('says why narration cannot play when no synthesis service is mounted', () => {
    const { props } = section(null)
    render(createElement(VoiceSection, props))
    expect(screen.getByRole('status').textContent).toBe('voice.unavailable')
    expect(screen.getByRole('button', { name: 'voice.preview' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('reports an active preview and an off toggle', () => {
    const { props } = section(playback({ speaking: true }), { enabled: false })
    render(createElement(VoiceSection, props))
    expect(screen.getByRole('switch', { name: 'voice.toggle' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('status').textContent).toBe('voice.speaking')
  })

  it('offers no voice control when the catalog is empty', () => {
    const { props } = section(playback({ voices: [], voiceId: null }))
    render(createElement(VoiceSection, props))
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('voice.unavailable')
  })

  it('reports a recorded playback failure and keeps the preview as the retry path', () => {
    const { props } = section(playback({ failure: 'remote' }))
    render(createElement(VoiceSection, props))
    expect(screen.getByRole('status').textContent).toBe('voice.failure')
    expect(screen.getByRole('button', { name: 'voice.preview' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('tablist', { name: 'voice.voice' })).toBeTruthy()
  })

  it('points at the voice choice when the saved voice left the catalog', () => {
    const { props, selectVoice } = section(playback({ failure: 'voice' }))
    render(createElement(VoiceSection, props))
    expect(screen.getByRole('status').textContent).toBe('voice.failureVoice')
    fireEvent.click(screen.getByRole('tab', { name: 'Tide' }))
    expect(selectVoice).toHaveBeenCalledWith('tide')
  })

  it('falls back to the first catalog voice before a selection exists', () => {
    const { props } = section(playback({ voiceId: null }))
    render(createElement(VoiceSection, props))
    expect(screen.getByRole('tab', { name: 'Stella' }).getAttribute('aria-selected')).toBe('true')
  })
})
