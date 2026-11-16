// @vitest-environment jsdom
/** The workbench renders the shared Conversation inside the modal card. */
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkbenchConversation, WorkbenchDialog } from '../src/client/workbench.tsx'

function dialogProps(options: { readonly session?: boolean; readonly reference?: boolean } = {}) {
  const renderSlot = vi.fn(() => <div data-testid="conversation" />)
  const props = {
    useSessions: (select: (state: { ids: readonly string[]; byId: Record<string, { blank: boolean }> }) => unknown) =>
      select({ ids: options.session === false ? [] : ['session-1'], byId: { 'session-1': { blank: true } } }),
    useResource: () => ({ value: options.reference === false ? {} : { reference: { sessionId: 'session-1' } } }),
    SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    renderSlot,
    t: (key: string) => key,
  }
  return { props, renderSlot }
}

it('renders the empty state while no Session exists', () => {
  const { props } = dialogProps({ session: false, reference: false })
  render(createElement(WorkbenchDialog, props as never))
  expect(screen.getByText('workbench.empty')).toBeTruthy()
  expect(screen.queryByTestId('conversation')).toBeNull()
  expect(document.querySelector('[data-shell-modal-fill]')).not.toBeNull()
})

it('renders the bound conversation seat', () => {
  const { props, renderSlot } = dialogProps()
  render(createElement(WorkbenchDialog, props as never))
  expect(screen.getByTestId('conversation')).toBeTruthy()
  expect(renderSlot).toHaveBeenCalledWith('better-interact.workbench.conversation', {})
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
