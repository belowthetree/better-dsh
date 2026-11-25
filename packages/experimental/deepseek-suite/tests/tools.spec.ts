// @vitest-environment node
/* oxlint-disable typescript/no-misused-spread -- hand-built Host doubles. */
/** The built-in plugin registers its tools and both speech providers. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { apply, Config } from '../src/index.ts'
import { ASR_ACCOUNT_API_CODE, ASR_SIGN_IN_CODE, SPEAK_MAX_CHARS } from '../src/constants.ts'

const CONFIG: Config = {
  apiKeyRef: 'DEEPSEEK_API_KEY',
  baseUrl: 'https://api.example',
  timeoutMs: 180_000,
  maxOutputChars: 40_000,
  ttsOutputDir: '',
}

/** What the plugin reads from the optional working-directory service. */
interface WorkspaceDouble {
  readonly defaultDirectory?: string
  ensure?(agent: unknown, signal: AbortSignal | undefined): Promise<string | undefined>
  get?(session: unknown): string | undefined
}

interface Harness {
  readonly tools: ReadonlyMap<string, ToolDefinition>
  readonly speechProviders: SpeechProviderStub[]
  readonly synthesisProviders: SynthesisProviderStub[]
  readonly warnings: string[]
  /** Emit the account sign-out event the plugin subscribed to. */
  signOut(): void
  /** Dispose every effect the plugin installed. */
  disposeAll(): void
}

/** What the plugin registers into the recognition seam. */
interface SpeechProviderStub {
  readonly info: { readonly id: string; readonly name: string }
  transcribe(
    input: { readonly audio: Uint8Array; readonly language: string },
    signal: AbortSignal,
  ): Promise<{ readonly text: string; readonly audioSeconds?: number }>
}

/** What the plugin registers into the synthesis seam. */
interface SynthesisProviderStub {
  readonly info: {
    readonly id: string
    readonly name: string
    readonly formats: readonly string[]
    readonly maxTextChars: number
  }
  synthesize(input: { readonly text: string; readonly voiceId: string }, signal: AbortSignal): Promise<Uint8Array>
}

/**
 * Boot the plugin over a hand-built Host context.
 * @param options - services the plugin may read and the composition config.
 * @returns the captured registrations and installed effects.
 */
function boot(options: {
  /** String shorthand: a service whose `ensure` resolves the directory and whose default is it. */
  readonly workspace?: string | WorkspaceDouble
  readonly account?: unknown
  /** `null` states that the credential is absent; an Error states that reading it fails. */
  readonly credential?: string | null | Error
  readonly config?: Partial<Config>
} = {}): Harness {
  const tools = new Map<string, ToolDefinition>()
  const speechProviders: SpeechProviderStub[] = []
  const synthesisProviders: SynthesisProviderStub[] = []
  const warnings: string[] = []
  const disposers: (() => void)[] = []
  const signOutListeners: (() => void)[] = []
  const trackEffect = (fn: () => unknown): (() => void) => {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose as () => void)
    return () => {}
  }
  const workspace = options.workspace
  const workspaceService: WorkspaceDouble | undefined = workspace === undefined
    ? undefined
    : typeof workspace === 'string'
      ? { defaultDirectory: workspace, ensure: () => Promise.resolve(workspace) }
      : workspace
  const credential = options.credential
  const ctx = {
    effect: trackEffect,
    inject: (names: string[], factory: (scope: unknown) => unknown) => {
      if (names.includes('speechToText')) {
        factory({
          speechToText: {
            register: (provider: unknown) => {
              speechProviders.push(provider as SpeechProviderStub)
              return () => Promise.resolve()
            },
          },
          effect: trackEffect,
        })
      } else {
        factory({
          textToSpeech: {
            register: (provider: unknown) => {
              synthesisProviders.push(provider as SynthesisProviderStub)
              return () => Promise.resolve()
            },
          },
          effect: trackEffect,
        })
      }
      return () => {}
    },
    get: (name: string) => {
      if (name === 'workingDirectory') return workspaceService
      if (name === 'deepseekAccount') return options.account
      return undefined
    },
    on: (_event: string, listener: () => void) => {
      signOutListeners.push(listener)
      return () => {
        const index = signOutListeners.indexOf(listener)
        if (index >= 0) signOutListeners.splice(index, 1)
      }
    },
    logger: { warn: (message: string) => { warnings.push(message) } },
    credentials: {
      resolve: async () => {
        if (credential instanceof Error) throw credential
        return { value: credential === null ? undefined : credential ?? 'test-key' }
      },
    },
    tools: {
      register: (definition: ToolDefinition) => {
        tools.set(definition.name, definition)
        return () => { tools.delete(definition.name) }
      },
    },
  }
  apply(ctx as never, { ...CONFIG, ...options.config })
  return {
    tools,
    speechProviders,
    synthesisProviders,
    warnings,
    signOut: () => { for (const listener of [...signOutListeners]) listener() },
    disposeAll: () => { for (const dispose of disposers.splice(0)) dispose() },
  }
}

