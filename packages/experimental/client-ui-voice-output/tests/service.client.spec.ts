/** The playback service owns the policy, the single pending reply, one audio element, and typed failures. */
import { Context } from '@deepseek-ai/cordis'
import type { SynthesisRequest } from '@deepseek-ai/dsh-api-text-to-speech/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CapturePhaseSource } from '../src/client/replies.ts'
import { VoiceOutputService } from '../src/client/service.ts'
import {
  assistantMessage, audioFixture, catalog, sessionFixture, speechFixture, synthesized, toolResult, turnStart, userMessage,
  type AudioFixture, type SpeechFixture,
} from './voice-output-fixture.client.ts'

const roots: Context[] = []
const services: VoiceOutputService[] = []

afterEach(async () => {
  for (const service of services.splice(0)) service.dispose()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

interface Fixture {
  readonly ctx: Context
  readonly service: VoiceOutputService
  readonly speech: SpeechFixture
  readonly audio: AudioFixture
}

/**
 * Create a service over a stub speech Remote and a controllable audio factory.
 * @param options - prepared Remote and audio stubs.
 * @returns the client context and the service under test.
 */
function fixture(options: { speech?: SpeechFixture; audio?: AudioFixture; capture?: CapturePhaseSource } = {}): Fixture {
  const ctx = new Context()
  roots.push(ctx)
  const speech = options.speech ?? speechFixture()
  ctx.provide('remote', { speechOutput: speech.namespace })
  if (options.capture !== undefined) ctx.provide('voiceCapture', options.capture)
  const audio = options.audio ?? audioFixture()
  const service = new VoiceOutputService(ctx, { audio: audio.factory })
  services.push(service)
  if (options.capture !== undefined) service.observeCapture(options.capture)
  return { ctx, service, speech, audio }
}

/** Let queued promise work, including the constructor's catalog request, settle. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
}

/**
 * Attach the service to one focused main-view Session.
 * @param service - service under test.
 * @param bench - Session object-layer stub.
 * @param id - Session the conversation frame retains.
 * @returns the Session's event window.
 */
function follow(service: VoiceOutputService, bench: ReturnType<typeof sessionFixture>, id = 'session-one') {
  const events = bench.session(id)
  bench.focus(id)
  const detach = service.observe(bench.source)
  events.replace([], false)
  return { events, detach }
}

/** Read the request one synthesize call carried. */
function requestOf(speech: SpeechFixture, index: number): SynthesisRequest {
  return speech.synthesize.mock.calls[index]![0] as SynthesisRequest
}

describe('catalog and preferences', () => {
  it('adopts the advertised voices, the text limit, and the Host-selected voice', async () => {
    const b = fixture()
    expect(b.service.snapshot()).toMatchObject({ policy: 'off', voiceId: null, voices: [], muted: false,
      speaking: false, queued: 0, failure: null, limit: 0 })
    await settle()
    const adopted = b.service.snapshot()
    expect(adopted).toMatchObject({
      voiceId: 'stella',
      voices: [{ id: 'stella', name: 'Stella' }, { id: 'tide', name: 'Tide' }],
      limit: 40,
      failure: null,
    })
    expect(b.service.snapshot()).toBe(adopted)
    expect(b.ctx).toBeDefined()
  })

  it('keeps one advertised voice per id and falls back to the first advertised voice', async () => {
    const b = fixture({
      speech: speechFixture({
        catalog: async () => ({
          ok: true as const,
          value: catalog({
            providers: [
              { ...catalog().providers[0]!, id: 'first' as never, voices: [{ id: 'stella', name: 'Stella' }] },
              { ...catalog().providers[0]!, id: 'second' as never, voices: [{ id: 'stella', name: 'Duplicate' }, { id: 'tide', name: 'Tide' }] },
            ],
            selection: { providerId: 'first' as never, voiceId: 'retired', format: 'wav' },
          }),
        }),
      }),
    })
    await settle()
    expect(b.service.snapshot().voices).toEqual([{ id: 'stella', name: 'Stella' }, { id: 'tide', name: 'Tide' }])
    expect(b.service.snapshot().voiceId).toBe('stella')
    const speaking = b.service.speak('hello')
    await settle()
    expect(requestOf(b.speech, 0)).toMatchObject({ providerId: 'first', voiceId: 'stella' })
    b.audio.clips[0]!.ended()
    await speaking
  })

  it('publishes unavailable when the catalog advertises no voice', async () => {
    const b = fixture({ speech: speechFixture({ catalog: async () => ({ ok: true as const, value: catalog({ providers: [] }) }) }) })
    await settle()
    expect(b.service.snapshot()).toMatchObject({ voices: [], voiceId: null, limit: 40, failure: 'unavailable' })
    await b.service.speak('hello')
    expect(b.speech.synthesize).not.toHaveBeenCalled()
    expect(b.service.snapshot().failure).toBe('unavailable')
  })

  it('maps a rejected catalog to remote and an unreachable Remote to unavailable', async () => {
    const rejected = fixture({ speech: speechFixture({
      catalog: async () => ({ ok: false as const, error: new Error('rejected') as never }),
    }) })
    await settle()
    expect(rejected.service.snapshot().failure).toBe('remote')
    const unreachable = fixture({ speech: speechFixture({
      catalog: async () => { throw new Error('offline') },
    }) })
    await settle()
    expect(unreachable.service.snapshot().failure).toBe('unavailable')
  })

  it('ignores a catalog that settles after disposal', async () => {
    const pending = Promise.withResolvers<{ ok: true; value: ReturnType<typeof catalog> }>()
    const b = fixture({ speech: speechFixture({ catalog: () => pending.promise }) })
    b.service.dispose()
    pending.resolve({ ok: true, value: catalog() })
    await settle()
    expect(b.service.snapshot()).toMatchObject({ voices: [], limit: 0, failure: null })
  })

  it('adopts persisted preferences and repairs malformed stored values', async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
    })
    storage.set('dsh.voice-output', JSON.stringify({ policy: 'all', voiceId: 'tide', muted: true }))
    const adopted = fixture()
    await settle()
    expect(adopted.service.snapshot()).toMatchObject({ policy: 'all', voiceId: 'tide', muted: true })
    expect(JSON.parse(storage.get('dsh.voice-output')!)).toMatchObject({ policy: 'all', voiceId: 'tide', muted: true })

    storage.set('dsh.voice-output', JSON.stringify({ policy: 'always', voiceId: 7, muted: 'yes' }))
    const repaired = fixture()
    await settle()
    expect(repaired.service.snapshot()).toMatchObject({ policy: 'off', voiceId: 'stella', muted: false })
    expect(JSON.parse(storage.get('dsh.voice-output')!)).toMatchObject({ policy: 'off', voiceId: null, muted: false })
  })
})

