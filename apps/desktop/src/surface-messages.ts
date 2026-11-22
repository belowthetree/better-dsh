/** Bounded delivery of role-and-channel renderer messages until the receiving subscription is ready. */

import type { SurfaceMessage, SurfaceMessageRole } from '@deepseek-ai/dsh-client-surface/protocol'

/** Maximum pending messages per role/channel and across one form runtime. */
const MAX_PENDING_PER_CHANNEL = 16
const MAX_PENDING_TOTAL = 64

interface PendingMessage {
  readonly target: SurfaceMessageRole
  readonly message: SurfaceMessage
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}

interface PendingChannel {
  readonly target: SurfaceMessageRole
  readonly channel: string
  readonly messages: PendingMessage[]
}

/** Owns renderer-message readiness, bounded queues, and their settlement. */
export class DesktopSurfaceMessageBroker {
  readonly #deliver: (target: SurfaceMessageRole, message: SurfaceMessage) => void
  readonly #ready = new Set<string>()
  readonly #channels = new Map<string, PendingChannel>()
  #pending = 0
  #disposed = false

  /** @param deliver - main-process send operation for a live target window. */
  constructor(deliver: (target: SurfaceMessageRole, message: SurfaceMessage) => void) {
    this.#deliver = deliver
  }

  /**
   * Deliver immediately when the target channel is ready, otherwise hold one bounded pending operation.
   * @param origin - authenticated sender role.
   * @param target - receiving role.
   * @param channel - consumer-owned channel.
   * @param payload - canonical JSON payload.
   * @returns after delivery, or a rejection when bounds, disposal, or target teardown prevent it.
   */
  async send(origin: SurfaceMessageRole, target: SurfaceMessageRole, channel: string, payload: unknown): Promise<void> {
    if (this.#disposed) throw new Error('desktop surface messages: broker is disposed')
    const key = keyOf(target, channel)
    if (this.#ready.has(key)) {
      this.#deliver(target, { origin, channel, payload })
      return
    }
    const queue = this.#channels.get(key) ?? { target, channel, messages: [] }
    if (queue.messages.length >= MAX_PENDING_PER_CHANNEL || this.#pending >= MAX_PENDING_TOTAL) {
      throw new Error(`desktop surface messages: pending limit reached for ${target}/${channel}`)
    }
    this.#channels.set(key, queue)
    await new Promise<void>((resolve, reject) => {
      queue.messages.push({
        target,
        message: { origin, channel, payload },
        resolve: () => { this.#pending -= 1; resolve() },
        reject: (error: Error) => { this.#pending -= 1; reject(error) },
      })
      this.#pending += 1
    })
  }

  /** Mark one target channel ready or unready, flushing its queue in original send order. */
  setReady(target: SurfaceMessageRole, channel: string, ready: boolean): void {
    const key = keyOf(target, channel)
    if (!ready) {
      this.#ready.delete(key)
      return
    }
    if (this.#disposed || this.#ready.has(key)) return
    this.#ready.add(key)
    const queue = this.#channels.get(key)
    if (queue === undefined) return
    this.#channels.delete(key)
    for (const pending of queue.messages) {
      try {
        this.#deliver(pending.target, pending.message)
        pending.resolve()
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  /** Reject every pending message for a destroyed target and forget its readiness. */
  drop(target: SurfaceMessageRole): void {
    for (const key of [...this.#ready]) if (key.startsWith(`${target}\0`)) this.#ready.delete(key)
    for (const [key, queue] of [...this.#channels]) {
      if (queue.target !== target) continue
      this.#channels.delete(key)
      const error = new Error(`desktop surface messages: target ${target} was destroyed`)
      for (const pending of queue.messages) pending.reject(error)
    }
  }

  /** Reject every pending operation and stop accepting messages. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const target of ['orb', 'surface', 'bubbles'] as const) this.drop(target)
  }
}

function keyOf(target: SurfaceMessageRole, channel: string): string {
  return `${target}\0${channel}`
}
