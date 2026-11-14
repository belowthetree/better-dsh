/** Click-to-record toolbar activity over the shared capture service; transcripts remain in the Session draft. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MicrophoneDevice, VoiceCaptureFailure, VoiceCapturePreview, VoiceCaptureResult, VoiceCaptureSnapshot } from '@deepseek-ai/dsh-client-voice-capture/client'
import type { SpeechPreparationOptions, SpeechProviderId, SpeechSelectionPatch } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { failureText } from './failure-text.ts'
import type { SpeechReadiness } from './readiness.ts'
import { Waveform } from './Waveform.tsx'
import { VoiceSetupDialog } from './VoiceSetupDialog.tsx'
import { NS } from './locales.ts'
import { Button, IconCloseOutlineRegular, IconStopFillRegular, IconMicrophoneOutlineRegular, StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './VoiceInput.module.css'

/** Shared capture-service commands injected without exposing a Cordis Context to React. */
export interface VoiceInputActions {
  /** Open the voice bundle details without starting preparation. */
  openSettings: () => void
  /** Remember the browser microphone used by previews and subsequent recordings. */
  selectMicrophone: (device: MicrophoneDevice) => void
  /**
   * Acquire one microphone for a level preview without recording.
   * @param device - microphone to acquire.
   * @param onFailure - receives a device interruption before release completes.
   * @param signal - preview lifetime owned by the rendered page.
   * @returns the acquired preview handle.
   */
  previewMicrophone: (device: MicrophoneDevice, onFailure: (failure: VoiceCaptureFailure) => void,
    signal: AbortSignal) => Promise<VoiceCapturePreview>
  /** @returns the live service snapshot for event handlers. */
  captureSnapshot: () => VoiceCaptureSnapshot
  /** Start recording on the selected microphone. */
  begin: () => Promise<void>
  /** @returns the final transcript of the active capture. */
  finish: () => Promise<VoiceCaptureResult>
  /** Stop the active capture and discard its audio. */
  cancel: () => Promise<void>
  /** @returns the transcript a collapsed-panel capture held for this consumer, or null. */
  takeTranscript: () => string | null
  configure: (patch: SpeechSelectionPatch) => Promise<void>
  prepare: (providerId: SpeechProviderId, options?: SpeechPreparationOptions) => Promise<void>
  cancelPreparation: (providerId: SpeechProviderId) => Promise<void>
  /** Persist whether a finished transcript is submitted instead of pre-filling the draft. */
  setHandsFree: (enabled: boolean) => void
}

/** Entry-injected Host readiness, capture snapshot and microphone commands. */
export interface VoiceInputInjected extends VoiceInputActions {
  hooks: {
    speechReadiness: HostObservable<SpeechReadiness>
    microphoneDevice: HostObservable<MicrophoneDevice>
    voiceSnapshot: HostObservable<VoiceCaptureSnapshot>
    /** Whether a finished transcript is submitted as an ordinary message. */
    handsFree: HostObservable<boolean>
    /** Whether the Plugins page navigation service is present; the setup dialog offers the details only while it is. */
    pluginNavigation: HostObservable<boolean>
  }
}

/** Composer-owned expansion and draft actions; preferences stay in plugin settings. */
export type VoiceInputProps = Pick<PropsRuntime<'conversation.input.activity'>, 'sessionId' | 'inputActions' | 'locked' | 'onActiveChange'>
  & PropsLocale<typeof NS> & InjectFace<VoiceInputInjected>

type Phase = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'feedback'