describe('explicit speech', () => {
  it('speaks trimmed text through one clip and revokes its object URL when it ends', async () => {
    const b = fixture()
    await settle()
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const speaking = b.service.speak('  hello there  ')
    await settle()
    expect(requestOf(b.speech, 0)).toMatchObject({ text: 'hello there', voiceId: 'stella', providerId: 'deepseek-tts' })
    expect(b.audio.clips).toHaveLength(1)
    expect(b.audio.clips[0]!.play).toHaveBeenCalledOnce()
    expect(b.service.snapshot()).toMatchObject({ speaking: true, queued: 0, failure: null })
    b.audio.clips[0]!.ended()
    await speaking
    expect(revoke).toHaveBeenCalledWith(b.audio.clips[0]!.url)
    expect(b.service.snapshot().speaking).toBe(false)
  })

  it('truncates text to the advertised character limit instead of splitting the request', async () => {
    const b = fixture({ speech: speechFixture({
      catalog: async () => ({ ok: true as const, value: catalog({ maxTextChars: 5 }) }),
    }) })
    await settle()
    const speaking = b.service.speak('abcdefghij')
    await settle()
    expect(requestOf(b.speech, 0).text).toBe('abcde')
    expect(b.speech.synthesize).toHaveBeenCalledOnce()
    b.audio.clips[0]!.ended()
    await speaking
  })

  it('ignores an empty request and speaks nothing while muted', async () => {
    const b = fixture()
    await settle()
    await b.service.speak('   ')
    expect(b.speech.synthesize).not.toHaveBeenCalled()
    b.service.setMuted(true)
    await b.service.speak('hello')
    await settle()
    expect(b.speech.synthesize).not.toHaveBeenCalled()
    expect(b.service.snapshot()).toMatchObject({ muted: true, speaking: false, queued: 0 })
    b.service.setMuted(false)
    expect(b.service.snapshot().muted).toBe(false)
  })

  it('takes no further effect when a preference keeps its current value', async () => {
    const b = fixture()
    await settle()
    b.service.setPolicy('all')
    const policies = b.service.snapshot()
    b.service.setPolicy('all')
    expect(b.service.snapshot()).toBe(policies)
    b.service.setMuted(true)
    const muted = b.service.snapshot()
    b.service.setMuted(true)
    expect(b.service.snapshot()).toBe(muted)
    b.service.setMuted(false)
  })

  it('rejects an unknown voice without replacing the remembered selection', async () => {
    const b = fixture()
    await settle()
    b.service.setVoice('tide')
    expect(b.service.snapshot().voiceId).toBe('tide')
    b.service.setVoice('ghost')
    expect(b.service.snapshot()).toMatchObject({ voiceId: 'tide', failure: 'voice' })
    b.service.setVoice('tide')
    expect(b.service.snapshot().voiceId).toBe('tide')
  })

  it('publishes voice for a stored voice the catalog does not advertise yet', async () => {
    const storage = new Map<string, string>([['dsh.voice-output', JSON.stringify({ policy: 'off', voiceId: 'stella', muted: false })]])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
    })
    const pending = Promise.withResolvers<never>()
    const b = fixture({ speech: speechFixture({ catalog: () => pending.promise }) })
    await b.service.speak('hello')
    expect(b.speech.synthesize).not.toHaveBeenCalled()
    expect(b.service.snapshot()).toMatchObject({ voiceId: 'stella', failure: 'voice' })
  })
})

