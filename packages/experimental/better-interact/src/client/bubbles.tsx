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
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NS } from './locales.ts'
import { workbenchAddress } from './resource.ts'
import css from './Bubbles.module.css'

/** Delay between two bubbles entering or leaving in sequence. */
export const BUBBLE_STAGGER_MS = 230

/** One bubble's enter or leave animation duration. */
export const BUBBLE_MOTION_MS = 180

/** Grace after the pointer leaves the orb window before the column is dismissed. */
export const BUBBLE_ORB_LEAVE_MS = 400

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
  }
  /** Ask the carrier for the bubble column presentation. */
  show(): void
  /** Return the carrier to the orb presentation. */
  hide(): void
  /** Raise the workbench for the Session the bubble column reports. */
  open(): void
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
 * @param props - Session catalog, the workbench resource hook, and the bubble entries.
 * @returns the bound bubble column, or nothing while the catalog has no Session.
 */
export function BubblesLayer(props: BubblesLayerProps) {
  const role = props.useSurface(snapshot => snapshot.role)
  const target = props.useSessions(state => state.ids[0])
  const resource = props.useResource<'betterinteract'>(workbenchAddress(target))
  const reference = resource.value?.reference
  const { show, hide } = props

  // The carrier runs the orb window beside the surface window. Pointer activity
  // inside the resident orb asks the carrier to present the column in the
  // surface window; leaving the orb re-arms the request and dismisses a column
  // the pointer did not move onto.
  useEffect(() => {
    if (role !== 'orb' || reference === undefined) return
    let fired = false
    let leaveTimer: ReturnType<typeof setTimeout> | null = null
    const clearLeave = (): void => {
      if (leaveTimer === null) return
      clearTimeout(leaveTimer)
      leaveTimer = null
    }
    const enter = (): void => {
      clearLeave()
      if (fired) return
      fired = true
      show()
    }
    const leave = (): void => {
      fired = false
      clearLeave()
      leaveTimer = setTimeout(() => {
        leaveTimer = null
        hide()
      }, BUBBLE_ORB_LEAVE_MS)
    }
    document.addEventListener('pointerenter', enter, true)
    document.addEventListener('pointermove', enter, true)
    document.addEventListener('pointerleave', leave, true)
    return () => {
      clearLeave()
      document.removeEventListener('pointerenter', enter, true)
      document.removeEventListener('pointermove', enter, true)
      document.removeEventListener('pointerleave', leave, true)
    }
  }, [role, reference, show, hide])

  if (reference === undefined) return null
  const { SessionProvider, renderSlot } = props
  return <SessionProvider session={reference}>{renderSlot('better-interact.bubbles.stack', {})}</SessionProvider>
}

/**
 * Render the bubble column of one Session: the newest output while the agent
 * works, the earlier answers while the pointer rests on it. Bubbles pop in and
 * out from the right in sequence from the newest output outward; the column
 * leaves after the pointer that entered it leaves, and the orb window dismisses
 * a column the pointer did not move onto.
 * @param props - bound Session state, its Chat target, and the carrier commands.
 * @returns the column while the carrier presents it, nothing otherwise.
 */
export function BubbleStack(props: BubbleStackProps) {
  const { show, hide, open, pointerInside, t } = props
  const presentation = props.useSurface(snapshot => snapshot.presentation)
  const running = props.useSession(value => value.running)
  const chat = props.useConversation(state => state.views.get('chat'))
  const [expanded, setExpanded] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [inside, setInside] = useState(false)
  const wasVisible = useRef<boolean | null>(null)
  /** Whether the pointer has entered this showing, which makes leaving decide the exit. */
  const hovered = useRef(false)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { entries, live } = bubbleOutputs(chat)
  const busy = running || live !== ''
  const visible = presentation === 'bubbles'
  const shown = expanded ? entries : entries.slice(-1)

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
    if (exitTimer.current !== null || !visible || shown.length === 0) return
    setExiting(true)
    const total = (shown.length - 1) * BUBBLE_STAGGER_MS + BUBBLE_MOTION_MS
    exitTimer.current = setTimeout(() => {
      exitTimer.current = null
      setExiting(false)
      hovered.current = false
      hide()
    }, total)
  }, [visible, shown.length, hide])

  // The column starts transparent to clicks; the carrier forwards pointer moves
  // to the page, so the first move over the stack asks for clicks back.
  useEffect(() => {
    pointerInside(false)
  }, [pointerInside])

  useEffect(() => () => {
    if (exitTimer.current !== null) clearTimeout(exitTimer.current)
  }, [])

  // A fresh column opens with the newest answer; reopening it after output
  // settled expands to the history while the pointer asks for it.
  useEffect(() => {
    const entered = wasVisible.current === false && visible
    wasVisible.current = visible
    if (!visible) {
      hovered.current = false
      setInside(false)
      setExpanded(false)
      cancelExit()
      return
    }
    if (entered && !busy) setExpanded(true)
  }, [visible, busy, cancelExit])

  useEffect(() => {
    if (!busy) return
    cancelExit()
    if (!visible) show()
  }, [busy, visible, show, cancelExit])

  useEffect(() => {
    if (!visible || exiting || busy || shown.length === 0 || inside || !hovered.current) return
    // Only a pointer that entered the column can leave it: an untouched column
    // stays on screen instead of disappearing on a timer.
    startExit()
  }, [visible, exiting, busy, shown.length, inside, startExit])

  /** Show the history and keep the column while the pointer rests on it. */
  const enter = (): void => {
    setInside(true)
    hovered.current = true
    cancelExit()
    setExpanded(true)
    pointerInside(true)
  }

  /** Let the carrier pass clicks through and leave the column once nothing streams. */
  const leave = (): void => {
    setInside(false)
    pointerInside(false)
    if (!busy && visible) startExit()
  }

  if (!visible || entries.length === 0) return null
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
        data-live={entry.live ? 'true' : 'false'}
        title={t('command.open')}
        onClick={() => { open() }}
      >
        {bubblePreview(entry.text)}
      </button>)}
    </div>
  </div>
}
