/** Provider routing, selection persistence, and fiber-owned registration lifetimes. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { describe, expect, it, vi } from 'vitest'
import TextToSpeech from '../src/index.ts'
import type {
  SpeechSynthesisInput, TextToSpeechProvider, TextToSpeechProviderId, TextToSpeechProviderInfo,
} from '../src/types.ts'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

const audio = new Uint8Array([1, 2, 3])
const caller = new AbortController().signal
const voices = [{ id: 'stella', name: 'Stella' }, { id: 'tide', name: 'Tide' }]

function provider(
  id: string,
  synthesize: TextToSpeechProvider['synthesize'] = async () => audio,
  formats: TextToSpeechProviderInfo['formats'] = ['wav'],
  maxTextChars = 10,
): TextToSpeechProvider {
  return { info: { id: id as TextToSpeechProviderId, name: id, location: 'host-local', voices, formats, maxTextChars }, synthesize }
}

/** Mount the service behind Loader with a settings stub that writes patches back into its live entry config. */
async function mounted(ctx: Context, config: object) {
  const live = await liveConfig(ctx, TextToSpeech, config)
  const writes: object[] = []
  ctx.provide('settings', { update: async (_entry: string, patch: Record<string, unknown>) => { writes.push(patch); await live.update(patch) } } as never)
  return { speech: ctx.get('textToSpeech')!, writes, live }
}

it('reports an empty provider catalog with the configured selection', async () => {
  const ctx = new Context(), base = ctx.plugin(TextToSpeech, { defaultProvider: 'empty', voiceId: 'stella' })
  await base
  try {
    const speech = ctx.get('textToSpeech')!
    expect(speech.listProviders()).toEqual([])
    expect(speech.snapshot()).toEqual({ providers: [], selection: { providerId: 'empty', voiceId: 'stella', format: 'wav' } })
  } finally { await base.dispose() }
})

describe('speech providers', () => {
  it('registers providers, lists them, and refuses duplicate ids without replacing the original', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'stella' })
    await base
    try {
      const service = ctx.get('textToSpeech')!
      const local = provider('local'), cloud = provider('cloud')
      const removeLocal = service.register(local)
      const removeCloud = service.register(cloud)
      expect(service.listProviders()).toEqual([local.info, cloud.info])
      expect(() => service.register(local)).toThrow('already registered')
      expect(service.listProviders()).toEqual([local.info, cloud.info])
      await removeLocal()
      await removeLocal()
      expect(service.listProviders()).toEqual([cloud.info])
      await removeCloud()
    } finally { await base.dispose() }
  })

  it('keeps a replacement registration when the withdrawn disposer runs again', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'stella' })
    await base
    try {
      const service = ctx.get('textToSpeech')!
      const entered = Promise.withResolvers<undefined>()
      const synthesize = provider('local', async (_input, signal) => {
        entered.resolve(undefined)
        await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
        return audio
      })
      const remove = service.register(synthesize)
      const operation = service.synthesize(service.resolve({ text: 'hello' }), caller)
      const rejection = expect(operation).rejects.toThrow('unloaded')
      await entered.promise
      const removing = remove()
      expect(service.listProviders()).toEqual([])
      const next = provider('local')
      const removeNext = service.register(next)
      await removing
      await rejection
      await remove()
      expect(service.listProviders()).toEqual([next.info])
      await removeNext()
    } finally { await base.dispose() }
  })

  it('removes a registration with its contributing fiber', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'stella' })
    await base
    try {
      const fiber = ctx.inject(['textToSpeech'], (owner) => {
        owner.effect(() => owner.textToSpeech.register(provider('local')))
      })
      await fiber
      expect(ctx.get('textToSpeech')!.listProviders()).toHaveLength(1)
      await fiber.dispose()
      expect(ctx.get('textToSpeech')!.listProviders()).toEqual([])
    } finally { await base.dispose() }
  })
})

