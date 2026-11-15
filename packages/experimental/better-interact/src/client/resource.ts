/** Workbench resource: the retained Session the dialog renders. */
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Registered `shell.modal` entry id of the workbench dialog. */
export const WORKBENCH_MODAL_ID = 'better-interact.workbench'

/** Resource protocol carrying one retained Session reference. */
export const WORKBENCH_PROTOCOL = 'betterinteract'

/** Address prefix of a workbench resource; the trailing segment is the Session id, empty when unknown. */
export const WORKBENCH_ADDRESS = 'dsh-resource://betterinteract/session/'

/** Value one workbench resource publishes. */
export interface BetterInteractResource {
  /** Retained Session reference; absent while no Session exists. */
  readonly reference?: SessionReference
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    betterinteract: BetterInteractResource
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    betterInteract: unknown
  }
}

/**
 * Address the workbench resource for one Session.
 * @param sessionId - Session the dialog renders, or undefined while the catalog is empty.
 * @returns canonical workbench resource address.
 */
export function workbenchAddress(sessionId: SessionId | undefined): string {
  return `${WORKBENCH_ADDRESS}${sessionId === undefined ? '' : encodeURIComponent(sessionId)}`
}

/**
 * Parse one workbench resource address.
 * @param address - possible workbench address.
 * @returns the encoded Session id, undefined for the empty catalog address, or throws for another resource.
 * @throws When the address belongs to another protocol or carries extra path segments.
 */
export function parseWorkbenchAddress(address: string): SessionId | undefined {
  const url = new URL(address)
  if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== 'betterinteract') {
    throw new Error(`better-interact: invalid workbench resource address "${address}"`)
  }
  const parts = url.pathname.replace(/^\//u, '').split('/')
  if (parts.length !== 2 || parts[0] !== 'session') throw new Error(`better-interact: invalid workbench resource address "${address}"`)
  const segment = parts[1] as string
  return segment === '' ? undefined : decodeURIComponent(segment) as SessionId
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
}

/**
 * Keep one Session retained for as long as the workbench shows it.
 * @param sessions - Session catalog the provider retains through.
 * @returns the resource provider that opens one Session reference per address.
 */
export function workbenchResourceProvider(sessions: ISessions): ResourceProvider<typeof WORKBENCH_PROTOCOL> {
  return {
    protocol: WORKBENCH_PROTOCOL,
    async *open(address, { signal }) {
      const sessionId = parseWorkbenchAddress(address)
      if (sessionId === undefined) {
        if (signal.aborted) return
        yield { ok: true, value: {} }
        await waitForAbort(signal)
        return
      }
      if (signal.aborted) return
      const reference = sessions.retain(sessionId, { source: 'betterInteract', signal })
      try {
        yield { ok: true, value: { reference } }
        await waitForAbort(signal)
      } finally {
        reference.release()
      }
    },
  }
}
