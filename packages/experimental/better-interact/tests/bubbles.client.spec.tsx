// @vitest-environment jsdom
/** The bubble column reports agent output and opens the workbench behind a click. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SurfaceSnapshot } from '@deepseek-ai/dsh-client-surface/client'
import {
  BUBBLE_COLLAPSE_MS, BUBBLE_FADE_MS, BUBBLE_FADE_OUT_MS, assistantText, bubbleOutputs, BubblesLayer, BubbleStack,
} from '../src/client/bubbles.tsx'

/** Orb presentation of the committed form profile. */
const ORB: SurfaceSnapshot = { form: 'orb', presentation: 'orb', pinned: false, available: true, modal: null }

function chat(input: {
  readonly answers?: readonly { readonly turn: number; readonly response: string }[]
  readonly partial?: readonly AssistantBlock[]
} = {}): ChatSnapshot {
  const nodes = (input.answers ?? []).map((answer, index) => ({
    kind: 'assistant',
    key: `node-${String(index)}`,
    id: `message-${String(index)}`,
    target: 'chat',
    data: {
      kind: 'assistant',
      seq: answer.turn,
      turn: 1,
      step: 1,
      blocks: [{ kind: 'text', text: answer.response }],
    },
  }))
  return {
    nodes: { values: () => nodes },
    navigation: { items: () => [] },
    legacy: { partial: input.partial === undefined ? null : { turn: 1, step: 1, blocks: input.partial } },
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
  function layer(options: { readonly reference?: boolean } = {}) {
    const renderSlot = vi.fn(() => <div data-testid="stack" />)
    const props = {
      useSurface: (select: (value: SurfaceSnapshot) => unknown) => select(ORB),
      useSessions: (select: (value: { readonly ids: readonly string[] }) => unknown) =>
        select({ ids: ['session-1'] }),
      useResource: () => ({ value: options.reference === false ? {} : { reference: { sessionId: 'session-1' } } }),
      SessionProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="bound">{children}</div>,
      renderSlot,
    }
    return { props, renderSlot }
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
})

describe('BubbleStack', () => {
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
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('renders only the newest output while collapsed', () => {
    const { props } = stack({ chat: chat({
      answers: [{ turn: 1, response: 'older answer' }, { turn: 2, response: 'newest answer' }],
    }) })
    render(createElement(BubbleStack, props as never))
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['newest answer'])
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

  it('expands the earlier answers on hover and collapses them after the pointer leaves', () => {
    const { props } = stack({ chat: chat({
      answers: [{ turn: 1, response: 'older answer' }, { turn: 2, response: 'newest answer' }],
    }) })
    render(createElement(BubbleStack, props as never))
    const log = screen.getByRole('log')
    fireEvent.pointerOver(log)
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['older answer', 'newest answer'])
    fireEvent.pointerOut(log)
    expect(screen.getAllByRole('button')).toHaveLength(2)
    act(() => { vi.advanceTimersByTime(BUBBLE_COLLAPSE_MS) })
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['newest answer'])
  })

  it('collapses an abandoned history even when no leave event arrives', () => {
    const { props } = stack({ chat: chat({
      answers: [{ turn: 1, response: 'older answer' }, { turn: 2, response: 'newest answer' }],
    }) })
    render(createElement(BubbleStack, props as never))
    fireEvent.pointerOver(screen.getByRole('log'))
    act(() => { vi.advanceTimersByTime(BUBBLE_COLLAPSE_MS) })
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('keeps the history open while the pointer keeps moving', () => {
    const { props } = stack({ chat: chat({
      answers: [{ turn: 1, response: 'older answer' }, { turn: 2, response: 'newest answer' }],
    }) })
    render(createElement(BubbleStack, props as never))
    const log = screen.getByRole('log')
    fireEvent.pointerOver(log)
    act(() => { vi.advanceTimersByTime(BUBBLE_COLLAPSE_MS - 500) })
    fireEvent.pointerMove(log)
    act(() => { vi.advanceTimersByTime(BUBBLE_COLLAPSE_MS - 500) })
    expect(screen.getAllByRole('button')).toHaveLength(2)
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

  it('fades and then dismisses the column once the output settles', () => {
    const { props, hide } = stack({ chat: chat({ answers: [{ turn: 1, response: 'answer' }] }) })
    render(createElement(BubbleStack, props as never))
    expect(column()?.dataset.faded).toBe('false')
    act(() => { vi.advanceTimersByTime(BUBBLE_FADE_MS) })
    expect(column()?.dataset.faded).toBe('true')
    expect(hide).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(BUBBLE_FADE_OUT_MS) })
    expect(hide).toHaveBeenCalledTimes(1)
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
