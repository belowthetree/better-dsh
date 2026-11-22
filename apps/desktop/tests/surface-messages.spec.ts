// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { SurfaceMessage, SurfaceMessageRole } from '@deepseek-ai/dsh-client-surface/protocol'
import { DesktopSurfaceMessageBroker } from '../src/surface-messages.ts'

describe('DesktopSurfaceMessageBroker', () => {
  it('queues one message until its exact role and channel are ready', async () => {
    const delivered: SurfaceMessage[] = []
    const broker = new DesktopSurfaceMessageBroker((_target, message) => { delivered.push(message) })
    let settled = false
    const pending = broker.send('orb', 'surface', 'better/intent', { id: 'one' }).then(() => { settled = true })
    expect(settled).toBe(false)
    broker.setReady('orb', 'better/intent', true)
    broker.setReady('surface', 'voice/state', true)
    expect(delivered).toEqual([])
    broker.setReady('surface', 'better/intent', true)
    await pending
    expect(delivered).toEqual([{ origin: 'orb', channel: 'better/intent', payload: { id: 'one' } }])
    broker.setReady('surface', 'better/intent', true)
    await broker.send('bubbles', 'surface', 'better/intent', null)
    expect(delivered).toHaveLength(2)
    broker.setReady('surface', 'better/intent', false)
    const queued = broker.send('orb', 'surface', 'better/intent', { id: 'two' })
    broker.setReady('surface', 'better/intent', true)
    await queued
    expect(delivered).toHaveLength(3)
  })

  it('enforces the per-channel pending bound and then drains in order', async () => {
    const broker = new DesktopSurfaceMessageBroker(() => {})
    const pending: Promise<void>[] = []
    for (let index = 0; index < 16; index++) {
      pending.push(broker.send('orb', 'surface', 'better/intent', { index }))
    }
    await expect(broker.send('orb', 'surface', 'better/intent', { index: 16 })).rejects.toThrow('pending limit reached')
    broker.setReady('surface', 'better/intent', true)
    await Promise.all(pending)
  })

  it('enforces the total bound across channels', async () => {
    const broker = new DesktopSurfaceMessageBroker(() => {})
    const pending: Promise<void>[] = []
    for (const channel of ['better/one', 'better/two', 'better/three', 'better/four']) {
      for (let index = 0; index < 16; index++) pending.push(broker.send('orb', 'surface', channel, null))
    }
    await expect(broker.send('orb', 'surface', 'better/five', null)).rejects.toThrow('pending limit reached')
    for (const channel of ['better/one', 'better/two', 'better/three', 'better/four']) {
      broker.setReady('surface', channel, true)
    }
    await Promise.all(pending)
  })

  it('rejects queued messages when their target is destroyed', async () => {
    const broker = new DesktopSurfaceMessageBroker(() => {})
    const pending = broker.send('orb', 'bubbles', 'better/intent', null)
    broker.drop('bubbles')
    await expect(pending).rejects.toThrow('target bubbles was destroyed')
  })

  it('rejects every pending operation on disposal and refuses later sends', async () => {
    const deliver = vi.fn<(target: SurfaceMessageRole, message: SurfaceMessage) => void>()
    const broker = new DesktopSurfaceMessageBroker(deliver)
    const first = broker.send('orb', 'surface', 'better/one', null)
    const second = broker.send('orb', 'bubbles', 'better/two', null)
    broker.dispose()
    await expect(first).rejects.toThrow('target surface was destroyed')
    await expect(second).rejects.toThrow('target bubbles was destroyed')
    await expect(broker.send('orb', 'surface', 'better/one', null)).rejects.toThrow('broker is disposed')
    broker.dispose()
    expect(deliver).not.toHaveBeenCalled()
  })
})
