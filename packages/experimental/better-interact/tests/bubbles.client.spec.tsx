// @vitest-environment jsdom
/** The bubble column reports agent output and opens the workbench behind a click. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  BUBBLE_HOVER_LEAVE_MS, BUBBLE_MOTION_MS, BUBBLE_PREVIEW_CHARS, BUBBLE_PREVIEW_LINES, BUBBLE_STAGGER_MS,
  assistantText, bubbleKind, bubbleOutputs, bubblePreview, BubblesLayer, BubbleStack, selectBubbleTarget,
} from '../src/client/bubbles.tsx'
import { parseWorkbenchAddress, workbenchAddress } from '../src/client/resource.ts'
import type { ReminderInteraction } from '../src/client/reminders.ts'

/** Orb presentation of the committed form profile. */
const ORB: SurfaceSnapshot = {
  form: 'orb', role: 'orb', presentation: 'orb', pinned: false, available: true, modal: null, orbDocked: false, orbHovered: false,
  modalOpen: false,
}

function chat(input: {
  readonly answers?: readonly { readonly turn: number; readonly response: string }[]
  readonly partial?: readonly AssistantBlock[]
  readonly turnsOnly?: boolean
} = {}): ChatSnapshot {
  const nodes = (input.answers ?? []).map(answer => ({
    kind: 'assistant',
    seq: answer.turn,
    turn: 1,
    step: 1,
    blocks: [{ kind: 'text', text: answer.response }],
  }))
  return {
    legacy: {
      nodes: input.turnsOnly === true ? [] : nodes,
      partial: input.partial === undefined ? null : { turn: 1, step: 1, blocks: input.partial },
    },
    navigation: {
      items: () => (input.answers ?? []).map(answer => ({ turn: answer.turn, anchorKey: 'a', prompt: '', response: answer.response })),
    },
  } as never
}

function sessionCatalog(
  ...rows: readonly { readonly id: string; readonly updatedAt?: number; readonly running?: boolean }[]
): SessionListState {
  return {
    ids: rows.map(row => row.id as SessionId),
    byId: Object.fromEntries(rows.map(row => [row.id, {
      id: row.id as SessionId,
      displayTitle: row.id,
      running: row.running === true,
      retainedBy: {},
      blank: false,
      updatedAt: row.updatedAt ?? 0,
    }])),
    phase: 'ready',
    projectionsBySession: {},
  }
}

function stack(options: {
  readonly role?: SurfaceSnapshot['role']
  readonly presentation?: SurfaceSnapshot['presentation']
  readonly orbHovered?: boolean
  readonly modalOpen?: boolean
  readonly running?: boolean
  readonly chat?: ChatSnapshot
  readonly pending?: ReadonlyMap<SessionId, ReminderInteraction>
  readonly summaries?: Readonly<Record<string, { readonly title?: string; readonly displayTitle?: string }>>
} = {}) {
  const show = vi.fn()
  const hide = vi.fn()
  const open = vi.fn()
  const pointerInside = vi.fn()
  const state = { pending: options.pending ?? new Map<SessionId, ReminderInteraction>() }
  const byId = Object.fromEntries(Object.entries(options.summaries ?? {}).map(([id, summary]) => [id, { id, ...summary }]))
  const props = {
    sessionId: 'session-1' as SessionId,
    useSurface: (select: (value: SurfaceSnapshot) => unknown) => select({
      ...ORB,
      role: options.role ?? 'bubbles',
      presentation: options.presentation ?? 'bubbles',
      orbHovered: options.orbHovered ?? true,
      modalOpen: options.modalOpen ?? false,
    }),
    useSession: (select: (value: { readonly running: boolean }) => unknown) => select({ running: options.running === true }),
    useConversation: (select: (value: { readonly views: { get: () => ChatSnapshot | undefined } }) => unknown) =>
      select({ views: { get: () => options.chat } }),
    usePending: (select: (value: ReadonlyMap<SessionId, ReminderInteraction>) => unknown) => select(state.pending),
    useSessions: (select: (value: { readonly byId: object }) => unknown) => select({ byId }),
    show, hide, open, pointerInside,
    t: (key: string, params?: Record<string, unknown>) =>
      params === undefined ? key : `${key}|${Object.values(params).join('|')}`,
  }
  /** Replace the pending map before the caller rerenders. */
  const setPending = (next: ReadonlyMap<SessionId, ReminderInteraction>): void => { state.pending = next }
  return { props, show, hide, open, pointerInside, setPending }
}

