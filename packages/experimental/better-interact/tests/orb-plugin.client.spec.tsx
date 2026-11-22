// @vitest-environment jsdom
/** Plugin-level spec: seat registrations, the system command, optional services, and disposal. */
import { act, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ShortcutCommand } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SurfaceMessage, SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { VoiceCaptureSnapshot } from '@deepseek-ai/dsh-client-voice-capture/client'
import type { VoiceOutputSnapshot } from '@deepseek-ai/dsh-client-ui-voice-output/protocol'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import * as plugin from '../src/client/index.ts'
import { QuickPrompt } from '../src/client/QuickPrompt.tsx'
import { ORB_CHAT_MODAL_ID } from '../src/client/modals.ts'
import {
  ORB_WORKBENCH_MODAL_ID, ORB_WORKBENCH_MODAL_SIZE, OrbWorkbench, OrbWorkbenchConversation,
} from '../src/client/OrbWorkbench.tsx'
import { zh } from '../src/client/orb-locales.ts'

let activeRuntime: SlotTestRuntime | undefined

afterEach(async () => {
  try {
    if (activeRuntime !== undefined) await activeRuntime.dispose()
  } finally {
    activeRuntime = undefined
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  }
})
beforeEach(() => { window.localStorage.clear() })

const ORB_SURFACE: SurfaceSnapshot = Object.freeze({
  form: 'orb', role: 'orb', presentation: 'orb', pinned: false, available: true, modal: null, orbDocked: false, orbHovered: false,
  modalOpen: false,
})

/** Observable double with identity-stable snapshots and signal-scoped observation. */
function observable<T>(initial: T) {
  const listeners = new Set<() => void>()
  let current = initial
  return {
    service: {
      snapshot: (): T => current,
      follow: (signal: AbortSignal): AsyncIterable<T> => (async function* () {
        yield current
        let wake: (() => void) | undefined
        const changed = (): void => { wake?.() }
        listeners.add(changed)
        const abort = (): void => { wake?.() }
        signal.addEventListener('abort', abort)
        try {
          while (!signal.aborted) {
            await new Promise<void>((resolve) => { wake = resolve })
            if (signal.aborted) return
            yield current
          }
        } finally {
          listeners.delete(changed)
          signal.removeEventListener('abort', abort)
        }
      })(),
    },
    publish: (next: T): void => {
      current = next
      for (const listener of [...listeners]) listener()
    },
    get followers() { return listeners.size },
  }
}

/** Surface double recording every carrier command. */
function surfaceDouble(initial: SurfaceSnapshot = ORB_SURFACE) {
  const snapshots = observable(initial)
  const listeners = new Map<string, Set<(message: SurfaceMessage) => void>>()
  return {
    get followers() { return snapshots.followers },
    publish(patch: Partial<SurfaceSnapshot>): void {
      snapshots.publish({ ...snapshots.service.snapshot(), ...patch })
    },
    emit(channel: string, origin: SurfaceMessage['origin'], payload: unknown): void {
      for (const listener of [...(listeners.get(channel) ?? [])]) listener({ origin, channel, payload })
    },
    service: {
      ...snapshots.service,
      expand: vi.fn(() => Promise.resolve()),
      collapse: vi.fn(() => Promise.resolve()),
      presentModal: vi.fn(() => Promise.resolve()),
      dismissModal: vi.fn(() => Promise.resolve()),
      setPinned: vi.fn(() => Promise.resolve()),
      dragBy: vi.fn(() => Promise.resolve()),
      snap: vi.fn(() => Promise.resolve()),
      presentBubbles: vi.fn(() => Promise.resolve()),
      dismissBubbles: vi.fn(() => Promise.resolve()),
      setPointerInside: vi.fn(),
      sendMessage: vi.fn<(target: SurfaceMessage['origin'], channel: string, payload: unknown) => Promise<void>>(async () => {}),
      onMessage: (channel: string, listener: (message: SurfaceMessage) => void) => {
        const entries = listeners.get(channel) ?? new Set()
        entries.add(listener)
        listeners.set(channel, entries)
        return () => { entries.delete(listener) }
      },
    },
  }
}

