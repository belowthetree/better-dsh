/**
 * Browser entry of the orb form. One apply call registers the locale
 * dictionaries, observes the surface carrier and the optional voice services
 * into snapshot stores, contributes the `shell.overlay` chrome and the
 * `shell.modal` quick setup card, and registers the system-scope
 * `orb.toggle` command. The conversation, composer, approvals, and questions
 * keep coming from the classic frame; this package owns orb and panel chrome
 * only.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
import type {} from '@deepseek-ai/dsh-client-voice-capture/client'
import type { VoiceCaptureSnapshot } from '@deepseek-ai/dsh-client-voice-capture/client'
import type {} from '@deepseek-ai/dsh-client-ui-voice-output/client'
import type { VoiceOutput, VoiceOutputPolicy, VoiceOutputSnapshot } from '@deepseek-ai/dsh-client-ui-voice-output/protocol'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { OrbLayer, QUICK_SETUP_MODAL_ID } from './OrbLayer.tsx'
import type { OrbOverlayInjected, OrbSurfaceActions } from './OrbLayer.tsx'
import { OrbQuickSetupCard } from './QuickSetupCard.tsx'
import type { OrbQuickSetupInjected } from './QuickSetupCard.tsx'
import { nextPolicy } from './state.ts'
import { de, en, es, fr, ja, NS, pt, ru, zh } from './locales.ts'

/** Required services: the frame seats, the form carrier, and the command registry. */
export const inject = ['surface', 'slots', 'locale', 'shortcuts']

/** Diagnostic name of the surface observation, used when its stream fails. */
const SURFACE_OBSERVATION = 'surface'
/** Diagnostic name of the capture observation, used when its stream fails. */
const CAPTURE_OBSERVATION = 'capture'
/** Diagnostic name of the playback observation, used when its stream fails. */
const PLAYBACK_OBSERVATION = 'playback'

/** Destination of one continuous observation; the surface and voice stores satisfy it. */
interface ObservationSink<T> {
  /**
   * Adopt one observed value.
   * @param value - latest published value.
   */
  set(value: T): void
}

/**
 * Follow one signal-scoped observation into a store for as long as the returned disposer allows.
 * @param follow - the source's observation factory.
 * @param store - target snapshot store.
 * @param label - diagnostic name reported when the observation fails.
 * @returns disposer aborting the observation.
 */
function observe<T>(
  follow: (signal: AbortSignal) => AsyncIterable<T>,
  store: ObservationSink<T>,
  label: string,
): () => void {
  const lifetime = new AbortController()
  void (async (): Promise<void> => {
    try {
      for await (const value of follow(lifetime.signal)) store.set(value)
    } catch (error) {
      // Aborting ends the iteration without throwing; anything else is a defect worth reporting.
      console.error(`orb: ${label} observation failed`, error)
    }
  })()
  return () => { lifetime.abort() }
}

