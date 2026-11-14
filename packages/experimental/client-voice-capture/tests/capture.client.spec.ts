/** One shared service owns the recorder, the device preference, and the speech Remote calls. */
import { Context } from '@deepseek-ai/cordis'
import { RemoteStreamCarrierError, type RemoteStreamOptions } from '@deepseek-ai/dsh-api-gateway/client'
import type { SpeechCatalog, TranscriptionRequest } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types'
import type { SpeechProviderId, Transcript } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { audioBase64, encodeWave } from '../src/client/audio.ts'
import { VoiceCaptureService } from '../src/client/service.ts'
import type { VoiceCaptureSnapshot } from '../src/protocol.ts'
import { captureFixture } from './audio-fixture.client.ts'

afterEach(() => { vi.unstubAllGlobals() })

const provider = 'sensevoice-local' as SpeechProviderId
const catalog: SpeechCatalog = {
  providers: [{ id: provider, name: 'Recognizer', location: 'host-local', languages: ['auto'], preparation: { phase: 'ready' } }],
  selection: { providerId: provider, language: 'auto' },
  maxAudioBytes: 4 * 1024 * 1024,
  maxDurationSeconds: 120,
}
const transcript: Transcript = { text: 'spoken text', audioSeconds: 2, inferenceSeconds: 0.4 }

interface FixtureOptions {
  catalogResult?: RemoteResult<SpeechCatalog>
  catalogPending?: Promise<RemoteResult<SpeechCatalog>>
  transcribe?: RemoteResult<Transcript>
  items?: SpeechCatalog[]
  streamFailure?: Error
}

function fixture(options: FixtureOptions = {}) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const items = options.items ?? [catalog]
  const streams: { options: RemoteStreamOptions<SpeechCatalog>; dispose: ReturnType<typeof vi.fn> }[] = []
  const transcribe = vi.fn(async (_request: TranscriptionRequest, _signal?: AbortSignal): Promise<RemoteResult<Transcript>> =>
    options.transcribe ?? { ok: true, value: transcript })
  const speech = {
    catalog: vi.fn(async () => {
      if (options.catalogPending) return await options.catalogPending
      return options.catalogResult ?? { ok: true as const, value: catalog }
    }),
    follow: vi.fn(async function* () { yield catalog }),
    configure: vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined })),
    prepare: vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined })),
    cancelPreparation: vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined })),
    transcribe,
  }
  const remote = {
    speech,
    $stream: vi.fn((streamOptions: RemoteStreamOptions<SpeechCatalog>) => {
      const closed = Promise.withResolvers<undefined>()
      const dispose = vi.fn(async () => { closed.resolve(undefined); await Promise.resolve() })
      streams.push({ options: streamOptions, dispose })
      return {
        async *[Symbol.asyncIterator]() {
          for (const value of items) {
            yield { generation: 1, value, signal: new AbortController().signal, accept: vi.fn() }
          }
          if (options.streamFailure !== undefined) throw options.streamFailure
          await closed.promise
        },
        dispose,
      }
    }),
  }
  ctx.provide('remote', remote)
  const service = new VoiceCaptureService(ctx)
  onTestFinished(async () => { await service.dispose() })
  return { ctx, remote, speech, streams, transcribe, service }
}

function installFrames() {
  let callback: FrameRequestCallback | undefined
  const request = vi.fn((next: FrameRequestCallback) => { callback = next; return 7 })
  const cancel = vi.fn()
  vi.stubGlobal('requestAnimationFrame', request)
  vi.stubGlobal('cancelAnimationFrame', cancel)
  return {
    request, cancel,
    tick(now = 0): void {
      const pending = callback
      callback = undefined
      pending?.(now)
    },
  }
}

async function capturing(options: FixtureOptions = {}) {
  const audio = captureFixture(), frames = installFrames(), b = fixture(options)
  await b.service.begin()
  return { ...b, audio, frames }
}

