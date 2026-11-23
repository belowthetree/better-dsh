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

interface Harness {
  readonly tools: ReadonlyMap<string, ToolDefinition>
  readonly speechProviders: SpeechProviderStub[]
  readonly synthesisProviders: unknown[]
}

/** What the plugin registers into the recognition seam. */
interface SpeechProviderStub {
  readonly info: { readonly id: string; readonly name: string }
  transcribe(
    input: { readonly audio: Uint8Array; readonly language: string },
    signal: AbortSignal,
  ): Promise<{ readonly text: string; readonly audioSeconds?: number }>
}

/**
 * Boot the plugin over a hand-built Host context.
 * @param options - services the plugin may read and the composition config.
 * @returns the captured registrations.
 */
function boot(options: {
  readonly workspace?: string
  readonly account?: unknown
  /** `null` states that the credential is absent; omission supplies the test key. */
  readonly credential?: string | null
  readonly config?: Partial<Config>
} = {}): Harness {
  const tools = new Map<string, ToolDefinition>()
  const speechProviders: SpeechProviderStub[] = []
  const synthesisProviders: unknown[] = []
  const scopedEffect = (fn: () => unknown): (() => void) => {
    fn()
    return () => {}
  }
  const ctx = {
    effect: (fn: () => unknown) => {
      fn()
      return () => {}
    },
    inject: (names: string[], factory: (scope: unknown) => unknown) => {
      if (names.includes('speechToText')) {
        factory({
          speechToText: {
            register: (provider: unknown) => {
              speechProviders.push(provider as SpeechProviderStub)
              return () => Promise.resolve()
            },
          },
          effect: scopedEffect,
        })
      } else {
        factory({
          textToSpeech: { register: (provider: unknown) => { synthesisProviders.push(provider); return () => Promise.resolve() } },
          effect: scopedEffect,
        })
      }
      return () => {}
    },
    get: (name: string) => {
      if (name === 'workingDirectory') {
        return options.workspace === undefined
          ? undefined
          : { defaultDirectory: options.workspace, ensure: async () => options.workspace }
      }
      if (name === 'deepseekAccount') return options.account
      return undefined
    },
    on: () => () => {},
    logger: { warn: vi.fn() },
    credentials: {
      resolve: async () => ({
        value: options.credential === null ? undefined : options.credential ?? 'test-key',
      }),
    },
    tools: { register: (definition: ToolDefinition) => { tools.set(definition.name, definition); return () => {} } },
  }
  apply(ctx as never, { ...CONFIG, ...options.config })
  return { tools, speechProviders, synthesisProviders }
}

/**
 * Replace the global fetch with one recording responder.
 * @param responder - response factory.
 * @returns the recorded requests.
 */
function stubFetch(responder: (url: string) => Response): string[] {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push(url)
    return responder(url)
  })
  return calls
}

const json = (value: unknown): Response =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

afterEach(() => { vi.unstubAllGlobals() })

describe('registration', () => {
  it('registers four tools and validates the composition config', () => {
    const { tools } = boot()
    expect([...tools.keys()].sort()).toEqual(['deepseek_asr', 'deepseek_ocr', 'deepseek_speak', 'deepseek_tts'])
    expect(Config(CONFIG).apiKeyRef).toBe('DEEPSEEK_API_KEY')
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
    const result = await tools.get('deepseek_ocr')!.execute({ filePath: 'doc.pdf', richLayout: true }, { signal: undefined } as never)
    expect(result).toContain('文件：doc.pdf（purpose: rich_layout_recognition，共 1 页）')
    expect(result).toContain('（该页输出达到上限，文本不完整）')
    expect(calls[0]).toBe('https://api.example/v1/tools/ocr')
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
    const result = await tools.get('deepseek_asr')!.execute({ filePath: 'speech.wav' }, { signal: undefined } as never)
    expect(result).toContain('识别结果（音频时长 3.20 秒）')
    expect(result).toContain('今天上海天气怎么样？')
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
})

describe('deepseek_tts', () => {
  it('writes the synthesized audio into the workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    stubFetch(() => new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'content-type': 'audio/wav' } }))
    const { tools } = boot({ workspace })
    const result = await tools.get('deepseek_tts')!.execute({ text: '测试' }, { signal: undefined } as never) as string
    expect(result).toContain(workspace)
    expect(result).toMatch(/deepseek-tts-\d{8}-\d{6}\.wav/)
    const target = result.split('\n')[0]!.replace('已生成语音：', '')
    expect([...(await readFile(target))]).toEqual([82, 73, 70, 70])
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
    await expect(speak.execute({ text: '   ' }, { signal: undefined } as never)).rejects.toThrow('需要 text 参数')
    await expect(speak.execute({ text: 'x'.repeat(SPEAK_MAX_CHARS + 1) }, { signal: undefined } as never))
      .rejects.toThrow(`不能超过 ${SPEAK_MAX_CHARS}`)
  })
})
