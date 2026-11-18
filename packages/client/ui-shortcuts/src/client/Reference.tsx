/** Searchable editable shortcut reference and its General Settings row. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, IconCloseOutlineRegular, IconRefreshOutlineRegular, Modal, ShortcutKeys, Tooltip, Toast, focusWithoutRing, isBehindModal } from '@deepseek-ai/dsh-client-ui-primitives'
import { TextSearchIndex } from '@deepseek-ai/dsh-util-text-search'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot, PropsStore } from '@deepseek-ai/dsh-client-store'
import type { ShortcutCatalogEntry, ShortcutCommandId, ShortcutFixedCatalogEntry, ShortcutPlatform, Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ShortcutEdit, ShortcutRevision, SystemShortcutState } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { ShortcutEditor } from './Editor.tsx'
import { ShortcutIcon } from './Icons.tsx'
import { shortcutFailure, shortcutReadFailure } from './feedback.ts'
import type { createShortcutsStore } from './store.ts'
import css from './Reference.module.css'

/** Catalog, carrier registration, and device labels delivered through renderer-bound hooks. */
export interface ReferenceInjected {
  platform: ShortcutPlatform
  runtime: Shortcuts['runtime']
  edit: Shortcuts['edit']
  recording: Shortcuts['recording']
  describeBinding: Shortcuts['describeBinding']
  hooks: {
    catalog: ObservableSnapshot<readonly ShortcutCatalogEntry[]>
    systemCatalog: Shortcuts['systemCatalog']
    global: Shortcuts['global']
    config: Shortcuts['config']
    fixedCatalog: Shortcuts['fixedCatalog']
  }
}
type Store = PropsStore<ReturnType<typeof createShortcutsStore>>
type Locale = PropsLocale<'shortcuts'>

/** Core reference positions are independent of labels and plugin registration order. */
const coreActionOrder = new Map<string, number>([
  'shortcuts.open',
  'session.new',
  'sidebar.left.toggle',
  'session.search',
  'workspace.add',
  'session.rename',
  'session.fork',
  'session.archive',
  'settings.open',
  'fontSize.increase',
  'fontSize.decrease',
  'workspace.openLocal',
  'sidebar.right.toggle',
  'workspace.files',
  'browser.new',
  'terminal.new',
  'pane.split',
  'pane.fullscreen.toggle',
  'page.refresh',
  'page.close',
].map((id, index) => [id, index]))

/** Reference groups in display order; OS-global commands follow application commands. */
const groups = ['application', 'global', 'input', 'menus', 'approval'] as const
/** Why the Global group cannot offer controls, keyed by the carrier's reported availability. */
const globalUnavailableCopy = { web: 'global-web', platform: 'global-platform', carrier: 'global-carrier' } as const

/** Editable command row tagged with its reference group and search names. */
type EditableEntry = ShortcutCatalogEntry & { readonly group: 'application' | 'global'; readonly names: readonly string[] }
/** Read-only fixed action with its search names. */
type FixedEntry = ShortcutFixedCatalogEntry & { readonly names: readonly string[] }
type ReferenceEntry = EditableEntry | FixedEntry

/**
 * Join one command's OS-global registration report by command ID.
 * @param state - carrier state reported for the current run.
 * @param id - command whose accelerator was requested.
 * @returns the carrier outcome, or suspended while the recording layer owns input.
 */
function registrationState(state: SystemShortcutState, id: ShortcutCommandId): 'registered' | 'failed' | 'suspended' {
  if (state.suspended) return 'suspended'
  return state.registrations.find(row => row.id === id)?.status ?? 'registered'
}

/**
 * Build the search keys for one editable command.
 * @param row - effective command with visible keycaps and ARIA text.
 * @returns aliases, both keycap spellings, and the ARIA combination.
 */
function searchNames(row: ShortcutCatalogEntry): readonly string[] {
  const keys = row.keys.filter(key => key !== '+')
  return [...row.aliases, keys.join('+'), keys.join(''), row.aria ?? '', row.aria?.replace('Meta', 'Cmd') ?? '']
}

/**
 * Distinguish editable commands from read-only fixed actions.
 * @param row - searchable reference row.
 * @returns whether the row exposes an editable binding.
 */