it('starts idle, remembers the device, and adopts the Host catalog on the first capture', async () => {
  const audio = captureFixture(), frames = installFrames(), b = fixture()
  onTestFinished(() => { void audio.recording.dispose() })
  const initial = b.service.snapshot()
  expect(initial).toMatchObject({ phase: 'idle', level: 0, failure: null, maxDurationSeconds: 0,
    device: { id: '', label: '' }, selection: { language: '' } })
  expect(b.service.snapshot()).toBe(initial)
  b.service.setDevice({ id: 'usb', label: 'USB microphone' })
  const changed = b.service.snapshot()
  expect(changed.device).toEqual({ id: 'usb', label: 'USB microphone' })
  expect(changed).not.toBe(initial)
  await b.service.begin()
  expect(audio.getUserMedia.mock.calls.at(-1)?.[0].audio).toMatchObject({ deviceId: { exact: 'usb' } })
  expect(b.service.snapshot()).toMatchObject({ phase: 'capturing', level: 0, failure: null,
    maxDurationSeconds: 120, selection: catalog.selection })
  frames.tick()
  expect(b.service.snapshot().level).toBe(0.25)
  const leveled = b.service.snapshot()
  frames.tick()
  expect(b.service.snapshot()).toBe(leveled)
  await b.service.cancel()
  expect(b.service.snapshot()).toMatchObject({ phase: 'idle', level: 0, failure: null })
})

it('publishes every stored snapshot to followers until the observation aborts', async () => {
  const b = fixture()
  const lifetime = new AbortController()
  const seen: VoiceCaptureSnapshot[] = []
  const observing = (async () => {
    for await (const snapshot of b.service.follow(lifetime.signal)) seen.push(snapshot)
  })()
  await vi.waitFor(() => { expect(seen).toHaveLength(1) })
  expect(seen[0]).toBe(b.service.snapshot())
  b.service.setDevice({ id: 'one', label: 'One' })
  await vi.waitFor(() => { expect(seen).toHaveLength(2) })
  b.service.setDevice({ id: 'two', label: 'Two' })
  await vi.waitFor(() => { expect(seen).toHaveLength(3) })
  expect(seen[2]?.device.id).toBe('two')
  lifetime.abort()
  await observing
  const aborted = new AbortController()
  aborted.abort()
  await expect((async () => {
    for await (const _snapshot of b.service.follow(aborted.signal)) { /* unreachable */ }
  })()).rejects.toThrow()
})

it('finishes by uploading canonical WAV audio for the remembered selection', async () => {
  const b = await capturing()
  b.frames.tick()
  const result = await b.service.finish()
  expect(result).toEqual(transcript)
  const request = b.transcribe.mock.calls[0]![0]
  expect(request).toMatchObject({ providerId: provider, language: 'auto' })
  const bytes = Uint8Array.from(Buffer.from(request.audioBase64, 'base64'))
  expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF')
  expect(bytes).toEqual(encodeWave(new Float32Array([0.5, -0.5])))
  expect(b.service.snapshot()).toMatchObject({ phase: 'idle', level: 0, failure: null })
  await b.audio.recording.dispose()
})

it('holds a finished transcript for a composer that mounts after the panel expands', async () => {
  const b = await capturing()
  b.frames.tick()
  const result = await b.service.finish({ hold: true })
  expect(result.text).toBe(transcript.text)
  expect(b.service.snapshot()).toMatchObject({ phase: 'idle', pendingTranscript: transcript.text })
  expect(b.service.takeTranscript()).toBe(transcript.text)
  expect(b.service.snapshot().pendingTranscript).toBeNull()
  expect(b.service.takeTranscript()).toBeNull()
  await b.audio.recording.dispose()
})

it('clears a held transcript on the next capture and on disposal', async () => {
  const b = await capturing()
  b.frames.tick()
  await b.service.finish({ hold: true })
  expect(b.service.snapshot().pendingTranscript).toBe(transcript.text)
  await b.service.begin()
  expect(b.service.snapshot().pendingTranscript).toBeNull()
  await b.service.finish()
  expect(b.service.snapshot().pendingTranscript).toBeNull()
  await b.service.begin()
  await b.service.finish({ hold: true })
  await b.service.dispose()
  expect(b.service.snapshot().pendingTranscript).toBeNull()
})

it.each([
  { kind: 'permission' as const, failure: () => new DOMException('denied', 'NotAllowedError') },
  { kind: 'deviceMissing' as const, failure: () => new DOMException('missing', 'NotFoundError') },
  { kind: 'transcribe' as const, failure: () => new DOMException('busy', 'NotReadableError') },
])('reports a denied or missing microphone as $kind', async ({ kind, failure }) => {
  captureFixture().getUserMedia.mockRejectedValueOnce(failure())
  installFrames()
  const b = fixture()
  await expect(b.service.begin()).rejects.toMatchObject({ failure: kind })
  expect(b.service.snapshot()).toMatchObject({ phase: 'idle', failure: kind })
  await b.service.dispose()
})

