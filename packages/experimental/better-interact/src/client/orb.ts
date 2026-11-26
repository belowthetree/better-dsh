/** Orb chrome, quick prompt, dedicated management workbench, and their commands. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ThemePreference } from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-voice-capture/client'
import type { VoiceCaptureCatalog, VoiceCaptureSnapshot } from '@deepseek-ai/dsh-client-voice-capture/client'
import type {} from '@deepseek-ai/dsh-client-ui-voice-output/client'
import type { VoiceOutputSnapshot } from '@deepseek-ai/dsh-client-ui-voice-output/protocol'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ManagementSessionController } from './management-session.ts'
import { ORB_CHAT_MODAL_ID } from './modals.ts'
import { createOrbActions } from './orb-actions.ts'
import { OrbDialogActionIcon, OrbLayer } from './OrbLayer.tsx'
import type { OrbOverlayInjected, OrbSurfaceActions } from './OrbLayer.tsx'
import { ORB_WORKBENCH_MODAL_ID, ORB_WORKBENCH_MODAL_SIZE, OrbWorkbench, OrbWorkbenchConversation } from './OrbWorkbench.tsx'
import type { OrbWorkbenchInjected } from './OrbWorkbench.tsx'
import { QuickPrompt } from './QuickPrompt.tsx'
import type { OrbChatActions, OrbChatInjected, VoiceReadiness } from './QuickPrompt.tsx'
import { de, en, es, fr, ja, NS, pt, ru, zh } from './orb-locales.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A quick prompt waiting for the target Session's history and its prompt receipt. */
    orbPrompt: unknown
    /** The management workbench holding its conversation open while the card shows. */
    orbChat: unknown
  }
}

/** Diagnostic name of the capture observation, used when its stream fails. */
const CAPTURE_OBSERVATION = 'capture'
/** Diagnostic name of the recognition-catalog observation, used when its stream fails. */
const CATALOG_OBSERVATION = 'speech readiness'
/** Diagnostic name of the playback observation, used when its stream fails. */
const PLAYBACK_OBSERVATION = 'playback'
const CAPTURE_STATE_CHANNEL = 'better-interact/capture-state'
const PLAYBACK_STATE_CHANNEL = 'better-interact/playback-state'
const VOICE_INTENT_CHANNEL = 'better-interact/voice-intent'

/** Parse the orb-only capture projection at the renderer-message boundary. */
function parseCapturePhase(payload: unknown): Pick<VoiceCaptureSnapshot, 'phase'> | null | undefined {
  if (payload === null) return null
  if (typeof payload !== 'object') return undefined
  const { phase } = payload as { readonly phase?: unknown }
  return phase === 'idle' || phase === 'starting' || phase === 'capturing' || phase === 'transcribing'
    ? { phase } : undefined
}

/** Parse the orb-only playback projection at the renderer-message boundary. */
function parsePlaybackState(payload: unknown): Pick<VoiceOutputSnapshot, 'speaking'> | null | undefined {
  if (payload === null) return null
  if (typeof payload !== 'object') return undefined
  const { speaking } = payload as { readonly speaking?: unknown }
  return typeof speaking === 'boolean' ? { speaking } : undefined
}

/**
 * Whether the selected recognizer can transcribe now: it must exist, and a
 * local provider must have its model loaded or loadable without a download.
 * @param catalog - complete recognition catalog from the Host.
 * @returns the readiness the microphone button reports.
 */
function readinessOf(catalog: VoiceCaptureCatalog): VoiceReadiness {
  const provider = catalog.providers.find(item => item.id === catalog.selection.providerId)
  if (provider === undefined) return 'missing'
  const phase = provider.preparation.phase
  return phase === 'ready' || phase === 'standby' || phase === 'waking' ? 'ready' : 'preparing'
}

/** Destination of one continuous voice observation. */
interface ObservationSink<T> {
  set(value: T): void
}

