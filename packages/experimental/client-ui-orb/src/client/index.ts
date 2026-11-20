/**
 * Browser entry of the orb form. One apply call registers the locale
 * dictionaries, observes the surface carrier and the optional voice services
 * into snapshot stores, contributes the `shell.overlay` orb and the
 * `shell.modal` chat box, and registers the system-scope orb commands. The
 * conversation, composer, approvals, and questions keep coming from the classic
 * frame; this package owns orb and chat chrome only.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
// Type-only: the `settingsUi` presentation capability the orb menu asks for.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ThemePreference } from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-voice-capture/client'
import type { VoiceCaptureSnapshot } from '@deepseek-ai/dsh-client-voice-capture/client'
import type {} from '@deepseek-ai/dsh-client-ui-voice-output/client'
import type { VoiceOutputSnapshot } from '@deepseek-ai/dsh-client-ui-voice-output/protocol'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ORB_CHAT_MODAL_ID } from './modals.ts'
import { OrbLayer } from './OrbLayer.tsx'
import type { OrbOverlayInjected, OrbSurfaceActions } from './OrbLayer.tsx'
import { ORB_WORKBENCH_MODAL_ID, ORB_WORKBENCH_MODAL_SIZE, OrbWorkbench, OrbWorkbenchConversation } from './OrbWorkbench.tsx'
import type { OrbWorkbenchInjected } from './OrbWorkbench.tsx'
import { QuickPrompt } from './QuickPrompt.tsx'
import type { OrbChatActions, OrbChatInjected } from './QuickPrompt.tsx'
import { de, en, es, fr, ja, NS, pt, ru, zh } from './locales.ts'

/** Required services: the frame seats, the form carrier, the command registry, the theme, and the conversation this form writes to. */
export const inject = ['surface', 'slots', 'locale', 'shortcuts', 'sessions', 'theme']

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A quick prompt waiting for the target Session's history and its prompt receipt. */
    orbPrompt: unknown
    /** The management workbench holding its conversation open while the card shows. */
    orbChat: unknown
  }
}

/** Diagnostic name of the surface observation, used when its stream fails. */
const SURFACE_OBSERVATION = 'surface'
/** Diagnostic name of the capture observation, used when its stream fails. */
const CAPTURE_OBSERVATION = 'capture'
/** Diagnostic name of the playback observation, used when its stream fails. */
const PLAYBACK_OBSERVATION = 'playback'
/** Id of the management Agent preset the chat conversation runs under. */
const MANAGEMENT_PRESET = 'manage'
/**
 * Storage key remembering the management Session across orb window reloads.
 * The v2 key seeds a fresh conversation in the Host default Workspace instead
 * of reusing a Session created in the profile's working directory.
 */
const MANAGEMENT_SESSION_KEY = 'dsh.orb.management-session.v2'

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
 * Read the management Session remembered by this window.
 * @returns the stored Session id, or null without usable storage.
 */
function rememberedManagementSession(): string | null {
  try {
    return window.localStorage.getItem(MANAGEMENT_SESSION_KEY)
  } catch (error) {
    // The orb window may run without usable storage; the Host catalog still identifies the conversation.
    console.debug('orb: management session preference unavailable', error)
    return null
  }
}

/**
 * Remember the management Session for the next orb window mount.
 * @param id - the Session the chat writes to.
 */