/** Capture observation double with the commands the orb and chat box issue. */
function captureDouble(initial: VoiceCaptureSnapshot) {
  const snapshots = observable(initial)
  const commands = {
    ...snapshots.service,
    begin: vi.fn(async () => {}),
    finish: vi.fn(async () => ({ text: 'held transcript', audioSeconds: 1, inferenceSeconds: 0.1 })),
    takeTranscript: vi.fn((): string | null => null),
    cancel: vi.fn(async () => {}),
  }
  return { publish: snapshots.publish, service: commands, get followers() { return snapshots.followers } }
}

/** Playback double recording the commands the orb issues. */
function outputDouble(initial: VoiceOutputSnapshot) {
  const snapshots = observable(initial)
  const commands = {
    ...snapshots.service,
    setMuted: vi.fn(),
    setPolicy: vi.fn(),
    setVoice: vi.fn(),
    stop: vi.fn(),
    speak: vi.fn(() => Promise.resolve()),
  }
  return { publish: snapshots.publish, service: commands, get followers() { return snapshots.followers } }
}

const CAPTURING: VoiceCaptureSnapshot = {
  pendingTranscript: null,
  phase: 'capturing',
  device: { id: '', label: 'System default' },
  level: 0.4,
  failure: null,
  maxDurationSeconds: 120,
  selection: { providerId: 'test' as SpeechProviderId, language: 'auto' },
}

const IDLE_CAPTURE: VoiceCaptureSnapshot = { ...CAPTURING, phase: 'idle', level: 0 }

const PLAYBACK: VoiceOutputSnapshot = {
  policy: 'off',
  voiceId: 'stella',
  voices: [{ id: 'stella', name: 'Stella' }, { id: 'tide', name: 'Tide' }],
  muted: false,
  speaking: false,
  queued: 0,
  failure: null,
  limit: 4096,
}

interface BenchOptions {
  /** Surface double to provide instead of the default recording double. */
  readonly surface?: ReturnType<typeof surfaceDouble>['service']
  /** Settings presentation double provided before the plugin mounts. */
  readonly settingsUi?: { readonly open: () => void }
  /** Playback double provided before the plugin mounts. */
  readonly output?: ReturnType<typeof outputDouble>
  /** Capture double provided before the plugin mounts. */
  readonly capture?: ReturnType<typeof captureDouble>
}

async function bench(options: BenchOptions = {}) {
  const surface = options.surface ?? surfaceDouble().service
  const commands = new Map<string, ShortcutCommand>()
  const runtime = await SlotTestRuntime.create()
  activeRuntime = runtime
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('zh')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  runtime.ctx.provide('surface', surface as never)
  runtime.ctx.provide('resources', { register: () => () => {} } as never)
  const openSession = vi.fn()
  runtime.ctx.provide('uiWorkspace', {
    openSession, openWorkspace: vi.fn(async () => {}), pickDirectory: vi.fn(async () => null),
  } as never)
  if (options.settingsUi !== undefined) runtime.ctx.provide('settingsUi', options.settingsUi)
  const theme = {
    getTheme: () => ({ preference: 'system' as const }),
    setTheme: vi.fn(),
  }
  runtime.ctx.provide('theme', theme as never)
  runtime.ctx.provide('shortcuts', {
    register: (command: ShortcutCommand) => {
      commands.set(command.id, command)
      return () => { commands.delete(command.id) }
    },
    catalog: createSnapshotStore([]),
  } as never)
  const conversation = createSnapshotStore<ConversationSnapshot>({
    activeTargets: new Set(), views: { get: () => undefined, grouped: () => undefined },
  })
  const uiSession = runtime.ctx.get('uiSession')
  if (uiSession === undefined) throw new Error('orb test: uiSession is unavailable')
  uiSession.provide({ hooks: ['conversation'] as const, resolve: () => ({ hooks: { conversation } }) })
  runtime.workspaces.stub('initializeDefault', async () => ({ workspaceId: 'default-workspace' } as never))
  const owner = await runtime.mount(plugin)
  await runtime.root.declare({
    'shell.overlay': { kind: 'list', scope: 'root' },
    'shell.modal': { kind: 'list', scope: 'root' },
  }, ({ renderSlot }) => <>
    {renderSlot('shell.overlay', {}, { only: 'orb' })}
    {renderSlot('shell.modal', {}, { only: ORB_CHAT_MODAL_ID })}
    {renderSlot('shell.modal', {}, { only: ORB_WORKBENCH_MODAL_ID })}
  </>)
  runtime.renderRoot()
  return { runtime, owner, commands, surface, locale, theme, openSession }
}