it('reports an unavailable browser and an empty recording', async () => {
  vi.stubGlobal('navigator', {})
  installFrames()
  const unavailable = fixture()
  await expect(unavailable.service.begin()).rejects.toMatchObject({ failure: 'unavailable' })
  await unavailable.service.dispose()
  vi.unstubAllGlobals()
  captureFixture({ empty: true })
  installFrames()
  const empty = fixture()
  await empty.service.begin()
  await expect(empty.service.finish()).rejects.toMatchObject({ failure: 'empty' })
  expect(empty.service.snapshot()).toMatchObject({ phase: 'idle', failure: 'empty' })
})

it('maps a rejected transcription to the transcribe failure', async () => {
  const audio = captureFixture()
  const failure = new RemoteError('speech/transcription-failed', 'recognizer offline', { reason: 'offline' })
  const b = fixture({ transcribe: { ok: false, error: failure } })
  installFrames()
  await b.service.begin()
  await expect(b.service.finish()).rejects.toMatchObject({ failure: 'transcribe', message: 'recognizer offline' })
  expect(b.service.snapshot()).toMatchObject({ phase: 'idle', failure: 'transcribe' })
  expect(audio.close).toHaveBeenCalled()
})

it('rejects a catalog failure before capture and clears the failure on the next begin', async () => {
  const audio = captureFixture(), frames = installFrames()
  const failure = new RemoteError('gateway/internal', 'catalog offline', {})
  const b = fixture({ catalogResult: { ok: false, error: failure } })
  await expect(b.service.begin()).rejects.toMatchObject({ failure: 'transcribe', message: 'catalog offline' })
  expect(b.service.snapshot()).toMatchObject({ phase: 'idle', failure: 'transcribe' })
  b.speech.catalog.mockResolvedValue({ ok: true, value: catalog })
  await b.service.begin()
  expect(b.service.snapshot()).toMatchObject({ phase: 'capturing', failure: null })
  await b.service.cancel()
  await audio.recording.dispose()
  frames.tick()
})

it('stops the capture when the microphone reports an interruption', async () => {
  const b = await capturing()
  b.frames.tick()
  b.audio.failRecorder()
  await vi.waitFor(() => { expect(b.service.snapshot()).toMatchObject({ phase: 'idle', level: 0, failure: 'interrupted' }) })
  expect(b.audio.trackStop).toHaveBeenCalled()
  b.frames.tick()
  expect(b.service.snapshot().level).toBe(0)
})

it('discards a capture on cancellation without uploading it', async () => {
  const b = await capturing()
  await b.service.cancel()
  expect(b.transcribe).not.toHaveBeenCalled()
  expect(b.service.snapshot()).toMatchObject({ phase: 'idle', failure: null })
  expect(b.audio.trackStop).toHaveBeenCalled()
  await b.service.cancel()
  expect(b.service.snapshot().phase).toBe('idle')
})

it('resolves a cancelled permission request without a failure', async () => {
  const audio = captureFixture()
  const permission = Promise.withResolvers<Awaited<ReturnType<typeof audio.getUserMedia>>>()
  audio.getUserMedia.mockReturnValueOnce(permission.promise)
  installFrames()
  const b = fixture()
  const starting = b.service.begin()
  await vi.waitFor(() => { expect(audio.getUserMedia).toHaveBeenCalledOnce() })
  await b.service.cancel()
  permission.resolve(audio.stream)
  await starting
  expect(b.service.snapshot()).toMatchObject({ phase: 'idle', failure: null })
  expect(audio.trackStop).toHaveBeenCalled()
  await audio.recording.dispose()
})

it('raises a failed permission request once cancellation already settled the capture', async () => {
  const audio = captureFixture()
  const permission = Promise.withResolvers<Awaited<ReturnType<typeof audio.getUserMedia>>>()
  audio.getUserMedia.mockReturnValueOnce(permission.promise)
  installFrames()
  const b = fixture()
  const starting = b.service.begin()
  await vi.waitFor(() => { expect(audio.getUserMedia).toHaveBeenCalledOnce() })
  await b.service.cancel()
  permission.reject(new DOMException('denied', 'NotAllowedError'))
  await starting
  expect(b.service.snapshot()).toMatchObject({ phase: 'idle', failure: null })
  await audio.recording.dispose()
})

