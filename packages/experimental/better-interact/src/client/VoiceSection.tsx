/** Settings section: whether the character balloons are read aloud, and in which voice. */
import { useId } from 'react'
import { Button, SegmentedControl, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { VoiceOutputSnapshot } from '@deepseek-ai/dsh-client-ui-voice-output/protocol'
import type { NS } from './locales.ts'
import type { NarrationPreference } from './narration.ts'
import css from './VoiceSection.module.css'

/** Renderer-facing share of the voice narration section. */
export interface VoiceSectionInjected {
  hooks: {
    /** Persisted narration toggle read by the playback renderer. */
    narration: HostObservable<NarrationPreference>
    /** Playback observation; null while no synthesis service is mounted in this renderer. */
    voice: HostObservable<VoiceOutputSnapshot | null>
  }
  /**
   * Persist the narration toggle.
   * @param enabled - whether balloons are read aloud.
   */
  setNarration(enabled: boolean): void
  /**
   * Select the synthesis voice the narration uses.
   * @param voiceId - catalog voice id.
   */
  selectVoice(voiceId: string): void
  /** Speak one fixed sample sentence in the selected voice. */
  preview(): void
}

/** Props of the `settings.section` entry `voice-narration`. */
export type VoiceSectionProps =
  & PropsRuntime<'settings.section'>
  & PropsLocale<typeof NS>
  & InjectFace<VoiceSectionInjected>

/**
 * Render the narration preference: one toggle, the voice choice, and a preview.
 * @param props - bound settings seats plus the narration and playback observations.
 * @returns the settings section.
 */
export function VoiceSection(props: VoiceSectionProps) {
  const { t } = props
  const narration = props.useNarration(value => value)
  const voice = props.useVoice(value => value)
  const id = useId()
  const voices = voice?.voices ?? []
  // A profile without the playback bundle still shows the toggle: the choice is
  // remembered, and the narration starts as soon as playback is mounted. A
  // recorded failure keeps the controls enabled and reports its own notice:
  // the next successful playback clears it, so the picker and the preview are
  // the recovery path.
  const unavailable = voice === null || voices.length === 0
  const failure = voice?.failure ?? null
  const options = voices.map(item => ({ value: item.id, label: item.name }))
  return <section className={css.section} aria-label={t('voice.title')}>
    <h3 className={css.title}>{t('voice.title')}</h3>
    <p className={css.intro}>{t('voice.intro')}</p>
    <div className={css.row}>
      <div className={css.copy}>
        <span className={css.label}>{t('voice.toggle')}</span>
        <p className={css.hint} id={`${id}-toggle`}>{t('voice.toggleHint')}</p>
      </div>
      <Switch
        checked={narration.enabled}
        onChange={props.setNarration}
        label={t('voice.toggle')}
        describedBy={`${id}-toggle`}
      />
    </div>
    <div className={css.row}>
      <div className={css.copy}>
        <span className={css.label}>{t('voice.voice')}</span>
        <p className={css.hint} id={`${id}-voice`}>{t('voice.voiceHint')}</p>
      </div>
      {voice !== null && options.length > 0 && <SegmentedControl
        id={`${id}-voice`}
        value={voice.voiceId ?? options[0]?.value ?? ''}
        options={options}
        onChange={props.selectVoice}
        label={t('voice.voice')}
        disabled={unavailable}
      />}
    </div>
    <div className={css.actions}>
      <Button variant="outline" size="sm" disabled={unavailable} onClick={props.preview}>
        {t('voice.preview')}
      </Button>
      {voice?.speaking === true && <span className={css.status} role="status">{t('voice.speaking')}</span>}
    </div>
    {unavailable && <p className={css.notice} role="status">{t('voice.unavailable')}</p>}
    {!unavailable && failure !== null && (
      <p className={css.notice} role="status">{t(failure === 'voice' ? 'voice.failureVoice' : 'voice.failure')}</p>
    )}
  </section>
}
