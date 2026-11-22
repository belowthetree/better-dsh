/**
 * Plugin manager, browser half: the **Plugins** entry of the sidebar and the
 * management page it opens in the main column, or in the frame's modal card on
 * a form profile, which renders no column. The page installs, enables,
 * disables, and removes the bundles of the Host's profile through the
 * `pluginManager` Remote and switches their rows in the profile's user layer.
 * A plugin that carries its own configuration renders it on this page through
 * the slots the page declares (`slot-contract.ts`).
 */
import type {} from '@deepseek-ai/dsh-client-product-analytics/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.modules Context merge.
import type {} from '@deepseek-ai/dsh-client-modules/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the root `main` keyed slot and the `shell.modal` list slot the
// page registers into, declared by ui-layout with the panel id brand, and the
// `sidebar.panellist` list the entry registers into, declared by ui-sidebar.
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ctx.surface Context merge, and the size hint the form
// profile's modal presentation accepts.
import type { ModalSizeHint } from '@deepseek-ai/dsh-client-surface/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remoteAccess Context merge.
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the forwarded events' own declaration (`$on`'s key face resolves
// through the owning package's client-safe types subpath).
import type {} from '@deepseek-ai/dsh-plugin-manager/types'
import { PluginManagerPage } from './PluginManagerPage.tsx'
import { PluginsModalPage } from './PluginsModalPage.tsx'
import { createPluginHeaderRef } from './header-scroll.ts'
import { PluginRefreshToast, type PluginRefreshToastFace } from './PluginRefreshToast.tsx'
import { PluginsPanelIcon } from './PluginsPanelIcon.tsx'
import { PluginsSettingsLink, type PluginsSettingsLinkInjected } from './PluginsSettingsLink.tsx'
import { configLedgerSource } from './config-ledger.ts'
import { tabLedgerSource } from './tab-ledger.ts'
import { PluginManagerController } from './manager-store.ts'
import { en, ja, es, fr, de, ru, pt, zh, type PluginManagerLocaleKey } from './locales.ts'
import { createNavigationStore } from './navigation-store.ts'
import type {} from './slot-contract.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Read-only management activity, independent of the visible Plugins page. */
    pluginChanges: {
      /**
       * Observe whether a bundle or one of its rows is being changed.
       * @param packageName Bundle package name.
       * @returns A snapshot source whose subscriptions belong to the caller.
       */
      bundle(packageName: string): HostObservable<boolean>
    }

    /** Cross-plugin navigation to the Plugins page. */
    pluginNavigation: {
      /**
       * Open a bundle's details without changing the current Session.
       * An absent bundle displays the plugin list after loading.
       * @param packageName - npm package name of the bundle.
       */
      openBundle(packageName: string): void
      /**
       * Open the Plugins main list without opening a dialog or changing the
       * current Session. A form profile, which renders no main column,
       * presents the page in its modal card instead.
       */
      openList(): void
    }
  }
}

export type { PluginManagerPageProps } from './PluginManagerPage.tsx'
export type { ConfigLedger, OfficialItem, SettingsSectionItem } from './config-ledger.ts'
export type { PluginManagerFace } from './manager-store.ts'
export type { PluginManagerLocaleKey } from './locales.ts'
export type {
  ConfigPageForm, PluginActivationOwnerProps, PluginAddActionsProps, PluginTabInstall, PluginTabProps, PluginTabUpdate,
  PluginConfigViewProps, PluginDetailProps, PluginPackageRef, PluginRowRef, PluginsSubject,
} from './slot-contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugin manager tab copy. */
    'pluginManager': PluginManagerLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'pluginManager'

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'plugins' as MainPanelId

/**
 * Dialog size of the form profile's Plugins card: the page's 960-pixel column
 * plus its own insets, inside the frame's 24-pixel backdrop margin.
 */
const PLUGINS_MODAL_SIZE: ModalSizeHint = { heightRatio: 0.85, width: 1152 }

/**
 * Slots the page declares for other plugins' contributions. The page has one
 * declaring registration per profile — the main column, or the form profile's
 * modal card — so the two placements share this table.
 */
const PAGE_CHILDREN = {
  'plugins.add.actions': { kind: 'list', scope: 'root' },
  'plugins.tab': { kind: 'list', scope: 'root' },
  'plugins.item': { kind: 'list', scope: 'root' },
  'plugins.bundle.activation': { kind: 'keyed', scope: 'root' },
  'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
  'plugins.row.config': { kind: 'keyed', scope: 'root' },
  'plugins.detail.actions': { kind: 'list', scope: 'root' },
  'plugins.detail.badge': { kind: 'list', scope: 'root' },
  'plugins.detail.section': { kind: 'list', scope: 'root' },
} as const

