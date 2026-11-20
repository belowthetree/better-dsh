/**
 * Agent output bubbles over the desktop: the live text of the newest answer,
 * the earlier answers on hover, and the workbench behind a click.
 */
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NS } from './locales.ts'
import type { ReminderInteraction } from './reminders.ts'
import { orbReminder, reminderMessage } from './reminders.ts'
import { workbenchAddress } from './resource.ts'
import css from './Bubbles.module.css'

/** Delay between two bubbles entering or leaving in sequence. */
export const BUBBLE_STAGGER_MS = 230

/** One bubble's enter or leave animation duration. */
export const BUBBLE_MOTION_MS = 180

/** Quiet time after the pointer leaves the orb and the column before the bubbles leave. */
export const BUBBLE_HOVER_LEAVE_MS = 500

/** Lines a collapsed bubble may preview before the rest is omitted with an ellipsis. */
export const BUBBLE_PREVIEW_LINES = 7

/** Character budget for one collapsed preview; keeps a wrapped paragraph inside the line clamp. */
export const BUBBLE_PREVIEW_CHARS = 190

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Output bubbles of one bound Session. */
    'better-interact.bubbles.stack': { kind: 'single'; scope: 'session' }
  }
}

/** Carrier commands and observations the bubble entries consume. */
export interface BubblesInjected {
  hooks: {
    /** Carrier presentation snapshot. */
    surface: HostObservable<SurfaceSnapshot>
    /** Pending Session interactions the orb speaks about. */
    pending: HostObservable<ReadonlyMap<SessionId, ReminderInteraction>>
  }
  /** Ask the carrier to show the bubble column window. */
  show(): void
  /** Ask the carrier to hide the bubble column window. */
  hide(): void
  /**
   * Raise the workbench of one Session, adding its card when the strip has none.
   * @param sessionId - Session whose conversation the dialog should show.
   */
  open(sessionId: SessionId): void
  /** Report whether the pointer is over the bubble column, so the carrier can pass clicks through elsewhere. */
  pointerInside(inside: boolean): void
}

/** Props of the `shell.overlay` entry `better-interact.bubbles`. */
export type BubblesLayerProps =
  & PropsRuntime<'shell.overlay'>
  & PropsRenderSlots<'better-interact.bubbles.stack'>
  & PropsLocale<typeof NS>
  & InjectFace<BubblesInjected>

/** Props of the session-scoped entry `better-interact.bubbles.stack`. */
export type BubbleStackProps =
  & PropsRuntime<'better-interact.bubbles.stack'>
  & PropsLocale<typeof NS>
  & InjectFace<BubblesInjected>

/** One rendered output: the text and whether it still streams. */
export interface BubbleOutput {
  /** Turn identity, so a changed answer keeps its bubble. */
  readonly key: string
  readonly text: string
  /** Whether this entry is the answer still being written. */
  readonly live: boolean
}

/** Category of one bubble: a completed answer, or the message currently streaming. */
export type BubbleKind = 'history' | 'streaming'

/**
 * Classify one bubble by whether its answer is still streaming.
 * @param entry - derived bubble entry.
 * @returns the streaming category for the live partial, history for a completed message.
 */
export function bubbleKind(entry: BubbleOutput): BubbleKind {
  return entry.live ? 'streaming' : 'history'
}

/**
 * Join the text blocks of one assistant publication.
 * @param blocks - assistant content blocks.
 * @returns trimmed visible text without reasoning or tool calls.
 */
export function assistantText(blocks: readonly AssistantBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) if (block.kind === 'text') parts.push(block.text)
  return parts.join('').trim()
}

/**
 * Omit the part of an answer the bubble cannot show, marking it with an ellipsis.
 * The CSS line clamp hides wrapped overflow, but it does not add an ellipsis when
 * the preview ends on an explicit line break.
 * @param text - complete answer text.
 * @returns the text up to the bubble's preview budget, ending in `…` when anything was omitted.
 */
export function bubblePreview(text: string): string {
  const lines = text.split('\n')
  let preview = lines.slice(0, BUBBLE_PREVIEW_LINES).join('\n')
  let omitted = lines.length > BUBBLE_PREVIEW_LINES
  if (preview.length > BUBBLE_PREVIEW_CHARS) {
    preview = preview.slice(0, BUBBLE_PREVIEW_CHARS)
    omitted = true
  }
  return omitted ? `${preview.trimEnd()}…` : preview
}

/**
 * Derive the bubble entries from the Chat target, oldest first.
 * @param chat - current Chat snapshot, or undefined before that target publishes.
 * @returns one entry per finished assistant message plus the streaming answer as the newest entry.
 */
