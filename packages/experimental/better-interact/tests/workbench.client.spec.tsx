// @vitest-environment jsdom
/** The workbench renders its card strip above the shared Conversation. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { workbenchAddress } from '../src/client/resource.ts'
import type { WorkbenchTabsState } from '../src/client/workbench-tabs.ts'
import { WorkbenchConversation, WorkbenchDialog } from '../src/client/workbench.tsx'

type Summary = { readonly blank: boolean; readonly displayTitle?: string; readonly title?: string }

afterEach(() => { cleanup() })

function dialogProps(options: {
  readonly tabs?: WorkbenchTabsState
  readonly reference?: boolean
  readonly summaries?: Readonly<Record<string, Summary>>
} = {}) {
  const renderSlot = vi.fn(() => <div data-testid="conversation" />)
  const select = vi.fn()
  const tabs: WorkbenchTabsState = options.tabs
    ?? { sessionIds: ['session-1' as SessionId], active: 'session-1' as SessionId }
  const byId: Readonly<Record<string, Summary>> = options.summaries
    ?? { 'session-1': { blank: true, displayTitle: 'session-1' } }
  const useResource = vi.fn(() => ({
    value: options.reference === false ? {} : { reference: { sessionId: tabs.active ?? tabs.sessionIds[0] } },
  }))
  const props = {
    useTabs: (selector: (state: WorkbenchTabsState) => unknown) => selector(tabs),
    useSessions: (selector: (state: { ids: readonly string[]; byId: Readonly<Record<string, Summary>> }) => unknown) =>
      selector({ ids: Object.keys(byId), byId }),
    useResource,
    SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    renderSlot,
    select,
    t: (key: string) => key,
  }
  return { props, renderSlot, select, useResource, tabs }
}

it('renders the empty state while no card exists', () => {
  const { props } = dialogProps({ tabs: { sessionIds: [], active: undefined }, reference: false })
  render(createElement(WorkbenchDialog, props as never))
  expect(screen.getByText('workbench.empty')).toBeTruthy()
  expect(screen.queryByRole('tablist')).toBeNull()
  expect(screen.queryByTestId('conversation')).toBeNull()
  expect(document.querySelector('[data-shell-modal-fill]')).not.toBeNull()
  expect(document.querySelector('[data-shell-modal-surface="bare"]')).not.toBeNull()
})

it('renders one card per workbench and selects the clicked one', () => {
  const { props, select } = dialogProps({
    tabs: { sessionIds: ['session-1' as SessionId, 'session-2' as SessionId], active: 'session-2' as SessionId },
    summaries: {
      'session-1': { blank: true, displayTitle: 'session-1' },
      'session-2': { blank: false, displayTitle: 'Release notes' },
    },
  })
  render(createElement(WorkbenchDialog, props as never))
  const cards = screen.getAllByRole('tab')
  expect(cards.map(card => card.textContent)).toEqual(['tab.new', 'Release notes'])
  expect(cards[0]?.getAttribute('aria-selected')).toBe('false')
  expect(cards[1]?.getAttribute('aria-selected')).toBe('true')
  fireEvent.click(cards[0]!)
  expect(select).toHaveBeenCalledExactlyOnceWith('session-1')
})

it('binds the conversation to the active card', () => {
  const { props, renderSlot, useResource } = dialogProps({
    tabs: { sessionIds: ['session-1' as SessionId, 'session-2' as SessionId], active: 'session-1' as SessionId },
  })
  render(createElement(WorkbenchDialog, props as never))
  expect(screen.getByTestId('conversation')).toBeTruthy()
  expect(useResource).toHaveBeenCalledWith(workbenchAddress('session-1' as SessionId))
  expect(renderSlot).toHaveBeenCalledWith('better-interact.workbench.conversation', {})
})

it('moves the card selection with the arrow keys', () => {
  const { props, select } = dialogProps({
    tabs: { sessionIds: ['session-1' as SessionId, 'session-2' as SessionId], active: 'session-1' as SessionId },
  })
  render(createElement(WorkbenchDialog, props as never))
  const tablist = screen.getByRole('tablist')
  fireEvent.keyDown(tablist, { key: 'Enter' })
  expect(select).not.toHaveBeenCalled()
  fireEvent.keyDown(tablist, { key: 'ArrowRight' })
  expect(select).toHaveBeenCalledExactlyOnceWith('session-2')
  fireEvent.keyDown(tablist, { key: 'ArrowLeft' })
  expect(select).toHaveBeenLastCalledWith('session-2')
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('better-interact-workbench-tab-session-1')
  expect(screen.getAllByRole('tab')[0]?.getAttribute('aria-controls')).toBe('better-interact-workbench-panel')
})

it('leaves a single card alone on the arrow keys', () => {
  const { props, select } = dialogProps()
  render(createElement(WorkbenchDialog, props as never))
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })
  expect(select).not.toHaveBeenCalled()
})

function conversationProps(
  session: { blank: boolean; running: boolean; promptAttempted: boolean; openState: string },
  summaryKnown = true,
) {
  const calls: unknown[][] = []
  const renderFactorySlot = (...args: unknown[]) => {
    calls.push(args)
    return <div data-testid="content" />
  }
  return {
    props: {
      sessionId: 'session-1' as SessionId,
      useSession: (select: (value: unknown) => unknown) => select(session),
      useConversation: (select: (value: unknown) => unknown) => select({ activeTargets: new Set<string>() }),
      useSessions: (select: (state: { byId: Record<string, { blank: boolean }> }) => unknown) =>
        select(summaryKnown ? { byId: { 'session-1': { blank: session.blank } } } : { byId: {} }),
      renderFactorySlot,
    },
    calls,
  }
}

/** Read the fixed View component one render handed to the conversation content. */
function fixedView(calls: unknown[][]): unknown {
  const options = calls[0]?.[2] as { slots: { views: unknown } }
  return options.slots.views
}

it('composes the shared conversation content with the fixed chat view', () => {
  const { props, calls } = conversationProps({ blank: true, running: false, promptAttempted: false, openState: 'open' })
  render(createElement(WorkbenchConversation, props as never))
  expect(calls[0]?.slice(0, 2)).toEqual([
    'conversation.content',
    { variant: 'embedded', phase: 'hero', hero: true },
  ])
  expect(typeof fixedView(calls)).toBe('function')
})

it('follows a running conversation', () => {
  const { props, calls } = conversationProps({ blank: false, running: true, promptAttempted: true,
    openState: 'open' })
  render(createElement(WorkbenchConversation, props as never))
  expect(calls[0]?.slice(0, 2)).toEqual([
    'conversation.content',
    { variant: 'embedded', phase: 'active', hero: false },
  ])
})

it('settles a blank session whose history is still loading', () => {
  const { props, calls } = conversationProps(
    { blank: true, running: false, promptAttempted: false, openState: 'loading' }, false)
  render(createElement(WorkbenchConversation, props as never))
  expect(calls[0]?.slice(0, 2)).toEqual([
    'conversation.content',
    { variant: 'embedded', phase: 'settling', hero: false },
  ])
})
