// @vitest-environment jsdom
/** The real capture entry waits for Surface before evaluating its renderer-role guard. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

vi.mock('@deepseek-ai/dsh-experimental-api-speech-to-text/remote', () => ({
  default: { package: '@deepseek-ai/dsh-experimental-api-speech-to-text', descriptors: [] },
}))

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

function fixture() {
  const ctx = new Context()
  roots.push(ctx)
  const disposeRemote = vi.fn(async () => {})
  const mount = vi.fn(async () => disposeRemote)
  ctx.provide('remote', { $mount: mount, speech: {} } as never)
  return { ctx, mount }
}

function provideSurface(ctx: Context, role: 'surface' | 'orb'): void {
  ctx.provide('surface', { snapshot: () => ({ form: 'orb', role }) } as never)
}

describe('voice capture client entry', () => {
  it('requires both Remote and Surface so role evaluation cannot race activation', () => {
    expect(inject).toEqual(['remote', 'surface'])
  })

  it('mounts the recorder when Surface is already active in the primary role', async () => {
    const b = fixture()
    provideSurface(b.ctx, 'surface')
    await b.ctx.plugin({ inject, apply })
    expect(b.ctx.get('voiceCapture')).toBeDefined()
    expect(b.mount).toHaveBeenCalledOnce()
  })

  it('waits for a late Surface before mounting the recorder', async () => {
    const b = fixture()
    const fiber = b.ctx.plugin({ inject, apply })
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    expect(b.ctx.get('voiceCapture')).toBeUndefined()
    expect(b.mount).not.toHaveBeenCalled()
    provideSurface(b.ctx, 'surface')
    await fiber
    expect(b.ctx.get('voiceCapture')).toBeDefined()
    expect(b.mount).toHaveBeenCalledOnce()
  })

  it('does not mount the Remote when a late Surface names a secondary role', async () => {
    const b = fixture()
    const fiber = b.ctx.plugin({ inject, apply })
    provideSurface(b.ctx, 'orb')
    await fiber
    expect(b.ctx.get('voiceCapture')).toBeUndefined()
    expect(b.mount).not.toHaveBeenCalled()
  })
})
