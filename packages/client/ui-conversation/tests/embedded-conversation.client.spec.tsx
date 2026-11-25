// @vitest-environment jsdom
/** Reusable embedded Conversation occurrence: derived phase and Hero, and its fixed Chat View. */
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { EmbeddedChatView, EmbeddedConversation } from '../src/client/skeleton/EmbeddedConversation.tsx'

afterEach(cleanup)

const SESSION = 'embedded-session' as SessionId

interface Occurrence {
  readonly session: Record<string, unknown>
  readonly summaryBlank?: boolean | undefined
  readonly activeTargets?: readonly string[]
  readonly headline?: string
}

/**
 * Render one occurrence with stub Session seats and a recording content Factory renderer.
 * @param occurrence - Session snapshot fields, the list summary's blank flag, and the occurrence input.
 * @returns the content Factory renderer spy and the Workspace handler handed to the content.
 */
function occurrence({ session, summaryBlank, activeTargets = [], headline }: Occurrence) {
  const renderFactorySlot = vi.fn(() => null)
  const onWorkspaceSelected = vi.fn()
  const snapshot = {
    blank: false, awaitingFirstTurn: false, running: false, promptAttempted: false, openState: 'open', ...session,
  }
  const props = {
    sessionId: SESSION,
    onWorkspaceSelected,
    ...(headline === undefined ? {} : { headline }),
    useSession: (select: (value: unknown) => unknown) => select(snapshot),
    useConversation: (select: (value: unknown) => unknown) => select({ activeTargets: new Set(activeTargets) }),
    useSessions: (select: (value: unknown) => unknown) => select({
      ids: [SESSION], byId: summaryBlank === undefined ? {} : { [SESSION]: { blank: summaryBlank } }, phase: 'ready',
    }),
    renderFactorySlot,
  }
  render(createElement(EmbeddedConversation, props as never))
  return { renderFactorySlot, onWorkspaceSelected }
}

function content(
  phase: string,
  hero: boolean,
  onWorkspaceSelected: () => void,
  extra: Record<string, unknown> = {},
) {
  return [
    'conversation.content',
    { variant: 'embedded', phase, hero, onWorkspaceSelected, ...extra },
    { slots: { views: EmbeddedChatView } },
  ]
}

it('renders an active occurrence once the Session has its first turn', () => {
  const { renderFactorySlot, onWorkspaceSelected } = occurrence({
    session: { blank: false, awaitingFirstTurn: false }, summaryBlank: false,
  })
  expect(renderFactorySlot.mock.calls[0]).toEqual(content('active', false, onWorkspaceSelected))
})

it('renders the Hero for a blank Session the list already proves blank', () => {
  const { renderFactorySlot, onWorkspaceSelected } = occurrence({
    session: { blank: true, awaitingFirstTurn: true }, summaryBlank: true,
  })
  expect(renderFactorySlot.mock.calls[0]).toEqual(content('hero', true, onWorkspaceSelected))
})

it('renders the Hero once a blank Session opens without a list summary', () => {
  const { renderFactorySlot, onWorkspaceSelected } = occurrence({
    session: { blank: true, awaitingFirstTurn: true, openState: 'open' }, summaryBlank: undefined,
  })
  expect(renderFactorySlot.mock.calls[0]).toEqual(content('hero', true, onWorkspaceSelected))
})

it('holds the settling phase while a blank Session history is still loading', () => {
  const { renderFactorySlot, onWorkspaceSelected } = occurrence({
    session: { blank: true, awaitingFirstTurn: true, openState: 'loading' }, summaryBlank: undefined,
  })
  expect(renderFactorySlot.mock.calls[0]).toEqual(content('settling', false, onWorkspaceSelected))
})

it('reaches the Hero without settling when the blank list summary is already known', () => {
  const { renderFactorySlot, onWorkspaceSelected } = occurrence({
    session: { blank: true, awaitingFirstTurn: true, openState: 'loading' }, summaryBlank: true,
  })
  expect(renderFactorySlot.mock.calls[0]).toEqual(content('hero', true, onWorkspaceSelected))
})

it('stays active after a prompt was attempted on a still-blank Session', () => {
  const { renderFactorySlot, onWorkspaceSelected } = occurrence({
    session: { blank: true, awaitingFirstTurn: true, promptAttempted: true }, summaryBlank: false,
  })
  expect(renderFactorySlot.mock.calls[0]).toEqual(content('active', false, onWorkspaceSelected))
})

it('stays active while a Conversation target is registered', () => {
  const { renderFactorySlot, onWorkspaceSelected } = occurrence({
    session: { blank: true, awaitingFirstTurn: true }, summaryBlank: false, activeTargets: ['chat'],
  })
  expect(renderFactorySlot.mock.calls[0]).toEqual(content('active', false, onWorkspaceSelected))
})

it('forwards the caller Hero headline', () => {
  const { renderFactorySlot, onWorkspaceSelected } = occurrence({
    session: { blank: true, awaitingFirstTurn: true }, summaryBlank: true, headline: 'Reviewing change 12',
  })
  expect(renderFactorySlot.mock.calls[0])
    .toEqual(content('hero', true, onWorkspaceSelected, { headline: 'Reviewing change 12' }))
})

it('fixes the local View to Chat', () => {
  const renderSlot = vi.fn(() => null)
  render(createElement(EmbeddedChatView, { renderSlot } as never))
  expect(renderSlot).toHaveBeenCalledExactlyOnceWith('conversation.session', { view: 'chat' })
})
