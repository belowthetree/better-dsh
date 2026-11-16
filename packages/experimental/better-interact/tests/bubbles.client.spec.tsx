// @vitest-environment jsdom
/** The bubble column reports agent output and opens the workbench behind a click. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
import {
  BUBBLE_MOTION_MS, BUBBLE_ORB_LEAVE_MS, BUBBLE_PREVIEW_CHARS, BUBBLE_PREVIEW_LINES, BUBBLE_STAGGER_MS,
  assistantText, bubbleOutputs, bubblePreview, BubblesLayer, BubbleStack,
} from '../src/client/bubbles.tsx'

/** Orb presentation of the committed form profile. */
const ORB: SurfaceSnapshot = { form: 'orb', role: 'orb', presentation: 'orb', pinned: false, available: true, modal: null }

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
  readonly presentation?: SurfaceSnapshot['presentation']
  readonly running?: boolean
  readonly chat?: ChatSnapshot
} = {}) {
  const show = vi.fn()
  const hide = vi.fn()
  const open = vi.fn()
  const pointerInside = vi.fn()
  const props = {
    useSurface: (select: (value: SurfaceSnapshot) => unknown) =>
      select({ ...ORB, presentation: options.presentation ?? 'bubbles' }),
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

  it('asks for the column once per pointer entry into the orb window', () => {
    const { props, show } = layer()
    render(createElement(BubblesLayer, props as never))
    fireEvent.pointerEnter(document)
    fireEvent.pointerMove(document)
    expect(show).toHaveBeenCalledOnce()
    fireEvent.pointerLeave(document)
    fireEvent.pointerEnter(document)
    expect(show).toHaveBeenCalledTimes(2)
  })

  it('dismisses the column after the pointer leaves the orb window', () => {
    const { props, hide } = layer()
    render(createElement(BubblesLayer, props as never))
    fireEvent.pointerEnter(document)
    fireEvent.pointerLeave(document)
    act(() => { vi.advanceTimersByTime(BUBBLE_ORB_LEAVE_MS - 1) })
    expect(hide).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(hide).toHaveBeenCalledOnce()
  })

  it('cancels the orb-leave dismissal when the pointer comes back', () => {
    const { props, hide } = layer()
    render(createElement(BubblesLayer, props as never))
    fireEvent.pointerEnter(document)
    fireEvent.pointerLeave(document)
    act(() => { vi.advanceTimersByTime(BUBBLE_ORB_LEAVE_MS - 100) })
    fireEvent.pointerEnter(document)
    act(() => { vi.advanceTimersByTime(BUBBLE_ORB_LEAVE_MS * 2) })
    expect(hide).not.toHaveBeenCalled()
  })

  it('does not ask for the column before a Session is bound', () => {
    const { props, show } = layer({ reference: false })
    render(createElement(BubblesLayer, props as never))
    fireEvent.pointerEnter(document)
    expect(show).not.toHaveBeenCalled()
  })

  it('ignores pointer activity reported by the surface window', () => {
    const { props, show } = layer({ surface: { ...ORB, role: 'surface', presentation: 'bubbles' } })
    render(createElement(BubblesLayer, props as never))
    fireEvent.pointerEnter(document)
    fireEvent.pointerMove(document)
    expect(show).not.toHaveBeenCalled()
  })
})