/**
 * Activate the orb form's client plugins.
 * @param ctx - client runtime owning the frame seats, the carrier, and the command registry.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'orb: copy')
  const t = ctx.locale.bind(NS)

  const surface = createSnapshotStore<SurfaceSnapshot>(ctx.surface.snapshot())
  ctx.effect(() => observe(signal => ctx.surface.follow(signal), surface, SURFACE_OBSERVATION), 'orb: surface')

  const reducedMotion = createSnapshotStore(false)
  ctx.effect(() => {
    // Headless client registrations run without browser media APIs.
    const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined
    if (query === undefined) return () => {}
    reducedMotion.set(query.matches)
    const changed = (): void => { reducedMotion.set(query.matches) }
    query.addEventListener('change', changed)
    return () => { query.removeEventListener('change', changed) }
  }, 'orb: reduced motion')

  const capture = createSnapshotStore<VoiceCaptureSnapshot | null>(null)
  const voice = createSnapshotStore<VoiceOutputSnapshot | null>(null)
  ctx.inject(['voiceCapture'], (scope) => {
    const service = scope.voiceCapture
    capture.set(service.snapshot())
    scope.effect(() => {
      const stop = observe(signal => service.follow(signal), capture, CAPTURE_OBSERVATION)
      return () => { stop(); capture.set(null) }
    }, 'orb: capture observation')
  })
  ctx.inject(['voiceOutput'], (scope) => {
    const service = scope.voiceOutput
    voice.set(service.snapshot())
    scope.effect(() => {
      const stop = observe(signal => service.follow(signal), voice, PLAYBACK_OBSERVATION)
      return () => { stop(); voice.set(null) }
    }, 'orb: playback observation')
  })

  /** Report one carrier command failure without interrupting the gesture that issued it. */
  const reportFailure = (error: unknown): void => {
    console.error('orb: surface command failed', error)
  }
  /**
   * Run one carrier command and contain its rejection.
   * @param command - carrier command to issue.
   */
  const issue = (command: () => Promise<void>): void => { command().catch(reportFailure) }

  /** @returns the mounted playback service, or undefined while its plugin is unmounted. */
  const playback = (): VoiceOutput | undefined => ctx.get('voiceOutput')

  /** Report one capture command failure without interrupting the gesture that issued it. */
  const reportVoiceFailure = (error: unknown): void => {
    console.error('orb: voice capture command failed', error)
  }
  /**
   * Start a capture from the collapsed orb, or finish it into the next composer.
   * A finished transcript is held by the capture service until the expanded panel's composer mounts.
   */
  const toggleVoice = (): void => {
    const service = ctx.get('voiceCapture')
    if (service === undefined) return
    const phase = service.snapshot().phase
    if (phase === 'idle') { service.begin().catch(reportVoiceFailure); return }
    if (phase !== 'capturing') return
    void service.finish({ hold: true }).then(() => { issue(() => ctx.surface.expand()) }, reportVoiceFailure)
  }

  const actions: OrbSurfaceActions = {
    expand: () => { issue(() => ctx.surface.expand()) },
    collapse: () => { issue(() => ctx.surface.collapse()) },
    setPinned: (pinned) => { issue(() => ctx.surface.setPinned(pinned)) },
    presentModal: (id) => { issue(() => ctx.surface.presentModal(id)) },
    dragBy: (deltaX, deltaY) => { issue(() => ctx.surface.dragBy(deltaX, deltaY)) },
    pointerInside: (inside) => { ctx.surface.setPointerInside(inside) },
    toggleMuted: () => {
      const service = playback()
      if (service !== undefined) service.setMuted(!service.snapshot().muted)
    },
    cyclePolicy: () => {
      const service = playback()
      if (service !== undefined) service.setPolicy(nextPolicy(service.snapshot().policy))
    },
    toggleVoice,
  }
  const overlay: OrbOverlayInjected = { hooks: { surface, capture, voice, reducedMotion }, actions }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'orb', locale: NS, inject: () => overlay,
  }, OrbLayer))

  const quickSetup: OrbQuickSetupInjected = {
    hooks: { voice },
    dismiss: () => { issue(() => ctx.surface.dismissModal()) },
    setMuted: (muted: boolean) => { playback()?.setMuted(muted) },
    setPolicy: (policy: VoiceOutputPolicy) => { playback()?.setPolicy(policy) },
    setVoice: (voiceId: string) => { playback()?.setVoice(voiceId) },
  }
  ctx.slots.inject('shell.modal', () => ctx.slots.register({
    name: 'shell.modal', id: QUICK_SETUP_MODAL_ID, locale: NS, inject: () => quickSetup,
  }, OrbQuickSetupCard))

  ctx.effect(() => ctx.shortcuts.register({
    id: 'orb.toggle' as ShortcutCommandId,
    label: () => t('command.toggle'),
    // Searchable terms, not rendered copy: the localized label above is what the settings list shows.
    aliases: ['orb', 'panel', 'toggle'],
    defaults: {},
    regions: ['page'],
    modals: [QUICK_SETUP_MODAL_ID],
    scope: 'system',
    resolve: () => ({
      status: 'handled',
      run: () => {
        const collapse = surface.getSnapshot().presentation === 'orb'
        issue(() => collapse ? ctx.surface.expand() : ctx.surface.collapse())
      },
    }),
  }), 'orb: toggle command')
  ctx.effect(() => ctx.shortcuts.register({
    id: 'voice.pushToTalk' as ShortcutCommandId,
    label: () => t('command.voice'),
    // Searchable terms, not rendered copy: the localized label above is what the settings list shows.
    aliases: ['voice', 'dictation', 'push to talk'],
    defaults: {},
    regions: ['page'],
    modals: [QUICK_SETUP_MODAL_ID],
    scope: 'system',
    resolve: () => ctx.get('voiceCapture') === undefined
      ? { status: 'pass' }
      : { status: 'handled', run: toggleVoice },
  }), 'orb: push-to-talk command')
}
