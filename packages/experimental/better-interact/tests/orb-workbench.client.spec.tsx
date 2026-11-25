// @vitest-environment jsdom
/** Driven management workbench: the reference gate and the shared embedded Conversation occurrence. */
import { cleanup, render } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import { OrbWorkbench, OrbWorkbenchConversation } from '../src/client/OrbWorkbench.tsx'
import type { OrbWorkbenchProps } from '../src/client/OrbWorkbench.tsx'

afterEach(cleanup)

it('composes the reusable embedded Conversation occurrence', () => {
  const renderFactorySlot = vi.fn(() => null)
  const openWorkspace = vi.fn()
  render(createElement(OrbWorkbenchConversation, { renderFactorySlot, openWorkspace } as never))
  expect(renderFactorySlot).toHaveBeenCalledExactlyOnceWith(
    'conversation.embedded',
    { onWorkspaceSelected: openWorkspace },
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