function isEditable(row: ReferenceEntry): row is EditableEntry {
  return 'modified' in row
}

/**
 * Render the General Settings action that opens the shortcut reference.
 * @param props - shared dialog action and localized labels.
 * @returns the settings row.
 */
export function ShortcutsRow({ actions, t, useCatalog }: PropsRuntime<'settings.general.item'> & Store & Locale & InjectFace<ReferenceInjected>) {
  const shortcut = useCatalog(rows => rows.find(row => row.id === 'shortcuts.open'))
  return <div className={css.setting}>
    <div className={css.settingText}>
      <div className={css.settingTitle}>{t('settings')}</div>
      <p className={css.settingDescription}>{t('description')}</p>
    </div>
    <Tooltip disabled={!shortcut?.keys.length} label={t('global-hint')} shortcutKeys={shortcut?.keys}>
      <button className={css.button} type="button" aria-label={t('view')} aria-keyshortcuts={shortcut?.aria}
        onClick={() => { actions.open() }}>{t('view')}</button>
    </Tooltip>
  </div>
}

/**
 * Render core actions in product order, then other commands by ID within each group. Search relevance takes precedence.
 * @param props - root store, effective catalogs, carrier state, and localized copy.
 * @returns the single reference dialog when open.
 */
export function ShortcutReference({
  useStore, actions, useCatalog, useSystemCatalog, useGlobal, useConfig, useFixedCatalog,
  platform, runtime, edit, recording, describeBinding, t,
}:
  PropsRuntime<'shell.overlay'> & Store & Locale & InjectFace<ReferenceInjected>) {
  const { open, query, focusRequest } = useStore(state => state)
  const catalog = useCatalog(value => value)
  const systemCatalog = useSystemCatalog(value => value)
  const globalState = useGlobal(value => value)
  const config = useConfig(value => value)
  const fixedCatalog = useFixedCatalog(value => value)
  const [target, setTarget] = useState<ShortcutCatalogEntry | null>(null)
  const [reset, setReset] = useState<{ revision: ShortcutRevision; scope: 'application' | 'system' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ text: string; error: boolean; seq: number } | null>(null)
  const mounted = useRef(true)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const dismissToast = useCallback(() => { setToast(null) }, [])
  const notify = useCallback((text: string, error = false): void => {
    setToast((previous) => {
      if (error && previous?.error && previous.text === text) return previous
      return { text, error, seq: (previous?.seq ?? 0) + 1 }
    })
  }, [])
  useEffect(() => {
    if (open && config.status === 'unreadable') notify(shortcutReadFailure(config, runtime, t), true)
  }, [open, config, runtime, notify, t])
  const closeEditor = (): void => {
    setTarget(null)
    const dialog = search.current?.closest<HTMLElement>('[role="dialog"]')
    /* v8 ignore next -- Editor callbacks run while its reference dialog and search input are mounted. */
    if (dialog != null) focusWithoutRing(dialog, { preventScroll: true })
  }
  const closeReference = (): void => {
    if (busy) return
    /* v8 ignore next -- The confirmation modal blocks the reference's close control. */
    if (reset !== null) setReset(null)
    else if (target !== null) closeEditor()
    else actions.close()
  }
  useEffect(() => { if (!open) setReset(null) }, [open])
  const persist: typeof edit = async (...args) => {
    setBusy(true)
    const result = await edit(...args)
    if (mounted.current) setBusy(false)
    return result
  }
  const resetAll = async (): Promise<void> => {
    /* v8 ignore next -- The reset control is accessible only while its confirmation is open. */
    if (reset === null) return
    const operation: ShortcutEdit = reset.scope === 'system' ? { type: 'reset-all', scope: 'system' } : { type: 'reset-all' }
    const result = await persist(operation, reset.revision)
    if (!mounted.current) return
    if (result.status === 'saved' || result.status === 'stale') setReset(null)
    notify(result.status === 'saved' ? t('reset-saved')
      : result.status === 'write-failed' ? t('reset-failed') : shortcutFailure(result, [...catalog, ...systemCatalog], t, runtime), result.status !== 'saved')
  }
  const editorProps = { useCatalog, useSystemCatalog, useConfig, useFixedCatalog, platform, runtime,
    edit: persist, recording, describeBinding, t, onClose: closeEditor,
    onSaved: () => { notify(t('saved')); closeEditor() },
    onError: (message: string) => { notify(message, true) } }
  useLayoutEffect(() => {
    const input = search.current
    if (open && input !== null && !isBehindModal(input)) focusWithoutRing(input)
  }, [open, focusRequest])
  // Stop stays after the other fixed input actions.
  const entryIndex = useMemo(() => new TextSearchIndex<ReferenceEntry>([
    ...catalog.map(row => ({
      ...row,
      names: [...row.aliases, row.keys.filter(key => key !== '+').join('+'), row.keys.filter(key => key !== '+').join(''), row.aria ?? '', row.aria?.replace('Meta', 'Cmd') ?? ''],
      group: 'application' as const,
    })),
    ...systemCatalog.map(row => ({
      ...row,
      names: searchNames(row),
      group: 'global' as const,
    })),
    ...fixedCatalog.map(row => ({ ...row, names: [row.id, row.keys.join(' ')] })),
  ].sort((left, right) => Number(left.id === 'response.stop') - Number(right.id === 'response.stop')
    || (coreActionOrder.get(left.id) ?? coreActionOrder.size) - (coreActionOrder.get(right.id) ?? coreActionOrder.size)
    || Number(left.id > right.id) - Number(left.id < right.id)),
  row => ({ fuzzy: [row.label, ...row.names] })),
  [catalog, fixedCatalog, systemCatalog])
  const matches = entryIndex.search(query)
  const modifiedCount = Object.keys(config.document.profiles[`${runtime}:${platform}`] ?? {}).length
  const systemModifiedCount = Object.keys(config.document.system ?? {}).length
  const globalLocked = runtime === 'web' ? 'web' : globalState.unavailable ?? null
  const groupCopy = globalLocked === null
    ? t(globalState.suspended ? 'global-suspended' : 'global-description')
    : t(globalUnavailableCopy[globalLocked])
  useLayoutEffect(() => {
    const input = search.current
    if (open && reset === null && modifiedCount === 0 && document.activeElement === document.body && input !== null) {
      focusWithoutRing(input)
    }
  }, [open, reset, modifiedCount])
  const editableRow = (row: EditableEntry) => <li key={row.id} className={row.group === 'global' ? `${css.row} ${css.globalRow}` : css.row}>
    {target?.id !== row.id && <button type="button" className={css.rowButton}
      aria-label={t('edit-label', { command: row.label })} disabled={busy || config.status !== 'ready'}
      onClick={() => { setTarget(row) }} />}
    <span className={css.commandLabel}>{row.label}</span>
    <span className={css.binding}>
      {target?.id === row.id
        ? <ShortcutEditor key={row.id} target={row} {...editorProps} />
        : <>
          <span className={css.rowActions}><ShortcutIcon kind="edit" /></span>
          {row.keys.length === 0 ? <span className={css.unbound}>{t('unbound')}</span> : <ShortcutKeys keys={row.keys} className={css.keyBadge} />}
        </>}
    </span>
    {row.group === 'global' && registrationState(globalState, row.id) === 'failed'
      && <p className={css.rowWarning} role="status">{t('global-failed')}</p>}
  </li>
  const fixedRow = (row: FixedEntry) => <li key={row.id} className={css.row}>
    <span className={css.commandLabel}>{row.label}</span>
    <span className={css.binding}><ShortcutKeys keys={row.keys} className={css.fixedKeyBadge} /></span>
  </li>
  return <><Modal open={open} onClose={closeReference} title={t('title')} headless
    shortcutModal="shortcuts" className={css.dialog as string}>
    <div className={css.contents} onPointerDownCapture={(event) => {
      if (target === null || busy || !(event.target instanceof Element) || event.target.closest('button, input, a, [contenteditable="true"], [role="group"]') !== null) return
      event.preventDefault()
      closeEditor()
    }}>
      <header className={css.header}>
        <h2 className={css.title}>{t('title')}</h2>
        <button type="button" className={css.close} aria-label={t('close')} disabled={busy} onClick={closeReference}>
          <IconCloseOutlineRegular size={14} />
        </button>
      </header>
      <div className={css.searchRow}>
        <div className={css.searchField} role="search" aria-label={t('search')}>
          <svg className={css.searchIcon} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M10.28 5.86536C10.28 3.41381 8.29245 1.42644 5.84094 1.42627C3.38929 1.42627 1.40186 3.4137 1.40186 5.86536C1.40203 8.31686 3.38939 10.3044 5.84094 10.3044C8.29234 10.3043 10.2799 8.31676 10.28 5.86536ZM11.4174 5.86536C11.4172 8.94498 8.92057 11.4416 5.84094 11.4418C2.76117 11.4418 0.263843 8.94509 0.263672 5.86536C0.263672 2.78548 2.76106 0.288086 5.84094 0.288086C8.92067 0.288258 11.4174 2.78559 11.4174 5.86536Z" fill="currentColor" />
            <path d="M13.7372 12.9078L12.9323 13.7127L9.9732 10.7536L10.7781 9.94867L13.7372 12.9078Z" fill="currentColor" />
          </svg>
          <input ref={search} data-modal-autofocus className={css.search} type="search" aria-label={t('search')}
            placeholder={t('search')} value={query} onChange={(event) => { actions.search(event.target.value) }} />
          {query !== '' && <button type="button" className={css.clearSearch} aria-label={t('clear-search')}
            onClick={() => { actions.search(''); search.current?.focus() }}><IconCloseOutlineRegular size={10} /></button>}
        </div>
      </div>
      <div className={css.list} aria-busy={config.status === 'loading'}>
        {groups.map((group) => {
          const rows = matches.filter(row => row.group === group)
          if (rows.length === 0) return null
          if (group === 'global') return <section key={group} aria-label={t(group)}>
            <h3 className={css.group}>{t(group)}</h3>
            <p className={css.groupDescription}>{groupCopy}</p>
            {globalLocked === null && <>
              <ul className={css.rows}>{rows.filter(isEditable).map(editableRow)}</ul>
              <div className={css.groupFooter}>
                <button type="button" className={css.resetAll} disabled={busy || config.status !== 'ready' || systemModifiedCount === 0}
                  onClick={(event) => { event.currentTarget.focus(); setTarget(null); setReset({ revision: config.revision, scope: 'system' }) }}>
                  <IconRefreshOutlineRegular size={12} />{t('global-reset-all')}
                </button>
                {systemModifiedCount > 0 && <span className={css.modifiedCount}>{t('modified-count', { count: systemModifiedCount })}</span>}
              </div>
            </>}
          </section>
          return <section key={group} aria-label={t(group)}>
            {group !== 'application' && <h3 className={css.group}>{t(group)}</h3>}
            <ul className={css.rows}>{rows.map(row => isEditable(row) ? editableRow(row) : fixedRow(row))}</ul>
          </section>
        })}
        {matches.length === 0 && <p className={css.hint} role="status">{t('empty')}</p>}
      </div>
      <footer className={css.footer}>
        <button type="button" className={css.resetAll} disabled={busy || config.status !== 'ready' || modifiedCount === 0}
          onClick={(event) => { event.currentTarget.focus(); setTarget(null); setReset({ revision: config.revision, scope: 'application' }) }}>
          <IconRefreshOutlineRegular size={12} />{t('reset-all')}
        </button>
        {modifiedCount > 0 && <span className={css.modifiedCount}>{t('modified-count', { count: modifiedCount })}</span>}
      </footer>
    </div>
  </Modal>
  <Modal open={open && reset !== null} title={t(reset?.scope === 'system' ? 'global-reset-title' : 'reset-title')}
    description={t(reset?.scope === 'system' ? 'global-reset-description' : 'reset-description')}
    closeLabel={t('close-confirmation')} onClose={() => { if (!busy) setReset(null) }}
    footer={<>
      <Button data-modal-autofocus disabled={busy} onClick={() => { setReset(null) }}>{t('cancel')}</Button>
      <Button variant="primary" disabled={busy || config.status !== 'ready'} onClick={() => { void resetAll() }}>{t('reset')}</Button>
    </>} />
  {toast !== null && <Toast key={toast.seq} text={toast.text} onDone={dismissToast}
    icon={<ShortcutIcon kind={toast.error ? 'error' : 'success'} className={toast.error ? css.toastError : css.toastSuccess} />} />}
  </>
}