describe('auto-speak policy', () => {
  it('speaks every completed reply under the all policy and nothing under off', async () => {
    const bench = sessionFixture()
    const b = fixture()
    await settle()
    const { events } = follow(b.service, bench)
    events.append(turnStart(1, 1))
    events.append(userMessage(2))
    events.append(assistantMessage(3, 1, 'first answer'))
    await settle()
    expect(b.speech.synthesize).not.toHaveBeenCalled()

    b.service.setPolicy('all')
    events.append(turnStart(4, 2))
    events.append(userMessage(5))
    events.append(assistantMessage(6, 2, 'second answer'))
    await settle()
    expect(requestOf(b.speech, 0)).toMatchObject({ text: 'second answer' })
    b.audio.clips[0]!.ended()
    await settle()
  })

  it('never speaks tool output, user messages, attempts, or a reply without visible text', async () => {
    const bench = sessionFixture()
    const b = fixture()
    await settle()
    b.service.setPolicy('all')
    const { events } = follow(b.service, bench)
    events.append(turnStart(1, 1))
    events.append(userMessage(2))
    events.append(entryOf('assistant/attempt', 3, { turn: 1, step: 1, stream: [] }))
    events.append(toolResult(4, 1))
    events.append(entryOf('step/start', 5, { turn: 1, step: 2 }))
    events.append(assistantMessage(6, 1, null))
    await settle()
    expect(b.speech.synthesize).not.toHaveBeenCalled()
  })

  it('speaks a voice-initiated turn only under the voice policy', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    const capture = captureFixture('transcribing')
    const bench = sessionFixture()
    const b = fixture({ capture: capture.source })
    await settle()
    b.service.setPolicy('voice')
    const { events } = follow(b.service, bench)
    // The adopted capture emits the transition that marks the next submitted turn.
    capture.emit('idle')
    await settle()
    events.append(turnStart(1, 1))
    events.append(userMessage(2))
    events.append(assistantMessage(3, 1, 'spoken reply'))
    await settle()
    expect(requestOf(b.speech, 0)).toMatchObject({ text: 'spoken reply' })
    b.audio.clips[0]!.ended()
    await settle()
    // The mark was consumed by that submission: a later reply stays silent.
    events.append(turnStart(4, 2))
    events.append(userMessage(5))
    events.append(assistantMessage(6, 2, 'silent reply'))
    await settle()
    expect(b.speech.synthesize).toHaveBeenCalledOnce()
  })

  it('keeps a reply silent under the voice policy without a mark or after the mark expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    const capture = captureFixture('transcribing')
    const bench = sessionFixture()
    const b = fixture({ capture: capture.source })
    await settle()
    b.service.setPolicy('voice')
    const { events } = follow(b.service, bench)
    events.append(turnStart(1, 1))
    events.append(userMessage(2))
    events.append(assistantMessage(3, 1, 'unmarked'))
    await settle()
    expect(b.speech.synthesize).not.toHaveBeenCalled()

    capture.emit('idle')
    await settle()
    vi.setSystemTime(1_000_000 + 61_000)
    events.append(turnStart(4, 2))
    events.append(userMessage(5))
    events.append(assistantMessage(6, 2, 'expired mark'))
    await settle()
    expect(b.speech.synthesize).not.toHaveBeenCalled()
  })
})

