// @vitest-environment jsdom
/** The workbench renders one card per Workspace above the selected page's conversation. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { workbenchAddress } from '../src/client/resource.ts'
import type { WorkbenchPagesState } from '../src/client/workbench-pages.ts'
import { WorkbenchConversation, WorkbenchDialog } from '../src/client/workbench.tsx'
import type { WorkbenchNotice } from '../src/client/workbench.tsx'

type SessionRow = {
  readonly updatedAt: number
  readonly blank?: boolean
  readonly title?: string
  readonly displayTitle?: string
}
type WorkspaceRow = {
  readonly workspaceId: WorkspaceId
  readonly title: string
  readonly path: string
  readonly sessionIds: readonly SessionId[]
}

const ws = (value: string) => value as WorkspaceId
const sid = (value: string) => value as SessionId

const workspace = (id: string, title: string, sessionIds: string[]): WorkspaceRow => ({
  workspaceId: ws(id), title, path: `E:\\Project\\${title}`, sessionIds: sessionIds.map(sid),
})

afterEach(() => { cleanup() })

function dialogProps(options: {
  readonly pages?: WorkbenchPagesState
  readonly workspaces?: readonly WorkspaceRow[]
  readonly sessions?: Readonly<Record<string, SessionRow>>
  readonly archived?: readonly string[]
  readonly reference?: boolean
  readonly notice?: WorkbenchNotice | null
  readonly focus?: number
} = {}) {
  const workspaces = options.workspaces ?? [workspace('ws-1', 'Alpha', ['s1'])]
  const pages: WorkbenchPagesState = options.pages ?? { active: workspaces[0]?.workspaceId, sessions: {} }
  const sessions = options.sessions ?? { s1: { updatedAt: 1 } }
  const renderSlot = vi.fn(() => <div data-testid="conversation" />)
  const select = vi.fn()
  const selectSession = vi.fn()
  const useResource = vi.fn(() => ({ value: options.reference === false ? {} : { reference: { sessionId: 's1' } } }))
  const props = {
    useWorkspaces: (selector: (state: { items: readonly WorkspaceRow[]; archivedSessionIds: readonly string[] }) => unknown) =>
      selector({ items: workspaces, archivedSessionIds: (options.archived ?? []).map(sid) }),
    usePages: (selector: (state: WorkbenchPagesState) => unknown) => selector(pages),
    useNotice: (selector: (state: WorkbenchNotice | null) => unknown) => selector(options.notice ?? null),
    useFocus: (selector: (state: number) => unknown) => selector(options.focus ?? 0),
    useHints: (selector: (state: {
      sessions: readonly string[]
      pageNext: readonly string[]
      pagePrevious: readonly string[]
    }) => unknown) => selector({
      sessions: ['Ctrl', 'Q'], pageNext: ['Ctrl', 'Tab'], pagePrevious: ['Shift', 'Ctrl', 'Tab'],
    }),
    useSessions: (selector: (state: { byId: Readonly<Record<string, SessionRow>> }) => unknown) =>
      selector({ byId: sessions }),
    useResource,
    SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    renderSlot,
    select,
    selectSession,
    t: (key: string) => key,
  }
  return { props, renderSlot, select, selectSession, useResource, pages }
}

it('renders the empty state while no Workspace page exists', () => {
  const { props } = dialogProps({ pages: { active: undefined, sessions: {} }, workspaces: [], reference: false })
  render(createElement(WorkbenchDialog, props as never))
  expect(screen.getByText('workbench.empty')).toBeTruthy()
  expect(screen.queryByRole('tablist')).toBeNull()
  expect(document.querySelector('[data-shell-modal-fill]')).not.toBeNull()
  expect(document.querySelector('[data-shell-modal-surface="bare"]')).not.toBeNull()
})

it('renders one card per Workspace and selects the clicked one', () => {
  const { props, select } = dialogProps({
    workspaces: [workspace('ws-1', 'Alpha', ['s1']), workspace('ws-2', 'Beta', ['s2'])],
    pages: { active: ws('ws-2'), sessions: {} },
    sessions: { s1: { updatedAt: 1 }, s2: { updatedAt: 2 } },
  })
  render(createElement(WorkbenchDialog, props as never))
  const cards = screen.getAllByRole('tab')
  expect(cards.map(card => card.textContent)).toEqual(['Alpha', 'Beta'])
  expect(cards[0]?.getAttribute('aria-selected')).toBe('false')
  expect(cards[1]?.getAttribute('aria-selected')).toBe('true')
  fireEvent.click(cards[0]!)
  expect(select).toHaveBeenCalledExactlyOnceWith(ws('ws-1'))
})

it('binds the conversation to the page Session, falling back to its newest', () => {
  const { props, renderSlot, useResource } = dialogProps({
    workspaces: [workspace('ws-1', 'Alpha', ['older', 'newer'])],
    pages: { active: ws('ws-1'), sessions: { [ws('ws-1')]: sid('older') } },
    sessions: { older: { updatedAt: 1 }, newer: { updatedAt: 2 } },
  })
  render(createElement(WorkbenchDialog, props as never))
  expect(screen.getByTestId('conversation')).toBeTruthy()
  expect(useResource).toHaveBeenCalledWith(workbenchAddress(sid('older')))
  expect(renderSlot).toHaveBeenCalledWith('better-interact.workbench.conversation', {})
})

it('lists the active Workspace Sessions as bookmarks and marks the current one', () => {
  const { props } = dialogProps({
    workspaces: [workspace('ws-1', 'Alpha', ['blank', 'titled'])],
    pages: { active: ws('ws-1'), sessions: { [ws('ws-1')]: sid('titled') } },
    sessions: { blank: { updatedAt: 1, blank: true }, titled: { updatedAt: 2, title: 'Release notes' } },
  })
  render(createElement(WorkbenchDialog, props as never))
  const rail = screen.getByRole('navigation', { name: 'sessions.label' })
  const bookmarks = within(rail).getAllByRole('button')
  expect(bookmarks.map(bookmark => bookmark.textContent)).toEqual(['session.new', 'Release notes'])
  expect(bookmarks[1]?.getAttribute('aria-current')).toBe('page')
  expect(bookmarks[0]?.getAttribute('aria-current')).toBeNull()
})

it('switches to the Session of the clicked bookmark', () => {
  const { props, selectSession } = dialogProps({
    workspaces: [workspace('ws-1', 'Alpha', ['s1', 's2'])],
    pages: { active: ws('ws-1'), sessions: { [ws('ws-1')]: sid('s1') } },
    sessions: { s1: { updatedAt: 1, title: 'First' }, s2: { updatedAt: 2, title: 'Second' } },
  })
  render(createElement(WorkbenchDialog, props as never))
  const rail = screen.getByRole('navigation', { name: 'sessions.label' })
  fireEvent.click(within(rail).getAllByRole('button')[1]!)
  expect(selectSession).toHaveBeenCalledExactlyOnceWith(sid('s2'))
})

it('hides archived Sessions from the bookmarks', () => {
  const { props } = dialogProps({
    workspaces: [workspace('ws-1', 'Alpha', ['archived', 'kept'])],
    pages: { active: ws('ws-1'), sessions: {} },
    sessions: { archived: { updatedAt: 2, title: 'Archived' }, kept: { updatedAt: 1, title: 'Kept' } },
    archived: ['archived'],
  })
  render(createElement(WorkbenchDialog, props as never))
  const rail = screen.getByRole('navigation', { name: 'sessions.label' })
  expect(rail.textContent).toContain('Kept')
  expect(rail.textContent).not.toContain('Archived')
})

it('focuses the current bookmark when a focus request arrives', () => {
  const { props } = dialogProps({
    workspaces: [workspace('ws-1', 'Alpha', ['s1', 's2'])],
    pages: { active: ws('ws-1'), sessions: { [ws('ws-1')]: sid('s2') } },
    sessions: { s1: { updatedAt: 1, title: 'First' }, s2: { updatedAt: 2, title: 'Second' } },
  })
  const view = render(createElement(WorkbenchDialog, props as never))
  view.rerender(createElement(WorkbenchDialog, { ...props, useFocus: (selector: (value: number) => unknown) => selector(1) } as never))
  expect(document.activeElement?.textContent).toBe('Second')
  expect(document.activeElement?.getAttribute('data-cursor')).toBe('true')
})

it('moves the selection ring without switching Sessions', () => {
  const { props, selectSession } = dialogProps({
    workspaces: [workspace('ws-1', 'Alpha', ['s1', 's2'])],
    pages: { active: ws('ws-1'), sessions: { [ws('ws-1')]: sid('s1') } },
    sessions: { s1: { updatedAt: 1, title: 'First' }, s2: { updatedAt: 2, title: 'Second' } },
  })
  render(createElement(WorkbenchDialog, props as never))
  const rail = screen.getByRole('navigation', { name: 'sessions.label' })
  const bookmarks = within(rail).getAllByRole('button')
  bookmarks[0]?.focus()
  fireEvent.keyDown(bookmarks[0]!, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(bookmarks[1])
  expect(bookmarks[1]?.getAttribute('data-cursor')).toBe('true')
  expect(selectSession).not.toHaveBeenCalled()
  fireEvent.keyDown(bookmarks[1]!, { key: 'ArrowLeft' })
  expect(document.activeElement).toBe(bookmarks[0])
  expect(bookmarks[0]?.getAttribute('data-cursor')).toBe('true')
  expect(bookmarks[1]?.getAttribute('data-cursor')).toBeNull()
  expect(selectSession).not.toHaveBeenCalled()
})

it('falls back to the newest Session when the page has no recorded choice', () => {
  const { props, useResource } = dialogProps({
    workspaces: [workspace('ws-1', 'Alpha', ['older', 'newer'])],
    pages: { active: ws('ws-1'), sessions: {} },
    sessions: { older: { updatedAt: 1 }, newer: { updatedAt: 2 } },
  })
  render(createElement(WorkbenchDialog, props as never))
  expect(useResource).toHaveBeenCalledWith(workbenchAddress(sid('newer')))
})

it('moves the page selection with the arrow keys', () => {
  const { props, select } = dialogProps({
    workspaces: [workspace('ws-1', 'Alpha', ['s1']), workspace('ws-2', 'Beta', ['s2'])],
    pages: { active: ws('ws-1'), sessions: {} },
    sessions: { s1: { updatedAt: 1 }, s2: { updatedAt: 1 } },
  })
  render(createElement(WorkbenchDialog, props as never))
  const tablist = screen.getByRole('tablist')
  fireEvent.keyDown(tablist, { key: 'Enter' })
  expect(select).not.toHaveBeenCalled()
  fireEvent.keyDown(tablist, { key: 'ArrowRight' })
  expect(select).toHaveBeenCalledExactlyOnceWith(ws('ws-2'))
  fireEvent.keyDown(tablist, { key: 'ArrowLeft' })
  expect(select).toHaveBeenLastCalledWith(ws('ws-2'))
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby'))
    .toBe('better-interact-workbench-tab-ws-1')
})

it('shows a failed Workspace creation notice', () => {
  const { props } = dialogProps({ notice: 'workbench.createFailed' })
  render(createElement(WorkbenchDialog, props as never))
  expect(screen.getByRole('alert').textContent).toBe('workbench.createFailed')
})

it('leaves a single Workspace alone on the arrow keys', () => {
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
