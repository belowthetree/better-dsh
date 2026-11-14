/** The speech Remote and the shared service arrive and leave together; consumers never own capture. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { mountVoiceCapture } from '../src/client/mount.ts'
import { captureFixture } from './audio-fixture.client.ts'

afterEach(() => { vi.unstubAllGlobals() })

const CONTRIBUTION: TypertRemoteContribution = {
  package: '@deepseek-ai/dsh-experimental-api-speech-to-text',
  descriptors: [],
}
const provider = 'local' as SpeechProviderId

function fixture() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const unmount = vi.fn(async () => {})
  class Remote extends Service {
    constructor() { super(ctx, 'remote') }
    async $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
      expect(contribution).toBe(CONTRIBUTION)
      return unmount
    }
  }
  new Remote()
  ctx.provide('remote.speech', {
    catalog: vi.fn(async () => ({ ok: true, value: {
      providers: [], selection: { providerId: provider, language: 'auto' },
      maxAudioBytes: 4 * 1024 * 1024, maxDurationSeconds: 120,
    } })),
    follow: vi.fn(),
    configure: vi.fn(async () => ({ ok: true, value: undefined })),
    prepare: vi.fn(async () => ({ ok: true, value: undefined })),
    cancelPreparation: vi.fn(async () => ({ ok: true, value: undefined })),
    transcribe: vi.fn(async () => ({ ok: true, value: { text: 'spoken', audioSeconds: 1, inferenceSeconds: 0.1 } })),
  })
  return { ctx, unmount }
}

function stubFrames(): void {
  vi.stubGlobal('requestAnimationFrame', vi.fn((_callback: FrameRequestCallback) => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
}

it('provides the capture service and withdraws both the service and the speech Remote', async () => {
  const b = fixture()
  expect(b.ctx.get('voiceCapture')).toBeUndefined()
  const dispose = await mountVoiceCapture(b.ctx, CONTRIBUTION)
  expect(b.unmount).not.toHaveBeenCalled()
  expect(b.ctx.get('voiceCapture')).toBeDefined()
  await dispose()
  expect(b.ctx.get('voiceCapture')).toBeUndefined()
  expect(b.unmount).toHaveBeenCalledOnce()
})

it('keeps an active capture when a mounted consumer fiber is disposed', async () => {
  const audio = captureFixture()
  stubFrames()
  const b = fixture()
  await mountVoiceCapture(b.ctx, CONTRIBUTION)
  let consumer: Context | undefined
  const fiber = b.ctx.plugin({ inject: ['voiceCapture'], apply: (ctx: Context) => { consumer = ctx } })
  await fiber
  const capture = consumer!.voiceCapture
  await capture.begin()
  expect(capture.snapshot().phase).toBe('capturing')
  await fiber.dispose()
  expect(b.ctx.voiceCapture.snapshot().phase).toBe('capturing')
  expect(audio.trackStop).not.toHaveBeenCalled()
  await b.ctx.voiceCapture.cancel()
  expect(audio.trackStop).toHaveBeenCalled()
  await audio.recording.dispose()
})

it('cancels an active recording when the capture plugin is withdrawn', async () => {
  const audio = captureFixture()
  stubFrames()
  const b = fixture()
  const dispose = await mountVoiceCapture(b.ctx, CONTRIBUTION)
  const capture = b.ctx.voiceCapture
  await capture.begin()
  await dispose()
  expect(audio.trackStop).toHaveBeenCalled()
  expect(b.unmount).toHaveBeenCalledOnce()
  expect(capture.snapshot()).toMatchObject({ phase: 'idle', level: 0 })
  await audio.recording.dispose()
})