/** Let pending observation generators and React updates settle inside act. */
async function flush(): Promise<void> {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

/** Provide both optional voice services from one nested fiber. */
async function provideVoice(
  runtime: SlotTestRuntime,
  capture: ReturnType<typeof captureDouble>,
  output: ReturnType<typeof outputDouble>,
) {
  const fiber = runtime.ctx.plugin({
    apply(scope: Context): void {
      scope.reflect.provide('voiceCapture', capture.service as never)
      scope.reflect.provide('voiceOutput', output.service as never)
    },
  })
  await fiber.await()
  await flush()
  return fiber
}

it('registers the overlay chrome, the chat dialog, and the system commands', async () => {
  const b = await bench()
  const overlay = b.runtime.slots.entries('shell.overlay')
  expect(overlay.map(entry => entry.options.id)).toEqual(['better-interact.bubbles', 'orb'])
  expect(overlay.find(entry => entry.options.id === 'orb')?.locale).toBe('orb')
  const modal = b.runtime.slots.entries('shell.modal')
  expect(modal.map(entry => entry.options.id)).toEqual(['better-interact.workbench', ORB_CHAT_MODAL_ID, ORB_WORKBENCH_MODAL_ID])
  const chatEntry = modal.find(entry => entry.options.id === ORB_CHAT_MODAL_ID)
  const workbenchEntry = modal.find(entry => entry.options.id === ORB_WORKBENCH_MODAL_ID)
  expect(chatEntry?.locale).toBe('orb')
  expect(chatEntry?.component).toBe(QuickPrompt)
  expect(workbenchEntry?.locale).toBe('orb')
  expect(workbenchEntry?.component).toBe(OrbWorkbench)
  expect(workbenchEntry?.children).toEqual({ 'orb.workbench.conversation': { kind: 'single', scope: 'session' } })
  const conversation = b.runtime.slots.entries('orb.workbench.conversation')
  expect(conversation.map(entry => entry.component)).toEqual([OrbWorkbenchConversation])

  const command = b.commands.get('orb.toggle')
  expect(command).toBeDefined()
  expect(command?.scope).toBe('system')
  expect(command?.defaults).toEqual({})
  expect(command?.label()).toBe(zh['command.toggle'])
  expect(command?.aliases).toEqual(['orb', 'chat', 'toggle'])

  const first = command?.resolve({ region: 'page', modal: null, target: null })
  expect(first?.status).toBe('handled')
  if (first?.status === 'handled') first.run()
  await flush()
  expect(b.surface.presentModal).toHaveBeenCalledExactlyOnceWith(ORB_CHAT_MODAL_ID)

  const open = b.commands.get('orb.open')
  expect(open?.scope).toBe('system')
  expect(open?.defaults).toEqual({
    'desktop:windows': { code: 'KeyD', modifiers: ['control', 'alt'] },
    'desktop:macos': { code: 'KeyD', modifiers: ['control', 'alt'] },
  })
  expect(open?.label()).toBe(zh['command.open'])
  expect(open?.aliases).toEqual(['orb', 'chat', 'open', 'show'])
  const opened = open?.resolve({ region: 'page', modal: null, target: null })
  expect(opened?.status).toBe('handled')
  if (opened?.status === 'handled') opened.run()
  await flush()
  expect(b.surface.presentModal).toHaveBeenCalledTimes(2)
  expect(b.surface.presentModal).toHaveBeenLastCalledWith(ORB_CHAT_MODAL_ID)

  const workbench = b.commands.get('orb.workbench')
  expect(workbench?.scope).toBe('system')
  expect(workbench?.defaults).toEqual({})
  expect(workbench?.label()).toBe(zh['orb.menu.workbench'])
  const workbenchCommand = workbench?.resolve({ region: 'page', modal: null, target: null })
  expect(workbenchCommand?.status).toBe('handled')
  if (workbenchCommand?.status === 'handled') workbenchCommand.run()
  await flush()
  expect(b.surface.presentModal).toHaveBeenLastCalledWith(ORB_WORKBENCH_MODAL_ID, ORB_WORKBENCH_MODAL_SIZE)

  const voiceCommand = b.commands.get('voice.pushToTalk')
  expect(voiceCommand?.scope).toBe('system')
  expect(voiceCommand?.defaults).toEqual({})
  expect(voiceCommand?.label()).toBe(zh['command.voice'])
  expect(voiceCommand?.resolve({ region: 'page', modal: null, target: null })).toEqual({ status: 'pass' })
})

it('opens the settings panel from the orb menu action', async () => {
  const open = vi.fn()
  const b = await bench({ settingsUi: { open } })
  const entry = b.runtime.slots.entries('shell.overlay').find(entry => entry.options.id === 'orb')
  const face = entry?.inject?.() as { actions: { openSettings(): void } }
  face.actions.openSettings()
  expect(open).toHaveBeenCalledOnce()
})

it('forwards the collapsed-orb voice gesture to the primary renderer', async () => {
  const surface = surfaceDouble()
  const capture = captureDouble(IDLE_CAPTURE)
  const b = await bench({ surface: surface.service, capture })
  const entry = b.runtime.slots.entries('shell.overlay').find(entry => entry.options.id === 'orb')
  const face = entry?.inject?.() as { actions: { toggleVoice(): void } }
  face.actions.toggleVoice()
  await flush()
  expect(surface.service.sendMessage).toHaveBeenCalledWith('surface', 'better-interact/voice-intent', { kind: 'toggle' })
  expect(capture.service.begin).not.toHaveBeenCalled()
  expect(surface.service.presentModal).not.toHaveBeenCalled()
})

it('executes voice intents on the primary renderer and publishes its snapshots', async () => {
  const surface = surfaceDouble({ ...ORB_SURFACE, role: 'surface' })
  const capture = captureDouble(IDLE_CAPTURE)
  const output = outputDouble(PLAYBACK)
  const b = await bench({ surface: surface.service })
  await provideVoice(b.runtime, capture, output)
  surface.service.sendMessage.mockClear()
  surface.emit('better-interact/voice-intent', 'orb', { kind: 'snapshot' })
  await flush()
  expect(surface.service.sendMessage).toHaveBeenCalledWith('orb', 'better-interact/capture-state', { phase: 'idle' })
  expect(surface.service.sendMessage).toHaveBeenCalledWith('orb', 'better-interact/playback-state', { speaking: false })
  surface.emit('better-interact/voice-intent', 'bubbles', { kind: 'toggle' })
  surface.emit('better-interact/voice-intent', 'orb', null)
  surface.emit('better-interact/voice-intent', 'orb', { kind: 'unknown' })
  await flush()
  expect(capture.service.begin).not.toHaveBeenCalled()
  surface.emit('better-interact/voice-intent', 'orb', { kind: 'toggle' })
  await flush()
  expect(capture.service.begin).toHaveBeenCalledOnce()

  capture.publish(CAPTURING)
  capture.publish({ ...CAPTURING, level: 0.9 })
  output.publish({ ...PLAYBACK, speaking: true })
  output.publish({ ...PLAYBACK, speaking: true })
  await flush()
  expect(surface.service.sendMessage).toHaveBeenCalledWith('orb', 'better-interact/capture-state', { phase: 'capturing' })
  expect(surface.service.sendMessage).toHaveBeenCalledWith('orb', 'better-interact/playback-state', { speaking: true })
  expect(surface.service.sendMessage.mock.calls.filter(call => call[1] === 'better-interact/capture-state'
    && (call[2] as { phase?: unknown })?.phase === 'capturing')).toHaveLength(1)
  expect(surface.service.sendMessage.mock.calls.filter(call => call[1] === 'better-interact/playback-state'
    && (call[2] as { speaking?: unknown })?.speaking === true)).toHaveLength(1)

  surface.emit('better-interact/voice-intent', 'orb', { kind: 'toggle' })
  await flush()
  expect(capture.service.finish).toHaveBeenCalledWith({ hold: true })
  expect(surface.service.presentModal).toHaveBeenCalledWith(ORB_CHAT_MODAL_ID)
})

it('starts a collapsed-orb capture and finishes it into the chat dialog', async () => {
  const surface = surfaceDouble({ ...ORB_SURFACE, role: 'surface' })
  const capture = captureDouble(IDLE_CAPTURE)
  const b = await bench({ surface: surface.service, capture })
  await provideVoice(b.runtime, capture, outputDouble(PLAYBACK))
  const entry = b.runtime.slots.entries('shell.overlay').find(entry => entry.options.id === 'orb')
  const face = entry?.inject?.() as { actions: { toggleVoice(): void } }
  face.actions.toggleVoice()
  await flush()
  expect(capture.service.begin).toHaveBeenCalledOnce()
  expect(surface.service.presentModal).not.toHaveBeenCalled()

  capture.publish({ ...CAPTURING, phase: 'starting' })
  await flush()
  face.actions.toggleVoice()
  expect(capture.service.finish).not.toHaveBeenCalled()

  capture.publish(CAPTURING)
  await flush()
  face.actions.toggleVoice()
  await flush()
  expect(capture.service.finish).toHaveBeenCalledWith({ hold: true })
  expect(surface.service.presentModal).toHaveBeenCalledExactlyOnceWith(ORB_CHAT_MODAL_ID)

  const command = b.commands.get('voice.pushToTalk')
  const resolution = command?.resolve({ region: 'page', modal: null, target: null })
  expect(resolution?.status).toBe('handled')
  if (resolution?.status === 'handled') resolution.run()
  await flush()
  expect(capture.service.begin).toHaveBeenCalledTimes(1)
})

it('reports rejected capture commands without interrupting the orb', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const surface = surfaceDouble({ ...ORB_SURFACE, role: 'surface' })
  const capture = captureDouble(IDLE_CAPTURE)
  const b = await bench({ surface: surface.service, capture })
  await provideVoice(b.runtime, capture, outputDouble(PLAYBACK))
  const entry = b.runtime.slots.entries('shell.overlay').find(entry => entry.options.id === 'orb')
  const face = entry?.inject?.() as { actions: { toggleVoice(): void } }
  capture.service.begin.mockRejectedValueOnce(new Error('microphone busy'))
  face.actions.toggleVoice()
  await flush()
  expect(errors).toHaveBeenCalledWith('orb: voice capture command failed', expect.any(Error))

  capture.publish(CAPTURING)
  await flush()
  capture.service.finish.mockRejectedValueOnce(new Error('service withdrawn'))
  face.actions.toggleVoice()
  await flush()
  expect(errors).toHaveBeenCalledTimes(2)
  expect(surface.service.presentModal).not.toHaveBeenCalled()
})

