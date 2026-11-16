// @vitest-environment jsdom
/** The bubble column reports agent output and opens the workbench behind a click. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
import {
  BUBBLE_HOVER_LEAVE_MS, BUBBLE_MOTION_MS, BUBBLE_PREVIEW_CHARS, BUBBLE_PREVIEW_LINES, BUBBLE_STAGGER_MS,
  assistantText, bubbleKind, bubbleOutputs, bubblePreview, BubblesLayer, BubbleStack,
} from '../src/client/bubbles.tsx'

/** Orb presentation of the committed form profile. */
const ORB: SurfaceSnapshot = {
  form: 'orb', role: 'orb', presentation: 'orb', pinned: false, available: true, modal: null, orbHovered: false,
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

function stack(options: {
  readonly role?: SurfaceSnapshot['role']
  readonly presentation?: SurfaceSnapshot['presentation']
  readonly orbHovered?: boolean
  readonly modalOpen?: boolean
  readonly running?: boolean
  readonly chat?: ChatSnapshot
} = {}) {
  const show = vi.fn()
  const hide = vi.fn()
  const open = vi.fn()
  const pointerInside = vi.fn()
  const props = {
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
    show, hide, open, pointerInside,
    t: (key: string) => key,
  }
  return { props, show, hide, open, pointerInside }
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

describe('BubblesLayer', () => {
  function layer(options: { readonly reference?: boolean; readonly surface?: SurfaceSnapshot } = {}) {
    const renderSlot = vi.fn(() => <div data-testid="stack" />)
    const surface = options.surface ?? ORB
    const show = vi.fn()
    const hide = vi.fn()
    const props = {
      useSurface: (select: (value: SurfaceSnapshot) => unknown) => select(surface),
      useSessions: (select: (value: { readonly ids: readonly string[] }) => unknown) =>
        select({ ids: ['session-1'] }),
      useResource: () => ({ value: options.reference === false ? {} : { reference: { sessionId: 'session-1' } } }),
      SessionProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="bound">{children}</div>,
      renderSlot,
      show,
      hide,
    }
    return { props, renderSlot, show, hide }
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
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('labels the column and its bubbles for assistive technology', () => {
    const { props } = stack({ chat: chat({ answers: [{ turn: 1, response: 'answer' }] }) })
    render(createElement(BubbleStack, props as never))
    expect(screen.getByRole('log').getAttribute('aria-label')).toBe('bubbles.label')
    expect(screen.getByRole('button').getAttribute('title')).toBe('command.open')
  })
})
