/**
 * Overlay entry of the orb form. Only the resident orb window draws chrome
 * here: the floating orb with its drag gesture and its appearance settings
 * menu. The chat box is a separate `shell.modal` entry hosted by the surface
 * window; the classic frame needs no form chrome, and the panel presentation
 * hosts only shell-owned overlays.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  IconCheckOutlineRegular, IconLoadingOutlineRegular, MenuSurface,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ThemePreference } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
import type { VoiceCaptureSnapshot } from '@deepseek-ai/dsh-client-voice-capture/client'
import type { VoiceOutputSnapshot } from '@deepseek-ai/dsh-client-ui-voice-output/client'
import { activeSession, orbLabelKey, orbVisualState } from './orb-state.ts'
import type { OrbVisualState } from './orb-state.ts'
import { usePointerDrag } from './use-pointer-drag.ts'
import orbSidePeek from './assets/orb-side-peek.png'
import orbStanding from './assets/orb-standing.png'
import matureSidePeek from './assets/orb-mature-side-peek.png'
import matureStanding from './assets/orb-mature-standing.png'
import type { NS, OrbKey } from './orb-locales.ts'
import css from './OrbForm.module.css'

/** The two artwork sets the settings menu can switch between. */
export type OrbAppearance = 'cute' | 'mature'

/** Storage key of the chosen artwork set inside the orb window. */
const APPEARANCE_KEY = 'dsh.orb.appearance'

/** @returns the persisted artwork set, or the cute default when storage is unavailable. */
function initialAppearance(): OrbAppearance {
  try {
    return window.localStorage.getItem(APPEARANCE_KEY) === 'mature' ? 'mature' : 'cute'
  } catch (error) {
    // The orb window may run without usable storage; the cute artwork remains the default.
    console.debug('orb: appearance preference unavailable', error)
    return 'cute'
  }
}

/**
 * Remember one artwork choice for the next orb window mount.
 * @param appearance - artwork set the user selected.
 */
function rememberAppearance(appearance: OrbAppearance): void {
  try {
    window.localStorage.setItem(APPEARANCE_KEY, appearance)
  } catch (error) {
    // Losing persistence must not close the menu or reset the visible artwork.
    console.debug('orb: appearance preference unavailable', error)
  }
}

/** Commands the orb overlay issues to the surface carrier. */
export interface OrbSurfaceActions {
  /** Present the centered chat modal. */
  readonly openChat: () => void
  /** Present the dedicated management workbench. */
  readonly openWorkbench: () => void
  /** Open the settings panel in the form's modal presentation. */
  readonly openSettings: () => void
  /**
   * Move the window by one pointer delta.
   * @param deltaX - horizontal movement in logical pixels.
   * @param deltaY - vertical movement in logical pixels.
   */
  readonly dragBy: (deltaX: number, deltaY: number) => void
  /**
   * Report whether the pointer is over the orb so the carrier can pass other clicks through.
   * @param inside - whether the pointer is over the orb or its drag handle.
   */
  readonly pointerInside: (inside: boolean) => void
  /** Start a collapsed-orb capture, or finish one into the chat modal. */
  readonly toggleVoice: () => void
  /** Snap the orb flush to a work-area edge when the user releases a drag near one. */
  readonly snap: () => void
}

/** Preference commands the orb overlay issues to the client services. */
export interface OrbPreferenceActions {
  /**
   * Persist one theme preference through the client theme service.
   * @param preference - light, dark, or the system preference.
   */
  readonly setTheme: (preference: ThemePreference) => void
}

/** Injected face of the `shell.overlay` entry. */
export interface OrbOverlayInjected {
  hooks: {
    /** Carrier presentation snapshot. */
    surface: HostObservable<SurfaceSnapshot>
    /** Microphone capture snapshot, or null while the capture plugin is unmounted. */
    capture: HostObservable<Pick<VoiceCaptureSnapshot, 'phase'> | null>
    /** Playback snapshot, or null while the playback plugin is unmounted. */
    voice: HostObservable<Pick<VoiceOutputSnapshot, 'speaking'> | null>
    /** Whether the user asked for reduced motion. */
    reducedMotion: HostObservable<boolean>
    /** The persisted theme preference of the client. */
    theme: HostObservable<ThemePreference>
  }
  actions: OrbSurfaceActions & OrbPreferenceActions
}