describe('active Session changes', () => {
  it('follows the newly retained Session and speaks nothing for the previous one', async () => {
    const bench = sessionFixture()
    const b = fixture()
    await settle()
    b.service.setPolicy('all')
    const first = bench.session('session-one')
    const second = bench.session('session-two')
    bench.focus('session-one')
    b.service.observe(bench.source)
    first.replace([], false)
    second.replace([], false)
    first.append(turnStart(1, 1))
    first.append(userMessage(2))
    first.append(assistantMessage(3, 1, 'first session reply'))
    await settle()
    expect(requestOf(b.speech, 0).text).toBe('first session reply')
    b.audio.clips[0]!.ended()
    await settle()

    bench.focus('session-two')
    await settle()
    expect(b.speech.synthesize).toHaveBeenCalledOnce()
    expect(b.service.snapshot()).toMatchObject({ speaking: false, queued: 0 })

    first.append(turnStart(4, 2))
    first.append(userMessage(5))
    first.append(assistantMessage(6, 2, 'stale session reply'))
    await settle()
    expect(b.speech.synthesize).toHaveBeenCalledOnce()

    second.append(turnStart(1, 1))
    second.append(userMessage(2))
    second.append(assistantMessage(3, 1, 'second session reply'))
    await settle()
    expect(requestOf(b.speech, 1).text).toBe('second session reply')
    b.audio.clips[1]!.ended()
    await settle()
  })
})