/** Services required by the sidebar registration, the Remote methods, and access; the inventory says whether the Host manages a profile. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginManager', 'remote.pluginInventory', 'remote.pluginRegistryProbe', 'configForms', 'layout', 'remoteAccess', 'modules', 'surface']

/**
 * Contribute the Plugins entry to the sidebar with the management page it
 * opens, and keep it current on the Host's change events, while the current
 * Peer may list the installed bundles.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-plugin-manager: dictionaries')
  const t = ctx.locale.bind(NS)
  const controller = new PluginManagerController(ctx)
  ctx.effect(() => () => { controller.dispose() }, 'ui-plugin-manager: controller')
  ctx.provide('pluginChanges', { bundle: packageName => controller.observeChanges(packageName) })
  // The page is a global panel: it belongs to the profile, not to a Session,
  // and the sidebar's entry selects it. What is installed and switched on is
  // the page's own; a plugin's configuration arrives through the slots the
  // page declares here, so the page never names a configurable plugin.
  const configLedger = configLedgerSource(ctx)
  const face = controller.inject(configLedger, tabLedgerSource(ctx), text => ctx.locale.resolveText(text))
  ctx.remoteAccess.whenAccess('pluginManager/listBundles', function* () {
    // The Host says when what is installed, enabled, or composed changed — from
    // this page, the CLI, or another browser — and streams install output.
    // A page never rendered holds no snapshot to refresh.
    const refresh = (): void => {
      // A profile change can replace a bundle's files, and a restarted Host is read afresh.
      controller.details.reset()
      if (controller.getSnapshot().status !== 'idle') void controller.load()
    }
    // Host changes made while access was withdrawn reached no subscription below.
    refresh()
    yield ctx.remote.$on('plugin-manager/changed', refresh)
    yield ctx.remote.$on('plugin-manager/install-log', (chunk) => { controller.appendLog(chunk) })
    yield ctx.remote.$on('plugin-manager/install-state', (progress) => { controller.installProgress(progress) })
    yield ctx.remote.$on('plugin-manager/update-state', (progress) => { controller.updateProgress(progress) })
    yield ctx.on('connection/reset', refresh)
    yield ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'plugin-manager.refresh-toast', locale: NS,
      inject: (): PluginRefreshToastFace => ({
        hooks: { pluginManager: face.hooks.pluginManager },
        dismissNotice: face.dismissNotice,
      }),
    }, PluginRefreshToast))
    // A form profile renders no main column, so its Plugins page lives in the
    // frame's modal card: the settings entry and every navigation caller
    // present that card instead of selecting a panel.
    const formProfile = ctx.surface.snapshot().presentation !== 'classic'
    const handle = createNavigationStore(), instance = handle.create()
    const store: typeof handle = { ...handle, create: () => instance }
    const pageInjected = () => ({
      ...face,
      createHeaderRef: createPluginHeaderRef,
      hooks: { ...face.hooks, clientSync: ctx.modules.entries.state },
      retryClient: () => { void ctx.modules.entries.retry().catch((error: unknown) => { ctx.logger.error(error) }) },
    })
    /** Show the page where this shell renders it: the main column, or the form modal. */
    const showPage = (): void => {
      if (!formProfile) { ctx.layout.selectPanel(PANEL_ID); return }
      ctx.surface.presentModal(PANEL_ID, PLUGINS_MODAL_SIZE).catch((error: unknown) => {
        ctx.logger.error(error)
      })
    }
    const openList = (): void => {
      showPage()
      instance.actions.setTab('installed')
      instance.actions.setView({ kind: 'list' })
    }
    // The classic shell shows the page in its main column; a form profile
    // renders no column, so the page occupies the frame's modal card instead.
    // A slot key has one declaring owner, so a profile registers exactly one;
    // the main column's placement leads because it owns the page's slots in the
    // shipped composition.
    if (!formProfile) {
      yield ctx.slots.inject('main', function* () {
        yield ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          store,
          inject: pageInjected,
          children: PAGE_CHILDREN,
        }, PluginManagerPage)
        yield ctx.layout.panelInfo.subscribe(() => {
          if (ctx.layout.panelInfo.getSnapshot().activePanelId !== PANEL_ID) instance.actions.setView({ kind: 'list' })
        })
      })
    } else {
      yield ctx.slots.inject('shell.modal', () => ctx.slots.register({
        name: 'shell.modal',
        id: PANEL_ID,
        locale: NS,
        store,
        inject: pageInjected,
        children: PAGE_CHILDREN,
      }, PluginsModalPage))
    }
    const disposeNavigation = ctx.reflect.provide('pluginNavigation', {
      openList,
      openBundle: (packageName: string) => {
        showPage()
        instance.actions.setTab('installed')
        instance.actions.setView({ kind: 'package', name: packageName })
      },
    })
    yield () => { void disposeNavigation() }
    // Settings lists one entry that leads here.
    yield ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: PANEL_ID,
      order: 15,
      label: () => t('settingsEntry'),
      inject: (): PluginsSettingsLinkInjected => ({ openPlugins: openList, dismissSettings: !formProfile }),
    }, PluginsSettingsLink))
    yield ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 0,
      label: () => t('panel'),
      locale: NS,
    }, PluginsPanelIcon))
  })
}