/** Complete props of the `shell.overlay` entry. */
export type OrbLayerProps =
  & PropsRuntime<'shell.overlay'>
  & PropsLocale<typeof NS>
  & InjectFace<OrbOverlayInjected>

/**
 * State indicator drawn over the orb artwork: capture bars, a working spinner,
 * or the speaking pulse. The resting orb shows only the artwork.
 * @param props.state - resolved visual state.
 * @returns the indicator for that state, or null while idle.
 */
function OrbGlyph({ state }: { state: OrbVisualState }) {
  switch (state) {
    case 'capturing':
      return <span className={css.wave} data-orb-glyph={state} aria-hidden="true"><i /><i /><i /></span>
    case 'transcribing':
    case 'running':
      return <span className={css.spinner} data-orb-glyph={state} aria-hidden="true"><IconLoadingOutlineRegular /></span>
    case 'speaking':
      return <span className={css.speaking} data-orb-glyph={state} aria-hidden="true" />
    case 'idle':
      return null
  }
}

/** One selectable setting row of the orb's settings menu. */
interface OrbMenuChoice {
  /** Stable row id, also used by tests and the checked state. */
  readonly id: string
  /** Localized row label. */
  readonly label: OrbKey
  /** Whether the row represents the current choice. */
  readonly active: boolean
  /** Apply the choice; the menu closes afterwards. */
  readonly select: () => void
}

/**
 * Render one checked-or-unchecked menu row.
 * @param props.choice - the setting, its label, and the applied state.
 * @param props.t - orb translator.
 * @param props.onSelect - closes the menu after the choice is applied.
 * @returns one `menuitemradio` row.
 */
function OrbMenuRow({ choice, t, onSelect }: {
  choice: OrbMenuChoice
  t: OrbLayerProps['t']
  onSelect: () => void
}) {
  return <button type="button" role="menuitemradio" aria-checked={choice.active}
    className={css.menuRow} data-orb-menu-item={choice.id}
    onClick={() => { choice.select(); onSelect() }}>
    <span className={css.menuCheck} aria-hidden="true">
      {choice.active ? <IconCheckOutlineRegular size={12} /> : null}
    </span>
    <span className={css.menuLabel}>{t(choice.label)}</span>
  </button>
}

/**
 * Render the floating orb of the resident orb window.
 * @param props - carrier presentation, voice and theme observations, commands, and localized copy.
 * @returns the orb chrome in the orb window, or nothing in the surface or bubble column window.
 */