it('supersedes a pending catalog request when the capture is cancelled', async () => {
  const audio = captureFixture()
  const pending = Promise.withResolvers<RemoteResult<SpeechCatalog>>()
  const b = fixture({ catalogPending: pending.promise })
  installFrames()
  const starting = b.service.begin()
  await vi.waitFor(() => { expect(b.speech.catalog).toHaveBeenCalledOnce() })
  await b.service.cancel()
  pending.resolve({ ok: true, value: catalog })
  await starting
  expect(b.service.snapshot()).toMatchObject({ phase: 'idle', failure: null })
  expect(audio.getUserMedia).not.toHaveBeenCalled()
  await audio.recording.dispose()
})

it('cancels an in-flight transcription after the recording is released', async () => {
  const audio = captureFixture()
  const pending = Promise.withResolvers<RemoteResult<Transcript>>()
  const b = fixture()
  b.transcribe.mockReturnValueOnce(pending.promise)
  installFrames()
  await b.service.begin()
  const finishing = b.service.finish()
  const rejected = expect(finishing).rejects.toThrow('cancelled')
  await vi.waitFor(() => { expect(b.transcribe).toHaveBeenCalledOnce() })
  const signal = b.transcribe.mock.calls[0]![1] as AbortSignal
  expect(signal.aborted).toBe(false)
  await b.service.cancel()
  expect(signal.aborted).toBe(true)
  pending.resolve({ ok: true, value: transcript })
  await rejected
  expect(b.service.snapshot()).toMatchObject({ phase: 'idle', failure: null })
  await audio.recording.dispose()
})

it('rejects commands that do not match the current phase or a withdrawn service', async () => {
  installFrames()
  const b = fixture()
  await expect(b.service.finish()).rejects.toThrow('not recording')
  await expect(b.service.preview({ id: '', label: '' }, () => {}, new AbortController().signal))
    .rejects.toMatchObject({ kind: 'unavailable' })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => { throw new Error('closed') } } })
  await b.service.dispose()
  await expect(b.service.begin()).rejects.toThrow('disposed')
  await expect(b.service.finish()).rejects.toThrow('disposed')
  await expect(b.service.preview({ id: '', label: '' }, () => {}, new AbortController().signal)).rejects.toThrow('disposed')
  await b.service.cancel()
  await b.service.dispose()
})

it('rejects a second concurrent capture', async () => {
  const b = await capturing()
  await expect(b.service.begin()).rejects.toThrow('already active')
  await b.service.cancel()
  expect(b.service.snapshot().phase).toBe('idle')
})

it('republishes an unchanged selection without replacing the snapshot', async () => {
  const audio = captureFixture(), frames = installFrames(), b = fixture()
  await b.service.begin()
  await b.service.finish()
  const before = b.service.snapshot()
  await b.service.begin()
  expect(b.service.snapshot().selection).toBe(before.selection)
  expect(b.service.snapshot().maxDurationSeconds).toBe(before.maxDurationSeconds)
  await b.service.cancel()
  frames.tick()
  await audio.recording.dispose()
})

it('forwards preferences and preparation to the speech Remote', async () => {
  const b = fixture()
  await b.service.configure({ language: 'zh' })
  expect(b.speech.configure).toHaveBeenCalledWith({ language: 'zh' })
  await b.service.prepare(provider, { downloadSource: 'https://hf-mirror.com' })
  expect(b.speech.prepare).toHaveBeenCalledWith(provider, { downloadSource: 'https://hf-mirror.com' })
  await b.service.prepare(provider)
  expect(b.speech.prepare).toHaveBeenLastCalledWith(provider, undefined)
  await b.service.cancelPreparation(provider)
  expect(b.speech.cancelPreparation).toHaveBeenCalledWith(provider)
  const failure = new RemoteError('gateway/internal', 'offline', {})
  b.speech.configure.mockResolvedValueOnce({ ok: false, error: failure })
  b.speech.prepare.mockResolvedValueOnce({ ok: false, error: failure })
  b.speech.cancelPreparation.mockResolvedValueOnce({ ok: false, error: failure })
  await expect(b.service.configure({ language: 'en' })).rejects.toThrow('offline')
  await expect(b.service.prepare(provider)).rejects.toThrow('offline')
  await expect(b.service.cancelPreparation(provider)).rejects.toThrow('offline')
})