function column(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-better-interact-bubbles]')
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('assistantText', () => {
  it('joins the visible text blocks and drops reasoning and tool calls', () => {
    expect(assistantText([
      { kind: 'reasoning', text: '思考' },
      { kind: 'text', text: ' 第一段' },
      { kind: 'tool-call', callId: 'call-1', name: 'read', argsRaw: '{}' },
      { kind: 'text', text: '，第二段 ' },
    ])).toBe('第一段，第二段')
  })

  it('returns nothing for a publication without text', () => {
    expect(assistantText([{ kind: 'reasoning', text: 'only thinking' }])).toBe('')
  })
})

describe('bubbleKind', () => {
  it('classifies the live partial as streaming and completed answers as history', () => {
    expect(bubbleKind({ key: 'live', text: 'writing', live: true })).toBe('streaming')
    expect(bubbleKind({ key: 'message-1', text: 'done', live: false })).toBe('history')
  })
})

describe('bubblePreview', () => {
  it('keeps text inside the line and character budget unchanged', () => {
    expect(bubblePreview('short answer')).toBe('short answer')
  })

  it('omits lines past the preview budget with an ellipsis', () => {
    const text = Array.from({ length: BUBBLE_PREVIEW_LINES + 2 }, (_, index) => `line ${String(index)}`).join('\n')
    const preview = bubblePreview(text)
    expect(preview.endsWith('…')).toBe(true)
    expect(preview.split('\n')).toHaveLength(BUBBLE_PREVIEW_LINES)
    expect(preview).not.toContain('line 8')
  })

  it('omits a wrapped paragraph past the character budget with an ellipsis', () => {
    const preview = bubblePreview('x'.repeat(BUBBLE_PREVIEW_CHARS + 10))
    expect(preview).toBe(`${'x'.repeat(BUBBLE_PREVIEW_CHARS)}…`)
  })
})

describe('bubbleOutputs', () => {
  it('reports nothing before the Chat target publishes', () => {
    expect(bubbleOutputs(undefined)).toEqual({ entries: [], live: '' })
  })

  it('lists the answered messages in log order with their durable message identity', () => {
    const { entries, live } = bubbleOutputs(chat({
      answers: [{ turn: 2, response: 'first answer' }, { turn: 4, response: '  second answer  ' }],
    }))
    expect(entries).toEqual([
      { key: 'message-2', text: 'first answer', live: false },
      { key: 'message-4', text: 'second answer', live: false },
    ])
    expect(live).toBe('')
  })

  it('falls back to the turn previews until the transcript assembles nodes', () => {
    const { entries } = bubbleOutputs(chat({ answers: [{ turn: 2, response: 'turn preview' }], turnsOnly: true }))
    expect(entries).toEqual([{ key: 'message-2', text: 'turn preview', live: false }])
  })

  it('yields no entry for a turn preview that carries no answer yet', () => {
    expect(bubbleOutputs(chat({ answers: [{ turn: 3, response: '' }] })).entries).toEqual([])
  })

  it('appends the streaming answer as the newest entry', () => {
    const { entries, live } = bubbleOutputs(chat({
      answers: [{ turn: 1, response: 'settled answer' }],
      partial: [{ kind: 'text', text: 'still writing' }],
    }))
    expect(entries.at(-1)).toEqual({ key: 'live', text: 'still writing', live: true })
    expect(live).toBe('still writing')
  })
})

