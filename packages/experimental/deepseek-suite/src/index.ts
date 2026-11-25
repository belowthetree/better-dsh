/**
 * DeepSeek OCR, speech recognition, speech synthesis, and in-memory playback
 * tools, plus the `deepseek-cloud` recognition and `deepseek-tts` synthesis
 * providers the orb profile expects.
 * @module @deepseek-ai/dsh-deepseek-suite
 */
import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-error'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
// Type-only: the credentials, account, `speechToText`, and `textToSpeech` service declarations.
import type {} from '@deepseek-ai/dsh-deepseek-account'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type { TextToSpeechProviderId } from '@deepseek-ai/dsh-text-to-speech'
import type {} from '@deepseek-ai/dsh-text-to-speech'
import {
  DEFAULT_BASE_URL, DeepSeekApiError, type AccountAuthorization, type TransportOptions,
  loadUploadFile, recognizeDocument, synthesizeSpeech, transcribeAudio,
} from './api.ts'
import { formatAsrResult, formatOcrResult } from './format.ts'
import { defaultAudioPath, resolveToolPath } from './paths.ts'
import { ASR_ACCOUNT_API_CODE, ASR_SIGN_IN_CODE, SPEAK_MAX_CHARS, SPEECH_PROVIDER_ID, TTS_PROVIDER_ID } from './constants.ts'

/** Plugin name registered with Cordis. */
export const name = '@deepseek-ai/dsh-deepseek-suite'

/** Services the tools and providers register into. */
export const inject = ['tools', 'credentials']

const WAVE_HEADER_BYTES = 44
const PCM16_MONO_16KHZ_BYTES_PER_SECOND = 32_000
const ASR_LOGIN_MESSAGE = '语音识别需要先登录 DeepSeek 账号：请打开“设置 → 账号”完成登录后，再使用 deepseek_asr。'

/** Plugin configuration; every deployment-varying choice is a validated field. */
export interface Config {
  /** Credential or environment-variable name holding the DeepSeek API key. */
  readonly apiKeyRef: string
  /** DeepSeek API origin. */
  readonly baseUrl: string
  /** Per-request deadline in milliseconds. */
  readonly timeoutMs: number
  /** Character budget of one OCR or recognition result. */
  readonly maxOutputChars: number
  /** Default directory for saved synthesis files; empty means the Session workspace. */
  readonly ttsOutputDir: string
}

/** Schemastery schema of {@link Config}. */
export const Config: z<Config> = z.object({
  apiKeyRef: z.string().role('credential-ref').default('DEEPSEEK_API_KEY'),
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  timeoutMs: z.natural().min(1_000).max(600_000).default(180_000),
  maxOutputChars: z.natural().min(2_000).max(200_000).default(40_000),
  ttsOutputDir: z.string().default(''),
})

/** What the optional Host account API exposes for authorized requests. */
interface DeepSeekAccountService {
  resolveRequestCredential?(endpoint: string): Promise<{
    readonly headers: Readonly<Record<string, string>>
    readonly revoked?: AbortSignal
    readonly reject?: () => void | Promise<void>
  } | undefined>
  resolveToken?(endpoint: string): Promise<string | undefined>
  rejectToken?(token: string): Promise<void> | void
}

/** What the optional working-directory service exposes to tools. */
interface WorkingDirectoryService {
  readonly defaultDirectory?: string
  ensure?(agent: unknown, signal: AbortSignal | undefined): Promise<string | undefined>
  get?(session: unknown): string | undefined
}

/** Agent facts one tool execution reads. */
interface ToolAgent {
  readonly session?: { readonly header?: { readonly cwd?: string } }
}

/**
 * Register the DeepSeek tools and their two speech providers.
 * @param ctx - Host context carrying the tool registry and credentials.
 * @param rawConfig - plugin configuration supplied by the composition.
 */
