/** Source-safe lifecycle for the shared capture service and the voice controls. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MicrophoneDevice, VoiceCaptureSnapshot } from '@deepseek-ai/dsh-client-voice-capture/client'
import type {} from '@deepseek-ai/dsh-client-voice-capture/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createHandsFreeStore } from './hands-free.ts'
import { VoiceInput, type VoiceInputInjected } from './VoiceInput.tsx'
import { en, ja, es, fr, de, ru, pt, NS, zh } from './locales.ts'
import { observeReadiness } from './readiness.ts'
import { VoicePreparation } from './PreparationCard.tsx'
import { VoiceSetupPrompt } from './VoiceSetupPrompt.tsx'

export const inject = ['slots', 'locale', 'voiceCapture']

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }))
  const capture = ctx.voiceCapture
  const readiness = observeReadiness(capture)
  ctx.effect(() => readiness.dispose)
  const snapshots = createSnapshotStore<VoiceCaptureSnapshot>(capture.snapshot(), { flush: 'raf' })
  ctx.effect(() => {
    const lifetime = new AbortController()
    void (async () => {
      try {
        for await (const snapshot of capture.follow(lifetime.signal)) snapshots.set(snapshot)
      } catch (error) {
        // Observation ends through the caller's abort; anything else is a defect worth reporting.
        console.error('voice input: capture observation failed', error)
      }
    })()
    return () => { lifetime.abort() }
  })
  const handsFree = createHandsFreeStore()
  const microphone: { getSnapshot: () => MicrophoneDevice; subscribe: (listener: () => void) => () => void } = {
    getSnapshot: () => snapshots.getSnapshot().device,
    subscribe: listener => snapshots.subscribe(listener),
  }
  // The Plugins page provides its navigation only while the current Peer may use it.
  const pluginNavigation = createSnapshotStore(false)
  ctx.inject(['pluginNavigation'], (scope: Context) => {
    scope.effect(() => {
      pluginNavigation.set(true)
      return () => { pluginNavigation.set(false) }
    }, 'voice-input: plugin navigation presence')
  })
  const actions: VoiceInputInjected = {
    openSettings: () => { ctx.get('pluginNavigation')?.openBundle('@deepseek-ai/dsh-experimental-voice-input-bundle') },
    hooks: { speechReadiness: readiness.state, microphoneDevice: microphone, voiceSnapshot: snapshots,
      handsFree, pluginNavigation },
    selectMicrophone: (device) => { capture.setDevice(device) },
    previewMicrophone: (device, onFailure, signal) => capture.preview(device, onFailure, signal),
    captureSnapshot: () => capture.snapshot(),
    begin: () => capture.begin(),
    finish: () => capture.finish(),
    cancel: () => capture.cancel(),
    takeTranscript: () => capture.takeTranscript(),
    configure: patch => capture.configure(patch),
    prepare: (providerId, options) => capture.prepare(providerId, options),
    cancelPreparation: providerId => capture.cancelPreparation(providerId),
    setHandsFree: (enabled) => { handsFree.set(enabled) },
  }
  ctx.slots.inject('conversation.input.activity', () => ctx.slots.register({
    name: 'conversation.input.activity', locale: NS, inject: () => actions,
  }, VoiceInput))
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config',
    key: '@deepseek-ai/dsh-experimental-voice-input-bundle', locale: NS, inject: () => actions,
  }, VoicePreparation))
  ctx.slots.inject('plugins.bundle.activation', () => ctx.slots.register({ name: 'plugins.bundle.activation',
    key: '@deepseek-ai/dsh-experimental-voice-input-bundle', locale: NS, inject: () => actions,
  }, VoiceSetupPrompt))
}

/**
 * Bind the voice composer and preparation slots to the shared capture service.
 * @param ctx - client runtime owning the dictionaries and slots.
 */
export function mountVoiceInput(ctx: Context): void {
  registerUi(ctx)
}