it('closes the chat dialog through the toggle command and contains carrier failures', async () => {
  const surface = surfaceDouble()
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const b = await bench({ surface: surface.service })
  surface.publish({ presentation: 'modal', modal: ORB_CHAT_MODAL_ID })
  await flush()
  const command = b.commands.get('orb.toggle')
  const resolution = command?.resolve({ region: 'page', modal: ORB_CHAT_MODAL_ID, target: null })
  expect(resolution?.status).toBe('handled')
  if (resolution?.status === 'handled') resolution.run()
  await flush()
  expect(surface.service.dismissModal).toHaveBeenCalledOnce()

  surface.publish({ presentation: 'panel', modal: null })
  await flush()
  const panel = command?.resolve({ region: 'page', modal: null, target: null })
  if (panel?.status === 'handled') panel.run()
  await flush()
  expect(surface.service.collapse).toHaveBeenCalledOnce()

  surface.service.presentModal.mockRejectedValueOnce(new Error('carrier closed'))
  surface.publish({ presentation: 'orb' })
  await flush()
  const again = command?.resolve({ region: 'page', modal: null, target: null })
  if (again?.status === 'handled') again.run()
  await flush()
  expect(errors).toHaveBeenCalledWith('orb: surface command failed', expect.any(Error))
})

it('issues every registered action through the entry faces', async () => {
  const surface = surfaceDouble()
  const capture = captureDouble(IDLE_CAPTURE)
  const benchResult = await bench({ surface: surface.service, capture })
  await provideVoice(benchResult.runtime, capture, outputDouble(PLAYBACK))
  const overlayEntry = benchResult.runtime.slots.entries('shell.overlay').find(entry => entry.options.id === 'orb')
  const face = overlayEntry?.inject?.() as { actions: {
    openChat(): void
    dragBy(deltaX: number, deltaY: number): void
    pointerInside(inside: boolean): void
    toggleVoice(): void
  } }
  face.actions.openChat()
  face.actions.dragBy(6, -4)
  face.actions.pointerInside(true)
  await flush()
  expect(surface.service.presentModal).toHaveBeenCalledWith(ORB_CHAT_MODAL_ID)
  expect(surface.service.dragBy).toHaveBeenCalledExactlyOnceWith(6, -4)
  expect(surface.service.setPointerInside).toHaveBeenCalledExactlyOnceWith(true)

  const chatEntry = benchResult.runtime.slots.entries('shell.modal').find(entry => entry.options.id === ORB_CHAT_MODAL_ID)
  const chat = chatEntry?.inject?.() as { actions: {
    takeTranscript(): string | null
    startDictation(): Promise<void>
    finishDictation(): Promise<string>
    cancelDictation(): void
  } }
  expect(chat.actions.takeTranscript()).toBeNull()
  await chat.actions.startDictation()
  expect(capture.service.begin).toHaveBeenCalledOnce()
  expect(await chat.actions.finishDictation()).toBe('held transcript')
  chat.actions.cancelDictation()
  await flush()
  expect(capture.service.cancel).toHaveBeenCalledOnce()
})

