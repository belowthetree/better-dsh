// @vitest-environment jsdom
/** Driven management workbench: the reference gate, the conversation factory input, and the fixed Chat view. */
import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import { FixedOrbWorkbenchView, OrbWorkbench, OrbWorkbenchConversation } from '../src/client/OrbWorkbench.tsx'
import type { OrbWorkbenchConversationProps, OrbWorkbenchProps } from '../src/client/OrbWorkbench.tsx'

afterEach(cleanup)

/** One bound-Session projection with the fields the phase derivation reads. */
function sessionState(patch: Record<string, unknown> = {}) {
  return {
    blank: false,
    awaitingFirstTurn: false,
    running: false,
    promptAttempted: false,
    openState: 'open' as const,
    ...patch,
  }
}

/**
 * Build the conversation props with stub Session seats and a recording factory renderer.
 * @param patch - Session fields to override.
 * @returns the props and the factory-call spy.
 */
function conversation(patch: Record<string, unknown> = {}) {
  const state = sessionState(patch)
  const renderFactorySlot = vi.fn(() => null)
  const props = {
    sessionId: 'managed',
    useSession: (selector: (value: typeof state) => unknown) => selector(state),
    useSessions: (selector: (value: { byId: Record<string, { blank?: boolean }> }) => unknown) =>
      selector({ byId: { managed: { blank: false } } }),
    useConversation: (selector: (value: { activeTargets: Set<string> }) => unknown) =>
      selector({ activeTargets: new Set<string>() }),
    renderFactorySlot,
  } as OrbWorkbenchConversationProps
  return { props, renderFactorySlot }
}

it('renders the active Chat view for a started conversation', () => {
  const b = conversation()
  render(<OrbWorkbenchConversation {...b.props} />)
  expect(b.renderFactorySlot).toHaveBeenCalledOnce()
  expect(b.renderFactorySlot).toHaveBeenCalledWith(
    'conversation.content',
    { variant: 'embedded', phase: 'active', hero: false },
    { slots: { views: FixedOrbWorkbenchView } },
  )
})

it('reports the hero phase while the bound Session is blank and open', () => {
  const b = conversation({ blank: true, openState: 'open' })
  render(<OrbWorkbenchConversation {...b.props} />)
  expect(b.renderFactorySlot).toHaveBeenCalledWith(
    'conversation.content',
    { variant: 'embedded', phase: 'hero', hero: true },
    { slots: { views: FixedOrbWorkbenchView } },
  )
})

it('keeps the card empty until the plugin retains the conversation', () => {
  const renderSlot = vi.fn(() => <span data-conversation="" />)
  const props = {
    useReference: (selector: (value: SessionReference | null) => unknown) => selector(null),
    SessionProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
    renderSlot,
  } as OrbWorkbenchProps
  const view = render(<OrbWorkbench {...props} />)
  expect(view.container.innerHTML).toBe('')
  expect(renderSlot).not.toHaveBeenCalled()
})

it('binds the retained Session into the conversation slot', () => {
  const reference = { sessionId: 'managed' } as SessionReference
  const renderSlot = vi.fn(() => <span data-conversation="" />)
  let provided: SessionReference | undefined
  const props = {
    useReference: (selector: (value: SessionReference | null) => unknown) => selector(reference),
    SessionProvider: ({ session, children }: { session: SessionReference; children?: ReactNode }) => {
      provided = session
      return <>{children}</>
    },
    renderSlot,
  } as OrbWorkbenchProps
  render(<OrbWorkbench {...props} />)
  expect(provided).toBe(reference)
  expect(renderSlot).toHaveBeenCalledWith('orb.workbench.conversation', {})
})