export function bubbleOutputs(chat: ChatSnapshot | undefined): { entries: BubbleOutput[]; live: string } {
  if (chat === undefined) return { entries: [], live: '' }
  const answers: { seq: number; text: string }[] = []
  // The assembled transcript holds one node per assistant message, whether or
  // not a transcript is rendered in this window; the Turn previews are the
  // fallback for a snapshot that has not assembled nodes yet.
  for (const node of chat.legacy.nodes) {
    if (node.kind !== 'assistant') continue
    const text = assistantText(node.blocks)
    if (text !== '') answers.push({ seq: node.seq, text })
  }
  if (answers.length === 0) {
    for (const item of chat.navigation.items()) {
      const text = item.response.trim()
      if (text !== '') answers.push({ seq: item.turn, text })
    }
  }
  answers.sort((left, right) => left.seq - right.seq)
  const entries: BubbleOutput[] = answers.map(answer => ({
    key: `message-${String(answer.seq)}`, text: answer.text, live: false,
  }))
  const partial = chat.legacy.partial
  const live = partial === null ? '' : assistantText(partial.blocks)
  if (live !== '') entries.push({ key: 'live', text: live, live: true })
  return { entries, live }
}

/**
 * Bind the bubble column to the Session the catalog reports as current.
 * The orb window keeps its stack mounted because it owns the entry triggers and
 * raises a streaming column; the column window mounts the stack only while the
 * column is up, and the surface window renders no column.
 * @param props - Session catalog, the workbench resource hook, and the bubble entries.
 * @returns the bound bubble column, or nothing while the catalog has no Session.
 */
export function BubblesLayer(props: BubblesLayerProps) {
  const role = props.useSurface(snapshot => snapshot.role)
  const presentation = props.useSurface(snapshot => snapshot.presentation)
  const orbHovered = props.useSurface(snapshot => snapshot.orbHovered)
  const target = props.useSessions(state => state.ids[0])
  const resource = props.useResource<'betterinteract'>(workbenchAddress(target))
  const reference = resource.value?.reference
  const { show } = props

  // The orb window is the only renderer that asks for the column, and the
  // pointer entering the resident orb is the only entry trigger. The carrier
  // reports that hover in the snapshot after the orb renderer's pointer report,
  // so the column and its exit timer never disagree about whether the pointer
  // is still on the orb.
  useEffect(() => {
    if (role !== 'orb' || !orbHovered || reference === undefined) return
    show()
  }, [role, orbHovered, reference, show])

  if (reference === undefined || (role !== 'orb' && presentation !== 'bubbles')) return null
  const { SessionProvider, renderSlot } = props
  return <SessionProvider session={reference}>{renderSlot('better-interact.bubbles.stack', {})}</SessionProvider>
}

/**
 * Render the bubble column of one Session: history bubbles for the messages
 * already answered, and one streaming bubble for the answer being written. The
 * streaming bubble appears while output streams and the column stays until the
 * agent stops; history bubbles follow the pointer's orb and column hover, leaving
 * half a second after the pointer is off both. The workbench holds the column
 * until its modal leaves, so opening it from a bubble keeps the outputs that
 * opened it.
 * @param props - bound Session state, its Chat target, and the carrier commands.
 * @returns the column while the carrier presents it, nothing otherwise.
 */