it('unwraps the Remote catalog and rejects its error branch', async () => {
  const b = fixture()
  await expect(b.service.catalog()).resolves.toEqual({
    providers: catalog.providers, selection: catalog.selection,
    maxAudioBytes: catalog.maxAudioBytes, maxDurationSeconds: catalog.maxDurationSeconds,
  })
  const failure = new RemoteError('gateway/internal', 'catalog failed', {})
  b.speech.catalog.mockResolvedValueOnce({ ok: false, error: failure })
  await expect(b.service.catalog()).rejects.toThrow('catalog failed')
})

it('follows the catalog across transport generations and ends on abort', async () => {
  const b = fixture({ items: [catalog, { ...catalog, selection: { providerId: provider, language: 'en' } }] })
  const lifetime = new AbortController()
  const seen: string[] = []
  const observing = (async () => {
    for await (const item of b.service.followCatalog(lifetime.signal)) seen.push(item.selection.language)
  })()
  await vi.waitFor(() => { expect(seen).toEqual(['auto', 'en']) })
  const stream = b.streams[0]!
  expect(stream.options.name).toBe('Voice capture catalog')
  expect(stream.options.ended(true)).toBeInstanceOf(RemoteStreamCarrierError)
  const opened = new AbortController()
  const source = stream.options.open(opened.signal)
  await source[Symbol.asyncIterator]().next()
  expect(b.speech.follow).toHaveBeenCalledWith(opened.signal)
  lifetime.abort()
  await observing
  expect(stream.dispose).toHaveBeenCalled()
  await expect((async () => {
    const aborted = new AbortController()
    aborted.abort()
    for await (const _catalog of b.service.followCatalog(aborted.signal)) { /* unreachable */ }
  })()).rejects.toThrow()
})

it('reports a terminal catalog stream failure', async () => {
  const b = fixture({ streamFailure: new Error('invalid snapshot') })
  await expect((async () => {
    for await (const _catalog of b.service.followCatalog(new AbortController().signal)) { /* unreachable */ }
  })()).rejects.toThrow('invalid snapshot')
  expect(b.streams[0]?.dispose).toHaveBeenCalled()
})

it('previews a microphone without recording and releases it on abort', async () => {
  const audio = captureFixture()
  const b = fixture()
  const failure = vi.fn()
  const lifetime = new AbortController()
  const preview = await b.service.preview({ id: 'usb', label: 'USB microphone' }, failure, lifetime.signal)
  expect(audio.getUserMedia.mock.calls.at(-1)?.[0].audio).toMatchObject({ deviceId: { exact: 'usb' } })
  expect(preview.deviceInfo()).toEqual({ label: 'Fixture microphone', groupId: 'fixture-input' })
  expect(preview.level()).toBe(0.25)
  audio.track.dispatchEvent(new Event('ended'))
  expect(failure).toHaveBeenCalledWith('interrupted')
  await preview.dispose()
  lifetime.abort()
  await expect(b.service.preview({ id: '', label: '' }, failure, lifetime.signal)).rejects.toThrow()
  await b.service.dispose()
})

it('releases a preview grant that settles after its lifetime aborts', async () => {
  const audio = captureFixture()
  const granted = Promise.withResolvers<Awaited<ReturnType<typeof audio.getUserMedia>>>()
  audio.getUserMedia.mockReturnValueOnce(granted.promise)
  const b = fixture()
  const lifetime = new AbortController()
  const pending = b.service.preview({ id: '', label: '' }, () => {}, lifetime.signal)
  await vi.waitFor(() => { expect(audio.getUserMedia).toHaveBeenCalledOnce() })
  lifetime.abort()
  granted.resolve(audio.stream)
  await expect(pending).rejects.toMatchObject({ kind: 'cancelled' })
  expect(audio.trackStop).toHaveBeenCalled()
})

it('rejects a preview whose permission is denied', async () => {
  const audio = captureFixture()
  audio.getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
  const b = fixture()
  await expect(b.service.preview({ id: '', label: '' }, () => {}, new AbortController().signal))
    .rejects.toMatchObject({ kind: 'permission' })
})

it('releases the capture and previews when the service is withdrawn', async () => {
  const audio = captureFixture(), frames = installFrames()
  const b = fixture()
  await b.service.begin()
  frames.tick()
  const preview = await b.service.preview({ id: '', label: '' }, () => {}, new AbortController().signal)
  expect(audio.trackStop).not.toHaveBeenCalled()
  await b.service.dispose()
  expect(audio.trackStop).toHaveBeenCalledTimes(2)
  expect(b.service.snapshot()).toMatchObject({ phase: 'idle', level: 0, failure: null })
  await preview.dispose()
})

