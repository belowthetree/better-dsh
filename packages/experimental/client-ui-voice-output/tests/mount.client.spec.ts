/** Mounting owns the Remote contribution and the provided service for one plugin lifetime. */
import { Context } from '@deepseek-ai/cordis'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VoiceOutput } from '../src/protocol.ts'
import { mountVoiceOutput } from '../src/client/mount.ts'
import {
  assistantMessage, audioFixture, sessionFixture, speechFixture, turnStart, userMessage,
  type AudioFixture, type SpeechFixture,
} from './voice-output-fixture.client.ts'

const CONTRIBUTION: TypertRemoteContribution = {
  package: '@deepseek-ai/dsh-api-text-to-speech',
  descriptors: [],
}

const roots: Context[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

interface Fixture {
  readonly ctx: Context
  readonly speech: SpeechFixture
  readonly audio: AudioFixture
  readonly unmount: ReturnType<typeof vi.fn<() => Promise<void>>>
}

/**
 * Create a client context carrying the stub speech Remote.
 * @param options - audio factory override.
 * @returns the context, both stubs, and the Remote contribution disposer.
 */
function fixture(options: { audio?: AudioFixture } = {}): Fixture {
  const ctx = new Context()
  roots.push(ctx)
  const speech = speechFixture()
  const unmount = vi.fn(async () => {})
  ctx.provide('remote', { speechOutput: speech.namespace, $mount: async (contribution: TypertRemoteContribution) => {
    expect(contribution).toBe(CONTRIBUTION)
    return unmount
  } })
  return { ctx, speech, audio: options.audio ?? audioFixture(), unmount }
}

/** Let the injected Session fiber and queued promise work settle. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
}

/**
 * Read the service this package provided; the spec program has no Context augmentation.
 * @param ctx - client context that mounted the plugin.
 * @returns the provided playback service.
 */
function voiceOutputOf(ctx: Context): VoiceOutput {
  return ctx.get('voiceOutput') as VoiceOutput
}

describe('mountVoiceOutput', () => {
  it('mounts the contribution, provides the service, and withdraws both', async () => {
    const b = fixture()
    expect(b.ctx.get('voiceOutput')).toBeUndefined()
    const dispose = await mountVoiceOutput(b.ctx, CONTRIBUTION, { audio: b.audio.factory })
    expect(b.ctx.get('voiceOutput')).toBeDefined()
    expect(b.unmount).not.toHaveBeenCalled()
    await dispose()
    expect(b.ctx.get('voiceOutput')).toBeUndefined()
    expect(b.unmount).toHaveBeenCalledOnce()
  })

  it('speaks an explicit request without any Session observation', async () => {
    const b = fixture()
    const dispose = await mountVoiceOutput(b.ctx, CONTRIBUTION, { audio: b.audio.factory })
    await settle()
    const speaking = voiceOutputOf(b.ctx).speak('hello')
    await settle()
    expect(b.speech.synthesize).toHaveBeenCalledOnce()
    b.audio.clips[0]!.ended()
    await speaking
    await dispose()
  })

  it('follows the Session object layer once the service appears', async () => {
    stubAllPolicy()
    const b = fixture()
    const dispose = await mountVoiceOutput(b.ctx, CONTRIBUTION, { audio: b.audio.factory })
    const bench = sessionFixture()
    const events = bench.session('one')
    bench.focus('one')
    events.replace([], false)
    b.ctx.provide('sessions', bench.source)
    await settle()
    events.append(turnStart(1, 1))
    events.append(userMessage(2))
    events.append(assistantMessage(3, 1, 'spoken after mount'))
    await settle()
    expect(b.speech.synthesize).toHaveBeenCalledOnce()
    await dispose()
  })

  it('withdraws the service and the contribution when the plugin fiber is disposed', async () => {
    const b = fixture()
    const fiber = b.ctx.plugin({
      name: 'client-ui-voice-output',
      apply: scoped => mountVoiceOutput(scoped, CONTRIBUTION, { audio: b.audio.factory }),
    })
    await fiber
    await settle()
    const speaking = voiceOutputOf(b.ctx).speak('hello')
    await settle()
    await fiber.dispose()
    await speaking
    expect(b.audio.clips[0]!.pause).toHaveBeenCalledOnce()
    expect(b.ctx.get('voiceOutput')).toBeUndefined()
    expect(b.unmount).toHaveBeenCalledOnce()
  })

  it('uses the browser Audio constructor when no factory is injected', async () => {
    const clips: string[] = []
    class BrowserAudio {
      constructor(url: string) { clips.push(url) }
      play = async (): Promise<void> => {}
      pause = (): void => {}
      addEventListener = (): void => {}
    }
    vi.stubGlobal('Audio', BrowserAudio)
    const b = fixture()
    const dispose = await mountVoiceOutput(b.ctx, CONTRIBUTION)
    await settle()
    const speaking = voiceOutputOf(b.ctx).speak('hello')
    await settle()
    expect(clips).toHaveLength(1)
    voiceOutputOf(b.ctx).stop()
    await speaking
    await dispose()
  })
})

/** Persist the all-replies policy before a mount, as a returning browser profile would. */
function stubAllPolicy(): void {
  const storage = new Map<string, string>([['dsh.voice-output', JSON.stringify({ policy: 'all', voiceId: null, muted: false })]])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
  })
}