export function BubbleStack(props: BubbleStackProps) {
  const { show, hide, open, pointerInside, t } = props
  const role = props.useSurface(snapshot => snapshot.role)
  const presentation = props.useSurface(snapshot => snapshot.presentation)
  const orbHovered = props.useSurface(snapshot => snapshot.orbHovered)
  const modalOpen = props.useSurface(snapshot => snapshot.modalOpen)
  const running = props.useSession(value => value.running)
  const chat = props.useConversation(state => state.views.get('chat'))
  const [exiting, setExiting] = useState(false)
  const [inside, setInside] = useState(false)
  /** Once the pointer asked for the history, keep it visible through the leave and exit. */
  const [holdHistory, setHoldHistory] = useState(false)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { entries, live } = bubbleOutputs(chat)
  const streaming = live !== ''
  const busy = running || streaming
  const visible = presentation === 'bubbles'
  // The pointer on the orb or the column asks for the history; a streaming
  // column the pointer is away from shows only its newest bubble.
  const expanded = orbHovered || inside || holdHistory
  const shown = expanded ? entries : entries.slice(-1)
  const pending = props.usePending(value => value)
  const byId = props.useSessions(state => state.byId)
  const reminder = orbReminder(pending)
  /** A waiting request keeps the column up even when the pointer is elsewhere. */
  const reminding = reminder !== undefined
  const summary = reminder === undefined ? undefined : byId[reminder.sessionId]
  const reminderTitle = reminder === undefined
    ? ''
    : (summary?.title?.trim() || summary?.displayTitle || String(reminder.sessionId))

  /** Stop a running exit, if any, and keep every bubble on screen. */
  const cancelExit = useCallback((): void => {
    if (exitTimer.current !== null) {
      clearTimeout(exitTimer.current)
      exitTimer.current = null
    }
    setExiting(false)
  }, [])

  /** Leave in sequence from the newest bubble, then dismiss the column. */
  const startExit = useCallback((): void => {
    if (exitTimer.current !== null || !visible) return
    // An empty column has nothing to animate, but its window still has to go.
    if (shown.length === 0) { hide(); return }
    setExiting(true)
    const total = (shown.length - 1) * BUBBLE_STAGGER_MS + BUBBLE_MOTION_MS
    exitTimer.current = setTimeout(() => {
      exitTimer.current = null
      setExiting(false)
      hide()
    }, total)
  }, [visible, shown.length, hide])

  // The bubble column owns its window; the orb and surface renderers never report
  // pointer presence for it. The column starts transparent to clicks, and the
  // carrier forwards pointer moves to the page, so the first move asks for clicks back.
  useEffect(() => {
    if (role !== 'bubbles') return
    pointerInside(false)
  }, [role, pointerInside])

  useEffect(() => () => {
    if (exitTimer.current !== null) clearTimeout(exitTimer.current)
  }, [])

  // A streaming answer raises the column on its own; the streaming bubble must
  // stay visible until the agent stops, whether or not the pointer is nearby.
  // A pending request raises it too, so the character's reminder is not missed.
  useEffect(() => {
    if (visible || (!streaming && !reminding)) return
    show()
  }, [visible, streaming, reminding, show])

  // Asking for the history keeps it expanded while the pointer leaves and the
  // bubbles finish their exit; a fresh streaming-only column starts collapsed.
  useEffect(() => {
    if (!visible) {
      setHoldHistory(false)
      return
    }
    if (orbHovered || inside) setHoldHistory(true)
  }, [visible, orbHovered, inside])

  useEffect(() => {
    if (!visible) {
      setInside(false)
      setHoldHistory(false)
      cancelExit()
      return
    }
    // The orb, the column, an active output, the workbench, or a pending request
    // keeps the bubbles. Otherwise the column leaves half a second after the
    // pointer left both.
    if (orbHovered || inside || busy || modalOpen || reminding) {
      cancelExit()
      return
    }
    if (exiting) return
    const timer = setTimeout(startExit, BUBBLE_HOVER_LEAVE_MS)
    return () => { clearTimeout(timer) }
  }, [visible, orbHovered, inside, busy, modalOpen, reminding, exiting, startExit, cancelExit])

  /** Expand the history and keep the column while the pointer rests on it. */
  const enter = (): void => {
    setInside(true)
    cancelExit()
    pointerInside(true)
  }

  /** Let the carrier pass clicks through; the leave timer decides the exit. */
  const leave = (): void => {
    setInside(false)
    pointerInside(false)
  }

  if (!visible || (entries.length === 0 && reminder === undefined)) return null
  return <div className={css.layer} data-better-interact-bubbles="" data-exiting={exiting ? 'true' : 'false'}>
    <div
      className={css.stack}
      role="log"
      aria-label={t('bubbles.label')}
      onPointerEnter={enter}
      onPointerLeave={leave}
    >
      {shown.map((entry, index) => <button
        key={entry.key}
        type="button"
        className={css.bubble}
        style={{ animationDelay: `${Math.max(0, shown.length - 1 - index) * BUBBLE_STAGGER_MS}ms` }}
        data-kind={bubbleKind(entry)}
        title={t('command.open')}
        onClick={() => { open(props.sessionId) }}
      >
        {bubblePreview(entry.text)}
      </button>)}
      {reminder !== undefined && <button
        type="button"
        className={css.reminder}
        data-better-interact-reminder=""
        title={t('reminder.open')}
        onClick={() => { open(reminder.sessionId) }}
      >
        <span className={css.reminderText}>{reminderMessage(reminder, reminderTitle, t)}</span>
        {reminder.others > 0 && <span className={css.reminderMore}>{t('reminder.more', { count: reminder.others })}</span>}
      </button>}
    </div>
  </div>
}