interface CapturedCall {
  readonly url: string
  readonly init: RequestInit | undefined
}

/**
 * Replace the global fetch with one recording responder.
 * @param responder - response factory per request.
 * @returns the recorded requests.
 */
function stubFetch(
  responder: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
): CapturedCall[] {
  const calls: CapturedCall[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push({ url, init })
    return responder(url, init)
  })
  return calls
}

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

/** Answer every request with one short WAV clip. */
function stubAudio(): void {
  stubFetch(() => new Response(new Uint8Array([7, 8]), { headers: { 'content-type': 'audio/wav' } }))
}

/**
 * Run `deepseek_tts` against the registered tools.
 * @param tools - tool definitions the plugin registered.
 * @param args - tool arguments.
 * @param agent - calling agent the execution carries.
 * @returns the tool result text.
 */
async function synthesize(
  tools: ReadonlyMap<string, ToolDefinition>,
  args: Record<string, string>,
  agent?: unknown,
): Promise<string> {
  const result = await tools.get('deepseek_tts')!.execute(args, { signal: undefined, agent } as never)
  return result as string
}

/** A rejection the fetch double raises when the request signal aborts. */
function pendingUntilAborted(init: RequestInit | undefined): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { reject(new Error('request aborted')) }, { once: true })
  })
}