it('treats absent voice services as no-ops', async () => {
  const surface = surfaceDouble()
  const benchResult = await bench({ surface: surface.service })
  const entry = benchResult.runtime.slots.entries('shell.overlay').find(entry => entry.options.id === 'orb')
  const face = entry?.inject?.() as { actions: { toggleVoice(): void } }
  face.actions.toggleVoice()
  const chatEntry = benchResult.runtime.slots.entries('shell.modal').find(entry => entry.options.id === ORB_CHAT_MODAL_ID)
  const chat = chatEntry?.inject?.() as { actions: {
    takeTranscript(): string | null
    startDictation(): Promise<void>
    finishDictation(): Promise<string>
    cancelDictation(): void
  } }
  expect(chat.actions.takeTranscript()).toBeNull()
  await chat.actions.startDictation()
  expect(await chat.actions.finishDictation()).toBe('')
  chat.actions.cancelDictation()
  await flush()
  expect(surface.service.presentModal).not.toHaveBeenCalled()
})

it('reports a failed surface observation', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const failing = {
    ...surfaceDouble().service,
    follow: (): AsyncIterable<SurfaceSnapshot> => (async function* () {
      throw new Error('stream broke')
    })(),
  }
  await bench({ surface: failing })
  await flush()
  expect(errors).toHaveBeenCalledWith('better-interact: observing the carrier failed', expect.any(Error))
})