describe('selectBubbleTarget', () => {
  it('reports the latest output rather than the first catalog row', () => {
    const catalog = sessionCatalog(
      { id: 'first', updatedAt: 1 },
      { id: 'answer', updatedAt: 9 },
      { id: 'older', updatedAt: 4 },
    )
    expect(selectBubbleTarget(catalog, undefined)).toBe('answer')
  })

  it('prioritizes running activity over a newer settled answer', () => {
    const catalog = sessionCatalog(
      { id: 'settled', updatedAt: 20 },
      { id: 'running', updatedAt: 5, running: true },
    )
    expect(selectBubbleTarget(catalog, undefined)).toBe('running')
  })

  it('holds the running target through newer activity and catalog reordering', () => {
    const catalog = sessionCatalog(
      { id: 'other', updatedAt: 30, running: true },
      { id: 'current', updatedAt: 2, running: true },
    )
    expect(selectBubbleTarget(catalog, 'current' as SessionId)).toBe('current')
  })

  it('keeps the current target on equal activity and handles an empty catalog', () => {
    const catalog = sessionCatalog({ id: 'other', updatedAt: 2 }, { id: 'current', updatedAt: 2 })
    expect(selectBubbleTarget(catalog, 'current' as SessionId)).toBe('current')
    expect(selectBubbleTarget(catalog, 'other' as SessionId)).toBe('other')
    expect(selectBubbleTarget(sessionCatalog(), undefined)).toBeUndefined()
  })

  it('ignores a stale current target and catalog rows whose summaries have not arrived', () => {
    const base = sessionCatalog({ id: 'available', updatedAt: 2 })
    const catalog = { ...base, ids: [...base.ids, 'missing' as SessionId] }
    expect(selectBubbleTarget(catalog, 'removed' as SessionId)).toBe('available')
  })
})