describe('queue and interruption', () => {
  it('keeps one pending reply and plays the newest when the clip ends', async () => {
    const bench = sessionFixture()
    const b = fixture()
    await settle()
    b.service.setPolicy('all')
    const { events } = follow(b.service, bench)
    events.append(turnStart(1, 1))
    events.append(userMessage(2))
    events.append(assistantMessage(3, 1, 'reply A'))
    await settle()
    expect(b.service.snapshot()).toMatchObject({ speaking: true, queued: 0 })
    events.append(assistantMessage(4, 1, 'reply B'))
    const replaced = b.service.snapshot()
    expect(replaced).toMatchObject({ speaking: true, queued: 1 })
    events.append(assistantMessage(5, 1, 'reply C'))
    expect(b.service.snapshot()).toBe(replaced)
    expect(b.speech.synthesize).toHaveBeenCalledOnce()
    b.audio.clips[0]!.ended()
    await settle()
    expect(b.speech.synthesize).toHaveBeenCalledTimes(2)
    expect(requestOf(b.speech, 1).text).toBe('reply C')
    b.audio.clips[1]!.ended()
    await settle()
    expect(b.service.snapshot()).toMatchObject({ speaking: false, queued: 0 })
  })

  it('stops playback and the pending reply on an explicit stop', async () => {
    const b = fixture()
    await settle()
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const speaking = b.service.speak('first')
    await settle()
    const queued = b.service.speak('second')
    expect(b.service.snapshot()).toMatchObject({ speaking: true, queued: 1 })
    b.service.stop()
    await speaking
    await queued
    expect(b.audio.clips[0]!.pause).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith(b.audio.clips[0]!.url)
    expect(b.service.snapshot()).toMatchObject({ speaking: false, queued: 0, failure: null })
    b.service.stop()
    expect(b.service.snapshot()).toMatchObject({ speaking: false, queued: 0 })
  })

  it('abandons an in-flight synthesis when a stop settles it', async () => {
    const gate = Promise.withResolvers<Awaited<ReturnType<SpeechFixture['synthesize']>>>()
    const b = fixture({ speech: speechFixture({ synthesize: () => gate.promise }) })
    await settle()
    const speaking = b.service.speak('slow')
    await settle()
    expect(b.service.snapshot().speaking).toBe(false)
    b.service.stop()
    gate.resolve({ ok: true, value: synthesized() })
    await speaking
    expect(b.audio.clips).toHaveLength(0)
    expect(b.service.snapshot()).toMatchObject({ speaking: false, failure: null })
  })

  it('settles a synthesis that fails after a stop without publishing a failure', async () => {
    const gate = Promise.withResolvers<Awaited<ReturnType<SpeechFixture['synthesize']>>>()
    const b = fixture({ speech: speechFixture({ synthesize: () => gate.promise }) })
    await settle()
    const speaking = b.service.speak('slow')
    await settle()
    b.service.stop()
    gate.reject(new Error('aborted'))
    await speaking
    expect(b.audio.clips).toHaveLength(0)
    expect(b.service.snapshot()).toMatchObject({ speaking: false, failure: null })
  })

  it('does not announce playback that a stop interrupted while play was settling', async () => {
    const gate = Promise.withResolvers<undefined>()
    const b = fixture({ audio: audioFixture({ play: () => gate.promise }) })
    await settle()
    const speaking = b.service.speak('hello')
    await settle()
    b.service.stop()
    gate.resolve(undefined)
    await speaking
    expect(b.service.snapshot()).toMatchObject({ speaking: false, failure: null })
    expect(b.audio.clips[0]!.pause).toHaveBeenCalledOnce()
  })

  it('interrupts playback when the active Session opens a new turn', async () => {
    const bench = sessionFixture()
    const b = fixture()
    await settle()
    b.service.setPolicy('all')
    const { events } = follow(b.service, bench)
    events.append(turnStart(1, 1))
    events.append(userMessage(2))
    events.append(assistantMessage(3, 1, 'reply'))
    await settle()
    expect(b.service.snapshot().speaking).toBe(true)
    events.append(turnStart(4, 2))
    expect(b.audio.clips[0]!.pause).toHaveBeenCalledOnce()
    expect(b.service.snapshot()).toMatchObject({ speaking: false, queued: 0 })
  })

  it('silences playback when mute is enabled', async () => {
    const b = fixture()
    await settle()
    const speaking = b.service.speak('muted soon')
    await settle()
    b.service.setMuted(true)
    await speaking
    expect(b.audio.clips[0]!.pause).toHaveBeenCalledOnce()
    expect(b.service.snapshot()).toMatchObject({ muted: true, speaking: false })
  })

  it('plays two provably queued explicit requests one after the other', async () => {
    const gate = Promise.withResolvers<Awaited<ReturnType<SpeechFixture['synthesize']>>>()
    let call = 0
    const b = fixture({ speech: speechFixture({
      synthesize: async () => {
        call += 1
        return call === 1 ? gate.promise : { ok: true as const, value: synthesized() }
      },
    }) })
    await settle()
    const first = b.service.speak('first')
    await settle()
    const second = b.service.speak('second')
    expect(b.service.snapshot().queued).toBe(1)
    gate.resolve({ ok: true, value: synthesized() })
    await settle()
    expect(b.service.snapshot()).toMatchObject({ speaking: true, queued: 1 })
    b.audio.clips[0]!.ended()
    await settle()
    expect(requestOf(b.speech, 1).text).toBe('second')
    b.audio.clips[1]!.ended()
    await first
    await second
  })
})