/** A path inside a fresh temporary directory. */
async function temporaryFile(name: string): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'dsh-suite-out-')), name)
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('registration', () => {
  it('registers four tools and validates the composition config', () => {
    const { tools } = boot()
    expect([...tools.keys()].sort()).toEqual(['deepseek_asr', 'deepseek_ocr', 'deepseek_speak', 'deepseek_tts'])
    expect(Config(CONFIG).apiKeyRef).toBe('DEEPSEEK_API_KEY')
  })

  it('disposes its tool registrations', () => {
    const harness = boot()
    expect(harness.tools.size).toBe(4)
    harness.disposeAll()
    expect(harness.tools.size).toBe(0)
  })

  it('registers the recognition and synthesis providers', async () => {
    const { speechProviders } = boot({
      account: { resolveRequestCredential: async () => ({ headers: {} }) },
    })
    const provider = speechProviders[0]!
    expect(provider.info).toMatchObject({ id: 'deepseek-cloud', name: 'DeepSeek Cloud' })
    stubFetch(() => json({ text: '你好', duration_ms: 3_200 }))
    await expect(provider.transcribe({ audio: new Uint8Array(44 + 3_200), language: 'auto' }, new AbortController().signal))
      .resolves.toMatchObject({ text: '你好', audioSeconds: 3.2 })
  })

  it('estimates the audio duration when recognition reports none', async () => {
    stubFetch(() => json({ text: '你好' }))
    const { speechProviders } = boot({
      account: { resolveRequestCredential: async () => ({ headers: {} }) },
    })
    const result = await speechProviders[0]!.transcribe(
      { audio: new Uint8Array(44 + 32_000), language: 'auto' },
      new AbortController().signal,
    )
    expect(result.text).toBe('你好')
    expect(result.audioSeconds).toBe(1)
  })

  it('synthesizes through the text-to-speech provider', async () => {
    const calls = stubFetch(() => new Response(new Uint8Array([9]), { headers: { 'content-type': 'audio/wav' } }))
    const { synthesisProviders } = boot()
    const provider = synthesisProviders[0]!
    expect(provider.info).toMatchObject({
      id: 'deepseek-tts', name: 'DeepSeek Cloud', formats: ['wav'], maxTextChars: SPEAK_MAX_CHARS,
    })
    const bytes = await provider.synthesize({ text: '你好', voiceId: 'tide' }, new AbortController().signal)
    expect([...bytes]).toEqual([9])
    const requestBody = calls[0]!.init?.body
    const body = JSON.parse(typeof requestBody === 'string' ? requestBody : '{}') as Record<string, unknown>
    expect(body).toMatchObject({ text: '你好', voice_id: 'tide', format: 'wav' })
    await expect(provider.synthesize({ text: '你好', voiceId: 'stella' }, AbortSignal.abort()))
      .rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('workspace resolution', () => {
  it('falls back to the host working directory when the service is absent', async () => {
    stubAudio()
    const target = await temporaryFile('voice.wav')
    const { tools } = boot()
    expect(await synthesize(tools, { text: '你好', outputPath: target })).toContain(target)
  })

  it('prefers the directory the service ensures for the agent', async () => {
    stubAudio()
    const directory = await mkdtemp(join(tmpdir(), 'dsh-suite-ws-'))
    const { tools } = boot({ workspace: { ensure: () => Promise.resolve(directory) } })
    expect(await synthesize(tools, { text: '你好' }, {})).toContain(directory)
  })

  it('warns and falls back to the host working directory when both lookups fail', async () => {
    stubAudio()
    const target = await temporaryFile('voice.wav')
    const harness = boot({
      workspace: {
        ensure: () => Promise.reject(new Error('no session')),
        get: () => { throw new Error('no session record') },
      },
    })
    expect(await synthesize(harness.tools, { text: '你好', outputPath: target }, { session: {} })).toContain(target)
    expect(harness.warnings).toHaveLength(2)
    expect(harness.warnings[0]).toContain('读取会话工作区失败')
    expect(harness.warnings[1]).toContain('读取会话目录失败')
  })

  it('uses the session directory when the ensure step has none', async () => {
    stubAudio()
    const directory = await mkdtemp(join(tmpdir(), 'dsh-suite-ws-'))
    const harness = boot({ workspace: { ensure: () => Promise.resolve(''), get: () => directory } })
    expect(await synthesize(harness.tools, { text: '你好' }, { session: {} })).toContain(directory)
    expect(harness.warnings).toHaveLength(0)
  })

  it('uses the host default when a lookup returns no directory', async () => {
    stubAudio()
    const directory = await mkdtemp(join(tmpdir(), 'dsh-suite-ws-'))
    const harness = boot({ workspace: { defaultDirectory: directory, get: () => undefined } })
    expect(await synthesize(harness.tools, { text: '你好' }, { session: {} })).toContain(directory)
    expect(harness.warnings).toHaveLength(0)
  })

  it('uses the host default when the calling agent has no session', async () => {
    stubAudio()
    const directory = await mkdtemp(join(tmpdir(), 'dsh-suite-ws-'))
    const harness = boot({ workspace: { defaultDirectory: directory, get: () => directory } })
    expect(await synthesize(harness.tools, { text: '你好' }, {})).toContain(directory)
    expect(harness.warnings).toHaveLength(0)
  })

  it('ignores lookups that return no directory and falls back to the host working directory', async () => {
    stubAudio()
    const target = await temporaryFile('voice.wav')
    const harness = boot({
      workspace: { ensure: () => Promise.resolve(undefined), get: () => '', defaultDirectory: '' },
    })
    expect(await synthesize(harness.tools, { text: '你好', outputPath: target }, { session: {} })).toContain(target)
    expect(harness.warnings).toHaveLength(0)
  })
})

describe('deepseek_ocr', () => {
  it('resolves the workspace path and formats each page', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    await writeFile(join(workspace, 'doc.pdf'), new Uint8Array([1]))
    const calls = stubFetch(() => json({
      purpose: 'rich_layout_recognition',
      pages: [{ index: 0, text: '第一页', finish_reason: 'length' }],
    }))
    const { tools } = boot({ workspace })
    const ocr = tools.get('deepseek_ocr')!
    const result = await ocr.execute({ filePath: 'doc.pdf', richLayout: true }, { signal: undefined } as never)
    expect(result).toContain('文件：doc.pdf（purpose: rich_layout_recognition，共 1 页）')
    expect(result).toContain('（该页输出达到上限，文本不完整）')
    expect(calls[0]!.url).toBe('https://api.example/v1/tools/ocr')
    expect(ocr.output.render({}, result as never)).toEqual([{ type: 'text', text: result }])
  })

  it('uses plain text recognition by default', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    await writeFile(join(workspace, 'doc.pdf'), new Uint8Array([1]))
    stubFetch(() => json({ pages: [] }))
    const { tools } = boot({ workspace })
    const result = await tools.get('deepseek_ocr')!.execute(
      { filePath: 'doc.pdf' },
      { signal: undefined } as never,
    )
    expect(result).toContain('purpose: text_recognition')
  })

  it('reports an unreadable file and a missing API key', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    const { tools } = boot({ workspace })
    await expect(tools.get('deepseek_ocr')!.execute({ filePath: 'missing.pdf' }, { signal: undefined } as never))
      .rejects.toThrow('deepseek-suite: 文件不存在')
    const keyless = boot({ workspace, credential: null, config: { apiKeyRef: 'SUITE_ABSENT_KEY_XYZ' } })
    await writeFile(join(workspace, 'doc.pdf'), new Uint8Array([1]))
    await expect(keyless.tools.get('deepseek_ocr')!.execute({ filePath: 'doc.pdf' }, { signal: undefined } as never))
      .rejects.toThrow('没有找到 DeepSeek API Key')
  })

  it('falls back to the environment variable when the credential store fails', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    await writeFile(join(workspace, 'doc.pdf'), new Uint8Array([1]))
    stubFetch(() => json({ pages: [] }))
    vi.stubEnv('SUITE_ENV_FALLBACK_KEY', 'environment-key')
    const { tools, warnings } = boot({
      workspace,
      credential: new Error('credential store down'),
      config: { apiKeyRef: 'SUITE_ENV_FALLBACK_KEY' },
    })
    const result = await tools.get('deepseek_ocr')!.execute({ filePath: 'doc.pdf' }, { signal: undefined } as never)
    expect(result).toContain('共 0 页')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('读取凭证失败')
  })
})

