/** OS-global accelerator registration for system-scope shortcut commands. */
import { globalShortcut } from 'electron'
import { effectiveSystemShortcuts, systemAccelerator } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type {
  ShortcutCommandId, ShortcutDefinition, ShortcutDocument, ShortcutPlatform, ShortcutRevision,
  SystemShortcutRegistration, SystemShortcutState,
} from '@deepseek-ai/dsh-client-shortcuts/protocol'

/** The subset of Electron's `globalShortcut` module this owner drives; tests replace it. */
export interface GlobalShortcutCarrier {
  /** Register one accelerator; false means another application or the system owns it. */
  register(accelerator: string, callback: () => void): boolean
  /** Release one accelerator this application registered. */
  unregister(accelerator: string): void
  /** Release every accelerator this application registered. */
  unregisterAll(): void
  /** Whether this application currently owns one accelerator. */
  isRegistered(accelerator: string): boolean
}

/** Inputs for {@link DesktopGlobalShortcuts}. */
export interface DesktopGlobalShortcutOptions {
  /** Device platform selecting the accelerator grammar. */
  readonly platform: ShortcutPlatform
  /** Accepted shortcut revision attached to each forwarded activation. */
  readonly revision: () => ShortcutRevision | undefined
  /** Whether the recording layer currently owns input. */
  readonly recording: () => boolean
  /** Forward one OS-global activation to the product renderer. */
  readonly send: (commandId: ShortcutCommandId, revision: ShortcutRevision) => void
  /** Publish changed registration state to the product renderer. */
  readonly publish: (state: SystemShortcutState) => void
  /** Registration backend; defaults to Electron's process-global registry. */
  readonly carrier?: GlobalShortcutCarrier
}

/** Empty registration state for a platform that cannot host global accelerators. */
const PLATFORM_UNAVAILABLE: SystemShortcutState = { registrations: [], suspended: false, unavailable: 'platform' }

/**
 * Owns the OS-global accelerators of one Desktop process. Registration is
 * derived from the accepted shortcut catalog and document on every change, is
 * suspended while the recording layer captures keys, and is released on quit.
 */
export class DesktopGlobalShortcuts {
  readonly #carrier: GlobalShortcutCarrier
  readonly #options: DesktopGlobalShortcutOptions
  /** Accelerator this owner registered, mapped to the command it activates. */
  readonly #owned = new Map<string, { readonly id: ShortcutCommandId; readonly callback: () => void }>()
  #definitions: readonly ShortcutDefinition[] = []
  #document: ShortcutDocument = { schemaVersion: 3, profiles: {} }
  #suspended = false
  #state: SystemShortcutState = PLATFORM_UNAVAILABLE

  /**
   * @param options - platform, renderer callbacks, and the registration backend.
   */
  constructor(options: DesktopGlobalShortcutOptions) {
    this.#options = options
    this.#carrier = options.carrier ?? globalShortcut
    this.#state = options.platform === 'linux' ? PLATFORM_UNAVAILABLE
      : { registrations: [], suspended: false }
  }

  /**
   * Current registration state for the product renderer.
   * @returns every attempted command and the carrier-level availability.
   */
  state(): SystemShortcutState {
    return this.#state
  }

  /**
   * Reconcile OS registrations with the accepted catalog and document.
   * @param definitions - trusted shortcut definitions from the product catalog.
   * @param document - accepted preference document.
   */
  sync(definitions: readonly ShortcutDefinition[], document: ShortcutDocument): void {
    this.#definitions = definitions
    this.#document = document
    this.#apply()
  }

  /**
   * Suspend or restore registration around the shortcut recording layer.
   * @param active - whether the recording layer currently captures keys.
   */
  recording(active: boolean): void {
    if (this.#suspended === active) return
    this.#suspended = active
    if (active) this.#unregisterEvery()
    this.#apply()
  }

  /** Forget the catalog and release every accelerator while the page unloads. */
  reset(): void {
    this.#definitions = []
    this.#document = { schemaVersion: 3, profiles: {} }
    this.#apply()
  }

  /** Release every accelerator this owner registered. */
  dispose(): void {
    this.#unregisterEvery()
    this.#state = { registrations: [], suspended: this.#suspended }
  }

  #apply(): void {
    const platform = this.#options.platform
    if (platform === 'linux') {
      this.#publish(PLATFORM_UNAVAILABLE)
      return
    }
    if (this.#suspended) {
      this.#publish({ registrations: [], suspended: true })
      return
    }
    const desired = new Map<string, ShortcutCommandId>()
    for (const row of effectiveSystemShortcuts(this.#definitions, this.#document, platform)) {
      if (row.binding === null || row.issue !== null || row.conflicts.length > 0) continue
      if (desired.has(systemAccelerator(row.binding, platform))) continue
      desired.set(systemAccelerator(row.binding, platform), row.id)
    }
    for (const [accelerator, owned] of this.#owned) {
      const id = desired.get(accelerator)
      if (id === owned.id) continue
      this.#carrier.unregister(accelerator)
      this.#owned.delete(accelerator)
    }
    const registrations: SystemShortcutRegistration[] = []
    for (const [accelerator, id] of [...desired].sort(([left], [right]) => left.localeCompare(right))) {
      const owned = this.#owned.get(accelerator)
      if (owned === undefined) {
        const callback = (): void => { this.#activate(id) }
        const registered = this.#carrier.register(accelerator, callback)
        if (registered) this.#owned.set(accelerator, { id, callback })
        registrations.push({ id, accelerator, status: registered ? 'registered' : 'failed' })
        continue
      }
      registrations.push({ id, accelerator, status: 'registered' })
    }
    this.#publish({ registrations, suspended: false })
  }

  /** Forward one activation when the renderer's accepted revision is still current. */
  #activate(id: ShortcutCommandId): void {
    if (this.#suspended || this.#options.recording()) return
    const revision = this.#options.revision()
    if (revision === undefined) return
    this.#options.send(id, revision)
  }

  #unregisterEvery(): void {
    for (const accelerator of this.#owned.keys()) this.#carrier.unregister(accelerator)
    this.#owned.clear()
  }

  /** Publish only when the renderer-visible state changed. */
  #publish(next: SystemShortcutState): void {
    const signature = JSON.stringify(next)
    if (signature === JSON.stringify(this.#state)) return
    this.#state = next
    this.#options.publish(next)
  }
}
