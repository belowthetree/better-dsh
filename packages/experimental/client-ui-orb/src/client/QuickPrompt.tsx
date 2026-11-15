/** Expanded presentation of the orb form: one chat box with a send button and no frame chrome. */
import { useEffect, useRef, useState } from 'react'
import { IconLoadingOutlineRegular, IconSendOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './OrbForm.module.css'

/** Props of the expanded chat box. */
export interface QuickPromptProps {
  /**
   * Take the text a collapsed-panel voice capture held for this box; consumed once on mount.
   * @returns the held transcript, or null when no capture is waiting.
   */
  readonly takeTranscript: () => string | null
  /**
   * Send one non-blank prompt to the current conversation.
   * @param text - trimmed prompt text.
   * @returns after the Host accepted the prompt.
   */
  readonly onSubmit: (text: string) => Promise<void>
  /** Collapse the box back into the orb. */
  readonly onCollapse: () => void
  /** Translate one dictionary key of the orb namespace. */
  readonly t: TranslateNS<typeof NS>
}

/**
 * Render the expanded chat box.
 * @param props - held transcript, submission, collapse, and localized copy.
 * @returns the box; Escape collapses it and Enter submits.
 */
export function QuickPrompt({ takeTranscript, onSubmit, onCollapse, t }: QuickPromptProps) {
  const [text, setText] = useState(() => takeTranscript() ?? '')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const input = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => { input.current?.focus() }, [])
  const submit = async (): Promise<void> => {
    const value = text.trim()
    if (value === '' || busy) return
    setBusy(true)
    setFailed(false)
    try {
      await onSubmit(value)
      setText('')
      onCollapse()
    } catch (_error) {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return <div className={css.prompt} data-orb-prompt onKeyDown={(event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    onCollapse()
  }}>
    <textarea ref={input} className={css.promptInput} data-orb-prompt-input value={text} rows={2}
      aria-label={t('prompt.label')} placeholder={t('prompt.placeholder')}
      onChange={(event) => { setText(event.target.value); setFailed(false) }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
        event.preventDefault()
        void submit()
      }} />
    {failed && <p className={css.promptError} role="alert">{t('prompt.failed')}</p>}
    <button type="button" className={css.promptSend} data-orb-prompt-send disabled={busy || text.trim() === ''}
      aria-label={t('prompt.send')} title={t('prompt.send')} onClick={() => { void submit() }}>
      {busy ? <IconLoadingOutlineRegular /> : <IconSendOutlineRegular />}
    </button>
  </div>
}