describe('deepseek_asr', () => {
  it('recognizes audio through the account authorization', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    await writeFile(join(workspace, 'speech.wav'), new Uint8Array([1]))
    stubFetch(() => json({ text: '今天上海天气怎么样？', duration_ms: 3_200 }))
    const { tools } = boot({
      workspace,
      account: { resolveRequestCredential: async () => ({ headers: { 'x-dsh-auth-token': 'token' } }) },
    })
    const asr = tools.get('deepseek_asr')!
    const result = await asr.execute({ filePath: 'speech.wav' }, { signal: undefined } as never)
    expect(result).toContain('识别结果（音频时长 3.20 秒）')
    expect(result).toContain('今天上海天气怎么样？')
    expect(asr.output.render({}, result as never)).toEqual([{ type: 'text', text: result }])
  })

  it('reports a signed-out account, a missing account API, and a revocation', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    await writeFile(join(workspace, 'speech.wav'), new Uint8Array([1]))
    const signedOut = boot({ workspace, account: { resolveRequestCredential: async () => undefined } })
    await expect(signedOut.tools.get('deepseek_asr')!.execute({ filePath: 'speech.wav' }, { signal: undefined } as never))
      .rejects.toMatchObject({ code: ASR_SIGN_IN_CODE })

    const missing = boot({ workspace })
    await expect(missing.tools.get('deepseek_asr')!.execute({ filePath: 'speech.wav' }, { signal: undefined } as never))
      .rejects.toMatchObject({ code: ASR_ACCOUNT_API_CODE })

    const revoked = new AbortController()
    revoked.abort()
    stubFetch(() => json({ error: { message: 'expired' } }))
    const rejected = boot({
      workspace,
      account: {
        resolveRequestCredential: async () => ({ headers: {}, revoked: revoked.signal }),
      },
    })
    await expect(rejected.tools.get('deepseek_asr')!.execute({ filePath: 'speech.wav' }, { signal: undefined } as never))
      .rejects.toMatchObject({ code: ASR_SIGN_IN_CODE })
  })

  it('reads a legacy token, sends it, and rejects it on a 401', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    await writeFile(join(workspace, 'speech.wav'), new Uint8Array([1]))
    const rejectToken = vi.fn()
    const calls = stubFetch(() => json({ error: { message: 'expired' } }, 401))
    const { tools } = boot({
      workspace,
      account: { resolveToken: async () => 'legacy-token', rejectToken },
    })
    await expect(tools.get('deepseek_asr')!.execute({ filePath: 'speech.wav' }, { signal: undefined } as never))
      .rejects.toMatchObject({ code: ASR_SIGN_IN_CODE })
    const headers = calls[0]!.init?.headers as Record<string, string>
    expect(headers['x-dsh-auth-token']).toBe('legacy-token')
    expect(rejectToken).toHaveBeenCalledWith('legacy-token')
  })

  it('treats an absent legacy token as signed out', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    await writeFile(join(workspace, 'speech.wav'), new Uint8Array([1]))
    const calls = stubFetch(() => json({ text: 'unused' }))
    const { tools } = boot({ workspace, account: { resolveToken: async () => undefined, rejectToken: vi.fn() } })
    await expect(tools.get('deepseek_asr')!.execute({ filePath: 'speech.wav' }, { signal: undefined } as never))
      .rejects.toMatchObject({ code: ASR_SIGN_IN_CODE })
    expect(calls).toHaveLength(0)
  })

  it('rethrows a legacy token lookup failure', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    await writeFile(join(workspace, 'speech.wav'), new Uint8Array([1]))
    const { tools } = boot({
      workspace,
      account: { resolveToken: async () => { throw new Error('account store down') }, rejectToken: vi.fn() },
    })
    await expect(tools.get('deepseek_asr')!.execute({ filePath: 'speech.wav' }, { signal: undefined } as never))
      .rejects.toThrow('account store down')
  })

  it('honors a sign-out while resolving the legacy token', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    await writeFile(join(workspace, 'speech.wav'), new Uint8Array([1]))
    const calls = stubFetch(() => json({ text: 'unused' }))
    let signOut = (): void => {}
    const rejectToken = vi.fn()
    const harness = boot({
      workspace,
      account: {
        resolveToken: async () => { signOut(); return 'legacy-token' },
        rejectToken,
      },
    })
    signOut = () => { harness.signOut() }
    await expect(harness.tools.get('deepseek_asr')!.execute({ filePath: 'speech.wav' }, { signal: undefined } as never))
      .rejects.toMatchObject({ code: ASR_SIGN_IN_CODE })
    expect(calls).toHaveLength(0)
    expect(rejectToken).not.toHaveBeenCalled()
  })

  it('requires both legacy token methods', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    await writeFile(join(workspace, 'speech.wav'), new Uint8Array([1]))
    const { tools } = boot({ workspace, account: { resolveToken: async () => 'legacy-token' } })
    await expect(tools.get('deepseek_asr')!.execute({ filePath: 'speech.wav' }, { signal: undefined } as never))
      .rejects.toMatchObject({ code: ASR_ACCOUNT_API_CODE })
  })

  it('stops when the caller aborts before or during authorization', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    await writeFile(join(workspace, 'speech.wav'), new Uint8Array([1]))
    const early = boot({
      workspace,
      account: { resolveRequestCredential: async () => ({ headers: {} }) },
    })
    await expect(early.tools.get('deepseek_asr')!.execute(
      { filePath: 'speech.wav' },
      { signal: AbortSignal.abort() } as never,
    )).rejects.toMatchObject({ name: 'AbortError' })

    const controller = new AbortController()
    const calls = stubFetch(() => json({ text: 'unused' }))
    const during = boot({
      workspace,
      account: {
        resolveRequestCredential: async () => {
          controller.abort()
          return { headers: {} }
        },
      },
    })
    await expect(during.tools.get('deepseek_asr')!.execute(
      { filePath: 'speech.wav' },
      { signal: controller.signal } as never,
    )).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toHaveLength(0)
  })

  it('releases a legacy token when the caller aborts after authorization', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    await writeFile(join(workspace, 'speech.wav'), new Uint8Array([1]))
    const controller = new AbortController()
    const calls = stubFetch(() => json({ text: 'unused' }))
    const { tools } = boot({
      workspace,
      account: {
        resolveToken: async () => {
          controller.abort()
          return 'legacy-token'
        },
        rejectToken: vi.fn(),
      },
    })
    await expect(tools.get('deepseek_asr')!.execute(
      { filePath: 'speech.wav' },
      { signal: controller.signal } as never,
    )).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toHaveLength(0)
  })

  it('propagates an audio load failure after authorization', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    const { tools } = boot({
      workspace,
      account: { resolveRequestCredential: async () => ({ headers: {} }) },
    })
    await expect(tools.get('deepseek_asr')!.execute({ filePath: 'missing.wav' }, { signal: undefined } as never))
      .rejects.toThrow('文件不存在')
  })

  it('signs out when the account is revoked during the request', async () => {    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    await writeFile(join(workspace, 'speech.wav'), new Uint8Array([1]))
    const revoked = new AbortController()
    let markStarted = (): void => {}
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    stubFetch((_url, init) => {
      markStarted()
      return pendingUntilAborted(init)
    })
    const { tools } = boot({
      workspace,
      account: { resolveRequestCredential: async () => ({ headers: {}, revoked: revoked.signal }) },
    })
    const pending = tools.get('deepseek_asr')!.execute(
      { filePath: 'speech.wav' },
      { signal: undefined } as never,
    ).catch((error: unknown) => error)
    await started
    revoked.abort()
    expect(await pending).toMatchObject({ code: ASR_SIGN_IN_CODE })
  })

  it('forwards the caller cancellation during the request', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    await writeFile(join(workspace, 'speech.wav'), new Uint8Array([1]))
    const caller = new AbortController()
    let markStarted = (): void => {}
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    stubFetch((_url, init) => {
      markStarted()
      return pendingUntilAborted(init)
    })
    const { tools } = boot({
      workspace,
      account: { resolveRequestCredential: async () => ({ headers: {} }) },
    })
    const pending = tools.get('deepseek_asr')!.execute(
      { filePath: 'speech.wav' },
      { signal: caller.signal } as never,
    ).catch((error: unknown) => error)
    await started
    caller.abort()
    expect(await pending).toMatchObject({ name: 'AbortError' })
  })
})

