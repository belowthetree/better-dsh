/** Main-view Session reply observation: completed assistant messages and voice-initiated turns. */
import type {
  SessionEventLikeEntry,
  SessionEventSource,
  SessionEventWindow,
  SessionListState,
  SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'

/** Milliseconds after a finished voice capture within which a submitted user message marks its turn. */
export const VOICE_TURN_WINDOW_MS = 60_000

/**
 * The capture-phase observation this observer reads from the optional
 * `voiceCapture` service. The phase vocabulary belongs to that service.
 */
export interface CapturePhaseSource {
  /** @returns the current capture snapshot, whose phase names the recorder state. */
  snapshot(): { readonly phase: string }
  /**
   * Observe capture snapshots.
   * @param signal - observation lifetime.
   * @returns the current snapshot, then one item per change until the signal aborts.
   */
  follow(signal: AbortSignal): AsyncIterable<{ readonly phase: string }>
}

/** The Session object-layer facts reply observation reads. */
export interface ReplySessionSource {
  /** Catalog rows carrying the local reference counts that select the main-view Session. */
  readonly list: ObservableSnapshot<SessionListState>
  /**
   * Borrow an already-retained Session binding without extending its lifetime.
   * @param id - Session identity.
   * @returns the live binding, or undefined without a retained generation.
   */
  binding(id: SessionId): { readonly eventSource: SessionEventSource } | undefined
}

/** One completed assistant reply of the followed Session. */
export interface ObservedReply {
  /** Turn the reply belongs to. */
  readonly turn: number
  /** Visible assistant text with reasoning and tool calls excluded. */
  readonly text: string
  /** Whether the turn started from a voice transcript. */
  readonly voiceInitiated: boolean
}

/** Playback reactions to the followed Session. */
export interface ReplyHandlers {
  /** A turn opened, so the previous turn's playback is stale. */
  started(): void
  /**
   * An assistant message completed with visible text.
   * @param reply - completed reply with its turn and text.
   */
  completed(reply: ObservedReply): void
}

/** Reference-source label under which the conversation frame retains its Session. */
const MAIN_VIEW_SOURCE = 'mainView'

/**
 * Whether the conversation frame still retains one catalog row.
 * @param summary - catalog row carrying local reference counts by consumer label.
 * @returns whether the row has a positive main-view reference count.
 */
function mainViewRetained(summary: SessionSummary): boolean {
  const counts: Readonly<Partial<Record<string, number>>> = summary.retainedBy
  return (counts[MAIN_VIEW_SOURCE] ?? 0) > 0
}

/**
 * Session the conversation frame retains.
 * @param state - current Session list snapshot.
 * @returns the retained Session, or undefined when no row has a main-view reference.
 */
function mainViewSession(state: SessionListState): SessionId | undefined {
  for (const row of Object.values(state.byId)) {
    if (mainViewRetained(row)) return row.id
  }
  return undefined
}

/**
 * Latest turn opened in one event window, for a user message already inside a turn.
 * @param window - current event-window snapshot.
 * @returns the highest `turn/start` turn, or undefined when the window holds none.
 */
function latestTurn(window: SessionEventWindow): number | undefined {
  for (let index = window.entries.length - 1; index >= 0; index -= 1) {
    const entry = window.entries[index]
    if (entry?.type === 'event' && entry.event.type === 'turn/start') return entry.event.data.turn
  }
  return undefined
}

/**
 * Join the visible text blocks of one assistant message.
 * @param message - assistant message from an `assistant/message` event.
 * @returns the joined text without reasoning, tool calls, or surrounding whitespace.
 */
function replyText(message: SessionEvent<'assistant/message'>['data']['message']): string {
  const parts: string[] = []
  for (const block of message.content) {
    if (block.type === 'text') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/**
 * Follow the main-view Session over a borrowed binding and report the facts
 * playback needs: a newly opened turn, a completed assistant reply, and whether
 * a voice capture finished shortly before the reply's user message.
 */
export class ActiveReplyObserver {
  readonly #sessions: ReplySessionSource
  readonly #handlers: ReplyHandlers
  #active: SessionId | undefined
  #offList: (() => void) | undefined
  #offEvents: (() => void) | undefined
  #latestTurn: number | undefined
  #voiceTurn: number | undefined
  #captureAt: number | undefined

  /**
   * @param sessions - Session object-layer reads for the main-view selection and its event window.
   * @param handlers - playback reactions.
   */
  constructor(sessions: ReplySessionSource, handlers: ReplyHandlers) {
    this.#sessions = sessions
    this.#handlers = handlers
  }

  /**
   * Begin following the current main-view Session and retarget when its selection moves.
   * @returns disposer detaching both the catalog and event-window observations.
   */
  connect(): () => void {
    this.#offList = this.#sessions.list.subscribe(() => { this.#retarget() })
    this.#retarget()
    return () => {
      this.#offList?.()
      this.#offList = undefined
      this.#offEvents?.()
      this.#offEvents = undefined
      this.#active = undefined
    }
  }

  /** Record that a voice capture just finished; the next submitted user message within the window marks its turn. */
  markCapture(): void {
    this.#captureAt = Date.now()
  }

  /** Move the event-window observation to the Session the main view now retains. */
  #retarget(): void {
    const id = mainViewSession(this.#sessions.list.getSnapshot())
    if (id === this.#active) return
    this.#offEvents?.()
    this.#offEvents = undefined
    this.#latestTurn = undefined
    this.#voiceTurn = undefined
    this.#active = id
    if (id === undefined) return
    const binding = this.#sessions.binding(id)
    if (binding === undefined) return
    const source = binding.eventSource
    this.#latestTurn = latestTurn(source.getSnapshot())
    this.#offEvents = source.subscribe(() => { this.#observe(source.getSnapshot()) })
  }

  /**
   * Apply the latest window change; a replacement window is reconnection history, not a new reply.
   * @param window - current event-window snapshot.
   */
  #observe(window: SessionEventWindow): void {
    switch (window.change.kind) {
      case 'replace':
      case 'prepend':
        return
      case 'append':
        this.#accept(window.change.entries)
        return
      case 'settle-assistant':
        if (window.change.entry !== undefined) this.#accept([window.change.entry])
    }
  }

  /**
   * Report the durable events among newly visible entries.
   * @param entries - newly published window entries.
   */
  #accept(entries: readonly SessionEventLikeEntry[]): void {
    for (const entry of entries) {
      if (entry.type === 'transient') continue
      this.#acceptEvent(entry.event)
    }
  }

  /**
   * Report one durable Session event.
   * @param event - durable event appended to the followed window.
   */
  #acceptEvent(event: SessionEvent): void {
    switch (event.type) {
      case 'turn/start':
        this.#latestTurn = event.data.turn
        this.#handlers.started()
        return
      case 'user/message':
        if (event.data.source.kind === 'user') this.#acceptSubmission()
        return
      case 'assistant/message': {
        const text = replyText(event.data.message)
        if (text === '') return
        this.#handlers.completed({
          turn: event.data.turn,
          text,
          voiceInitiated: event.data.turn === this.#voiceTurn,
        })
        return
      }
      default:
        return
    }
  }

  /** Consume the voice mark when a submitted user message claims its turn. */
  #acceptSubmission(): void {
    if (this.#captureAt === undefined) return
    const capturedAt = this.#captureAt
    this.#captureAt = undefined
    if (Date.now() - capturedAt > VOICE_TURN_WINDOW_MS || this.#latestTurn === undefined) return
    this.#voiceTurn = this.#latestTurn
  }
}
