import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { SessionController } from '../src/index.ts'

const sessionId = brandString<SessionId>('session-delete-target')

/** A controller whose only initialized dependencies are those the delete path reads. */
function bench(options: {
  readonly running?: boolean
  readonly runningAfterInspect?: boolean
  readonly liveIdle?: boolean
  readonly stillLive?: boolean
  readonly owned?: boolean
  readonly stored?: boolean
  readonly persistence?: boolean
  readonly children?: readonly SessionId[]
  readonly listError?: Error
  readonly disposeError?: Error
  readonly accountingError?: Error
  readonly cacheError?: Error
  readonly deleteError?: unknown
} = {}) {
  const ctx = new Context()
  const removed: SessionId[] = []
  ctx.on('api-session/removed', (id) => { removed.push(id) })
  const live = { value: options.running === true || options.liveIdle === true }
  const status = { value: options.running === true ? 'running' : 'idle' }
  ctx.provide('agents', { get: () => live.value ? { id: sessionId, status: status.value } : undefined } as never)
  ctx.provide('sessions', {
    get: () => options.stillLive === true || live.value ? { id: sessionId } : undefined,
  } as never)
  const persistence = {
    stat: vi.fn(async () => options.stored === false ? undefined : { header: { id: sessionId }, revision: 'revision' }),
    delete: vi.fn(async () => { if (options.deleteError !== undefined) throw options.deleteError }),
  }
  if (options.persistence !== false) ctx.provide('sessionPersistence', persistence as never)
  const records = (options.children ?? []).map(id => ({
    header: { id, origin: 'subagent' as const, parentSession: sessionId }, live: false, persisted: true,
  }))
  ctx.provide('sessionQuery', {
    listSessions: vi.fn(async () => {
      if (options.listError !== undefined) throw options.listError
      if (options.runningAfterInspect === true) {
        live.value = true
        status.value = 'running'
      }
      return records
    }),
  } as never)
  const workspace = {
    detachSession: vi.fn(async () => { if (options.accountingError !== undefined) throw options.accountingError }),
  }
  const workspaceRegistry = {
    list: vi.fn(() => [workspace]),
    unarchiveSession: vi.fn(async () => {}),
    unpinSession: vi.fn(async () => {}),
  }
  ctx.provide('workspaceRegistry', workspaceRegistry as never)
  const cache = { evict: vi.fn(async () => { if (options.cacheError !== undefined) throw options.cacheError }) }
  ctx.provide('sessionProjectionCache', cache as never)
  const controller = new SessionController(ctx, { nativeOpen: false, listWorkSliceMs: 16 })
  const disposeAgent = vi.fn(async () => {
    if (options.disposeError !== undefined) throw options.disposeError
    if (options.owned === false) return false
    live.value = false
    return true
  })
  Object.assign(controller, { agents: { disposeAgent } })
  return { ctx, controller, persistence, workspace, workspaceRegistry, cache, removed, disposeAgent }
}

const signal = new AbortController().signal

