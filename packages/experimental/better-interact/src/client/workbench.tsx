/** Workbench dialog hosting one page per Workspace, its Session bookmarks, and the shared conversation. */
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ModalSizeHint } from '@deepseek-ai/dsh-client-surface/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRenderFactories, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NS } from './locales.ts'
import { workbenchAddress } from './resource.ts'
import { workbenchGroups } from './workbench-groups.ts'
import type { WorkbenchPagesState } from './workbench-pages.ts'
import css from './Workbench.module.css'
import { EmbeddedConversation } from './embedded-conversation.tsx'
import type { EmbeddedConversationInjected } from './embedded-conversation.tsx'

/**
 * Dialog size the workbench asks the carrier for: four fifths of the work area
 * height and a 1488-pixel dialog. The wider dialog reserves the frame's
 * 1440-pixel card, whose body centers a 1120-pixel conversation panel with the
 * Session bookmarks in the left margin.
 */
export const WORKBENCH_MODAL_SIZE: ModalSizeHint = { heightRatio: 0.8, width: 1488 }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Conversation occurrence hosted by the workbench dialog. */
    'better-interact.workbench.conversation': { kind: 'single'; scope: 'session' }
  }
}

/** Dialog-owned notice shown as an inline failure line. */
export type WorkbenchNotice = 'workbench.createFailed' | 'workbench.manageFailed'

/** Effective shortcut key labels shown by the card hints. */
export interface WorkbenchHints {
  /** Binding that moves keyboard focus to the Session bookmarks. */
  readonly sessions: readonly string[]
  /** Binding that shows the next Workspace page. */
  readonly pageNext: readonly string[]
  /** Binding that shows the previous Workspace page. */
  readonly pagePrevious: readonly string[]
}

/**
 * Translate a vertical wheel over the horizontally scrollable Workspace strip
 * into horizontal scrolling. A strip that fits its content keeps the page
 * scroll it belongs to.
 * @param strip - scroll metrics of the strip.
 * @param event - wheel movement over the strip.
 * @returns whether the strip consumed the wheel.
 */
export function scrollTabsByWheel(
  strip: { readonly scrollWidth: number; readonly clientWidth: number; scrollLeft: number },
  event: { readonly deltaY: number; preventDefault(): void },
): boolean {
  if (event.deltaY === 0 || strip.scrollWidth <= strip.clientWidth) return false
  event.preventDefault()
  strip.scrollLeft += event.deltaY
  return true
}

/** Workspace pages, Session bookmarks, and selection actions the workbench dialog consumes. */
export interface WorkbenchInjected {
  hooks: {
    /** Persisted Workspace page selection and per-page Session choices. */
    pages: HostObservable<WorkbenchPagesState>
    /** Inline failure notice, or null while none is shown. */
    notice: HostObservable<WorkbenchNotice | null>
    /** Focus request counter; every change moves keyboard focus to the active bookmark. */
    focus: HostObservable<number>
    /** Effective shortcut key labels for the card hints. */
    hints: HostObservable<WorkbenchHints>
  }
  /**
   * Show one Workspace page, opening its current Session.
   * @param workspaceId - Workspace whose page the dialog should show.
   */
  select(workspaceId: WorkspaceId): void
  /**
   * Show one Session as its Workspace page's current session.
   * @param sessionId - Session whose bookmark was activated.
   */
  selectSession(sessionId: SessionId): void
}

/** Props of the `shell.modal` entry `better-interact.workbench`. */
export type WorkbenchDialogProps =
  & PropsRuntime<'shell.modal'>
  & PropsRenderSlots<'better-interact.workbench.conversation'>
  & PropsLocale<typeof NS>
  & InjectFace<WorkbenchInjected>

/**
 * Render the workbench: one card per Workspace above the Session bookmarks and
 * the page's conversation.
 * @param props - Workspace catalog, page selection, Session catalog, resource hook, and the Conversation seat.
 * @returns the dialog, or its empty state while no Workspace page resolves.
 */
