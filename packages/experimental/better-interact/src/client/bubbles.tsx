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
import { useEffect, useRef, useState } from 'react'
import type { NS } from './locales.ts'
import { workbenchAddress } from './resource.ts'
import css from './Bubbles.module.css'

/** Quiet time after the output settles before the bubble column fades. */
export const BUBBLE_FADE_MS = 3000

/** Quiet time after the pointer leaves the column before the history collapses. */
export const BUBBLE_COLLAPSE_MS = 3000

/** Fade-out duration; the carrier returns to the orb when it ends. */
export const BUBBLE_FADE_OUT_MS = 300

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
  const presentation = props.useSurface(snapshot => snapshot.presentation)
  const target = props.useSessions(state => state.ids[0])
  const resource = props.useResource<'betterinteract'>(workbenchAddress(target))
  const { show } = props

  // While the carrier shows the orb, the window is the orb itself: the first
  // pointer activity inside it opens the column that holds the history.
  useEffect(() => {
    if (presentation !== 'orb') return
    let fired = false
    const enter = (): void => {
      if (fired) return
      fired = true
      show()
    }
    document.addEventListener('pointerenter', enter, true)
    document.addEventListener('pointermove', enter, true)
    return () => {
      document.removeEventListener('pointerenter', enter, true)
      document.removeEventListener('pointermove', enter, true)
    }
  }, [presentation, show])

  const reference = resource.value?.reference
  if (reference === undefined) return null
  const { SessionProvider, renderSlot } = props
  return <SessionProvider session={reference}>{renderSlot('better-interact.bubbles.stack', {})}</SessionProvider>
}

/**
 * Render the bubble column of one Session: the newest output while the agent
 * works, the earlier answers while the pointer rests on it.
 * @param props - bound Session state, its Chat target, and the carrier commands.
 * @returns the column while the carrier presents it, nothing otherwise.
 */
export function BubbleStack(props: BubbleStackProps) {
  const { show, hide, open, pointerInside, t } = props
  const presentation = props.useSurface(snapshot => snapshot.presentation)
  const running = props.useSession(value => value.running)
  const chat = props.useConversation(state => state.views.get('chat'))
  const [expanded, setExpanded] = useState(false)
  const [activity, setActivity] = useState(0)
  const [faded, setFaded] = useState(false)
  const wasVisible = useRef<boolean | null>(null)
  const { entries, live } = bubbleOutputs(chat)
  const busy = running || live !== ''
  const visible = presentation === 'bubbles'

  // The column starts transparent to clicks; the carrier forwards pointer moves
  // to the page, so the first move over the stack asks for clicks back.
  useEffect(() => {
    pointerInside(false)
  }, [pointerInside])

  // Every fresh column clears the previous fade: reopening it must show it again.
  useEffect(() => {
    if (!visible) return
    setFaded(false)
    pointerInside(false)
  }, [visible, pointerInside])

  useEffect(() => {
    if (!busy) return
    setFaded(false)
    if (!visible) show()
  }, [busy, visible, show])

  useEffect(() => {
    if (!expanded) return
    const collapse = setTimeout(() => { setExpanded(false) }, BUBBLE_COLLAPSE_MS)
    return () => { clearTimeout(collapse) }
  }, [expanded, activity])

  useEffect(() => {
    const entered = wasVisible.current === false && visible
    wasVisible.current = visible
    if (entered && !busy) setExpanded(true)
  }, [visible, busy])

  useEffect(() => {
    if (busy || entries.length === 0 || expanded || !visible) return
    const fade = setTimeout(() => { setFaded(true) }, BUBBLE_FADE_MS)
    const dismiss = setTimeout(() => { hide() }, BUBBLE_FADE_MS + BUBBLE_FADE_OUT_MS)
    return () => {
      clearTimeout(fade)
      clearTimeout(dismiss)
    }
  }, [busy, entries.length, expanded, visible, hide])

  const touch = (): void => {
    pointerInside(true)
    setActivity(value => value + 1)
    setExpanded(true)
  }

  if (!visible || entries.length === 0) return null
  const shown = expanded ? entries : entries.slice(-1)
  return <div
    className={css.layer}
    data-better-interact-bubbles=""
    data-faded={faded ? 'true' : 'false'}
  >
    <div
      className={css.stack}
      role="log"
      aria-label={t('bubbles.label')}
      onPointerEnter={touch}
      onPointerMove={touch}
      onPointerLeave={() => { pointerInside(false) }}
    >
      {shown.map(entry => <button
        key={entry.key}
        type="button"
        className={css.bubble}
        data-live={entry.live ? 'true' : 'false'}
        title={t('command.open')}
        onClick={() => { open() }}
      >
        {entry.text}
      </button>)}
    </div>
  </div>
}