function rememberManagementSession(id: string): void {
  try {
    window.localStorage.setItem(MANAGEMENT_SESSION_KEY, id)
  } catch (error) {
    // Losing persistence only costs a new management Session on the next launch.
    console.debug('orb: management session preference unavailable', error)
  }
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

  const theme = createSnapshotStore<ThemePreference>(ctx.theme.getTheme().preference)
  ctx.effect(() => ctx.on('theme/change', () => {
    theme.set(ctx.theme.getTheme().preference)
  }), 'orb: theme preference')

  /** Report one carrier command failure without interrupting the gesture that issued it. */
  const reportFailure = (error: unknown): void => {
    console.error('orb: surface command failed', error)
  }
  /**
   * Run one carrier command and contain its rejection.
   * @param command - carrier command to issue.
   */
  const issue = (command: () => Promise<void>): void => { command().catch(reportFailure) }

  /** Report one capture command failure without interrupting the gesture that issued it. */
  const reportVoiceFailure = (error: unknown): void => {
    console.error('orb: voice capture command failed', error)
  }
  /**
   * Resolve the Host default Workspace, creating it on first use when the
   * profile allows that. The management Session lives there so its
   * session-query tools see the same Workspace the user works in.
   * @returns the default Workspace id, or undefined when no Workspace service
   *   or default Workspace is available.
   */
  const defaultWorkspaceId = async (): Promise<WorkspaceId | undefined> => {
    const workspaces = ctx.get('workspaces')
    if (workspaces === undefined) return undefined
    try {
      return (await workspaces.initializeDefault())?.workspaceId
    } catch (error) {
      // A failed default Workspace must not block the chat: the Host still creates the Session.
      console.warn('orb: default workspace unavailable', error)
      return undefined
    }
  }

  /** Session created or resumed by this window's chat; avoids a second create while the catalog catches up. */
  let managementTarget: Awaited<ReturnType<typeof ctx.sessions.create>> | undefined

  /**
   * Resolve the chat's management Session: the remembered Session while the
   * Host still lists it, otherwise a new one under the management preset in
   * the Host default Workspace.
   * @returns the Session that receives the chat prompt.
   */
  const managementSession = async (): Promise<Awaited<ReturnType<typeof ctx.sessions.create>>> => {
    if (managementTarget !== undefined) return managementTarget
    const sessions = ctx.sessions
    const remembered = rememberedManagementSession()
    const known = remembered === null
      ? undefined
      : sessions.list.getSnapshot().ids.find(id => String(id) === remembered)
    if (known !== undefined) {
      managementTarget = known
      return known
    }
    const workspaceId = await defaultWorkspaceId()
    const created = await sessions.create({
      agentPreset: MANAGEMENT_PRESET,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    })
    rememberManagementSession(String(created))
    managementTarget = created
    return created
  }

  /**
   * Send one prompt to the orb's management conversation.
   * @param text - trimmed prompt text.
   * @returns after the Host accepted the prompt.
   */
  const submitPrompt = async (text: string): Promise<void> => {
    const target = await managementSession()
    await ctx.sessions.using(target, { source: 'orbPrompt' }, async (reference) => {
      const binding = await reference.ready
      const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
      if (!result.ok) throw result.error
    })
    // The prompt is accepted; raise the dedicated workbench so the answer has a visible surface.
    openWorkbench()
  }

  /** @returns the transcript a capture held for the chat box, consumed once. */
  const takeTranscript = (): string | null => ctx.get('voiceCapture')?.takeTranscript() ?? null

  /** Retained conversation behind the management workbench; null while the card is closed. */
  let workbenchReference: SessionReference | null = null
  /** Reference store the workbench modal renders from. */
  const workbenchStore = createSnapshotStore<SessionReference | null>(null)
  /** In-flight preparation, so overlapping surface snapshots retain once. */
  let preparingWorkbench: Promise<void> | undefined

  /** Release the workbench's retained conversation. */
  const closeWorkbench = (): void => {
    if (workbenchReference !== null) {
      workbenchReference.release()
      workbenchReference = null
    }
    workbenchStore.set(null)
  }

  /** Retain the management conversation for an open workbench. */
  const prepareWorkbench = (): void => {
    if (workbenchReference !== null || preparingWorkbench !== undefined) return
    preparingWorkbench = (async () => {
      const target = await managementSession()
      const reference = ctx.sessions.retain(target, { source: 'orbChat', facets: { conversation: true } })
      if (surface.getSnapshot().modal !== ORB_WORKBENCH_MODAL_ID) {
        reference.release()
        return
      }
      workbenchReference = reference
      workbenchStore.set(reference)
    })().catch((error: unknown) => {
      console.error('orb: management workbench unavailable', error)
    }).finally(() => { preparingWorkbench = undefined })
  }

  /** Present the management workbench; the surface window prepares its conversation. */
  const openWorkbench = (): void => {
    issue(() => ctx.surface.presentModal(ORB_WORKBENCH_MODAL_ID, ORB_WORKBENCH_MODAL_SIZE))
  }

  ctx.effect(() => {
    const sync = (): void => {
      if (surface.getSnapshot().modal === ORB_WORKBENCH_MODAL_ID) prepareWorkbench()
      else closeWorkbench()
    }
    const stop = surface.subscribe(sync)
    sync()
    return () => { stop(); closeWorkbench() }
  }, 'orb: management workbench binding')

  /** Present the centered chat modal. */
  const openChat = (): void => { issue(() => ctx.surface.presentModal(ORB_CHAT_MODAL_ID)) }
  /** Open the settings panel in the form's modal presentation. */
  const openSettings = (): void => { ctx.get('settingsUi')?.open() }
  /** Dismiss the active modal presentation and return to the orb. */
  const dismissModal = (): void => { issue(() => ctx.surface.dismissModal()) }

  /**
   * Start a capture from the collapsed orb, or finish it into the chat modal.
   * A finished transcript is held by the capture service until the box mounts and takes it.
   */
  const toggleVoice = (): void => {
    const service = ctx.get('voiceCapture')
    if (service === undefined) return
    const phase = service.snapshot().phase
    if (phase === 'idle') { service.begin().catch(reportVoiceFailure); return }
    if (phase !== 'capturing') return
    void service.finish({ hold: true }).then(() => { openChat() }, reportVoiceFailure)
  }

  const actions: OrbSurfaceActions = {
    openChat,
    openWorkbench,
    openSettings,
    dragBy: (deltaX, deltaY) => { issue(() => ctx.surface.dragBy(deltaX, deltaY)) },
    pointerInside: (inside) => { ctx.surface.setPointerInside(inside) },
    toggleVoice,
    snap: () => { issue(() => ctx.surface.snap()) },
  }
  /** Persist one theme preference so every client window follows it. */
  const setTheme = (preference: ThemePreference): void => { ctx.theme.setTheme(preference) }
  const overlay: OrbOverlayInjected = {
    hooks: { surface, capture, voice, reducedMotion, theme },
    actions: { ...actions, setTheme },
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'orb', locale: NS, inject: () => overlay,
  }, OrbLayer))

  /** Start recording from the chat box's microphone. */
  const startDictation = async (): Promise<void> => {
    const service = ctx.get('voiceCapture')
    if (service === undefined) return
    await service.begin()
  }
  /** @returns the transcript of the chat box's finished recording. */
  const finishDictation = async (): Promise<string> => {
    const service = ctx.get('voiceCapture')
    if (service === undefined) return ''
    return (await service.finish()).text
  }
  /** Discard the chat box's recording when the box closes while it records. */
  const cancelDictation = (): void => {
    const service = ctx.get('voiceCapture')
    if (service === undefined) return
    service.cancel().catch(reportVoiceFailure)
  }

  const chatActions: OrbChatActions = {
    takeTranscript, submit: submitPrompt, startDictation, finishDictation, cancelDictation,
  }
  const chat: OrbChatInjected = { hooks: { capture }, actions: chatActions }
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
  }, OrbWorkbenchConversation))

  ctx.effect(() => ctx.shortcuts.register({
    id: 'orb.toggle' as ShortcutCommandId,
    label: () => t('command.toggle'),
    // Searchable terms, not rendered copy: the localized label above is what the settings list shows.
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
    // Searchable terms, not rendered copy: the localized label above is what the settings list shows.
    aliases: ['orb', 'chat', 'open', 'show'],
    defaults: {
      'desktop:windows': { code: 'KeyD', modifiers: ['control', 'alt'] },
      'desktop:macos': { code: 'KeyD', modifiers: ['control', 'alt'] },
    },
    regions: ['page'],
    modals: [ORB_CHAT_MODAL_ID],
    scope: 'system',
    resolve: () => ({ status: 'handled', run: openChat }),
  }), 'orb: open command')
  ctx.effect(() => ctx.shortcuts.register({
    id: 'orb.workbench' as ShortcutCommandId,
    label: () => t('orb.menu.workbench'),
    // Searchable terms, not rendered copy: the localized label above is what the settings list shows.
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
    // Searchable terms, not rendered copy: the localized label above is what the settings list shows.
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