describe('BubblesLayer', () => {
  function layer(options: {
    readonly reference?: boolean
    readonly surface?: SurfaceSnapshot
    readonly catalog?: SessionListState
  } = {}) {
    const renderSlot = vi.fn(() => <div data-testid="stack" />)
    const surface = options.surface ?? ORB
    const catalog = options.catalog ?? sessionCatalog({ id: 'session-1' })
    const show = vi.fn()
    const hide = vi.fn()
    const useResource = vi.fn((address: string) => ({
      value: options.reference === false ? {} : { reference: { sessionId: parseWorkbenchAddress(address) } },
    }))
    const props = {
      useSurface: (select: (value: SurfaceSnapshot) => unknown) => select(surface),
      useSessions: (select: (value: SessionListState) => unknown) => select(catalog),
      useResource,
      SessionProvider: ({ children, session }: { children: React.ReactNode; session: { sessionId: SessionId } }) =>
        <div data-testid="bound" data-session={session.sessionId}>{children}</div>,
      renderSlot,
      show,
      hide,
    }
    return { props, renderSlot, show, hide, useResource }
  }

  it('renders nothing while the catalog retains no Session', () => {
    const { props, renderSlot } = layer({ reference: false })
    render(createElement(BubblesLayer, props as never))
    expect(screen.queryByTestId('stack')).toBeNull()
    expect(renderSlot).not.toHaveBeenCalled()
  })

  it('renders the bubble stack inside the bound Session', () => {
    const { props, renderSlot } = layer()
    render(createElement(BubblesLayer, props as never))
    expect(screen.getByTestId('bound')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledWith('better-interact.bubbles.stack', {})
  })

  it('binds the active Session instead of the first catalog row', () => {
    const { props, useResource } = layer({
      catalog: sessionCatalog({ id: 'first', updatedAt: 1 }, { id: 'active', updatedAt: 8, running: true }),
    })
    render(createElement(BubblesLayer, props as never))
    expect(useResource).toHaveBeenLastCalledWith(workbenchAddress('active' as SessionId))
    expect(screen.getByTestId('bound').getAttribute('data-session')).toBe('active')
  })

  it('keeps the streaming target until it settles, then follows newer activity', () => {
    const initial = layer({
      catalog: sessionCatalog(
        { id: 'current', updatedAt: 2, running: true },
        { id: 'other', updatedAt: 1 },
      ),
    })
    const view = render(createElement(BubblesLayer, initial.props as never))
    expect(initial.useResource).toHaveBeenLastCalledWith(workbenchAddress('current' as SessionId))

    const streaming = layer({
      catalog: sessionCatalog(
        { id: 'other', updatedAt: 10, running: true },
        { id: 'current', updatedAt: 2, running: true },
      ),
    })
    view.rerender(createElement(BubblesLayer, streaming.props as never))
    expect(streaming.useResource).toHaveBeenLastCalledWith(workbenchAddress('current' as SessionId))

    const settled = layer({
      catalog: sessionCatalog(
        { id: 'other', updatedAt: 10, running: true },
        { id: 'current', updatedAt: 2 },
      ),
    })
    view.rerender(createElement(BubblesLayer, settled.props as never))
    expect(settled.useResource).toHaveBeenLastCalledWith(workbenchAddress('other' as SessionId))
  })

  it('asks for the column when the carrier reports the orb hover', () => {
    const { props, show } = layer({ surface: { ...ORB, orbHovered: true } })
    render(createElement(BubblesLayer, props as never))
    expect(show).toHaveBeenCalledOnce()
  })

  it('does not ask for the column before the pointer enters the orb', () => {
    const { props, show } = layer({ surface: { ...ORB, orbHovered: false } })
    render(createElement(BubblesLayer, props as never))
    expect(show).not.toHaveBeenCalled()
  })

  it('does not ask for the column before a Session is bound', () => {
    const { props, show } = layer({ reference: false, surface: { ...ORB, orbHovered: true } })
    render(createElement(BubblesLayer, props as never))
    expect(show).not.toHaveBeenCalled()
  })

  it('renders no column in the surface window', () => {
    const { props, renderSlot } = layer({
      surface: { ...ORB, role: 'surface', presentation: 'panel' },
    })
    render(createElement(BubblesLayer, props as never))
    expect(renderSlot).not.toHaveBeenCalled()
    expect(screen.queryByTestId('stack')).toBeNull()
  })

  it('mounts the column window stack only while the carrier presents the column', () => {
    const hidden = layer({ surface: { ...ORB, role: 'bubbles', presentation: 'orb' } })
    const view = render(createElement(BubblesLayer, hidden.props as never))
    expect(hidden.renderSlot).not.toHaveBeenCalled()
    expect(screen.queryByTestId('stack')).toBeNull()
    const shown = layer({ surface: { ...ORB, role: 'bubbles', presentation: 'bubbles' } })
    view.rerender(createElement(BubblesLayer, shown.props as never))
    expect(shown.renderSlot).toHaveBeenCalledWith('better-interact.bubbles.stack', {})
    expect(screen.getByTestId('stack')).toBeTruthy()
  })

  it('ignores the orb hover in the column window', () => {
    const { props, show } = layer({
      surface: { ...ORB, role: 'bubbles', presentation: 'bubbles', orbHovered: true },
    })
    render(createElement(BubblesLayer, props as never))
    expect(show).not.toHaveBeenCalled()
  })
})

describe('BubbleStack', () => {
  /** Rendered bubble labels, oldest first. */
  const labels = (): (string | null)[] => screen.queryAllByRole('button').map(button => button.textContent)

  /** Per-bubble entry or exit delays, oldest first. */
  const delays = (): string[] => screen.queryAllByRole('button').map(button => button.style.animationDelay)

  it('renders nothing while the carrier presents another presentation', () => {
    const { props } = stack({ presentation: 'panel', chat: chat({
      answers: [{ turn: 1, response: 'answer' }],
    }) })
    render(createElement(BubbleStack, props as never))
    expect(column()).toBeNull()
  })

  it('expands the history when the column opens over the orb', () => {
    const answers = [{ turn: 1, response: 'older answer' }, { turn: 2, response: 'newest answer' }]
    const collapsed = stack({ presentation: 'orb', chat: chat({ answers }) })
    const view = render(createElement(BubbleStack, collapsed.props as never))
    expect(column()).toBeNull()
    const opened = stack({ presentation: 'bubbles', chat: chat({ answers }) })
    view.rerender(createElement(BubbleStack, opened.props as never))
    expect(labels()).toEqual(['older answer', 'newest answer'])
  })

  it('renders only the newest output while collapsed', () => {
    const { props } = stack({
      orbHovered: false,
      chat: chat({
        answers: [{ turn: 1, response: 'older answer' }, { turn: 2, response: 'newest answer' }],
      }),
    })
    render(createElement(BubbleStack, props as never))
    expect(labels()).toEqual(['newest answer'])
  })

  it('asks for the column when output starts streaming', () => {
    const { props, show } = stack({
      presentation: 'orb',
      orbHovered: false,
      running: true,
      chat: chat({ partial: [{ kind: 'text', text: 'working' }] }),
    })
    render(createElement(BubbleStack, props as never))
    expect(show).toHaveBeenCalledOnce()
  })

  it('does not raise the column for a run that has produced no answer yet', () => {
    const { props, show } = stack({ presentation: 'orb', running: true, chat: chat({}) })
    render(createElement(BubbleStack, props as never))
    expect(show).not.toHaveBeenCalled()
  })

  it('marks the live answer as streaming and the completed answers as history', () => {
    const { props } = stack({
      orbHovered: true,
      running: true,
      chat: chat({
        answers: [{ turn: 1, response: 'older answer' }],
        partial: [{ kind: 'text', text: 'still writing' }],
      }),
    })
    render(createElement(BubbleStack, props as never))
    expect(screen.getAllByRole('button').map(button => button.dataset.kind)).toEqual(['history', 'streaming'])
  })

  it('keeps the streaming bubble while the agent runs regardless of hover', () => {
    const { props, hide } = stack({
      orbHovered: false,
      running: true,
      chat: chat({ partial: [{ kind: 'text', text: 'working' }] }),
    })
    const view = render(createElement(BubbleStack, props as never))
    expect(labels()).toEqual(['working'])
    expect(screen.getByRole('button').dataset.kind).toBe('streaming')
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(column()?.dataset.exiting).toBe('false')
    expect(hide).not.toHaveBeenCalled()
    const settled = stack({
      orbHovered: false,
      running: false,
      chat: chat({ answers: [{ turn: 1, response: 'working' }] }),
    })
    view.rerender(createElement(BubbleStack, settled.props as never))
    expect(labels()).toEqual(['working'])
    expect(screen.getByRole('button').dataset.kind).toBe('history')
    act(() => { vi.advanceTimersByTime(BUBBLE_HOVER_LEAVE_MS - 1) })
    expect(settled.hide).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(column()?.dataset.exiting).toBe('true')
    act(() => { vi.advanceTimersByTime(BUBBLE_MOTION_MS) })
    expect(settled.hide).toHaveBeenCalledTimes(1)
  })

  it('enters the history in sequence from the newest answer outward', () => {
    const answers = [
      { turn: 1, response: 'oldest answer' },
      { turn: 2, response: 'middle answer' },
      { turn: 3, response: 'newest answer' },
    ]
    const { props } = stack({ chat: chat({ answers }) })
    render(createElement(BubbleStack, props as never))
    fireEvent.pointerOver(screen.getByRole('log'))
    expect(labels()).toEqual(['oldest answer', 'middle answer', 'newest answer'])
    expect(delays()).toEqual([
      `${String(2 * BUBBLE_STAGGER_MS)}ms`,
      `${String(BUBBLE_STAGGER_MS)}ms`,
      '0ms',
    ])
  })

  it('keeps the column while the orb is hovered', () => {
    const { props, hide } = stack({ chat: chat({ answers: [{ turn: 1, response: 'answer' }] }) })
    render(createElement(BubbleStack, props as never))
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(column()?.dataset.exiting).toBe('false')
    expect(hide).not.toHaveBeenCalled()
  })

  it('leaves half a second after the pointer leaves the orb', () => {
    const answers = [{ turn: 1, response: 'answer' }]
    const onOrb = stack({ chat: chat({ answers }), orbHovered: true })
    const view = render(createElement(BubbleStack, onOrb.props as never))
    const away = stack({ chat: chat({ answers }), orbHovered: false })
    view.rerender(createElement(BubbleStack, away.props as never))
    act(() => { vi.advanceTimersByTime(BUBBLE_HOVER_LEAVE_MS - 1) })
    expect(column()?.dataset.exiting).toBe('false')
    act(() => { vi.advanceTimersByTime(1) })
    expect(column()?.dataset.exiting).toBe('true')
    act(() => { vi.advanceTimersByTime(BUBBLE_MOTION_MS) })
    expect(away.hide).toHaveBeenCalledTimes(1)
  })

  it('keeps the column while the pointer is on it without orb hover', () => {
    const { props, hide } = stack({
      chat: chat({ answers: [{ turn: 1, response: 'answer' }] }),
      orbHovered: false,
    })
    render(createElement(BubbleStack, props as never))
    fireEvent.pointerOver(screen.getByRole('log'))
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(column()?.dataset.exiting).toBe('false')
    expect(hide).not.toHaveBeenCalled()
    fireEvent.pointerOut(screen.getByRole('log'))
    act(() => { vi.advanceTimersByTime(BUBBLE_HOVER_LEAVE_MS) })
    expect(column()?.dataset.exiting).toBe('true')
  })

  it('cancels the pending leave when the pointer returns to the orb', () => {
    const answers = [{ turn: 1, response: 'answer' }]
    const away = stack({ chat: chat({ answers }), orbHovered: false })
    const view = render(createElement(BubbleStack, away.props as never))
    act(() => { vi.advanceTimersByTime(BUBBLE_HOVER_LEAVE_MS - 100) })
    const back = stack({ chat: chat({ answers }), orbHovered: true })
    view.rerender(createElement(BubbleStack, back.props as never))
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(column()?.dataset.exiting).toBe('false')
    expect(back.hide).not.toHaveBeenCalled()
  })

  it('cancels a running exit when the pointer returns to the column', () => {
    const { props, hide } = stack({
      chat: chat({ answers: [{ turn: 1, response: 'answer' }] }),
      orbHovered: false,
    })
    render(createElement(BubbleStack, props as never))
    act(() => { vi.advanceTimersByTime(BUBBLE_HOVER_LEAVE_MS) })
    expect(column()?.dataset.exiting).toBe('true')
    fireEvent.pointerOver(screen.getByRole('log'))
    expect(column()?.dataset.exiting).toBe('false')
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(hide).not.toHaveBeenCalled()
  })

  it('expands the history on hover and leaves in sequence after the pointer leaves both', () => {
    const { props, hide } = stack({
      chat: chat({ answers: [{ turn: 1, response: 'older answer' }, { turn: 2, response: 'newest answer' }] }),
      orbHovered: false,
    })
    render(createElement(BubbleStack, props as never))
    const log = screen.getByRole('log')
    fireEvent.pointerOver(log)
    expect(labels()).toEqual(['older answer', 'newest answer'])
    fireEvent.pointerOut(log)
    act(() => { vi.advanceTimersByTime(BUBBLE_HOVER_LEAVE_MS) })
    expect(column()?.dataset.exiting).toBe('true')
    expect(delays()).toEqual([`${String(BUBBLE_STAGGER_MS)}ms`, '0ms'])
    expect(hide).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(BUBBLE_STAGGER_MS + BUBBLE_MOTION_MS) })
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('reports pointer presence so the carrier can pass clicks through', () => {
    const { props, pointerInside } = stack({ chat: chat({ answers: [{ turn: 1, response: 'answer' }] }) })
    render(createElement(BubbleStack, props as never))
    expect(pointerInside).toHaveBeenCalledWith(false)
    const log = screen.getByRole('log')
    fireEvent.pointerOver(log)
    expect(pointerInside).toHaveBeenLastCalledWith(true)
    fireEvent.pointerOut(log)
    expect(pointerInside).toHaveBeenLastCalledWith(false)
  })

  it('keeps the orb and surface renderers out of the column pointer reporting', () => {
    for (const role of ['orb', 'surface'] as const) {
      const { props, pointerInside } = stack({
        role,
        presentation: 'orb',
        chat: chat({ answers: [{ turn: 1, response: 'answer' }] }),
      })
      const view = render(createElement(BubbleStack, props as never))
      expect(column()).toBeNull()
      expect(pointerInside).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it('holds the column while the workbench modal is open', () => {
    const { props, hide } = stack({
      modalOpen: true,
      orbHovered: false,
      chat: chat({ answers: [{ turn: 1, response: 'answer' }] }),
    })
    render(createElement(BubbleStack, props as never))
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(column()?.dataset.exiting).toBe('false')
    expect(hide).not.toHaveBeenCalled()
  })

  it('cancels a pending leave when the workbench opens', () => {
    const answers = [{ turn: 1, response: 'answer' }]
    const away = stack({ orbHovered: false, chat: chat({ answers }) })
    const view = render(createElement(BubbleStack, away.props as never))
    act(() => { vi.advanceTimersByTime(BUBBLE_HOVER_LEAVE_MS - 100) })
    const workbench = stack({ orbHovered: false, modalOpen: true, chat: chat({ answers }) })
    view.rerender(createElement(BubbleStack, workbench.props as never))
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(column()?.dataset.exiting).toBe('false')
    expect(workbench.hide).not.toHaveBeenCalled()
  })

  it('leaves half a second after the workbench closes', () => {
    const answers = [{ turn: 1, response: 'answer' }]
    const workbench = stack({ orbHovered: false, modalOpen: true, chat: chat({ answers }) })
    const view = render(createElement(BubbleStack, workbench.props as never))
    const closed = stack({ orbHovered: false, chat: chat({ answers }) })
    view.rerender(createElement(BubbleStack, closed.props as never))
    act(() => { vi.advanceTimersByTime(BUBBLE_HOVER_LEAVE_MS - 1) })
    expect(column()?.dataset.exiting).toBe('false')
    act(() => { vi.advanceTimersByTime(1) })
    expect(column()?.dataset.exiting).toBe('true')
    act(() => { vi.advanceTimersByTime(BUBBLE_MOTION_MS) })
    expect(closed.hide).toHaveBeenCalledTimes(1)
  })

  it('dismisses an empty column half a second after the pointer leaves', () => {
    const { props, hide } = stack({ orbHovered: false, chat: chat({}) })
    render(createElement(BubbleStack, props as never))
    expect(column()).toBeNull()
    act(() => { vi.advanceTimersByTime(BUBBLE_HOVER_LEAVE_MS) })
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('keeps an empty column while the orb is hovered', () => {
    const { props, hide } = stack({ orbHovered: true, chat: chat({}) })
    render(createElement(BubbleStack, props as never))
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(hide).not.toHaveBeenCalled()
  })

  it('opens the workbench from a bubble click', () => {
    const { props, open } = stack({ chat: chat({ answers: [{ turn: 1, response: 'answer' }] }) })
    render(createElement(BubbleStack, props as never))
    fireEvent.click(screen.getByRole('button'))
    expect(open).toHaveBeenCalledExactlyOnceWith('session-1')
  })

  it('labels the column and its bubbles for assistive technology', () => {
    const { props } = stack({ chat: chat({ answers: [{ turn: 1, response: 'answer' }] }) })
    render(createElement(BubbleStack, props as never))
    expect(screen.getByRole('log').getAttribute('aria-label')).toBe('bubbles.label')
    expect(screen.getByRole('button').getAttribute('title')).toBe('command.open')
  })

  it('speaks a pending approval as a speech balloon and opens its Session', () => {
    const approval: ReminderInteraction = {
      key: 'approval:1', kind: 'approval', sessionId: 'session-2' as SessionId, toolName: 'bash',
    }
    const { props, open } = stack({
      pending: new Map([[approval.sessionId, approval]]),
      summaries: { 'session-2': { title: 'Alpha' } },
    })
    render(createElement(BubbleStack, props as never))
    const balloon = document.querySelector<HTMLElement>('[data-better-interact-reminder]')
    expect(balloon).not.toBeNull()
    expect(balloon?.textContent).toBe('reminder.approval|Alpha|bash')
    expect(balloon?.getAttribute('title')).toBe('reminder.open')
    fireEvent.click(balloon!)
    expect(open).toHaveBeenCalledExactlyOnceWith('session-2')
  })

  it('falls back to the display title, then the Session id', () => {
    const approval: ReminderInteraction = {
      key: 'approval:1', kind: 'approval', sessionId: 'session-2' as SessionId, toolName: 'bash',
    }
    const pending = new Map([[approval.sessionId, approval]])
    const titled = stack({ pending, summaries: { 'session-2': { title: '  ', displayTitle: 'Beta' } } })
    const view = render(createElement(BubbleStack, titled.props as never))
    expect(document.querySelector('[data-better-interact-reminder]')?.textContent)
      .toBe('reminder.approval|Beta|bash')
    view.unmount()
    const anonymous = stack({ pending })
    render(createElement(BubbleStack, anonymous.props as never))
    expect(document.querySelector('[data-better-interact-reminder]')?.textContent)
      .toBe('reminder.approval|session-2|bash')
  })

  it('speaks a pending question with its text and counts the other requests', () => {
    const question: ReminderInteraction = {
      key: 'question:1', kind: 'question', sessionId: 'session-2' as SessionId, questions: [{ question: 'Continue?' }],
    }
    const other: ReminderInteraction = { key: 'question:2', kind: 'question', sessionId: 'session-3' as SessionId }
    const { props } = stack({
      pending: new Map([[question.sessionId, question], [other.sessionId, other]]),
      summaries: { 'session-2': { title: 'Alpha' } },
    })
    render(createElement(BubbleStack, props as never))
    expect(document.querySelector('[data-better-interact-reminder]')?.textContent)
      .toBe('reminder.question|Alpha|Continue?reminder.more|1')
  })

  it('raises the column on its own while a request waits', () => {
    const approval: ReminderInteraction = {
      key: 'approval:1', kind: 'approval', sessionId: 'session-2' as SessionId, toolName: 'bash',
    }
    const { props, show } = stack({
      pending: new Map([[approval.sessionId, approval]]), presentation: 'orb', orbHovered: false,
    })
    render(createElement(BubbleStack, props as never))
    expect(show).toHaveBeenCalledOnce()
  })

  it('holds the column while the request waits and releases it after it settles', () => {
    const approval: ReminderInteraction = {
      key: 'approval:1', kind: 'approval', sessionId: 'session-2' as SessionId, toolName: 'bash',
    }
    const { props, hide, setPending } = stack({
      pending: new Map([[approval.sessionId, approval]]), orbHovered: false,
    })
    const view = render(createElement(BubbleStack, props as never))
    act(() => { vi.advanceTimersByTime(BUBBLE_HOVER_LEAVE_MS + BUBBLE_STAGGER_MS + BUBBLE_MOTION_MS) })
    expect(hide).not.toHaveBeenCalled()
    act(() => { setPending(new Map()) })
    view.rerender(createElement(BubbleStack, props as never))
    act(() => { vi.advanceTimersByTime(BUBBLE_HOVER_LEAVE_MS + BUBBLE_MOTION_MS) })
    expect(hide).toHaveBeenCalledOnce()
  })
})