describe('deepseek_tts', () => {
  it('writes the synthesized audio into the workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    stubFetch(() => new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'content-type': 'audio/wav' } }))
    const { tools } = boot({ workspace })
    const tts = tools.get('deepseek_tts')!
    const result = await tts.execute({ text: '测试' }, { signal: undefined } as never) as string
    expect(result).toContain(workspace)
    expect(result).toMatch(/deepseek-tts-\d{8}-\d{6}\.wav/)
    const target = result.split('\n')[0]!.replace('已生成语音：', '')
    expect([...(await readFile(target))]).toEqual([82, 73, 70, 70])
    expect(tts.output.render({}, 'saved')).toEqual([{ type: 'text', text: 'saved' }])
  })

  it('writes a pcm voice into an explicit path', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    stubFetch(() => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/wav' } }))
    const { tools } = boot({ workspace })
    const result = await tools.get('deepseek_tts')!.execute(
      { text: '测试', voice: 'tide', format: 'pcm', outputPath: 'voice.pcm' },
      { signal: undefined } as never,
    ) as string
    expect(result).toContain('格式 pcm，音色 tide')
    const target = join(workspace, 'voice.pcm')
    expect(result).toContain(target)
    expect([...(await readFile(target))]).toEqual([1, 2, 3])
  })

  it('rejects empty text', async () => {
    const { tools } = boot()
    await expect(tools.get('deepseek_tts')!.execute({ text: '   ' }, { signal: undefined } as never))
      .rejects.toThrow('deepseek_tts 需要 text 参数')
  })

  it('writes into the configured output directory', async () => {
    stubAudio()
    const outputDirectory = await mkdtemp(join(tmpdir(), 'dsh-suite-out-'))
    const { tools } = boot({ config: { ttsOutputDir: outputDirectory } })
    expect(await synthesize(tools, { text: '你好' })).toContain(outputDirectory)
  })
})

describe('deepseek_speak', () => {
  it('returns the playback payload and its presentation metadata', async () => {
    const { tools } = boot()
    const speak = tools.get('deepseek_speak')!
    const value = await speak.execute({ text: ' 抱歉，我迟到了。 ' }, { signal: undefined } as never) as {
      text: string
      characters: number
    }
    expect(value).toEqual({ text: '抱歉，我迟到了。', characters: 8 })
    expect(speak.output.presentationMeta?.({}, value as never)).toEqual({ speak: { text: '抱歉，我迟到了。' } })
    expect(speak.output.render({}, value as never)).toEqual([{ type: 'text', text: '已请求播放 8 个字符的语音。' }])
    await expect(speak.execute({ text: '   ' }, { signal: undefined } as never)).rejects.toThrow('需要 text 参数')
    await expect(speak.execute({ text: 'x'.repeat(SPEAK_MAX_CHARS + 1) }, { signal: undefined } as never))
      .rejects.toThrow(`不能超过 ${SPEAK_MAX_CHARS}`)
  })
})
