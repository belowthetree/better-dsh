/** Authenticated speech-output methods bound text, audio, and provider time before one synthesis call. */
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import TextToSpeech from '@deepseek-ai/dsh-text-to-speech'
import type { SpeechSynthesisInput, TextToSpeechProviderId } from '@deepseek-ai/dsh-text-to-speech'
import { afterEach, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import TextToSpeechController from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => root.fiber.dispose())) })

const id = 'deepseek-tts' as TextToSpeechProviderId
const audio = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])
const info = { id, name: 'test', location: 'cloud', voices: [{ id: 'stella', name: 'Stella' }], formats: ['wav'], maxTextChars: 4000 } as const

/** One Host composition with a stub synthesizer and the Remote under test. */
function fixture(maxTextChars = 4000, maxAudioBytes = 64, timeoutMs = 60_000) {
  const ctx = new Context(); roots.push(ctx)
  const speech = new TextToSpeech(ctx, TextToSpeech.Config({ defaultProvider: id, voiceId: 'stella' }))
  const synthesize = vi.fn(async () => audio)
  speech.register({ info, synthesize })
  return { api: new TextToSpeechController(ctx, { maxTextChars, maxAudioBytes, timeoutMs }), synthesize, speech }
}

/** Register a synthesizer that settles only when its cancellation signal aborts. */
function hanging(ctx: Context): Mock<(input: SpeechSynthesisInput, signal: AbortSignal) => Promise<Uint8Array>> {
  const speech = new TextToSpeech(ctx, TextToSpeech.Config({ defaultProvider: id, voiceId: 'stella' }))
  const synthesize = vi.fn((_input: SpeechSynthesisInput, signal: AbortSignal) => new Promise<Uint8Array>((_resolve, reject) => {
    signal.addEventListener('abort', () => { reject(new Error('provider aborted', { cause: signal.reason })) })
  }))
  speech.register({ info, synthesize })
  return synthesize
}

/** Message of a caught value, for assertions that must not cast. */
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }

it('declares the speech-output endpoint and lists limits without synthesizing', async () => {
  const { api, synthesize } = fixture()
  expect(api.typertRemote).toMatchObject({ serviceKey: 'textToSpeechController', namespace: 'speechOutput' })
  expect(remoteMethods(api).map(({ method, mode }) => [method, mode]))
    .toEqual([['catalog', undefined], ['follow', 'stream'], ['configure', undefined], ['synthesize', undefined]])
  expect(api.catalog()).toMatchObject({
    selection: { providerId: id, voiceId: 'stella', format: 'wav' },
    providers: [{ id, voices: [{ id: 'stella' }], formats: ['wav'] }],
    maxTextChars: 4000, maxAudioBytes: 64, timeoutMs: 60_000,
  })
  expect(synthesize).not.toHaveBeenCalled()
  await expect(api.configure({ voiceId: 'stella' })).rejects.toThrow('settings service')
})

it('streams complete catalogs as the provider roster changes', async () => {
  const { api, speech } = fixture()
  const lifetime = new AbortController(), observation = api.follow(lifetime.signal)[Symbol.asyncIterator]()
  expect((await observation.next()).value).toMatchObject({ providers: [{ id }], maxTextChars: 4000, maxAudioBytes: 64 })
  const second = 'second-tts' as TextToSpeechProviderId
  speech.register({ info: { ...info, id: second }, synthesize: async () => audio })
  expect((await observation.next()).value).toMatchObject({ providers: [{ id }, { id: second }] })
  lifetime.abort(); await observation.next()
})

it('rejects empty and oversized text before selecting a provider', async () => {
  const { api, synthesize } = fixture(3)
  await expect(api.synthesize({ text: '   \n' }, new AbortController().signal))
    .rejects.toMatchObject({ code: 'speech-output/invalid-text', message: 'Text is empty', details: { reason: 'empty' } })
  await expect(api.synthesize({ text: '你好呀!' }, new AbortController().signal))
    .rejects.toMatchObject({ code: 'speech-output/invalid-text', details: { reason: 'size' } })
  expect(synthesize).not.toHaveBeenCalled()
  expect(await api.synthesize({ text: '你好呀' }, new AbortController().signal))
    .toEqual({ audioBase64: Buffer.from(audio).toString('base64'), format: 'wav', characters: 3 })
  expect(synthesize).toHaveBeenCalledWith({ text: '你好呀', voiceId: 'stella', format: 'wav' }, expect.any(AbortSignal))
})

it('returns canonical base64 for an explicit selection and forwards trimmed text', async () => {
  const { api, synthesize } = fixture()
  const result = await api.synthesize({ text: '  Hello  ', providerId: id, voiceId: 'stella', format: 'wav' }, new AbortController().signal)
  expect(result.audioBase64).toBe(Buffer.from(audio).toString('base64'))
  expect(Buffer.from(result.audioBase64, 'base64')).toEqual(Buffer.from(audio))
  expect(result).toEqual({ audioBase64: Buffer.from(audio).toString('base64'), format: 'wav', characters: 5 })
  expect(synthesize).toHaveBeenCalledWith({ text: 'Hello', voiceId: 'stella', format: 'wav' }, expect.any(AbortSignal))
})

it('maps only the request deadline abort to a typed timeout', async () => {
  const ctx = new Context(); roots.push(ctx)
  const synthesize = hanging(ctx)
  const api = new TextToSpeechController(ctx, { maxTextChars: 4000, maxAudioBytes: 64, timeoutMs: 25 })
  await expect(api.synthesize({ text: 'Hello' }, new AbortController().signal))
    .rejects.toMatchObject({ code: 'speech-output/timeout', details: { reason: 'timeout' } })
  expect(synthesize).toHaveBeenCalledTimes(1)
})

it('preserves caller cancellation instead of reporting a Remote failure', async () => {
  const ctx = new Context(); roots.push(ctx)
  hanging(ctx)
  const api = new TextToSpeechController(ctx, { maxTextChars: 4000, maxAudioBytes: 64, timeoutMs: 60_000 })
  await expect(api.synthesize({ text: 'Hello' }, AbortSignal.abort(new Error('before')))).rejects.toThrow('before')
  const caller = new AbortController(), pending = api.synthesize({ text: 'Hello' }, caller.signal).catch((error: unknown) => error)
  caller.abort(new Error('cancel'))
  const error: unknown = await pending
  expect(error).not.toHaveProperty('isDSHRemoteError')
  expect(messageOf(error)).toBe('cancel')
})

it('rejects oversized audio and sanitizes provider and selection failures', async () => {
  const small = fixture(4000, 3)
  await expect(small.api.synthesize({ text: 'Hello' }, new AbortController().signal))
    .rejects.toMatchObject({ code: 'speech-output/too-large', details: { reason: 'size' } })

  const { api, synthesize } = fixture()
  synthesize.mockRejectedValueOnce(new Error('provider diagnostic sk-secret'))
  const failure: unknown = await api.synthesize({ text: 'Hello' }, new AbortController().signal).catch((error: unknown) => error)
  expect(failure).toMatchObject({ code: 'speech-output/synthesis-failed', message: 'Speech synthesis failed', details: { reason: 'provider' } })
  expect(String(failure) + JSON.stringify(failure)).not.toContain('sk-secret')

  await expect(api.synthesize({ text: 'Hello', voiceId: 'missing' }, new AbortController().signal))
    .rejects.toMatchObject({ code: 'speech-output/synthesis-failed', message: 'The selected voice is unavailable', details: { reason: 'unavailable' } })
})
