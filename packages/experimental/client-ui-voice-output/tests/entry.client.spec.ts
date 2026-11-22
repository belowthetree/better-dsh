// @vitest-environment jsdom
/** The real playback entry waits for Surface before evaluating its renderer-role guard. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { speechFixture } from './voice-output-fixture.client.ts'

vi.mock('@deepseek-ai/dsh-api-text-to-speech/remote', () => ({
  default: { package: '@deepseek-ai/dsh-api-text-to-speech', descriptors: [] },
}))

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

function fixture() {
  const ctx = new Context()
  roots.push(ctx)
  const speech = speechFixture()
  const disposeRemote = vi.fn(async () => {})
  const mount = vi.fn(async () => disposeRemote)
  ctx.provide('remote', { $mount: mount, speechOutput: speech.namespace } as never)
  // The shipped gateway provides the mounted namespace as its own service; the
  // entry reaches it through the scope that injects it.
  ctx.provide('remote.speechOutput', speech.namespace)
  return { ctx, mount }
}

function provideSurface(ctx: Context, role: 'surface' | 'bubbles'): void {
  ctx.provide('surface', { snapshot: () => ({ form: 'orb', role }) } as never)
}

describe('voice output client entry', () => {
  it('requires both Remote and Surface so role evaluation cannot race activation', () => {
    expect(inject).toEqual(['remote', 'surface'])
  })

  it('mounts playback when Surface is already active in the primary role', async () => {
    const b = fixture()
    provideSurface(b.ctx, 'surface')
    await b.ctx.plugin({ inject, apply })
    expect(b.ctx.get('voiceOutput')).toBeDefined()
    expect(b.mount).toHaveBeenCalledOnce()
  })

  it('waits for a late Surface before mounting playback', async () => {
    const b = fixture()
    const fiber = b.ctx.plugin({ inject, apply })
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    expect(b.ctx.get('voiceOutput')).toBeUndefined()
    expect(b.mount).not.toHaveBeenCalled()
    provideSurface(b.ctx, 'surface')
    await fiber
    expect(b.ctx.get('voiceOutput')).toBeDefined()
    expect(b.mount).toHaveBeenCalledOnce()
  })

  it('does not mount the Remote when a late Surface names a secondary role', async () => {
    const b = fixture()
    const fiber = b.ctx.plugin({ inject, apply })
    provideSurface(b.ctx, 'bubbles')
    await fiber
    expect(b.ctx.get('voiceOutput')).toBeUndefined()
    expect(b.mount).not.toHaveBeenCalled()
  })
})