export function apply(ctx: Context, rawConfig: Config): void {
  const config: Config = rawConfig
  const workingDirectory = ctx.get('workingDirectory') as WorkingDirectoryService | undefined

  /**
   * Read the owning Session workspace, falling back to the Host default.
   * @param agent - calling agent, when the execution carries one.
   * @param signal - tool cancellation.
   * @returns the workspace directory.
   */
  const workspaceDirectory = async (agent: unknown, signal: AbortSignal | undefined): Promise<string> => {
    if (workingDirectory !== undefined) {
      if (typeof workingDirectory.ensure === 'function' && agent !== undefined) {
        try {
          const directory = await workingDirectory.ensure(agent, signal)
          if (typeof directory === 'string' && directory !== '') return directory
        } catch (error) {
          ctx.logger.warn(`deepseek-suite: 读取会话工作区失败 ${String(error)}`)
        }
      }
      if (typeof workingDirectory.get === 'function') {
        const session = (agent as ToolAgent | undefined)?.session
        if (session !== undefined) {
          try {
            const directory = workingDirectory.get(session)
            if (typeof directory === 'string' && directory !== '') return directory
          } catch (error) {
            ctx.logger.warn(`deepseek-suite: 读取会话目录失败 ${String(error)}`)
          }
        }
      }
      if (typeof workingDirectory.defaultDirectory === 'string' && workingDirectory.defaultDirectory !== '') {
        return workingDirectory.defaultDirectory
      }
    }
    return process.cwd()
  }

  /**
   * Resolve the API key for one call; nothing is cached between calls.
   * @returns the API key.
   */
  const resolveApiKey = async (): Promise<string> => {
    let value: string | undefined
    try {
      const credential = await ctx.credentials.resolve(config.apiKeyRef as CredentialRef)
      if (typeof credential?.value === 'string' && credential.value !== '') value = credential.value
    } catch (error) {
      ctx.logger.warn(`deepseek-suite: 读取凭证失败 ${String(error)}`)
    }
    if (value === undefined) value = process.env[config.apiKeyRef]
    if (value === undefined || value === '') {
      throw new Error(
        `没有找到 DeepSeek API Key：请先在“设置 → 模型”里保存名为 ${config.apiKeyRef} 的凭证，或在环境变量 ${config.apiKeyRef} 中提供；也可以在插件配置里改 apiKeyRef。`,
      )
    }
    return value
  }

  /**
   * Build the API-key transport for one call.
   * @param signal - tool cancellation.
   * @returns the transport options.
   */
  const transport = async (signal: AbortSignal | undefined): Promise<TransportOptions & { readonly signal: AbortSignal | undefined }> => ({
    fetchImpl: globalThis.fetch,
    baseUrl: config.baseUrl,
    apiKey: await resolveApiKey(),
    signal,
  })

  /**
   * Resolve the installed account API for one recognition request.
   * @param signal - tool cancellation.
   * @returns the account authorization facts.
   * @throws HarnessError when the account API is missing or the account is signed out.
   */
  const accountTransport = async (
    signal: AbortSignal | undefined,
  ): Promise<TransportOptions & { readonly signal: AbortSignal | undefined }> => {
    signal?.throwIfAborted()
    const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/v1/tools/asr`
    const account = ctx.get('deepseekAccount') as DeepSeekAccountService | undefined
    let authorization: AccountAuthorization | undefined
    if (account !== undefined && typeof account.resolveRequestCredential === 'function') {
      const credential = await account.resolveRequestCredential(endpoint)
      if (credential !== undefined) {
        authorization = {
          kind: 'account', endpoint, headers: credential.headers,
          revoked: credential.revoked, reject: credential.reject,
        }
      }
    } else if (account !== undefined && typeof account.resolveToken === 'function'
      && typeof account.rejectToken === 'function') {
      const revoked = new AbortController()
      const release = ctx.on('deepseek-account/signed-out', () => { revoked.abort() }, { global: true })
      let token: string | undefined
      try {
        token = await account.resolveToken(endpoint)
      } catch (error) {
        release()
        throw error
      }
      if (token === undefined || revoked.signal.aborted) {
        release()
      } else {
        authorization = {
          kind: 'account', endpoint, headers: { 'x-dsh-auth-token': token },
          revoked: revoked.signal, release, reject: () => account.rejectToken?.(token),
        }
      }
    } else {
      throw new HarnessError(
        '当前 DSH 未提供 DeepSeek 账号请求接口，请启用 deepseek-account 或升级 DSH 后，再使用 deepseek_asr。',
        ASR_ACCOUNT_API_CODE,
      )
    }
    if (authorization === undefined) {
      throw new HarnessError(ASR_LOGIN_MESSAGE, ASR_SIGN_IN_CODE)
    }
    try {
      signal?.throwIfAborted()
    } catch (error) {
      authorization.release?.()
      throw error
    }
    return { fetchImpl: globalThis.fetch, authorization, signal }
  }

  /**
   * Authorize first, then load and transcribe one account-audio source.
   * @param signal - tool cancellation.
   * @param loadFile - loads the audio upload once authorization succeeded.
   * @returns the recognized text and duration.
   */
  const transcribeAccountAudio = async (
    signal: AbortSignal | undefined,
    loadFile: () => Promise<Parameters<typeof transcribeAudio>[0]['file']>,
  ) => {
    const authorized = await accountTransport(signal)
    try {
      const file = await loadFile()
      return await transcribeAudio({ ...authorized, file, timeoutMs: Math.max(config.timeoutMs, 300_000) })
    } catch (error) {
      if (signal?.aborted === true) throw signal.reason
      const revoked = authorized.authorization?.revoked?.aborted === true
      const failure = error instanceof DeepSeekApiError ? error : undefined
      if (revoked || failure?.status === 401) {
        throw new HarnessError(ASR_LOGIN_MESSAGE, ASR_SIGN_IN_CODE, { cause: error })
      }
      throw error
    } finally {
      authorized.authorization?.release?.()
    }
  }

  /**
   * Resolve one tool path against the Session workspace.
   * @param input - raw path argument.
   * @param signal - tool cancellation.
   * @param agent - calling agent, when the execution carries one.
   * @returns the absolute path.
   */
  const resolveInputPath = async (
    input: string,
    signal: AbortSignal | undefined,
    agent: unknown,
  ): Promise<string> => resolveToolPath(input, await workspaceDirectory(agent, signal))

  const ocr = defineTool({
    name: 'deepseek_ocr',
    description:
      '调用 DeepSeek OCR 接口识别本地 PDF、Word、PowerPoint 或图片中的文字，按页返回。文件不会存入 Files API；只看文字用默认的 text_recognition，需要保留版面里的图表时用 richLayout。相对路径按当前会话工作区解析。',
    parameters: {
      filePath: { type: 'string', required: true, description: '本地文件路径；相对路径按当前会话工作区解析。' },
      richLayout: {
        type: 'boolean',
        description: 'true 用 rich_layout_recognition（逐页识别并保留版面图），默认 false 用 text_recognition。',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const signal = exec.signal
      const absolute = await resolveInputPath(args.filePath, signal, exec.agent)
      const file = await loadUploadFile(absolute).catch((error: unknown) => {
        throw new Error(`deepseek-suite: ${(error as Error).message}`)
      })
      const data = await recognizeDocument({
        ...(await transport(signal)),
        file,
        purpose: args.richLayout === true ? 'rich_layout_recognition' : 'text_recognition',
        timeoutMs: Math.max(config.timeoutMs, 300_000),
      })
      return formatOcrResult(data, { filename: file.filename, maxOutputChars: config.maxOutputChars })
    },
  })

  const asr = defineTool({
    name: 'deepseek_asr',
    description:
      '调用 DeepSeek 账号自带的语音识别接口，把本地音频文件整段转成文本。需要先在“设置 → 账号”登录 DeepSeek；相对路径按当前会话工作区解析。',
    parameters: {
      filePath: {
        type: 'string', required: true,
        description: '本地音频文件路径（wav、mp3、m4a 等）；相对路径按当前会话工作区解析。',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const signal = exec.signal
      const data = await transcribeAccountAudio(signal, async () => {
        const absolute = await resolveInputPath(args.filePath, signal, exec.agent)
        return loadUploadFile(absolute)
      })
      return formatAsrResult({ text: data.text, duration_ms: data.duration_ms }, {
        maxOutputChars: config.maxOutputChars,
      })
    },
  })

  const tts = defineTool({
    name: 'deepseek_tts',
    description:
      '调用 DeepSeek 语音合成接口，把文本合成为语音文件并保存到本地会话工作区，返回文件路径。适合朗读回答或生成音频素材。',
    parameters: {
      text: { type: 'string', required: true, description: '要朗读的文本，不能为空。' },
      voice: { type: 'string', enum: ['stella', 'tide'], description: '音色：stella 女声（默认），tide 男声。' },
      format: { type: 'string', enum: ['wav', 'pcm'], description: '音频格式，默认 wav。' },
      outputPath: {
        type: 'string',
        description: '保存路径（相对当前会话工作区或绝对路径）。默认在工作区生成 deepseek-tts-<时间戳>.wav。',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const text = args.text.trim()
      if (text === '') throw new Error('deepseek_tts 需要 text 参数')
      const audioFormat = args.format === 'pcm' ? 'pcm' : 'wav'
      const voice = args.voice === 'tide' ? 'tide' : 'stella'
      const audio = await synthesizeSpeech({
        ...(await transport(exec.signal)),
        text,
        voiceId: voice,
        format: audioFormat,
        timeoutMs: Math.max(config.timeoutMs, 180_000),
      })
      const base = await workspaceDirectory(exec.agent, exec.signal)
      const directory = config.ttsOutputDir === '' ? base : resolveToolPath(config.ttsOutputDir, base)
      const target = args.outputPath === undefined || args.outputPath.trim() === ''
        ? defaultAudioPath(directory, audioFormat)
        : resolveToolPath(args.outputPath, base)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, audio.bytes)
      const size = (audio.bytes.length / 1024).toFixed(1)
      return `已生成语音：${target}\n格式 ${audioFormat}，音色 ${voice}，大小 ${size} KB。`
    },
  })

  const speak = defineTool({
    name: 'deepseek_speak',
    description:
      '把一段文字合成为语音并在客户端直接播放：音频只存在于内存，不写文件、不进入会话记录。适合让助手把回答或提醒念出来；这条工具不会返回音频文件。',
    parameters: {
      text: { type: 'string', required: true, description: '要朗读的文本，不能为空。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string', required: true }, characters: { type: 'integer', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `已请求播放 ${String(value.characters)} 个字符的语音。` }],
      presentationMeta: (_args, value) => ({ speak: { text: value.text } }),
    },
    // oxlint-disable-next-line typescript/require-await -- async keeps argument failures rejections, as the tool contract expects.
    async execute(args) {
      const text = args.text.trim()
      if (text === '') throw new Error('deepseek_speak 需要 text 参数')
      if (text.length > SPEAK_MAX_CHARS) throw new Error(`deepseek_speak 的 text 不能超过 ${SPEAK_MAX_CHARS} 个字符`)
      return { text, characters: text.length }
    },
  })

  ctx.inject(['speechToText'], (scope) => {
    scope.effect(() => scope.speechToText.register({
      info: {
        id: SPEECH_PROVIDER_ID as SpeechProviderId, name: 'DeepSeek Cloud', location: 'cloud', languages: ['auto'],
      },
      async transcribe(input, signal) {
        const startedAt = performance.now()
        const data = await transcribeAccountAudio(signal, () => Promise.resolve({
          bytes: input.audio, filename: 'voice.wav', size: input.audio.byteLength,
        }))
        return {
          text: data.text,
          audioSeconds: typeof data.duration_ms === 'number'
            ? data.duration_ms / 1000
            : Math.max(0, (input.audio.byteLength - WAVE_HEADER_BYTES) / PCM16_MONO_16KHZ_BYTES_PER_SECOND),
          inferenceSeconds: (performance.now() - startedAt) / 1000,
        }
      },
    }), 'deepseek-suite: DeepSeek cloud speech provider')
  })

  ctx.inject(['textToSpeech'], (scope) => {
    scope.effect(() => scope.textToSpeech.register({
      info: {
        id: TTS_PROVIDER_ID as TextToSpeechProviderId,
        name: 'DeepSeek Cloud',
        location: 'cloud',
        voices: [{ id: 'stella', name: 'Stella' }, { id: 'tide', name: 'Tide' }],
        formats: ['wav'],
        maxTextChars: SPEAK_MAX_CHARS,
      },
      async synthesize(input, signal) {
        signal.throwIfAborted()
        const audio = await synthesizeSpeech({
          ...(await transport(signal)),
          text: input.text,
          voiceId: input.voiceId,
          format: 'wav',
          timeoutMs: Math.max(config.timeoutMs, 180_000),
        })
        return audio.bytes
      },
    }), 'deepseek-suite: DeepSeek cloud speech synthesis provider')
  })

  ctx.effect(() => {
    const disposers = [ocr, asr, tts, speak].map(definition => ctx.tools.register(definition))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'deepseek-suite: DeepSeek OCR / recognition / synthesis / playback tools')
}