/** Follow one signal-scoped voice observation until the returned disposer aborts it. */
function observe<T>(
  follow: (signal: AbortSignal) => AsyncIterable<T>,
  store: ObservationSink<T>,
  label: string,
): () => Promise<void> {
  const lifetime = new AbortController()
  const running = (async (): Promise<void> => {
    try {
      for await (const value of follow(lifetime.signal)) store.set(value)
    } catch (error) {
      console.error(`orb: ${label} observation failed`, error)
    }
  })()
  return async () => {
    lifetime.abort()
    await running
  }
}

/** Shared services and observations supplied by the Better plugin root. */
export interface OrbPluginOptions {
  /** Management Session resolver shared with the general workbench. */
  readonly management: ManagementSessionController
  /** Root-owned carrier observation shared with Bubbles and the general workbench. */
  readonly surface: HostObservable<SurfaceSnapshot>
}

/**
 * Activate the Orb entries over the shared Better management Session and surface observation.
 * @param ctx - Client context carrying the frame, commands, Session, theme, and optional voice services.
 * @param options - shared management Session resolver and carrier observation.
 * @returns nothing; registrations remain owned by the Better plugin fiber.
 */
export function applyOrb(ctx: ClientContext, options: OrbPluginOptions): void {
  const t = ctx.locale.bind(NS)
  const { management, surface } = options
  const role = surface.getSnapshot().role
  const primary = role === 'surface'
  const orbActions = createOrbActions()
  ctx.provide('orbActions', orbActions)

  const reducedMotion = createSnapshotStore(false)
  ctx.effect(() => {
    const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined
    if (query === undefined) return () => {}
    reducedMotion.set(query.matches)
    const changed = (): void => { reducedMotion.set(query.matches) }
    query.addEventListener('change', changed)
    return () => { query.removeEventListener('change', changed) }
  }, 'orb: reduced motion')

  const capture = createSnapshotStore<VoiceCaptureSnapshot | null>(null)
  const capturePhase = createSnapshotStore<Pick<VoiceCaptureSnapshot, 'phase'> | null>(null)
  const voice = createSnapshotStore<Pick<VoiceOutputSnapshot, 'speaking'> | null>(null)
  const readiness = createSnapshotStore<VoiceReadiness>('connecting')
  const publishCapture = (value: VoiceCaptureSnapshot | null, force = false): void => {
    capture.set(value)
    const next = value === null ? null : { phase: value.phase }
    if (!force && capturePhase.getSnapshot()?.phase === next?.phase) return
    capturePhase.set(next)
    if (primary) {
      void ctx.surface.sendMessage('orb', CAPTURE_STATE_CHANNEL, next).catch(reportFailure)
    }
  }
  const publishPlayback = (value: Pick<VoiceOutputSnapshot, 'speaking'> | null, force = false): void => {
    if (!force && voice.getSnapshot()?.speaking === value?.speaking) return
    voice.set(value)
    if (primary) {
      void ctx.surface.sendMessage('orb', PLAYBACK_STATE_CHANNEL,
        value === null ? null : { speaking: value.speaking }).catch(reportFailure)
    }
  }
  if (primary) {
    ctx.inject(['voiceCapture'], (scope) => {
      const service = scope.voiceCapture
      publishCapture(service.snapshot())
      scope.effect(() => {
        const stop = observe(signal => service.follow(signal), {
          set: (value) => { publishCapture(value) },
        }, CAPTURE_OBSERVATION)
        return async () => { await stop(); publishCapture(null) }
      }, 'orb: capture observation')
      scope.effect(() => {
        const stop = observe(signal => service.followCatalog(signal), {
          set: (catalog) => { readiness.set(readinessOf(catalog)) },
        }, CATALOG_OBSERVATION)
        return async () => { await stop(); readiness.set('connecting') }
      }, 'orb: speech readiness observation')
    })
    ctx.inject(['voiceOutput'], (scope) => {
      const service = scope.voiceOutput
      publishPlayback({ speaking: service.snapshot().speaking })
      scope.effect(() => {
        const stop = observe(signal => service.follow(signal), {
          set: (value) => { publishPlayback({ speaking: value.speaking }) },
        }, PLAYBACK_OBSERVATION)
        return async () => { await stop(); publishPlayback(null) }
      }, 'orb: playback observation')
    })
  }

  const theme = createSnapshotStore<ThemePreference>(ctx.theme.getTheme().preference)
  ctx.effect(() => ctx.on('theme/change', () => {
    theme.set(ctx.theme.getTheme().preference)
  }), 'orb: theme preference')

  const reportFailure = (error: unknown): void => {
    console.error('orb: surface command failed', error)
  }
  const issue = (command: () => Promise<void>): void => { command().catch(reportFailure) }
  const reportVoiceFailure = (error: unknown): void => {
    console.error('orb: voice capture command failed', error)
  }

  const submitPrompt = async (text: string): Promise<void> => {
    const target = await management.resolve()
    await ctx.sessions.using(target, { source: 'orbPrompt' }, async (reference) => {
      const binding = await reference.ready
      const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
      if (!result.ok) throw result.error
    })
    openWorkbench()
  }

  const takeTranscript = (): string | null => ctx.get('voiceCapture')?.takeTranscript() ?? null
  let workbenchReference: SessionReference | null = null
  const workbenchStore = createSnapshotStore<SessionReference | null>(null)
  let preparingWorkbench: Promise<void> | undefined
  let workbenchGeneration = 0
  let workbenchDisposed = false

  const closeWorkbench = (): void => {
    workbenchGeneration += 1
    if (workbenchReference !== null) {
      workbenchReference.release()
      workbenchReference = null
    }
    workbenchStore.set(null)
  }

  const prepareWorkbench = (): void => {
    if (workbenchDisposed || workbenchReference !== null || preparingWorkbench !== undefined) return
    const generation = workbenchGeneration
    const preparing = (async () => {
      const target = await management.resolve()
      if (generation !== workbenchGeneration || surface.getSnapshot().modal !== ORB_WORKBENCH_MODAL_ID) return
      ctx.uiWorkspace.openSession(target)
      const reference = ctx.sessions.retain(target, { source: 'orbChat', facets: { conversation: true } })
      if (generation !== workbenchGeneration || surface.getSnapshot().modal !== ORB_WORKBENCH_MODAL_ID) {
        reference.release()
        return
      }
      workbenchReference = reference
      workbenchStore.set(reference)
    })().catch((error: unknown) => {
      if (generation === workbenchGeneration) console.error('orb: management workbench unavailable', error)
    }).finally(() => {
      if (preparingWorkbench === preparing) preparingWorkbench = undefined
      if (generation !== workbenchGeneration && !workbenchDisposed && workbenchReference === null
        && surface.getSnapshot().modal === ORB_WORKBENCH_MODAL_ID) prepareWorkbench()
    })
    preparingWorkbench = preparing
  }

  const openWorkbench = (): void => {
    issue(() => ctx.surface.presentModal(ORB_WORKBENCH_MODAL_ID, ORB_WORKBENCH_MODAL_SIZE))
  }

  ctx.effect(() => {
    workbenchDisposed = false
    const sync = (): void => {
      if (surface.getSnapshot().modal === ORB_WORKBENCH_MODAL_ID) prepareWorkbench()
      else closeWorkbench()
    }
    const stop = surface.subscribe(sync)
    sync()
    return () => {
      workbenchDisposed = true
      stop()
      closeWorkbench()
    }
  }, 'orb: management workbench binding')

  const openChat = (): void => { issue(() => ctx.surface.presentModal(ORB_CHAT_MODAL_ID)) }
  const openSettings = (): void => { ctx.get('settingsUi')?.open() }
  const dismissModal = (): void => { issue(() => ctx.surface.dismissModal()) }
  const setOptions = (open: boolean): void => { issue(() => ctx.surface.setOrbMenu(open)) }
  const activateAction = (id: string): void => {
    setOptions(false)
    try {
      orbActions.run(id)
    } catch (error) {
      console.error(`orb: action ${id} failed`, error)
    }
  }

  const toggleVoice = (): void => {
    if (role === 'orb') {
      issue(() => ctx.surface.sendMessage('surface', VOICE_INTENT_CHANNEL, { kind: 'toggle' }))
      return
    }
    const service = ctx.get('voiceCapture')
    if (service === undefined) return
    const phase = service.snapshot().phase
    if (phase === 'idle') { service.begin().catch(reportVoiceFailure); return }
    if (phase !== 'capturing') return
    void service.finish({ hold: true }).then(() => { openChat() }, reportVoiceFailure)
  }

  ctx.effect(() => ctx.surface.onMessage(VOICE_INTENT_CHANNEL, (message) => {
    if (!primary || message.origin !== 'orb') return
    if (typeof message.payload !== 'object' || message.payload === null) return
    const { kind } = message.payload as { readonly kind?: unknown }
    if (kind === 'toggle') toggleVoice()
    else if (kind === 'snapshot') {
      publishCapture(capture.getSnapshot(), true)
      publishPlayback(voice.getSnapshot(), true)
    }
  }), 'orb: voice intents')

  if (role === 'orb') {
    ctx.effect(() => ctx.surface.onMessage(CAPTURE_STATE_CHANNEL, (message) => {
      if (message.origin !== 'surface') return
      const state = parseCapturePhase(message.payload)
      if (state === undefined) console.error('orb: rejected an invalid capture state')
      else capturePhase.set(state)
    }), 'orb: capture state')
    ctx.effect(() => ctx.surface.onMessage(PLAYBACK_STATE_CHANNEL, (message) => {
      if (message.origin !== 'surface') return
      const state = parsePlaybackState(message.payload)
      if (state === undefined) console.error('orb: rejected an invalid playback state')
      else voice.set(state)
    }), 'orb: playback state')
    void ctx.surface.sendMessage('surface', VOICE_INTENT_CHANNEL, { kind: 'snapshot' }).catch(reportFailure)
  }

  const actions: OrbSurfaceActions = {
    openChat,
    openWorkbench,
    openSettings,
    setOptions,
    activateAction,
    dragBy: (deltaX, deltaY) => { issue(() => ctx.surface.dragBy(deltaX, deltaY)) },
    pointerInside: (inside) => { ctx.surface.setPointerInside(inside) },
    toggleVoice,
    snap: () => { issue(() => ctx.surface.snap()) },
  }
  const setTheme = (preference: ThemePreference): void => { ctx.theme.setTheme(preference) }
  const overlay: OrbOverlayInjected = {
    hooks: { surface, capture: capturePhase, voice, reducedMotion, theme, orbActions: orbActions.items },
    actions: { ...actions, setTheme },
  }
  ctx.effect(() => orbActions.register({
    id: 'dialog',
    label: () => t('orb.action.dialog'),
    icon: { key: 'dialog' },
    order: 0,
    run: openChat,
  }), 'orb: assistant dialog action')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'orb', locale: NS, inject: () => overlay,
    children: { 'orb.action.icon': { kind: 'keyed', scope: 'root', inline: true } },
  }, OrbLayer))
  ctx.slots.inject('orb.action.icon', () => ctx.slots.register({
    name: 'orb.action.icon', key: 'dialog',
  }, OrbDialogActionIcon))

  const startDictation = async (): Promise<void> => {
    const service = ctx.get('voiceCapture')
    if (service === undefined) return
    await service.begin()
  }
  const finishDictation = async (): Promise<string> => {
    const service = ctx.get('voiceCapture')
    if (service === undefined) return ''
    return (await service.finish()).text
  }
  const cancelDictation = (): void => {
    const service = ctx.get('voiceCapture')
    if (service === undefined) return
    service.cancel().catch(reportVoiceFailure)
  }

  const chatActions: OrbChatActions = {
    takeTranscript, submit: submitPrompt, startDictation, finishDictation, cancelDictation,
  }
  const chat: OrbChatInjected = { hooks: { capture, voiceReadiness: readiness }, actions: chatActions }
  ctx.slots.inject('shell.modal', () => ctx.slots.register({
    name: 'shell.modal', id: ORB_CHAT_MODAL_ID, locale: NS, inject: () => chat,
  }, QuickPrompt))

  const workbenchFace: OrbWorkbenchInjected = { hooks: { reference: workbenchStore } }
  ctx.slots.inject('shell.modal', () => ctx.slots.register({
    name: 'shell.modal', id: ORB_WORKBENCH_MODAL_ID, locale: NS, inject: () => workbenchFace,
    children: { 'orb.workbench.conversation': { kind: 'single', scope: 'session' } },
  }, OrbWorkbench))
  ctx.slots.inject('orb.workbench.conversation', () => ctx.slots.register({
    name: 'orb.workbench.conversation',
    inject: () => ({
      openWorkspace: (workspaceId: WorkspaceId, adopt: (sessionId: SessionId) => void) =>
        ctx.uiWorkspace.openWorkspace(workspaceId, adopt),
    }),
  }, OrbWorkbenchConversation))

  ctx.effect(() => ctx.shortcuts.register({
    id: 'orb.toggle' as ShortcutCommandId,
    label: () => t('command.toggle'),
    aliases: ['orb', 'chat', 'toggle'],
    defaults: {},
    regions: ['page'],
    modals: [ORB_CHAT_MODAL_ID],
    scope: 'system',
    resolve: () => {
      const presentation = surface.getSnapshot().presentation
      return {
        status: 'handled',
        run: () => {
          if (presentation === 'orb') { openChat(); return }
          if (presentation === 'panel') { issue(() => ctx.surface.collapse()); return }
          dismissModal()
        },
      }
    },
  }), 'orb: toggle command')
  ctx.effect(() => ctx.shortcuts.register({
    id: 'orb.open' as ShortcutCommandId,
    label: () => t('command.open'),
    aliases: ['orb', 'options', 'menu', 'open', 'show'],
    defaults: {
      'desktop:windows': { code: 'KeyD', modifiers: ['control', 'alt'] },
      'desktop:macos': { code: 'KeyD', modifiers: ['control', 'alt'] },
    },
    regions: ['page'],
    modals: [],
    scope: 'system',
    resolve: () => ({
      status: 'handled',
      run: () => {
        // The OS-global shortcut reaches the surface renderer; both renderers read
        // the same carrier snapshot, so the toggle is decided from that state.
        setOptions(surface.getSnapshot().orbMenu === null)
      },
    }),
  }), 'orb: options command')
  ctx.effect(() => ctx.shortcuts.register({
    id: 'orb.workbench' as ShortcutCommandId,
    label: () => t('orb.menu.workbench'),
    aliases: ['orb', 'manage', 'workbench', 'conversation'],
    defaults: {},
    regions: ['page'],
    modals: [ORB_WORKBENCH_MODAL_ID],
    scope: 'system',
    resolve: () => ({ status: 'handled', run: openWorkbench }),
  }), 'orb: workbench command')
  ctx.effect(() => ctx.shortcuts.register({
    id: 'voice.pushToTalk' as ShortcutCommandId,
    label: () => t('command.voice'),
    aliases: ['voice', 'dictation', 'push to talk'],
    defaults: {},
    regions: ['page'],
    modals: [],
    scope: 'system',
    resolve: () => ctx.get('voiceCapture') === undefined
      ? { status: 'pass' }
      : { status: 'handled', run: toggleVoice },
  }), 'orb: push-to-talk command')
}

/** Orb locale dictionaries, registered by the root Better plugin. */
export const orbLocales = { zh, en, ja, es, fr, de, ru, pt }
