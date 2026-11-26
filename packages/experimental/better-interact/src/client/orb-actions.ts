/**
 * Registration surface of the orb's options ring. A plugin adds one round
 * action around the mascot without rendering the ring, the button chrome, or
 * its placement; the orb renderer lays every registered action out.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { MAX_ORB_ACTIONS } from './orb-action-layout.ts'

/** Glyph of one orb action: a registered component, optionally drawing an image URL. */
export interface OrbActionIcon {
  /** Key of the `orb.action.icon` component that draws this action's glyph. */
  readonly key: string
  /** Optional image URL the keyed glyph may draw instead of its own artwork. */
  readonly src?: string
}

/** One round action contributed to the orb's options ring. */
export interface OrbAction {
  /** Stable id, unique among the actions registered in one renderer. */
  readonly id: string
  /** Localized accessible label and button tooltip, resolved when the ring renders. */
  readonly label: () => string
  /** Glyph slot of the round button. */
  readonly icon: OrbActionIcon
  /** Ring order; ties keep registration order. */
  readonly order?: number
  /** Run the action. The orb closes the ring before calling it. */
  readonly run: () => void
}

/** Presentation fields of one registered action, published to the orb renderer. */
export interface OrbActionView {
  /** Stable action id. */
  readonly id: string
  /** Localized accessible label and button tooltip. */
  readonly label: () => string
  /** Glyph slot of the round button. */
  readonly icon: OrbActionIcon
}

/** Client service plugins inject to contribute their own orb options. */
export interface OrbActions {
  /**
   * Add one action to the orb's options ring.
   * @param action - action to add; an id must not repeat and the ring holds at most `MAX_ORB_ACTIONS`.
   * @returns disposer removing the action and its button.
   */
  register(action: OrbAction): () => void
  /** Registered actions in ring order. */
  readonly items: HostObservable<readonly OrbActionView[]>
  /**
   * Run one registered action.
   * @param id - id of the action to run; an unknown id does nothing.
   */
  run(id: string): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Registration surface of the resident orb's options ring. */
    orbActions: OrbActions
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Glyph or image of one registered orb action, selected by its icon key. */
    'orb.action.icon': { kind: 'keyed'; scope: 'root'; inline: true; owner: { icon: OrbActionIcon } }
  }
}

/**
 * Create the per-renderer orb action registry.
 * @returns the service, its published views, and the run lookup.
 */
export function createOrbActions(): OrbActions {
  const store = createSnapshotStore<readonly OrbActionView[]>([])
  const registered = new Map<string, { readonly action: OrbAction; readonly sequence: number }>()
  let sequence = 0
  const publish = (): void => {
    const ordered = [...registered.values()].sort((left, right) =>
      (left.action.order ?? 0) - (right.action.order ?? 0) || left.sequence - right.sequence)
    store.set(ordered.map(({ action }) => ({ id: action.id, label: action.label, icon: action.icon })))
  }
  return {
    register(action) {
      if (registered.has(action.id)) throw new Error(`orb action ${JSON.stringify(action.id)} is already registered`)
      if (registered.size >= MAX_ORB_ACTIONS) {
        throw new Error(`the orb options ring holds at most ${String(MAX_ORB_ACTIONS)} actions`)
      }
      registered.set(action.id, { action, sequence: ++sequence })
      publish()
      return () => {
        if (registered.delete(action.id)) publish()
      }
    },
    items: {
      getSnapshot: () => store.getSnapshot(),
      subscribe: listener => store.subscribe(listener),
    },
    run(id) {
      registered.get(id)?.action.run()
    },
  }
}