/** Render a compact microphone or an expanded capture, transcription, or retry row. */
export function VoiceInput({ sessionId, inputActions, locked, onActiveChange, begin, finish, cancel, captureSnapshot,
  takeTranscript, openSettings, useSpeechReadiness, usePluginNavigation, useVoiceSnapshot, useHandsFree, t }: VoiceInputProps) {
  const readiness = useSpeechReadiness(value => value), catalog = readiness.catalog
  const navigable = usePluginNavigation(present => present)
  const snapshot = useVoiceSnapshot(value => value), handsFree = useHandsFree(value => value)
  const provider = catalog?.providers.find(item => item.id === catalog.selection.providerId)
  const usable = readiness.connected && (provider?.preparation.phase === 'ready' || provider?.preparation.phase === 'standby'
    || provider?.preparation.phase === 'waking')
  const [feedback, setFeedback] = useState<string | null>(null), [pending, setPending] = useState('')
  const [setupOpen, setSetupOpen] = useState(false)
  useEffect(() => { if (usable) setSetupOpen(false) }, [usable])
  const span = useRef<TokenSpan>(), generation = useRef(0), timer = useRef<ReturnType<typeof setTimeout>>()
  const phase: Phase = snapshot.phase === 'starting' ? 'requesting' : snapshot.phase === 'capturing' ? 'recording'
    : snapshot.phase === 'transcribing' ? 'transcribing' : feedback === null ? 'idle' : 'feedback'
  const expanded = phase !== 'idle'
  useLayoutEffect(() => { onActiveChange(expanded); return () => { onActiveChange(false) } }, [expanded, onActiveChange])

  const clearTimer = useCallback((): void => {
    if (timer.current === undefined) return
    clearTimeout(timer.current)
    timer.current = undefined
  }, [])
  const reset = useCallback((): void => {
    clearTimer()
    span.current = undefined
    setPending(''); setFeedback(null); setSetupOpen(false)
  }, [clearTimer])
  const cancelCapture = useCallback((): void => {
    generation.current++
    reset()
    void cancel()
  }, [reset, cancel])
  const stop = useCallback(async (): Promise<void> => {
    if (captureSnapshot().phase !== 'capturing') return
    const run = generation.current
    clearTimer()
    try {
      const result = await finish()
      if (run !== generation.current) return
      if (result.text === '') { setFeedback(t('empty')); return }
      const target = span.current ?? inputActions.captureInsertion()
      span.current = undefined
      if (!inputActions.insertText(result.text, target)) { setPending(result.text); setFeedback(t('conflict')); return }
      setFeedback(null)
      if (handsFree) inputActions.submit()
    } catch (error) {
      if (run === generation.current) setFeedback(failureText(error, t))
    }
  }, [captureSnapshot, clearTimer, finish, handsFree, inputActions, t])
  const start = useCallback(async (): Promise<void> => {
    if (!catalog || !usable || locked || captureSnapshot().phase !== 'idle') return
    const run = ++generation.current
    span.current = inputActions.captureInsertion()
    setFeedback(null); setPending('')
    try { await begin() } catch (error) {
      if (run === generation.current) setFeedback(failureText(error, t))
      return
    }
    if (run !== generation.current) return
    const seconds = catalog.maxDurationSeconds
    if (seconds <= 0) return
    timer.current = setTimeout(() => { void stop() }, seconds * 1000)
  }, [begin, captureSnapshot, catalog, locked, stop, t, usable])

  useEffect(() => {
    reset()
    // Capture belongs to the service: a Session change retargets the next transcript without stopping it.
  }, [sessionId, reset])
  useEffect(() => {
    if (snapshot.failure !== 'interrupted') return
    setFeedback(t('interrupted'))
  }, [snapshot.failure, t])
  // A capture finished from the collapsed orb holds its transcript until this control mounts.
  useEffect(() => {
    if (snapshot.pendingTranscript === null) return
    const text = takeTranscript()
    if (text === null) return
    if (!inputActions.insertText(text, inputActions.captureInsertion())) { setPending(text); setFeedback(t('conflict')); return }
    setFeedback(null)
    if (handsFree) inputActions.submit()
  }, [snapshot.pendingTranscript, takeTranscript, inputActions, handsFree, t])
  useEffect(() => {
    if (phase === 'idle') return
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      cancelCapture()
    }
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('keydown', escape) }
  }, [phase, cancelCapture])

  if (!expanded) return <>
    <Tooltip label={t('dictate')} disabled={!usable} side="top" portal>
      <span className={css.triggerAnchor}><Button className={css.trigger} size="sm" disabled={locked}
        aria-label={t(usable ? 'start' : 'setupPrompt.trigger')} aria-haspopup={usable ? undefined : 'dialog'}
        onMouseDown={(event) => { event.preventDefault() }}
        onClick={() => { if (usable) void start(); else setSetupOpen(true) }}><IconMicrophoneOutlineRegular size={18} /></Button></span>
    </Tooltip>
    <VoiceSetupDialog open={setupOpen && !usable}
      needsInstallation={readiness.connected && provider?.location === 'host-local' && provider.preparation.phase === 'unprepared'}
      onDismiss={() => { setSetupOpen(false) }}
      onOpenDetails={navigable ? () => { setSetupOpen(false); openSettings() } : undefined} t={t} />
  </>
  return <div className={css.captureRow} data-voice-activity={phase}>
    <Button type="button" className={css.roundButton} size="sm" aria-label={t(pending ? 'discard' : 'cancel')}
      onClick={cancelCapture}><IconCloseOutlineRegular size={14} /></Button>
    {phase === 'recording' ? <Waveform level={snapshot.level} label={t('recording')} />
      : <span className={css.activityMessage} role="status" title={pending || feedback || undefined}>
        {(phase === 'requesting' || phase === 'transcribing') && <StateDot state="ongoing" />}
        {phase === 'feedback' ? feedback : t(phase === 'requesting' ? 'requesting'
          : provider?.preparation.phase === 'waking' ? 'wakingShort' : 'transcribingShort')}</span>}
    {phase === 'recording' && <Button type="button" className={css.roundButton} size="sm" aria-label={t('stop')}
      onClick={() => { void stop() }}><IconStopFillRegular size={14} /></Button>}
    {phase === 'feedback' && (pending
      ? <Button className={css.inlineAction} size="sm" type="button" onClick={() => {
        if (inputActions.insertText(pending, inputActions.captureInsertion())) { setPending(''); setFeedback(null) }
      }}>{t('insert')}</Button>
      : <Button className={css.roundButton} size="sm" type="button" aria-label={t('retryRecording')} disabled={!usable || locked}
        onClick={() => { void start() }}><IconMicrophoneOutlineRegular size={18} /></Button>)}
  </div>
}