describe('BubbleStack', () => {
  /** Rendered bubble labels, oldest first. */
  const labels = (): (string | null)[] => screen.queryAllByRole('button').map(button => button.textContent)

  /** Per-bubble entry or exit delays, oldest first. */
  const delays = (): string[] => screen.queryAllByRole('button').map(button => button.style.animationDelay)

  it('renders nothing while the carrier presents another presentation', () => {
    const { props } = stack({ presentation: 'panel', running: true, chat: chat({
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
    const { props } = stack({ chat: chat({
      answers: [{ turn: 1, response: 'older answer' }, { turn: 2, response: 'newest answer' }],
    }) })
    render(createElement(BubbleStack, props as never))
    expect(labels()).toEqual(['newest answer'])
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

  it('asks for the column while the agent streams output', () => {
    const { props, show } = stack({ presentation: 'orb', running: true, chat: chat({
      partial: [{ kind: 'text', text: 'working' }],
    }) })
    render(createElement(BubbleStack, props as never))
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('stays quiet while no output is in progress', () => {
    const { props, show } = stack({ presentation: 'orb' })
    render(createElement(BubbleStack, props as never))
    expect(show).not.toHaveBeenCalled()
  })

  it('expands the history on hover and leaves in sequence after the pointer leaves', () => {
    const { props, hide } = stack({ chat: chat({
      answers: [{ turn: 1, response: 'older answer' }, { turn: 2, response: 'newest answer' }],
    }) })
    render(createElement(BubbleStack, props as never))
    const log = screen.getByRole('log')
    fireEvent.pointerOver(log)
    expect(labels()).toEqual(['older answer', 'newest answer'])
    fireEvent.pointerOut(log)
    expect(column()?.dataset.exiting).toBe('true')
    expect(delays()).toEqual([`${String(BUBBLE_STAGGER_MS)}ms`, '0ms'])
    expect(hide).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(BUBBLE_STAGGER_MS + BUBBLE_MOTION_MS) })
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('cancels a running exit when the pointer comes back', () => {
    const { props, hide } = stack({ chat: chat({
      answers: [{ turn: 1, response: 'older answer' }, { turn: 2, response: 'newest answer' }],
    }) })
    render(createElement(BubbleStack, props as never))
    const log = screen.getByRole('log')
    fireEvent.pointerOver(log)
    fireEvent.pointerOut(log)
    act(() => { vi.advanceTimersByTime(BUBBLE_STAGGER_MS) })
    expect(column()?.dataset.exiting).toBe('true')
    fireEvent.pointerOver(log)
    expect(column()?.dataset.exiting).toBe('false')
    act(() => { vi.advanceTimersByTime(2 * (BUBBLE_STAGGER_MS + BUBBLE_MOTION_MS)) })
    expect(hide).not.toHaveBeenCalled()
    expect(labels()).toEqual(['older answer', 'newest answer'])
  })

  it('stays on screen until a pointer that entered it leaves', () => {
    const { props, hide } = stack({ chat: chat({ answers: [{ turn: 1, response: 'answer' }] }) })
    render(createElement(BubbleStack, props as never))
    expect(column()?.dataset.exiting).toBe('false')
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(column()?.dataset.exiting).toBe('false')
    expect(hide).not.toHaveBeenCalled()
    fireEvent.pointerOver(screen.getByRole('log'))
    fireEvent.pointerOut(screen.getByRole('log'))
    expect(column()?.dataset.exiting).toBe('true')
    act(() => { vi.advanceTimersByTime(BUBBLE_MOTION_MS) })
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('stays while hovered over settled output until the pointer leaves', () => {
    const answers = [{ turn: 1, response: 'answer' }]
    const running = stack({ running: true, chat: chat({ answers }) })
    const view = render(createElement(BubbleStack, running.props as never))
    fireEvent.pointerOver(screen.getByRole('log'))
    const settled = stack({ running: false, chat: chat({ answers }) })
    view.rerender(createElement(BubbleStack, settled.props as never))
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(settled.hide).not.toHaveBeenCalled()
    fireEvent.pointerOut(screen.getByRole('log'))
    act(() => { vi.advanceTimersByTime(BUBBLE_MOTION_MS) })
    expect(settled.hide).toHaveBeenCalledTimes(1)
  })

  it('cancels the exit when new output starts streaming', () => {
    const { props, hide } = stack({ chat: chat({ answers: [{ turn: 1, response: 'answer' }] }) })
    const view = render(createElement(BubbleStack, props as never))
    fireEvent.pointerOver(screen.getByRole('log'))
    fireEvent.pointerOut(screen.getByRole('log'))
    expect(column()?.dataset.exiting).toBe('true')
    const resumed = stack({
      running: true,
      chat: chat({ answers: [{ turn: 1, response: 'answer' }], partial: [{ kind: 'text', text: 'more' }] }),
    })
    view.rerender(createElement(BubbleStack, resumed.props as never))
    expect(column()?.dataset.exiting).toBe('false')
    act(() => { vi.advanceTimersByTime(BUBBLE_MOTION_MS * 2) })
    expect(hide).not.toHaveBeenCalled()
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