describe('selection observation', () => {
  it('shares snapshots with observers and coalesces intermediate provider changes', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'stella' })
    await base
    try {
      const service = ctx.get('textToSpeech')!
      const lifetime = new AbortController(), stream = service.follow(lifetime.signal)[Symbol.asyncIterator]()
      expect((await stream.next()).value).toMatchObject({ providers: [], selection: { providerId: 'local', voiceId: 'stella' } })
      const waiting = stream.next()
      service.register(provider('local'))
      expect((await waiting).value).toMatchObject({ providers: [{ id: 'local' }] })
      const coalesced = stream.next()
      service.register(provider('cloud'))
      service.register(provider('another'))
      expect((await coalesced).value).toMatchObject({ providers: [{ id: 'local' }, { id: 'cloud' }, { id: 'another' }] })
      lifetime.abort()
      expect((await stream.next()).done).toBe(true)
      await expect(service.follow(lifetime.signal)[Symbol.asyncIterator]().next()).rejects.toThrow()
    } finally { await base.dispose() }
  })

  it('ends waiting observers and rejects registration after service disposal', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'stella' })
    await base
    const service = ctx.get('textToSpeech')!, stream = service.follow(new AbortController().signal)[Symbol.asyncIterator]()
    await stream.next()
    const waiting = stream.next()
    await base.dispose()
    expect((await waiting).done).toBe(true)
    expect(() => service.register(provider('late'))).toThrow('disposed')
  })
})

describe('selection persistence', () => {
  it('persists explicit provider, voice, and format changes through the profile and publishes them', async () => {
    const ctx = new Context()
    try {
      const { speech, writes } = await mounted(ctx, { defaultProvider: 'local', voiceId: 'stella' })
      speech.register(provider('local'))
      speech.register(provider('cloud'))
      const stream = speech.follow(new AbortController().signal)[Symbol.asyncIterator]()
      expect((await stream.next()).value).toMatchObject({ selection: { providerId: 'local', voiceId: 'stella' } })
      const next = stream.next()
      await speech.configure({ providerId: 'cloud' as TextToSpeechProviderId })
      expect((await next).value).toMatchObject({ selection: { providerId: 'cloud', voiceId: 'stella' } })
      await speech.configure({ voiceId: 'tide' })
      await speech.configure({ format: 'wav' })
      expect(speech.snapshot().selection).toEqual({ providerId: 'cloud', voiceId: 'tide', format: 'wav' })
      expect(speech.resolve({ text: 'hello' })).toMatchObject({ provider: { info: { id: 'cloud' } }, voiceId: 'tide', format: 'wav' })
      expect(writes).toEqual([{ defaultProvider: 'cloud' }, { voiceId: 'tide' }, { format: 'wav' }])
      await expect(speech.configure({ providerId: 'missing' as TextToSpeechProviderId })).rejects.toThrow('unavailable')
      await expect(speech.configure({ voiceId: 'bogus' })).rejects.toThrow('does not support voice')
      expect(speech.snapshot().selection).toEqual({ providerId: 'cloud', voiceId: 'tide', format: 'wav' })
    } finally { await ctx.fiber.dispose() }
  })

  it('refuses to configure without the settings service or a profile entry', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'stella' })
      const speech = ctx.get('textToSpeech')!
      speech.register(provider('local'))
      await expect(speech.configure({ voiceId: 'tide' })).rejects.toThrow('settings service')
      ctx.provide('settings', { update: vi.fn() } as never)
      await expect(speech.configure({ voiceId: 'tide' })).rejects.toThrow('profile entry')
      expect(speech.snapshot().selection).toEqual({ providerId: 'local', voiceId: 'stella', format: 'wav' })
    } finally { await ctx.fiber.dispose() }
  })

  it('rejects voices and formats the selected provider does not advertise', async () => {
    const ctx = new Context()
    try {
      const { speech, writes } = await mounted(ctx, { defaultProvider: 'local', voiceId: 'stella' })
      const synthesize = vi.fn(async () => audio)
      speech.register(provider('local', synthesize))
      speech.register(provider('silent', synthesize, []))
      await expect(speech.configure({ providerId: 'silent' as TextToSpeechProviderId })).rejects.toThrow('does not support format')
      await expect(speech.configure({ voiceId: 'bogus' })).rejects.toThrow('does not support voice')
      expect(writes).toEqual([])
      expect(() => speech.resolve({ text: 'hello', providerId: 'silent' as TextToSpeechProviderId }))
        .toThrow('does not support format')
      expect(synthesize).not.toHaveBeenCalled()
      expect(speech.snapshot().selection).toEqual({ providerId: 'local', voiceId: 'stella', format: 'wav' })
    } finally { await ctx.fiber.dispose() }
  })
})

