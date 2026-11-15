/**
 * Overlay entry of the orb form. Only the `orb` presentation draws chrome here:
 * the floating orb with its drag gesture and context menu. The chat box is a
 * separate `shell.modal` entry so the carrier renders it in its centered modal
 * presentation; the classic frame needs no form chrome, and the panel
 * presentation hosts only shell-owned overlays.
 */
import { useCallback, useMemo, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { IconLoadingOutlineRegular, IconMicrophoneOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
import type { VoiceCaptureSnapshot } from '@deepseek-ai/dsh-client-voice-capture/client'
import type { VoiceOutputSnapshot } from '@deepseek-ai/dsh-client-ui-voice-output/client'
import { QUICK_SETUP_MODAL_ID } from './modals.ts'
import { activeSession, orbLabelKey, orbVisualState } from './state.ts'
import type { OrbVisualState } from './state.ts'
import { OrbMenu } from './OrbMenu.tsx'
import type { OrbMenuEntryId } from './OrbMenu.tsx'
import { usePointerDrag } from './use-pointer-drag.ts'
import type { NS } from './locales.ts'
import css from './OrbForm.module.css'

/** Commands the orb overlay issues to the surface carrier. */
export interface OrbSurfaceActions {
  /** Present the centered chat modal. */
  readonly openChat: () => void
  /**
   * Change the panel pin state.
   * @param pinned - whether the presentation stays above other windows.
   */
  readonly setPinned: (pinned: boolean) => void
  /**
   * Raise one registered modal presentation.
   * @param id - registered `shell.modal` entry id.
   */
  readonly presentModal: (id: string) => void
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
  /** Toggle playback mute state. */
  readonly toggleMuted: () => void
  /** Advance the auto-speak policy one step. */
  readonly cyclePolicy: () => void
  /** Start a collapsed-orb capture, or finish one into the chat modal. */
  readonly toggleVoice: () => void
}

/** Injected face of the `shell.overlay` entry. */
export interface OrbOverlayInjected {
  hooks: {
    /** Carrier presentation snapshot. */
    surface: HostObservable<SurfaceSnapshot>
    /** Microphone capture snapshot, or null while the capture plugin is unmounted. */
    capture: HostObservable<VoiceCaptureSnapshot | null>
    /** Playback snapshot, or null while the playback plugin is unmounted. */
    voice: HostObservable<VoiceOutputSnapshot | null>
    /** Whether the user asked for reduced motion. */
    reducedMotion: HostObservable<boolean>
  }
  actions: OrbSurfaceActions
}

/** Complete props of the `shell.overlay` entry. */
export type OrbLayerProps =
  & PropsRuntime<'shell.overlay'>
  & PropsLocale<typeof NS>
  & InjectFace<OrbOverlayInjected>

/**
 * State indicator drawn inside the orb: a resting dot, capture bars, a working
 * spinner, or the speaking pulse.
 * @param props.state - resolved visual state.
 * @returns the indicator for that state.
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
      return <span className={css.dot} data-orb-glyph={state} aria-hidden="true" />
  }
}

/**
 * Render the floating orb of the orb presentation.
 * @param props - carrier presentation, voice observations, commands, and localized copy.
 * @returns the orb chrome, or nothing for presentations this entry does not dress.
 */
export function OrbLayer(props: OrbLayerProps) {
  const surface = props.useSurface(snapshot => snapshot)
  const capture = props.useCapture(snapshot => snapshot)
  const voice = props.useVoice(snapshot => snapshot)
  const reducedMotion = props.useReducedMotion(value => value)
  const sessions = props.useSessions(state => state)
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { actions, t } = props
  const drag = usePointerDrag(actions.dragBy)
  const session = useMemo(() => activeSession(sessions), [sessions])
  const capturing = capture === null ? null : capture.phase !== 'idle'
  const state = useMemo(
    () => orbVisualState({ capture, voice }, session?.running === true),
    [capture, voice, session],
  )
  const closeMenu = useCallback((): void => { setMenuOpen(false) }, [])
  const selectEntry = useCallback((entry: OrbMenuEntryId): void => {
    setMenuOpen(false)
    switch (entry) {
      case 'pin':
        actions.setPinned(!surface.pinned)
        return
      case 'mute':
        actions.toggleMuted()
        return
      case 'policy':
        actions.cyclePolicy()
        return
      case 'settings':
        actions.presentModal(QUICK_SETUP_MODAL_ID)
        return
      case 'voice':
        actions.toggleVoice()
        return
    }
  }, [actions, surface.pinned])

  /**
   * Close the context menu with Escape; the focused orb keeps the key event inside the overlay.
   * @param event - key press inside the overlay.
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !menuOpen) return
    event.preventDefault()
    setMenuOpen(false)
  }

  // The chat modal and the frame's modal layer own every other presentation.
  // The bubbles presentation keeps the orb on screen beside its column.
  if (surface.presentation !== 'orb' && surface.presentation !== 'bubbles') return null
  const anchor = surface.presentation === 'bubbles' ? surface.anchor : undefined

  return <div
    className={anchor === undefined ? css.orbRoot : css.orbAnchor}
    style={anchor === undefined ? undefined : { left: anchor.x, top: anchor.y }}
    data-orb
    data-state={state}
    data-reduced-motion={reducedMotion || undefined}
    onKeyDown={onKeyDown}
  >
    {capture !== null && <button type="button" className={css.mic} data-orb-mic
      data-capturing={capturing === true || undefined}
      aria-label={t(capturing === true ? 'orb.micStop' : 'orb.micStart')}
      onPointerDown={(event) => { event.stopPropagation() }}
      onPointerEnter={() => { actions.pointerInside(true) }}
      onPointerLeave={() => { actions.pointerInside(false) }}
      onClick={(event) => { event.stopPropagation(); actions.toggleVoice() }}>
      <IconMicrophoneOutlineRegular size={14} />
    </button>}
    <button type="button" className={css.orb} data-orb-button
      data-hovered={hovered || undefined}
      data-pressed={pressed || undefined}
      data-dragging={drag.dragging || undefined}
      aria-label={t(orbLabelKey(state))}
      title={t('orb.label')}
      onPointerDown={(event) => { setPressed(true); drag.handlers.onPointerDown(event) }}
      onPointerMove={drag.handlers.onPointerMove}
      onPointerUp={(event) => { setPressed(false); drag.handlers.onPointerUp(event) }}
      onPointerCancel={(event) => { setPressed(false); drag.handlers.onPointerCancel(event) }}
      onLostPointerCapture={drag.handlers.onPointerCancel}
      onPointerEnter={() => { setHovered(true); actions.pointerInside(true) }}
      onPointerLeave={() => { setHovered(false); actions.pointerInside(false) }}
      onClick={() => { if (!drag.moved()) actions.openChat() }}
      onContextMenu={(event) => { event.preventDefault(); setMenuOpen(true) }}>
      <OrbGlyph state={state} />
      <span className={css.grip} data-orb-drag aria-hidden="true"
        onPointerEnter={() => { actions.pointerInside(true) }}
        onPointerLeave={() => { actions.pointerInside(false) }} />
    </button>
    {menuOpen && <>
      <div className={css.menuBackdrop} data-orb-menu-backdrop onClick={closeMenu} />
      <OrbMenu pinned={surface.pinned} muted={voice?.muted ?? null} policy={voice?.policy ?? null}
        capturing={capturing} onSelect={selectEntry} t={t} />
    </>}
  </div>
}