describe('failure mapping', () => {
  it('maps a rejected synthesis to remote and clears the failure on the next start', async () => {
    let fail = true
    const b = fixture({ speech: speechFixture({
      synthesize: async () => fail
        ? { ok: false as const, error: new Error('rejected') as never }
        : { ok: true as const, value: synthesized() },
    }) })
    await settle()
    await b.service.speak('refused')
    expect(b.service.snapshot().failure).toBe('remote')
    fail = false
    const speaking = b.service.speak('accepted')
    await settle()
    expect(b.service.snapshot()).toMatchObject({ speaking: true, failure: null })
    b.audio.clips[0]!.ended()
    await speaking
  })

  it('maps an unreachable Remote to unavailable', async () => {
    const b = fixture({ speech: speechFixture({ synthesize: async () => { throw new Error('offline') } }) })
    await settle()
    await b.service.speak('hello')
    expect(b.service.snapshot().failure).toBe('unavailable')
  })

  it('maps an uncreatable object URL and an uncreatable element to playback', async () => {
    const unreachable = fixture()
    await settle()
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('no blob URLs') })
    await unreachable.service.speak('hello')
    expect(unreachable.service.snapshot().failure).toBe('playback')
    expect(unreachable.speech.synthesize).toHaveBeenCalledOnce()
    create.mockRestore()

    const uncreatable = fixture({ audio: audioFixture({ create: () => { throw new Error('no audio') } }) })
    await settle()
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    await uncreatable.service.speak('hello')
    expect(uncreatable.service.snapshot().failure).toBe('playback')
    expect(revoke).toHaveBeenCalledOnce()
  })

  it('maps a refused play call to playback and ignores the element afterwards', async () => {
    const b = fixture({ audio: audioFixture({ play: async () => { throw new Error('blocked') } }) })
    await settle()
    await b.service.speak('hello')
    expect(b.service.snapshot()).toMatchObject({ failure: 'playback', speaking: false })
    b.audio.clips[0]!.ended()
    expect(b.service.snapshot()).toMatchObject({ failure: 'playback', speaking: false })
  })

  it('maps an element media error to playback', async () => {
    const b = fixture()
    await settle()
    const speaking = b.service.speak('hello')
    await settle()
    b.audio.clips[0]!.failed()
    await speaking
    expect(b.service.snapshot()).toMatchObject({ failure: 'playback', speaking: false })
  })
})

describe('capture observation', () => {
  it('marks a turn only for the transcribing-to-idle transition', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(2_000_000)
    const capture = captureFixture('starting')
    const bench = sessionFixture()
    const b = fixture({ capture: capture.source })
    await settle()
    b.service.setPolicy('voice')
    const { events } = follow(b.service, bench)
    capture.emit('capturing')
    await settle()
    capture.emit('idle')
    await settle()
    events.append(turnStart(1, 1))
    events.append(userMessage(2))
    events.append(assistantMessage(3, 1, 'cancelled capture'))
    await settle()
    expect(b.speech.synthesize).not.toHaveBeenCalled()
    capture.emit('transcribing')
    await settle()
    capture.emit('idle')
    await settle()
    events.append(turnStart(4, 2))
    events.append(userMessage(5))
    events.append(assistantMessage(6, 2, 'finished capture'))
    await settle()
    expect(requestOf(b.speech, 0).text).toBe('finished capture')
    b.audio.clips[0]!.ended()
    await settle()
  })

  it('ends the capture observation when it fails without affecting playback', async () => {
    const capture = captureFixture('transcribing')
    const bench = sessionFixture()
    const b = fixture({ capture: capture.source })
    await settle()
    b.service.setPolicy('all')
    const { events } = follow(b.service, bench)
    capture.fail(new Error('capture service failed'))
    await settle()
    events.append(turnStart(1, 1))
    events.append(userMessage(2))
    events.append(assistantMessage(3, 1, 'still spoken'))
    await settle()
    expect(requestOf(b.speech, 0).text).toBe('still spoken')
    b.audio.clips[0]!.ended()
    await settle()
  })

  it('detaches the reply observation when its disposer runs', async () => {
    const bench = sessionFixture()
    const b = fixture()
    await settle()
    b.service.setPolicy('all')
    const { events, detach } = follow(b.service, bench)
    detach()
    events.append(turnStart(1, 1))
    events.append(userMessage(2))
    events.append(assistantMessage(3, 1, 'detached'))
    await settle()
    expect(b.speech.synthesize).not.toHaveBeenCalled()
  })

  it('takes no capture registration after disposal', () => {
    const b = fixture()
    b.service.dispose()
    const detach = b.service.observeCapture(captureFixture('idle').source)
    expect(detach).toBeTypeOf('function')
    detach()
  })

  it('marks voice turns only while the current capture registration watches', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(3_000_000)
    const bench = sessionFixture()
    const b = fixture()
    await settle()
    b.service.setPolicy('voice')
    const { events } = follow(b.service, bench)
    const first = captureFixture('idle')
    const second = captureFixture('idle')
    const detachFirst = b.service.observeCapture(first.source)
    const detachSecond = b.service.observeCapture(second.source)

    // A superseded registration's disposer leaves the newer watch in place.
    detachFirst()
    second.emit('transcribing')
    await settle()
    second.emit('idle')
    await settle()
    events.append(turnStart(1, 1))
    events.append(userMessage(2))
    events.append(assistantMessage(3, 1, 'marked by the current capture'))
    await settle()
    expect(requestOf(b.speech, 0).text).toBe('marked by the current capture')
    b.audio.clips[0]!.ended()
    await settle()

    // The owning registration's disposer ends the watch, so a later capture marks nothing.
    detachSecond()
    second.emit('transcribing')
    await settle()
    second.emit('idle')
    await settle()
    events.append(turnStart(4, 2))
    events.append(userMessage(5))
    events.append(assistantMessage(6, 2, 'unmarked after detach'))
    await settle()
    expect(b.speech.synthesize).toHaveBeenCalledOnce()
  })
})