describe('request resolution', () => {
  it('applies composition defaults and rejects undeliverable requests before synthesis', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'stella' })
    await base
    try {
      const service = ctx.get('textToSpeech')!
      const local = provider('local'), cloud = provider('cloud', undefined, ['wav'], 4)
      service.register(local)
      service.register(cloud)
      expect(service.resolve({ text: 'hello' })).toEqual({ provider: local, text: 'hello', voiceId: 'stella', format: 'wav' })
      expect(service.resolve({ text: 'hey', providerId: cloud.info.id, voiceId: 'tide', format: 'wav' }))
        .toEqual({ provider: cloud, text: 'hey', voiceId: 'tide', format: 'wav' })
      expect(() => service.resolve({ text: 'hello', providerId: 'missing' as TextToSpeechProviderId })).toThrow('unavailable')
      expect(() => service.resolve({ text: 'hello', voiceId: 'unknown' })).toThrow('does not support voice')
      expect(() => service.resolve({ text: '' })).toThrow('empty')
      expect(() => service.resolve({ text: ' \n ' })).toThrow('empty')
      expect(() => service.resolve({ text: '12345', providerId: cloud.info.id })).toThrow('exceeds the provider limit of 4')
      expect(service.resolve({ text: '1234', providerId: cloud.info.id }).text).toBe('1234')
    } finally { await base.dispose() }
  })
})

describe('synthesis', () => {
  it('synthesizes through the pinned provider and reports the accepted text length', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'stella' })
    await base
    try {
      const service = ctx.get('textToSpeech')!
      const synthesize = vi.fn(async (_input: SpeechSynthesisInput) => audio)
      service.register(provider('local', synthesize))
      const spec = service.resolve({ text: 'hello' })
      expect(await service.synthesize(spec, caller)).toEqual({ audio, format: 'wav', characters: 5 })
      expect(synthesize).toHaveBeenCalledWith({ text: 'hello', voiceId: 'stella', format: 'wav' }, expect.any(AbortSignal))
    } finally { await base.dispose() }
  })

  it('rejects pre-aborted and withdrawn queued work before the synthesizer starts', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'stella' })
    await base
    try {
      const service = ctx.get('textToSpeech')!
      let calls = 0
      const remove = service.register(provider('local', async () => { calls++; return audio }))
      const spec = service.resolve({ text: 'hello' })
      await expect(service.synthesize(spec, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
      const rejection = expect(service.synthesize(spec, caller)).rejects.toThrow('unloaded')
      await remove()
      await rejection
      expect(calls).toBe(0)
    } finally { await base.dispose() }
  })

  it('rejects a resolved provider that was withdrawn or replaced', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'stella' })
    await base
    try {
      const service = ctx.get('textToSpeech')!
      const remove = service.register(provider('local'))
      const spec = service.resolve({ text: 'hello' })
      await remove()
      await expect(service.synthesize(spec, caller)).rejects.toThrow('no longer registered')
      const removeNext = service.register(provider('local'))
      await expect(service.synthesize(spec, caller)).rejects.toThrow('no longer registered')
      await removeNext()
    } finally { await base.dispose() }
  })

  it('combines caller cancellation with the registration lifetime', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'stella' })
    await base
    try {
      const service = ctx.get('textToSpeech')!
      const entered = Promise.withResolvers<AbortSignal>()
      service.register(provider('local', async (_input, signal) => {
        entered.resolve(signal)
        await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
        return audio
      }))
      const abort = new AbortController()
      const operation = service.synthesize(service.resolve({ text: 'hello' }), abort.signal)
      const combined = await entered.promise
      expect(combined.aborted).toBe(false)
      abort.abort(new Error('caller stopped'))
      await expect(operation).rejects.toThrow('caller stopped')
    } finally { await base.dispose() }
  })
})

it('requires the composition to choose its default provider and voice', () => {
  expect(() => z.resolve({}, TextToSpeech.Config, {})).toThrow()
  const resolved = TextToSpeech.Config({ defaultProvider: 'custom', voiceId: 'stella' })
  expect([resolved.defaultProvider.get(), resolved.voiceId.get(), resolved.format.get()]).toEqual(['custom', 'stella', 'wav'])
})
