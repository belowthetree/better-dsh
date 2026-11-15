/** Form-owned quick voice settings card shown by the modal presentation. */
import { IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { VoiceOutputPolicy, VoiceOutputSnapshot } from '@deepseek-ai/dsh-client-ui-voice-output/client'
import { policyLabelKey } from './state.ts'
import type { NS } from './locales.ts'
import css from './OrbForm.module.css'

/** Settled auto-speak policies in presentation order. */
const POLICIES: readonly VoiceOutputPolicy[] = ['off', 'voice', 'all']

/** Injected face of the `shell.modal` entry `orb.quick-setup`. */
export interface OrbQuickSetupInjected {
  hooks: {
    /** Playback snapshot, or null while the playback plugin is unmounted. */
    voice: HostObservable<VoiceOutputSnapshot | null>
  }
  /** Dismiss the modal presentation through the surface carrier. */
  readonly dismiss: () => void
  /**
   * Set the playback mute state.
   * @param muted - whether playback is muted.
   */
  readonly setMuted: (muted: boolean) => void
  /**
   * Set the auto-speak policy.
   * @param policy - policy to adopt.
   */
  readonly setPolicy: (policy: VoiceOutputPolicy) => void
  /**
   * Select the spoken voice.
   * @param voiceId - provider voice id from the snapshot's catalog.
   */
  readonly setVoice: (voiceId: string) => void
}

/** Complete props of the quick setup card; the frame owns focus, Escape, and the dismissal area. */
export type OrbQuickSetupProps =
  & PropsRuntime<'shell.modal'>
  & PropsLocale<typeof NS>
  & InjectFace<OrbQuickSetupInjected>

/**
 * Render the form's voice selection, mute toggle, and auto-speak policy.
 * @param props - playback observation, commands, and localized copy.
 * @returns the quick setup card, or its unmounted-plugin explanation.
 */
export function OrbQuickSetupCard(props: OrbQuickSetupProps) {
  const { t } = props
  const voice = props.useVoice(snapshot => snapshot)
  return <section className={css.setup} data-orb-quick-setup>
    <header className={css.setupHeader}>
      <h2 className={css.setupTitle}>{t('setup.title')}</h2>
      <button type="button" className={css.setupClose} data-orb-setup-close
        aria-label={t('setup.close')} title={t('setup.close')} onClick={props.dismiss}>
        <IconCloseOutlineRegular />
      </button>
    </header>
    {voice === null
      ? <div className={css.setupBody} data-orb-setup-empty>
        <p className={css.setupNote}>{t('setup.noVoiceTitle')}</p>
        <p>{t('setup.noVoiceBody')}</p>
      </div>
      : <>
        <p className={css.setupBody}>{t('setup.description')}</p>
        <fieldset className={css.setupGroup}>
          <legend className={css.setupLegend}>{t('setup.voice')}</legend>
          <div className={css.setupChoices}>
            {voice.voices.map(item => <button key={item.id} type="button" className={css.setupChoice}
              data-orb-setup-voice={item.id} aria-pressed={item.id === voice.voiceId}
              onClick={() => { props.setVoice(item.id) }}>{item.name}</button>)}
          </div>
        </fieldset>
        <fieldset className={css.setupGroup}>
          <legend className={css.setupLegend}>{t('setup.policy')}</legend>
          <div className={css.setupChoices}>
            {POLICIES.map(policy => <button key={policy} type="button" className={css.setupChoice}
              data-orb-setup-policy={policy} aria-pressed={policy === voice.policy}
              onClick={() => { props.setPolicy(policy) }}>{t(policyLabelKey(policy))}</button>)}
          </div>
        </fieldset>
        <button type="button" className={css.setupChoice} data-orb-setup-mute
          aria-pressed={voice.muted} onClick={() => { props.setMuted(!voice.muted) }}>{t('setup.mute')}</button>
        <p className={css.setupBilled}>{t('setup.billed')}</p>
      </>}
  </section>
}
