// @vitest-environment jsdom
/** The workbench renders the shared Conversation inside the modal card. */
import { render, screen } from '@testing-library/react'
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
  render(<WorkbenchDialog {...props as never} />)
  expect(screen.getByText('workbench.empty')).toBeTruthy()
  expect(screen.queryByTestId('conversation')).toBeNull()
})

it('renders the bound conversation seat', () => {
  const { props, renderSlot } = dialogProps()
  render(<WorkbenchDialog {...props as never} />)
  expect(screen.getByTestId('conversation')).toBeTruthy()
  expect(renderSlot).toHaveBeenCalledWith('better-interact.workbench.conversation', {})
})

function conversationProps(
  session: { blank: boolean; running: boolean; promptAttempted: boolean; openState: string },
  summaryKnown = true,
) {
  const renderFactorySlot = vi.fn(() => <div data-testid="content" />)
  return {
    props: {
      sessionId: 'session-1' as SessionId,
      useSession: (select: (value: unknown) => unknown) => select(session),
      useConversation: (select: (value: unknown) => unknown) => select({ activeTargets: new Set<string>() }),
      useSessions: (select: (state: { byId: Record<string, { blank: boolean }> }) => unknown) =>
        select(summaryKnown ? { byId: { 'session-1': { blank: session.blank } } } : { byId: {} }),
      renderFactorySlot,
    },
    renderFactorySlot,
  }
}

it('composes the shared conversation content with the fixed chat view', () => {
  const { props, renderFactorySlot } = conversationProps({ blank: true, running: false, promptAttempted: false, openState: 'open' })
  render(<WorkbenchConversation {...props as never} />)
  expect(renderFactorySlot).toHaveBeenCalledWith(
    'conversation.content',
    { variant: 'embedded', phase: 'hero', hero: true },
    expect.objectContaining({ slots: expect.objectContaining({ views: expect.any(Function) }) }),
  )
})

it('follows a running conversation', () => {
  const { props, renderFactorySlot } = conversationProps({ blank: false, running: true, promptAttempted: true,
    openState: 'open' })
  render(<WorkbenchConversation {...props as never} />)
  expect(renderFactorySlot).toHaveBeenCalledWith(
    'conversation.content',
    { variant: 'embedded', phase: 'active', hero: false },
    expect.anything(),
  )
})

it('settles a blank session whose history is still loading', () => {
  const { props, renderFactorySlot } = conversationProps(
    { blank: true, running: false, promptAttempted: false, openState: 'loading' }, false)
  render(<WorkbenchConversation {...props as never} />)
  expect(renderFactorySlot).toHaveBeenCalledWith(
    'conversation.content',
    { variant: 'embedded', phase: 'settling', hero: false },
    expect.anything(),
  )
})
