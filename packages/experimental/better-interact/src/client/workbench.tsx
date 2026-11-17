/** Workbench dialog hosting the shared conversation surface and its card strip. */
import type { KeyboardEvent } from 'react'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ModalSizeHint } from '@deepseek-ai/dsh-client-surface/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRenderFactories, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NS } from './locales.ts'
import { workbenchAddress } from './resource.ts'
import type { WorkbenchTabsState } from './workbench-tabs.ts'
import css from './Workbench.module.css'

/** Dialog size the workbench asks the carrier for: four fifths of the work area height. */
export const WORKBENCH_MODAL_SIZE: ModalSizeHint = { heightRatio: 0.8 }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Conversation occurrence hosted by the workbench dialog. */
    'better-interact.workbench.conversation': { kind: 'single'; scope: 'session' }
  }
}

/** Card strip and selection actions the workbench dialog consumes. */
export interface WorkbenchInjected {
  hooks: {
    /** Persisted strip order and the card the dialog shows. */
    tabs: HostObservable<WorkbenchTabsState>
  }
  /**
   * Show one Session's workbench, appending its card when the strip has none.
   * @param sessionId - Session whose conversation the dialog should show.
   */
  select(sessionId: SessionId): void
}

/** Props of the `shell.modal` entry `better-interact.workbench`. */
export type WorkbenchDialogProps =
  & PropsRuntime<'shell.modal'>
  & PropsRenderSlots<'better-interact.workbench.conversation'>
  & PropsLocale<typeof NS>
  & InjectFace<WorkbenchInjected>

/**
 * Render the workbench: the cards of the Sessions it has hosted above the
 * current conversation.
 * @param props - Session catalog, workbench strip, resource hook, and the Conversation seat.
 * @returns the dialog, or its empty state while no card resolves.
 */
export function WorkbenchDialog(props: WorkbenchDialogProps) {
  const { SessionProvider, renderSlot, select, t } = props
  const tabs = props.useTabs(value => value)
  const summaries = props.useSessions(state => state.byId)
  const active = tabs.active ?? tabs.sessionIds[0]
  const address = workbenchAddress(active)
  const resource = props.useResource<'betterinteract'>(address)
  const reference = resource.value?.reference

  /** Move the selection and focus with the arrow keys inside the strip. */
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    if (tabs.sessionIds.length < 2) return
    event.preventDefault()
    const index = active === undefined ? 0 : tabs.sessionIds.indexOf(active)
    const step = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (index + step + tabs.sessionIds.length) % tabs.sessionIds.length
    const next = tabs.sessionIds[nextIndex]
    if (next === undefined) return
    select(next)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-workbench-tab]')[nextIndex]?.focus()
  }

  return <section className={css.root} data-better-interact-workbench="" data-shell-modal-fill=""
    data-shell-modal-surface="bare">
    {tabs.sessionIds.length > 0 && <div className={css.tabs} role="tablist" aria-label={t('tabs.label')}
      data-workbench-tabs="" onKeyDown={onTabKey}>
      {tabs.sessionIds.map((sessionId) => {
        const summary = summaries[sessionId]
        const label = summary?.blank === true
          ? t('tab.new')
          : (summary?.title?.trim() || summary?.displayTitle || sessionId)
        return <button key={sessionId} type="button" role="tab" id={`better-interact-workbench-tab-${sessionId}`}
          aria-selected={sessionId === active} aria-controls="better-interact-workbench-panel"
          tabIndex={sessionId === active ? 0 : -1} className={css.tab} data-workbench-tab=""
          data-active={sessionId === active || undefined} title={label}
          onClick={() => { select(sessionId) }}>
          <span className={css.tabTitle}>{label}</span>
        </button>
      })}
    </div>}
    <div id="better-interact-workbench-panel" className={css.panel} data-better-interact-panel=""
      role="tabpanel" aria-labelledby={active === undefined ? undefined : `better-interact-workbench-tab-${active}`}>
      {reference === undefined
        ? <p className={css.empty} data-better-interact-empty="">{t('workbench.empty')}</p>
        : <SessionProvider session={reference}>{renderSlot('better-interact.workbench.conversation', {})}</SessionProvider>}
    </div>
  </section>
}

/** Chat view the workbench always shows, hiding the transcript's other Views. */
export function FixedWorkbenchView(props: ConversationViewsProps) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

/** Props of the session-scoped entry `better-interact.workbench.conversation`. */
export type WorkbenchConversationProps =
  & PropsRuntime<'better-interact.workbench.conversation'>
  & PropsRenderFactories

/**
 * Compose the shared Conversation content for the workbench's bound Session.
 * @param props - bound Session state, its Conversation state, and the Factory renderer.
 * @returns the conversation content rooted at the Chat view.
 */
export function WorkbenchConversation(
  { sessionId, useSession, useConversation, useSessions, renderFactorySlot }:WorkbenchConversationProps) {
  const session = useSession(value => value)
  const conversation = useConversation(value => value)
  const active = conversation.activeTargets.size > 0
    || (!session.blank && !session.awaitingFirstTurn)
    || session.running
  const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
  const summaryBlank = useSessions(state => state.byId[sessionId]?.blank)
  const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true
  const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
  const phase = settling ? 'settling' : hero ? 'hero' : 'active'
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, {
    slots: { views: FixedWorkbenchView },
  })
}