it('follows the carrier presentation and reduced-motion preference', async () => {
  const listeners: Array<() => void> = []
  const media = { matches: false }
  vi.stubGlobal('matchMedia', () => ({
    get matches() { return media.matches },
    addEventListener: (_type: string, listener: () => void) => { listeners.push(listener) },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.splice(listeners.indexOf(listener), 1)
    },
  }))
  const surface = surfaceDouble()
  await bench({ surface: surface.service })
  expect(document.querySelector('[data-orb]')?.getAttribute('data-reduced-motion')).toBeNull()
  media.matches = true
  act(() => { for (const listener of [...listeners]) listener() })
  expect(document.querySelector('[data-orb]')?.getAttribute('data-reduced-motion')).toBe('true')

  surface.publish({ presentation: 'panel', pinned: true })
  await flush()
  expect(document.querySelector('[data-orb]')).not.toBeNull()

  surface.publish({ presentation: 'modal', modal: ORB_CHAT_MODAL_ID })
  await flush()
  expect(document.querySelector('[data-orb]')).not.toBeNull()
  expect(document.querySelector('[data-orb-prompt-input]')?.getAttribute('aria-label')).toBe(zh['prompt.label'])
})

it('creates the management Session with the manage preset and reuses it', async () => {
  const surface = surfaceDouble()
  const b = await bench({ surface: surface.service })
  const prompt = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
  const managed = await b.runtime.sessions.add({ id: 'managed', session: { prompt } })
  const create = vi.fn(async (opts: Parameters<typeof b.runtime.sessions.create>[0]) => {
    expect(opts).toEqual({ agentPreset: 'manage', workspaceId: 'default-workspace' })
    return managed
  })
  b.runtime.sessions.stubCreate(create)
  surface.publish({ presentation: 'modal', modal: ORB_CHAT_MODAL_ID })
  await flush()
  const input = document.querySelector('[data-orb-prompt-input]') as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: '  summarize the day  ' } })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
  await flush()
  expect(create).toHaveBeenCalledOnce()
  expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: 'summarize the day' }], 'queue')
  expect(surface.service.presentModal).toHaveBeenLastCalledWith(ORB_WORKBENCH_MODAL_ID, ORB_WORKBENCH_MODAL_SIZE)

  // A later prompt reuses the remembered Session instead of creating another conversation.
  surface.publish({ presentation: 'modal', modal: ORB_CHAT_MODAL_ID })
  await flush()
  const second = document.querySelector('[data-orb-prompt-input]') as HTMLTextAreaElement
  fireEvent.change(second, { target: { value: 'what changed?' } })
  await act(async () => { fireEvent.keyDown(second, { key: 'Enter' }) })
  await flush()
  expect(create).toHaveBeenCalledOnce()
  expect(prompt).toHaveBeenNthCalledWith(2, [{ type: 'text', text: 'what changed?' }], 'queue')
})