it('keeps a stopped level loop from publishing after the capture ends', async () => {
  const b = await capturing()
  b.frames.tick()
  await b.service.finish()
  expect(b.frames.cancel).toHaveBeenCalled()
  b.frames.tick(100)
  expect(b.service.snapshot().level).toBe(0)
  expect(b.service.snapshot().phase).toBe('idle')
})

it('yields a change published while a follower still holds the previous snapshot', async () => {
  const b = fixture()
  const lifetime = new AbortController()
  const seen: VoiceCaptureSnapshot[] = []
  const observing = (async () => {
    for await (const snapshot of b.service.follow(lifetime.signal)) {
      seen.push(snapshot)
      if (seen.length === 1) b.service.setDevice({ id: 'inside', label: 'Inside' })
      if (seen.length === 2) lifetime.abort()
    }
  })()
  await observing
  expect(seen.map(snapshot => snapshot.device.id)).toEqual(['', 'inside'])
})

it('settles a cancelled catalog failure without publishing it', async () => {
  const pending = Promise.withResolvers<RemoteResult<SpeechCatalog>>()
  const b = fixture({ catalogPending: pending.promise })
  const starting = b.service.begin()
  await vi.waitFor(() => { expect(b.speech.catalog).toHaveBeenCalledOnce() })
  await b.service.cancel()
  pending.reject(new Error('catalog offline'))
  await starting
  expect(b.service.snapshot()).toMatchObject({ phase: 'idle', failure: null })
  await b.service.dispose()
})

it('keeps a non-error rejection message on the failure', async () => {
  captureFixture()
  installFrames()
  const b = fixture()
  b.speech.catalog.mockRejectedValueOnce('catalog offline')
  await expect(b.service.begin()).rejects.toThrow('catalog offline')
  expect(b.service.snapshot()).toMatchObject({ phase: 'idle', failure: 'transcribe' })
  await b.service.dispose()
})

it('cancels a capture that is still encoding', async () => {
  const audio = captureFixture(), frames = installFrames(), b = fixture()
  const decoded = Promise.withResolvers<{ duration: number }>()
  audio.decoding.mockReturnValueOnce(decoded.promise)
  await b.service.begin()
  const finishing = b.service.finish()
  const rejected = expect(finishing).rejects.toThrow('cancelled')
  await vi.waitFor(() => { expect(audio.decoding).toHaveBeenCalledOnce() })
  await b.service.cancel()
  decoded.resolve({ duration: 2 })
  await rejected
  expect(b.service.snapshot()).toMatchObject({ phase: 'idle', failure: null })
  expect(b.transcribe).not.toHaveBeenCalled()
  frames.tick()
  await audio.recording.dispose()
})

it('releases an encode when the service is withdrawn', async () => {
  const audio = captureFixture(), frames = installFrames(), b = fixture()
  const decoded = Promise.withResolvers<{ duration: number }>()
  audio.decoding.mockReturnValueOnce(decoded.promise)
  await b.service.begin()
  const finishing = b.service.finish()
  const rejected = expect(finishing).rejects.toThrow('cancelled')
  await vi.waitFor(() => { expect(audio.decoding).toHaveBeenCalledOnce() })
  const withdrawing = b.service.dispose()
  decoded.resolve({ duration: 2 })
  await rejected
  await withdrawing
  expect(b.transcribe).not.toHaveBeenCalled()
  frames.tick()
  await audio.recording.dispose()
})

it('stops a catalog observation aborted during an item', async () => {
  const b = fixture({ items: [catalog, { ...catalog, selection: { providerId: provider, language: 'en' } }] })
  const lifetime = new AbortController()
  const seen: string[] = []
  const observing = (async () => {
    for await (const item of b.service.followCatalog(lifetime.signal)) {
      seen.push(item.selection.language)
      lifetime.abort()
    }
  })()
  await observing
  expect(seen).toEqual(['auto'])
  expect(b.streams[0]?.dispose).toHaveBeenCalled()
})

it('encodes through the base64 carrier the speech Remote expects', () => {
  const bytes = encodeWave(new Float32Array([0.25]))
  expect(Buffer.from(audioBase64(bytes), 'base64')).toEqual(Buffer.from(bytes))
})
