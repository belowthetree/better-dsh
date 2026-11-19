import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { SessionController } from '../src/index.ts'

const sessionId = brandString<SessionId>('session-delete-target')

/** A controller whose only initialized dependencies are those the delete path reads. */
function bench(options: {
  readonly running?: boolean
  readonly liveIdle?: boolean
  readonly owned?: boolean
  readonly stored?: boolean
  readonly children?: readonly SessionId[]
  readonly deleteError?: Error
} = {}) {
  const ctx = new Context()
  const removed: SessionId[] = []
  ctx.on('api-session/removed', (id) => { removed.push(id) })
  const live = { value: options.running === true || options.liveIdle === true }
  const status = options.running === true ? 'running' : 'idle'
  ctx.provide('agents', { get: () => live.value ? { id: sessionId, status } : undefined } as never)
  ctx.provide('sessions', { get: () => live.value ? { id: sessionId } : undefined } as never)
  const persistence = {
    stat: vi.fn(async () => options.stored === false ? undefined : { header: { id: sessionId }, revision: 'revision' }),
    delete: vi.fn(async () => { if (options.deleteError !== undefined) throw options.deleteError }),
  }
  ctx.provide('sessionPersistence', persistence as never)
  const records = (options.children ?? []).map(id => ({
    header: { id, origin: 'subagent' as const, parentSession: sessionId }, live: false, persisted: true,
  }))
  ctx.provide('sessionQuery', { listSessions: vi.fn(async () => records) } as never)
  const workspace = { detachSession: vi.fn(async () => {}) }
  const workspaceRegistry = {
    list: vi.fn(() => [workspace]),
    unarchiveSession: vi.fn(async () => {}),
    unpinSession: vi.fn(async () => {}),
  }
  ctx.provide('workspaceRegistry', workspaceRegistry as never)
  const cache = { evict: vi.fn(async () => {}) }
  ctx.provide('sessionProjectionCache', cache as never)
  const controller = new SessionController(ctx, { nativeOpen: false, listWorkSliceMs: 16 })
  const disposeAgent = vi.fn(async () => {
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

    const missing = Object.assign(new Error('missing'), { name: 'SessionPersistenceNotFoundError' })
    const gone = bench({ deleteError: missing })
    await expect(gone.controller.delete({ sessionId }, signal))
      .rejects.toMatchObject({ code: 'session/not-found' })
  })
})