it('creates the management Session in the Host default Workspace', async () => {
  const surface = surfaceDouble()
  const b = await bench({ surface: surface.service })
  b.runtime.workspaces.stub('initializeDefault', async () => ({ workspaceId: 'default-workspace' } as never))
  const managed = await b.runtime.sessions.add({
    id: 'managed-default',
    session: { prompt: vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } })) },
  })
  const create = vi.fn(async (opts: Parameters<typeof b.runtime.sessions.create>[0]) => {
    expect(opts).toEqual({ agentPreset: 'manage', workspaceId: 'default-workspace' })
    return managed
  })
  b.runtime.sessions.stubCreate(create)
  surface.publish({ presentation: 'modal', modal: ORB_CHAT_MODAL_ID })
  await flush()
  const input = document.querySelector('[data-orb-prompt-input]') as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: 'status' } })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
  await flush()
  expect(b.runtime.workspaces.calls.filter(call => call.method === 'initializeDefault')).toHaveLength(1)
  expect(create).toHaveBeenCalledOnce()
})

it('retains the management conversation while the workbench is presented', async () => {
  const surface = surfaceDouble()
  const b = await bench({ surface: surface.service })
  const managed = await b.runtime.sessions.add({ id: 'managed', session: { prompt: vi.fn() } })
  b.runtime.sessions.stubCreate(async () => managed)
  surface.publish({ presentation: 'modal', modal: ORB_WORKBENCH_MODAL_ID })
  await flush()
  await flush()
  expect(b.runtime.sessions.retainInfo('managed' as never).getSnapshot().retainedBy).toMatchObject({ orbChat: 1 })
  surface.publish({ presentation: 'orb', modal: null })
  await flush()
  expect(b.runtime.sessions.retainInfo('managed' as never).getSnapshot().retainedBy).not.toHaveProperty('orbChat')
})

it('invalidates a management workbench preparation that closes before creation settles', async () => {
  const surface = surfaceDouble()
  const b = await bench({ surface: surface.service })
  const managed = await b.runtime.sessions.add({ id: 'managed', session: { prompt: vi.fn() } })
  const created = Promise.withResolvers<typeof managed>()
  b.runtime.sessions.stubCreate(() => created.promise)
  surface.publish({ presentation: 'modal', modal: ORB_WORKBENCH_MODAL_ID })
  await flush()
  surface.publish({ presentation: 'orb', modal: null })
  await flush()
  created.resolve(managed)
  await flush()
  expect(b.openSession).not.toHaveBeenCalled()
  expect(b.runtime.sessions.retainInfo(managed).getSnapshot().retainedBy).not.toHaveProperty('orbChat')
})

it('restarts management workbench preparation after a close and reopen', async () => {
  const surface = surfaceDouble()
  const b = await bench({ surface: surface.service })
  const managed = await b.runtime.sessions.add({ id: 'managed', session: { prompt: vi.fn() } })
  const created = Promise.withResolvers<typeof managed>()
  b.runtime.sessions.stubCreate(() => created.promise)
  surface.publish({ presentation: 'modal', modal: ORB_WORKBENCH_MODAL_ID })
  await flush()
  surface.publish({ presentation: 'orb', modal: null })
  await flush()
  surface.publish({ presentation: 'modal', modal: ORB_WORKBENCH_MODAL_ID })
  await flush()
  created.resolve(managed)
  await flush()
  expect(b.openSession).toHaveBeenCalledWith(managed)
  expect(b.runtime.sessions.retainInfo(managed).getSnapshot().retainedBy).toMatchObject({ orbChat: 1 })
})