describe('SessionController permanent deletion', () => {
  it('removes the stored session, detaches its accounting, evicts its cache, and announces the removal', async () => {
    const b = bench()
    await expect(b.controller.delete({ sessionId }, signal)).resolves.toEqual({ deleted: true })
    expect(b.persistence.delete).toHaveBeenCalledWith(sessionId, { signal })
    expect(b.workspace.detachSession).toHaveBeenCalledWith(sessionId)
    expect(b.workspaceRegistry.unarchiveSession).toHaveBeenCalledWith(sessionId)
    expect(b.workspaceRegistry.unpinSession).toHaveBeenCalledWith(sessionId)
    expect(b.cache.evict).toHaveBeenCalledWith(sessionId)
    expect(b.removed).toEqual([sessionId])
  })

  it('stops an idle Agent it owns before deleting its log', async () => {
    const b = bench({ liveIdle: true })
    await expect(b.controller.delete({ sessionId }, signal)).resolves.toEqual({ deleted: true })
    expect(b.disposeAgent).toHaveBeenCalledWith(sessionId)
    expect(b.persistence.delete).toHaveBeenCalledOnce()
  })

  it('treats a Session that disappeared with its stopped Agent as deleted', async () => {
    const b = bench({ liveIdle: true })
    b.persistence.stat
      .mockResolvedValueOnce({ header: { id: sessionId }, revision: 'revision' })
      .mockResolvedValueOnce(undefined)
    await expect(b.controller.delete({ sessionId }, signal)).resolves.toEqual({ deleted: true })
    expect(b.disposeAgent).toHaveBeenCalledWith(sessionId)
    expect(b.persistence.delete).not.toHaveBeenCalled()
    expect(b.workspace.detachSession).toHaveBeenCalledWith(sessionId)
  })

  it('refuses a running session without stopping it or touching persistence', async () => {
    const b = bench({ running: true })
    await expect(b.controller.delete({ sessionId }, signal)).rejects.toMatchObject({ code: 'session/delete-active' })
    expect(b.disposeAgent).not.toHaveBeenCalled()
    expect(b.persistence.delete).not.toHaveBeenCalled()
  })

  it('refuses a live session whose Agent another consumer owns', async () => {
    const b = bench({ liveIdle: true, owned: false })
    await expect(b.controller.delete({ sessionId }, signal)).rejects.toMatchObject({ code: 'session/delete-active' })
    expect(b.persistence.delete).not.toHaveBeenCalled()
  })

  it('refuses a missing stored session', async () => {
    const b = bench({ stored: false })
    await expect(b.controller.delete({ sessionId }, signal)).rejects.toMatchObject({ code: 'session/not-found' })
    expect(b.persistence.delete).not.toHaveBeenCalled()
  })

  it('refuses a session when the deployment mounts no persistence backend', async () => {
    const b = bench({ persistence: false })
    await expect(b.controller.delete({ sessionId }, signal)).rejects.toMatchObject({
      code: 'session/not-found',
      message: expect.stringContaining('is not stored') as string,
    })
    expect(b.removed).toEqual([])
  })

  it('maps a catalog inspection failure to gateway/internal', async () => {
    const b = bench({ listError: new Error('catalog unavailable') })
    await expect(b.controller.delete({ sessionId }, signal)).rejects.toMatchObject({
      code: 'gateway/internal',
      message: expect.stringContaining('cannot inspect') as string,
    })
    expect(b.persistence.delete).not.toHaveBeenCalled()
  })

  it('refuses a session that started work while being inspected', async () => {
    const b = bench({ liveIdle: true, runningAfterInspect: true })
    await expect(b.controller.delete({ sessionId }, signal)).rejects.toMatchObject({
      code: 'session/delete-active',
      message: expect.stringContaining('started work while deleting') as string,
    })
    expect(b.disposeAgent).not.toHaveBeenCalled()
    expect(b.persistence.delete).not.toHaveBeenCalled()
  })

  it('maps a failed Agent stop to delete-active', async () => {
    const b = bench({ liveIdle: true, disposeError: new Error('teardown failed') })
    await expect(b.controller.delete({ sessionId }, signal)).rejects.toMatchObject({
      code: 'session/delete-active',
      message: expect.stringContaining('could not be stopped') as string,
    })
    expect(b.persistence.delete).not.toHaveBeenCalled()
  })

  it('refuses a session still live after its Agent stopped', async () => {
    const b = bench({ liveIdle: true, stillLive: true })
    await expect(b.controller.delete({ sessionId }, signal)).rejects.toMatchObject({
      code: 'session/delete-active',
      message: expect.stringContaining('still live after stopping') as string,
    })
    expect(b.persistence.delete).not.toHaveBeenCalled()
  })

  it('maps an unknown backend rejection to gateway/internal', async () => {
    const b = bench({ deleteError: 'backend exploded' })
    await expect(b.controller.delete({ sessionId }, signal)).rejects.toMatchObject({
      code: 'gateway/internal',
      message: expect.stringContaining('backend exploded') as string,
    })
    expect(b.removed).toEqual([])
  })

  it('logs a Workspace accounting failure after the log is removed', async () => {
    const b = bench({ accountingError: new Error('detach failed') })
    const warn = vi.spyOn(b.ctx.logger, 'warn').mockImplementation(() => {})
    await expect(b.controller.delete({ sessionId }, signal)).resolves.toEqual({ deleted: true })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Workspace accounting was not'))
    expect(b.cache.evict).toHaveBeenCalledWith(sessionId)
    expect(b.removed).toEqual([sessionId])
  })

  it('logs a projection checkpoint failure after the log is removed', async () => {
    const b = bench({ cacheError: new Error('evict failed') })
    const warn = vi.spyOn(b.ctx.logger, 'warn').mockImplementation(() => {})
    await expect(b.controller.delete({ sessionId }, signal)).resolves.toEqual({ deleted: true })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('projection checkpoint was not'))
    expect(b.removed).toEqual([sessionId])
  })

  it('refuses a parent of subagent sessions and names the children', async () => {
    const child = brandString<SessionId>('session-delete-child')
    const b = bench({ children: [child] })
    await expect(b.controller.delete({ sessionId }, signal)).rejects.toMatchObject({
      code: 'session/delete-has-children', details: { sessionId, childSessionIds: [child] },
    })
    expect(b.persistence.delete).not.toHaveBeenCalled()
  })

  it('maps a backend without deletion support and a busy backend to stable failures', async () => {
    const unsupported = Object.assign(new Error('unsupported'), { name: 'SessionPersistenceDeleteUnsupportedError' })
    const unavailable = bench({ deleteError: unsupported })
    await expect(unavailable.controller.delete({ sessionId }, signal))
      .rejects.toMatchObject({ code: 'session/delete-unavailable' })

    const busy = Object.assign(new Error('busy'), { name: 'SessionPersistenceBusyError' })
    const active = bench({ deleteError: busy })
    await expect(active.controller.delete({ sessionId }, signal))
      .rejects.toMatchObject({ code: 'session/delete-active' })

    const locked = Object.assign(new Error('locked'), { name: 'SessionAlreadyOwnedError' })
    await expect(bench({ deleteError: locked }).controller.delete({ sessionId }, signal))
      .rejects.toMatchObject({ code: 'session/delete-active' })

    const missing = Object.assign(new Error('missing'), { name: 'SessionPersistenceNotFoundError' })
    const gone = bench({ deleteError: missing })
    await expect(gone.controller.delete({ sessionId }, signal))
      .rejects.toMatchObject({ code: 'session/not-found' })
  })
})