describe('lifecycle', () => {
  it('publishes every changed snapshot to followers until the observation aborts', async () => {
    const b = fixture()
    await settle()
    const lifetime = new AbortController()
    const seen: number[] = []
    const observing = (async () => {
      for await (const snapshot of b.service.follow(lifetime.signal)) seen.push(snapshot.limit)
    })()
    await settle()
    expect(seen).toEqual([40])
    b.service.setPolicy('all')
    await settle()
    expect(seen).toEqual([40, 40])
    expect(b.service.snapshot().policy).toBe('all')
    lifetime.abort()
    await observing
    const aborted = new AbortController()
    aborted.abort()
    await expect((async () => {
      for await (const _snapshot of b.service.follow(aborted.signal)) { /* unreachable */ }
    })()).rejects.toThrow()
  })

  it('stops playback and ignores requests after disposal', async () => {
    const b = fixture()
    await settle()
    const speaking = b.service.speak('hello')
    await settle()
    b.service.dispose()
    await speaking
    expect(b.audio.clips[0]!.pause).toHaveBeenCalledOnce()
    expect(b.service.snapshot()).toMatchObject({ speaking: false, queued: 0 })
    await b.service.speak('after disposal')
    expect(b.speech.synthesize).toHaveBeenCalledOnce()
    b.service.dispose()
    const detached = b.service.observe(sessionFixture().source)
    expect(detached).toBeTypeOf('function')
    detached()
  })

  it('creates the audio element through the browser Audio constructor by default', async () => {
    const clips: { url: string; play: () => Promise<void> }[] = []
    class BrowserAudio {
      constructor(readonly url: string) {
        clips.push({ url, play: async () => {} })
      }
      play = async (): Promise<void> => {}
      pause = (): void => {}
      addEventListener = (): void => {}
    }
    vi.stubGlobal('Audio', BrowserAudio)
    const ctx = new Context()
    roots.push(ctx)
    const speech = speechFixture()
    ctx.provide('remote', { speechOutput: speech.namespace })
    const service = new VoiceOutputService(ctx)
    services.push(service)
    await settle()
    const speaking = service.speak('hello')
    await settle()
    expect(clips).toHaveLength(1)
    expect(clips[0]!.url).toMatch(/^blob:/)
    service.stop()
    await speaking
  })
})

/** Build one durable entry through the shared fixture helper. */
function entryOf(type: string, seq: number, data: Record<string, unknown>) {
  return { type: 'event' as const, event: { type, seq, time: seq * 1000, data } as never }
}

/** Controllable capture-phase source for the voice-turn marker. */
function captureFixture(initial: string) {
  let next: ((phase: string) => void) | undefined
  let fail: ((error: Error) => void) | undefined
  const source: CapturePhaseSource = {
    snapshot: () => ({ phase: initial }),
    follow: async function* (signal: AbortSignal) {
      while (!signal.aborted) {
        const phase = await new Promise<string>((resolve, reject) => {
          next = resolve
          fail = reject
        })
        yield { phase }
      }
    },
  }
  return {
    source,
    emit: (phase: string): void => { next?.(phase) },
    fail: (error: Error): void => { fail?.(error) },
  }
}
