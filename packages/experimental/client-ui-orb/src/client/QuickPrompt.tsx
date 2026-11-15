/**
 * Chat box of the orb form. The carrier renders it inside the modal
 * presentation's centered, focus-trapped card: one prompt input, a voice input
 * toggle, and a send button. A finished dictation appends the transcript to the
 * input instead of submitting it.
 */
import { useEffect, useRef, useState } from 'react'
import {
  IconLoadingOutlineRegular, IconMicrophoneOutlineRegular, IconSendOutlineRegular, IconStopFillRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { VoiceCaptureSnapshot } from '@deepseek-ai/dsh-client-voice-capture/client'
import type { NS } from './locales.ts'
import css from './OrbForm.module.css'

/** Commands the chat box issues to the plugin's apply closure. */
export interface OrbChatActions {
  /** @returns the transcript a collapsed-orb capture held for this box, consumed once. */
  readonly takeTranscript: () => string | null
  /**
   * Send one non-blank prompt to the current conversation.
   * @param text - trimmed prompt text.
   * @returns after the Host accepted the prompt.
   */
  readonly submit: (text: string) => Promise<void>
  /** Dismiss the modal presentation through the surface carrier. */
  readonly dismiss: () => void
  /** Start recording on the selected microphone. */
  readonly startDictation: () => Promise<void>
  /** @returns the transcript the recognizer produced for the chat box's recording. */
  readonly finishDictation: () => Promise<string>
  /** Stop the chat box's recording and discard its audio after the box unmounts. */
  readonly cancelDictation: () => void
}

/** Injected face of the `shell.modal` entry `orb.chat`. */
export interface OrbChatInjected {
  hooks: {
    /** Capture snapshot, or null while the capture plugin is unmounted. */
    capture: HostObservable<VoiceCaptureSnapshot | null>
  }
  actions: OrbChatActions
}

/** Complete props of the chat box; the frame owns the backdrop, focus trap, and Escape. */
export type QuickPromptProps =
  & PropsRuntime<'shell.modal'>
  & PropsLocale<typeof NS>
  & InjectFace<OrbChatInjected>

/** Dictation notice shown beside the actions after a recording settled without text. */
type DictationNotice = 'voiceEmpty' | 'voiceFailed'

/**
 * Render the orb form's chat box.
 * @param props - capture observation, prompt and dictation commands, and localized copy.
 * @returns the chat box; Enter sends, Shift+Enter inserts a newline, and the frame closes it.
 */
export function QuickPrompt(props: QuickPromptProps) {
  const { actions, t } = props
  const { takeTranscript, submit, dismiss, startDictation, finishDictation, cancelDictation } = actions
  const capture = props.useCapture(snapshot => snapshot)
  const [text, setText] = useState(() => takeTranscript() ?? '')
  const [sending, setSending] = useState(false)
  const [sendFailed, setSendFailed] = useState(false)
  const [notice, setNotice] = useState<DictationNotice | null>(null)
  const input = useRef<HTMLTextAreaElement | null>(null)
  /** Whether the active capture was started from this box and must not outlive it. */
  const owned = useRef(false)
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => () => {
    if (!owned.current) return
    owned.current = false
    cancelDictation()
  }, [cancelDictation])
  // A capture finished elsewhere with `{ hold: true }` waits for this box to take it.
  useEffect(() => {
    if (capture === null || capture.pendingTranscript === null) return
    const transcript = takeTranscript()
    if (transcript === null) return
    setText(current => current + transcript)
  }, [capture, takeTranscript])

  const send = async (): Promise<void> => {
    const value = text.trim()
    if (value === '' || sending) return
    setSending(true)
    setSendFailed(false)
    try {
      await submit(value)
      setText('')
      dismiss()
    } catch (_error) {
      setSendFailed(true)
    } finally {
      setSending(false)
    }
  }

  /** Acquire the microphone; a rejected start keeps the box open with a notice. */
  const startRecording = (): void => {
    setNotice(null)
    owned.current = true
    startDictation().catch(() => {
      owned.current = false
      setNotice('voiceFailed')
    })
  }
  /** Stop the owned recording and append its transcript to the input. */
  const stopRecording = (): void => {
    setNotice(null)
    finishDictation().then((transcript) => {
      owned.current = false
      if (transcript === '') { setNotice('voiceEmpty'); return }
      setText(current => current + transcript)
    }).catch(() => {
      owned.current = false
      setNotice('voiceFailed')
    })
  }

  const phase = capture?.phase ?? null
  const dictationLabel = phase === 'capturing' ? t('prompt.voiceStop')
    : phase === 'starting' ? t('prompt.voiceRequesting')
      : phase === 'transcribing' ? t('prompt.voiceTranscribing')
        : t('prompt.voiceStart')
  const status = phase === 'starting' ? t('prompt.voiceRequesting')
    : phase === 'capturing' ? t('prompt.voiceRecording')
      : phase === 'transcribing' ? t('prompt.voiceTranscribing')
        : notice === null ? null : t(notice === 'voiceEmpty' ? 'prompt.voiceEmpty' : 'prompt.voiceFailed')

  return <div className={css.prompt} data-orb-prompt>
    <textarea ref={input} className={css.promptInput} data-orb-prompt-input value={text} rows={2}
      aria-label={t('prompt.label')} placeholder={t('prompt.placeholder')}
      onChange={(event) => { setText(event.target.value); setSendFailed(false) }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
        event.preventDefault()
        void send()
      }} />
    {sendFailed && <p className={css.promptError} role="alert">{t('prompt.failed')}</p>}
    <div className={css.promptActions}>
      {status !== null && <span className={css.promptStatus} data-orb-prompt-status role="status">{status}</span>}
      {capture !== null && <button type="button" className={css.promptMic} data-orb-prompt-mic
        data-recording={capture.phase === 'capturing' || undefined}
        disabled={capture.phase === 'starting' || capture.phase === 'transcribing'}
        aria-label={dictationLabel} title={dictationLabel}
        onClick={capture.phase === 'capturing' ? stopRecording : startRecording}>
        {capture.phase === 'starting' || capture.phase === 'transcribing'
          ? <span className={css.promptSpinner}><IconLoadingOutlineRegular /></span>
          : capture.phase === 'capturing' ? <IconStopFillRegular /> : <IconMicrophoneOutlineRegular />}
      </button>}
      <button type="button" className={css.promptSend} data-orb-prompt-send disabled={sending || text.trim() === ''}
        aria-label={t('prompt.send')} title={t('prompt.send')} onClick={() => { void send() }}>
        {sending
          ? <span className={css.promptSpinner}><IconLoadingOutlineRegular /></span>
          : <IconSendOutlineRegular size={16} />}
      </button>
    </div>
  </div>
}