export function WorkbenchDialog(props: WorkbenchDialogProps) {
  const { SessionProvider, renderSlot, select, selectSession, t } = props
  const workspacesState = props.useWorkspaces(state => state)
  const workspaces = workspacesState.items
  const archived = new Set(workspacesState.archivedSessionIds)
  const pages = props.usePages(value => value)
  const notice = props.useNotice(value => value)
  const focusRequest = props.useFocus(value => value)
  const hints = props.useHints(value => value)
  const sessions = props.useSessions(state => state.byId)
  const { getTriggerProps } = props.useContextMenu()
  const groups = workbenchGroups(workspaces, sessions, t('tabs.manage'))
  const tabsRef = useRef<HTMLDivElement | null>(null)
  const sessionsRef = useRef<HTMLElement | null>(null)
  const lastFocus = useRef(focusRequest)
  // The keyboard cursor is local presentation state: it marks the bookmark
  // Enter would activate and stays distinct from the current Session.
  const [cursor, setCursor] = useState<SessionId | null>(null)
  const active = pages.active !== undefined && groups.some(item => item.workspaceId === pages.active)
    ? pages.active
    : groups[0]?.workspaceId
  const workspace = groups.find(item => item.workspaceId === active)
  const available = workspace === undefined
    ? []
    : workspace.sessionIds.filter((sessionId): sessionId is SessionId =>
      sessions[sessionId] !== undefined && !archived.has(sessionId))
  const newest = available.reduce<SessionId | undefined>((best, sessionId) => best === undefined
    || (sessions[sessionId]?.updatedAt ?? 0) > (sessions[best]?.updatedAt ?? 0) ? sessionId : best, undefined)
  const mapped = active === undefined ? undefined : pages.sessions[active]
  const sessionId = mapped !== undefined && available.includes(mapped) ? mapped : newest
  const address = workbenchAddress(sessionId)
  const resource = props.useResource<'betterinteract'>(address)
  const reference = resource.value?.reference

  // A vertical wheel over the strip scrolls the Workspace pages: the bar stays
  // hidden, and a mouse wheel does not translate to a horizontal scroller on its own.
  useEffect(() => {
    const strip = tabsRef.current
    if (strip === null) return
    const onWheel = (event: WheelEvent): void => {
      scrollTabsByWheel(strip, event)
    }
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => { strip.removeEventListener('wheel', onWheel) }
  }, [])

  // A shortcut asks for the bookmark list through the counter; focus stays a
  // component concern, and the first render never steals the dialog's focus.
  useEffect(() => {
    if (focusRequest === lastFocus.current) return
    lastFocus.current = focusRequest
    const current = sessionsRef.current?.querySelector<HTMLElement>('[data-workbench-session][data-active]')
    const first = sessionsRef.current?.querySelector<HTMLElement>('[data-workbench-session]')
    const target = current ?? first
    target?.focus()
  }, [focusRequest])

  /** Move the selection and focus with the arrow keys inside the Workspace strip. */
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    if (groups.length < 2) return
    event.preventDefault()
    const current = active === undefined ? 0 : groups.findIndex(item => item.workspaceId === active)
    const step = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (current + step + groups.length) % groups.length
    const next = groups[nextIndex]
    if (next === undefined) return
    select(next.workspaceId)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-workbench-tab]')[nextIndex]?.focus()
  }

  /** Move the selection ring between the Session bookmarks; Enter activates it. */
  const onSessionKey = (event: KeyboardEvent<HTMLElement>): void => {
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight'
    const backward = event.key === 'ArrowUp' || event.key === 'ArrowLeft'
    if (!forward && !backward) return
    const bookmark = event.target instanceof HTMLElement
      ? event.target.closest<HTMLButtonElement>('[data-workbench-session]')
      : null
    if (bookmark === null) return
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-workbench-session]')]
    const index = items.indexOf(bookmark)
    if (index === -1) return
    event.preventDefault()
    const next = (index + (forward ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  return <section className={css.root} data-better-interact-workbench="" data-shell-modal-fill=""
    data-shell-modal-surface="bare" data-shell-modal-wide="">
    {notice !== null && <p className={css.notice} role="alert" data-better-interact-notice="">{t(notice)}</p>}
    <div className={css.body}>
      {groups.length > 0 && <div className={css.tabs} role="tablist" aria-label={t('tabs.label')}
        ref={tabsRef} data-workbench-tabs="" onKeyDown={onTabKey}>
        {groups.map((item) => {
          const selected = item.workspaceId === active
          return <Tooltip key={item.workspaceId} label={item.path ?? item.title} shortcutKeys={hints.pageNext}
            side="top" portal delayMs={300} maxWidth={360}>
            <button type="button" role="tab"
              id={`better-interact-workbench-tab-${item.workspaceId}`}
              aria-selected={selected} aria-controls="better-interact-workbench-panel"
              tabIndex={selected ? 0 : -1} className={css.tab} data-workbench-tab=""
              data-active={selected || undefined}
              onClick={() => { select(item.workspaceId) }}>
              <span className={css.tabTitle}>{item.title}</span>
            </button>
          </Tooltip>
        })}
      </div>}
      {available.length > 0 && <nav ref={sessionsRef} className={css.sessions} aria-label={t('sessions.label')}
        data-better-interact-sessions="" onKeyDown={onSessionKey}>
        {available.map((bookmarkId) => {
          const summary = sessions[bookmarkId]
          const label = summary?.blank === true
            ? t('session.new')
            : (summary?.title?.trim() || summary?.displayTitle || bookmarkId)
          const selected = bookmarkId === sessionId
          return <Tooltip key={bookmarkId} label={label} shortcutKeys={hints.sessions}
            side="right" portal delayMs={300} maxWidth={360}>
            <button type="button" className={css.session} data-workbench-session=""
              {...getTriggerProps({ kind: 'session', value: { sessionId: bookmarkId, displayTitle: label } })}
              data-active={selected || undefined} data-cursor={bookmarkId === cursor || undefined}
              aria-current={selected ? 'page' : undefined}
              onFocus={() => { setCursor(bookmarkId) }}
              onBlur={() => { setCursor(value => (value === bookmarkId ? null : value)) }}
              onClick={() => { selectSession(bookmarkId) }}>
              <span className={css.sessionTitle}>{label}</span>
            </button>
          </Tooltip>
        })}
      </nav>}
      <div id="better-interact-workbench-panel" className={css.panel} data-better-interact-panel=""
        role="tabpanel" aria-labelledby={active === undefined ? undefined : `better-interact-workbench-tab-${active}`}>
        {reference === undefined
          ? <p className={css.empty} data-better-interact-empty="">{t('workbench.empty')}</p>
          : <SessionProvider session={reference}>{renderSlot('better-interact.workbench.conversation', {})}</SessionProvider>}
      </div>
    </div>
  </section>
}

/** Props of the session-scoped entry `better-interact.workbench.conversation`. */
export type WorkbenchConversationProps =
  & PropsRuntime<'better-interact.workbench.conversation'>
  & PropsRenderFactories
  & InjectFace<EmbeddedConversationInjected>

/**
 * Compose the shared Conversation content for the workbench's bound Session.
 * @param props - bound Session state, its Conversation state, and the Factory renderer.
 * @returns the conversation content rooted at the Chat view.
 */
export function WorkbenchConversation(props: WorkbenchConversationProps) {
  return <EmbeddedConversation {...props} />
}