it('does not restart management workbench preparation after plugin disposal', async () => {
  const surface = surfaceDouble()
  const b = await bench({ surface: surface.service })
  const managed = await b.runtime.sessions.add({ id: 'managed', session: { prompt: vi.fn() } })
  const created = Promise.withResolvers<typeof managed>()
  b.runtime.sessions.stubCreate(() => created.promise)
  surface.publish({ presentation: 'modal', modal: ORB_WORKBENCH_MODAL_ID })
  await flush()
  await b.owner.dispose()
  created.resolve(managed)
  await flush()
  expect(b.openSession).not.toHaveBeenCalled()
  expect(b.runtime.sessions.retainInfo(managed).getSnapshot().retainedBy).not.toHaveProperty('orbChat')
})

it('reports a rejected prompt inside the chat box', async () => {
  const surface = surfaceDouble()
  const b = await bench({ surface: surface.service })
  const prompt = vi.fn(async () => ({ ok: false as const, error: new RemoteError('gateway/internal', 'offline', {}) }))
  const managed = await b.runtime.sessions.add({ id: 'managed', session: { prompt } })
  b.runtime.sessions.stubCreate(async () => managed)
  surface.publish({ presentation: 'modal', modal: ORB_CHAT_MODAL_ID })
  await flush()
  const input = document.querySelector('[data-orb-prompt-input]') as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: 'retry' } })
  await act(async () => { fireEvent.click(document.querySelector('[data-orb-prompt-send]') as HTMLElement) })
  await flush()
  expect(document.querySelector('[role=alert]')?.textContent).toBe(zh['prompt.failed'])
  expect(surface.service.dismissModal).not.toHaveBeenCalled()
})

it('reflects the optional voice services', async () => {
  const surface = surfaceDouble()
  await bench({ surface: surface.service })
  expect(document.querySelector('[data-orb]')?.getAttribute('data-state')).toBe('idle')
  expect(surface.service.sendMessage).toHaveBeenCalledWith('surface', 'better-interact/voice-intent', { kind: 'snapshot' })

  surface.emit('better-interact/capture-state', 'surface', { phase: 'capturing' })
  await flush()
  expect(document.querySelector('[data-orb]')?.getAttribute('data-state')).toBe('capturing')

  surface.emit('better-interact/capture-state', 'surface', { phase: 'transcribing' })
  surface.emit('better-interact/playback-state', 'surface', { speaking: true })
  await flush()
  expect(document.querySelector('[data-orb]')?.getAttribute('data-state')).toBe('transcribing')

  surface.emit('better-interact/capture-state', 'surface', { phase: 'idle' })
  surface.emit('better-interact/playback-state', 'surface', { speaking: false })
  await flush()
  expect(document.querySelector('[data-orb]')?.getAttribute('data-state')).toBe('idle')

  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  surface.emit('better-interact/capture-state', 'surface', { phase: 'unknown' })
  surface.emit('better-interact/playback-state', 'surface', { speaking: 'yes' })
  await flush()
  expect(document.querySelector('[data-orb]')?.getAttribute('data-state')).toBe('idle')
  expect(errors).toHaveBeenCalledTimes(2)
})

it('clears primary voice projections when the surface detaches them', async () => {
  const surface = surfaceDouble()
  await bench({ surface: surface.service })
  surface.emit('better-interact/capture-state', 'surface', { phase: 'capturing' })
  surface.emit('better-interact/playback-state', 'surface', { speaking: true })
  await flush()
  surface.emit('better-interact/capture-state', 'surface', null)
  surface.emit('better-interact/playback-state', 'surface', null)
  await flush()
  expect(document.querySelector('[data-orb]')?.getAttribute('data-state')).toBe('idle')
})

it('removes every registration and observation when the plugin unloads', async () => {
  const surface = surfaceDouble()
  const b = await bench({ surface: surface.service })
  expect(b.runtime.slots.entries('shell.overlay')).toHaveLength(2)
  expect(b.commands.has('orb.toggle')).toBe(true)
  expect(surface.followers).toBe(1)
  await b.owner.dispose()
  expect(surface.followers).toBe(0)
  expect(b.runtime.slots.entries('shell.overlay')).toEqual([])
  expect(b.runtime.slots.entries('shell.modal')).toEqual([])
  expect(b.commands.size).toBe(0)
})
