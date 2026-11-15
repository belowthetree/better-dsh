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
import { useEffect, useState } from 'react'
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
 * @returns one entry per answered turn plus the streaming answer as the newest entry.
 */
export function bubbleOutputs(chat: ChatSnapshot | undefined): { entries: BubbleOutput[]; live: string } {
  if (chat === undefined) return { entries: [], live: '' }
  const entries: BubbleOutput[] = []
  for (const item of chat.navigation.items()) {
    const text = item.response.trim()
    if (text !== '') entries.push({ key: `turn-${String(item.turn)}`, text, live: false })
  }
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
  const target = props.useSessions(state => state.ids[0])
  const resource = props.useResource<'betterinteract'>(workbenchAddress(target))
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
  const { show, hide, open, t } = props
  const presentation = props.useSurface(snapshot => snapshot.presentation)
  const running = props.useSession(value => value.running)
  const chat = props.useConversation(state => state.views.get('chat'))
  const [expanded, setExpanded] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [faded, setFaded] = useState(false)
  const { entries, live } = bubbleOutputs(chat)
  const busy = running || live !== ''
  const visible = presentation === 'bubbles'

  useEffect(() => {
    if (!busy) return
    setFaded(false)
    if (!visible) show()
  }, [busy, visible, show])

  useEffect(() => {
    if (busy || entries.length === 0 || expanded) return
    const fade = setTimeout(() => { setFaded(true) }, BUBBLE_FADE_MS)
    const dismiss = setTimeout(() => { hide() }, BUBBLE_FADE_MS + BUBBLE_FADE_OUT_MS)
    return () => {
      clearTimeout(fade)
      clearTimeout(dismiss)
    }
  }, [busy, entries.length, expanded, hide])

  useEffect(() => {
    if (hovering || !expanded) return
    const collapse = setTimeout(() => { setExpanded(false) }, BUBBLE_COLLAPSE_MS)
    return () => { clearTimeout(collapse) }
  }, [hovering, expanded])

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
      onPointerEnter={() => { setHovering(true); setExpanded(true) }}
      onPointerLeave={() => { setHovering(false) }}
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