export function OrbLayer(props: OrbLayerProps) {
  const surface = props.useSurface(snapshot => snapshot)
  const capture = props.useCapture(snapshot => snapshot)
  const voice = props.useVoice(snapshot => snapshot)
  const reducedMotion = props.useReducedMotion(value => value)
  const themePreference = props.useTheme(preference => preference)
  const sessions = props.useSessions(state => state)
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [appearance, setAppearance] = useState<OrbAppearance>(initialAppearance)
  const [menuOpen, setMenuOpen] = useState(false)
  const { actions, t } = props
  const drag = usePointerDrag((deltaX, deltaY) => { actions.dragBy(deltaX, deltaY) })
  const session = useMemo(() => activeSession(sessions), [sessions])
  const state = useMemo(
    () => orbVisualState({ capture, voice }, session?.running === true),
    [capture, voice, session],
  )
  /** Finish a gesture: the carrier snaps a released drag near a work-area edge. */
  const finishDrag = (): void => {
    if (drag.moved()) actions.snap()
  }

  // Escape or leaving the orb window closes the settings menu, matching the
  // platform's context-menu behavior: a click on the desktop or on another
  // application blurs this window without reaching its document.
  useEffect(() => {
    if (!menuOpen) return undefined
    const close = (): void => { setMenuOpen(false) }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menuOpen])

  // The surface window hosts panel and modal presentations and the bubble
  // column window hosts the output column; only the resident orb window draws the orb.
  if (surface.role !== 'orb') return null

  const selectAppearance = (next: OrbAppearance): void => {
    setAppearance(next)
    rememberAppearance(next)
  }
  const appearanceChoices: readonly OrbMenuChoice[] = [
    { id: 'cute', label: 'orb.menu.cute', active: appearance === 'cute', select: () => { selectAppearance('cute') } },
    { id: 'mature', label: 'orb.menu.mature', active: appearance === 'mature', select: () => { selectAppearance('mature') } },
  ]
  const themeChoices: readonly OrbMenuChoice[] = [
    { id: 'light', label: 'orb.menu.light', active: themePreference === 'light', select: () => { actions.setTheme('light') } },
    { id: 'dark', label: 'orb.menu.dark', active: themePreference === 'dark', select: () => { actions.setTheme('dark') } },
    { id: 'system', label: 'orb.menu.system', active: themePreference === 'system', select: () => { actions.setTheme('system') } },
  ]
  const artwork = appearance === 'mature'
    ? (surface.orbDocked ? matureSidePeek : matureStanding)
    : (surface.orbDocked ? orbSidePeek : orbStanding)

  return <div
    className={css.orbRoot}
    data-orb
    data-state={state}
    data-appearance={appearance}
    data-reduced-motion={reducedMotion || undefined}
  >
    <button type="button" className={css.orb} data-orb-button
      data-hovered={hovered || undefined}
      data-pressed={pressed || undefined}
      data-dragging={drag.dragging || undefined}
      aria-label={t(orbLabelKey(state))}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onPointerDown={(event) => { setPressed(true); drag.handlers.onPointerDown(event) }}
      onPointerMove={drag.handlers.onPointerMove}
      onPointerUp={(event) => { setPressed(false); drag.handlers.onPointerUp(event); finishDrag() }}
      onPointerCancel={(event) => { setPressed(false); drag.handlers.onPointerCancel(event); finishDrag() }}
      onLostPointerCapture={drag.handlers.onPointerCancel}
      onPointerEnter={() => { setHovered(true); actions.pointerInside(true) }}
      onPointerLeave={() => { setHovered(false); actions.pointerInside(false) }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setMenuOpen(true) }}
      onClick={() => { if (!drag.moved() && !menuOpen) actions.openChat() }}>
      <img className={css.orbArt} src={artwork} alt="" data-orb-art draggable={false} />
      <OrbGlyph state={state} />
      <span className={css.grip} data-orb-drag aria-hidden="true"
        onPointerEnter={() => { actions.pointerInside(true) }}
        onPointerLeave={() => { actions.pointerInside(false) }} />
    </button>
    {menuOpen && <div className={css.menuLayer} data-orb-menu-layer
      onPointerDown={() => { setMenuOpen(false) }}>
      <MenuSurface compact role="menu" aria-label={t('orb.menu.label')} className={css.menu}
        onPointerDown={(event) => { event.stopPropagation() }}>
        <button type="button" role="menuitem" className={css.menuRow} data-orb-menu-item="workbench"
          onClick={() => { setMenuOpen(false); actions.openWorkbench() }}>
          <span className={css.menuCheck} aria-hidden="true" />
          <span className={css.menuLabel}>{t('orb.menu.workbench')}</span>
        </button>
        <button type="button" role="menuitem" className={css.menuRow} data-orb-menu-item="settings"
          onClick={() => { setMenuOpen(false); actions.openSettings() }}>
          <span className={css.menuCheck} aria-hidden="true" />
          <span className={css.menuLabel}>{t('orb.menu.settings')}</span>
        </button>
        <div className={css.menuSeparator} role="separator" />
        {appearanceChoices.map(choice => <OrbMenuRow key={choice.id} choice={choice} t={t}
          onSelect={() => { setMenuOpen(false) }} />)}
        <div className={css.menuSeparator} role="separator" />
        {themeChoices.map(choice => <OrbMenuRow key={choice.id} choice={choice} t={t}
          onSelect={() => { setMenuOpen(false) }} />)}
      </MenuSurface>
    </div>}
  </div>
}
