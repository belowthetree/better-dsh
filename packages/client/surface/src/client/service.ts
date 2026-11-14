/** Surface state over one carrier adapter, exposed to Client plugins as `ctx.surface`. */
import type { SurfaceSnapshot } from '../protocol.ts'
import type { SurfaceAdapter } from './adapters.ts'

/* jscpd:ignore-start -- the service restates the carrier commands so each layer owns its JSDoc and the adapter can add initial/read. */
/** Presentation state and carrier commands exposed to Client plugins as `ctx.surface`. */
export interface SurfaceService {
  /**
   * Read the current presentation snapshot.
   * @returns the current snapshot; the same reference until a field changes.
   */
  snapshot(): SurfaceSnapshot
  /**
   * Follow presentation changes for one consumer.
   * @param signal - aborts the iteration; the generator ends without throwing.
   * @returns the current snapshot followed by each changed snapshot.
   */
  follow(signal: AbortSignal): AsyncIterable<SurfaceSnapshot>
  /** Expand the orb into the panel presentation. */
  expand(): Promise<void>
  /** Collapse the panel back into the orb presentation. */
  collapse(): Promise<void>
  /**
   * Raise the modal presentation over the current one.
   * @param id - registered `shell.modal` entry id to display.
   */
  presentModal(id: string): Promise<void>
  /** Dismiss the modal presentation and restore the previous one. */
  dismissModal(): Promise<void>
  /**
   * Keep a collapsed or panel presentation above other windows.
   * @param pinned - whether the presentation stays visible.
   */
  setPinned(pinned: boolean): Promise<void>
  /**
   * Move the orb by a pointer delta.
   * @param deltaX - horizontal pointer delta in logical pixels.
   * @param deltaY - vertical pointer delta in logical pixels.
   */
  dragBy(deltaX: number, deltaY: number): Promise<void>
  /**
   * Report whether the pointer is over interactive content.
   * @param inside - whether the pointer is over the orb or its drag handle.
   */
  setPointerInside(inside: boolean): void
}
/* jscpd:ignore-end */

/** Whether two snapshots carry the same presentation fields. */
function samePresentation(left: SurfaceSnapshot, right: SurfaceSnapshot): boolean {
  return left.form === right.form
    && left.presentation === right.presentation
    && left.pinned === right.pinned
    && left.available === right.available
    && left.modal === right.modal
}

/** Carrier-backed surface state; one instance lives for one plugin lifetime. */
export class SurfaceRuntime implements SurfaceService {
  private current: SurfaceSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly adapter: SurfaceAdapter

  /** @param adapter - carrier commands, initial snapshot, and change notifications. */
  constructor(adapter: SurfaceAdapter) {
    this.adapter = adapter
    this.current = adapter.initial()
  }

  /**
   * Follow carrier notifications for one plugin lifetime.
   * @returns disposer removing the carrier subscription.
   */
  connect(): () => void {
    return this.adapter.subscribe((snapshot) => { this.publish(snapshot) })
  }

  /**
   * Read the current presentation snapshot.
   * @returns the current snapshot; the same reference until a field changes.
   */
  snapshot(): SurfaceSnapshot {
    return this.current
  }

  /** @returns the carrier's presentation changes until the signal aborts. */
  follow(signal: AbortSignal): AsyncIterable<SurfaceSnapshot> {
    return this.watch(signal)
  }

  /** Expand the orb into the panel presentation. */
  async expand(): Promise<void> {
    await this.command(() => this.adapter.expand())
  }

  /** Collapse the panel back into the orb presentation. */
  async collapse(): Promise<void> {
    await this.command(() => this.adapter.collapse())
  }

  /** Raise the modal presentation over the current one. */
  async presentModal(id: string): Promise<void> {
    await this.command(() => this.adapter.presentModal(id))
  }

  /** Dismiss the modal presentation and restore the previous one. */
  async dismissModal(): Promise<void> {
    await this.command(() => this.adapter.dismissModal())
  }

  /** Keep a collapsed or panel presentation above other windows. */
  async setPinned(pinned: boolean): Promise<void> {
    await this.command(() => this.adapter.setPinned(pinned))
  }

  /** Move the orb by a pointer delta; main clamps it to the work area. */
  async dragBy(deltaX: number, deltaY: number): Promise<void> {
    await this.command(() => this.adapter.dragBy(deltaX, deltaY))
  }

  /** Report whether the pointer is over interactive content. */
  setPointerInside(inside: boolean): void {
    this.adapter.pointerInside(inside)
  }

  /** Run one carrier command, then adopt the snapshot it settled into. */
  private async command(run: () => Promise<void>): Promise<void> {
    await run()
    this.publish(await this.adapter.read())
  }

  /** Adopt one carrier snapshot; silent when no presentation field changed. */
  private publish(next: SurfaceSnapshot): void {
    if (samePresentation(this.current, next)) return
    this.current = next
    for (const listener of [...this.listeners]) listener()
  }

  /** Yield the current snapshot, then each changed one, until the signal aborts. */
  private async *watch(signal: AbortSignal): AsyncGenerator<SurfaceSnapshot> {
    const pending: SurfaceSnapshot[] = []
    let release: (() => void) | undefined
    const resume = (): void => {
      const resolve = release
      release = undefined
      resolve?.()
    }
    const off = this.subscribe(() => {
      pending.push(this.current)
      resume()
    })
    const abort = (): void => { resume() }
    signal.addEventListener('abort', abort)
    try {
      yield this.current
      while (!signal.aborted) {
        if (pending.length === 0) {
          await new Promise<void>((resolve) => { release = resolve })
          continue
        }
        const next = pending.shift()
        /* v8 ignore next -- the empty check above guarantees an element. */
        if (next === undefined) continue
        yield next
      }
    } finally {
      signal.removeEventListener('abort', abort)
      off()
    }
  }

  /** Observe adopted snapshots; the watcher owns the returned disposer. */
  private subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
