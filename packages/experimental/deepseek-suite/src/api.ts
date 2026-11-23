/**
 * DeepSeek application API client for OCR, speech recognition, and speech
 * synthesis. Every function takes its transport explicitly so tests and callers
 * never depend on module state.
 * @module @deepseek-ai/dsh-deepseek-suite
 */
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

/** Default DeepSeek API origin. */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com'

/** Documented single-file limit of the OCR endpoint. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

/** Fields one failed DeepSeek request carries beyond its message. */
export interface ApiErrorDetails {
  readonly status?: number | undefined
  readonly code?: string | undefined
  readonly type?: string | undefined
  readonly retryable?: boolean | undefined
  readonly cause?: unknown
}

/** One rejected DeepSeek request with its HTTP and provider identity. */
export class DeepSeekApiError extends Error {
  /** HTTP status the provider answered with, absent for transport failures. */
  readonly status: number | undefined
  /** Provider error code, or the stable code this client assigns to one failure. */
  readonly code: string | undefined
  /** Provider error type, when the response carried one. */
  readonly type: string | undefined
  /** Whether the caller may retry the same request safely. */
  readonly retryable: boolean

  /**
   * @param message - user-facing failure text.
   * @param details - HTTP status, provider codes, retryability, and the underlying cause.
   */
  constructor(message: string, details: ApiErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause })
    this.name = 'DeepSeekApiError'
    this.status = details.status
    this.code = details.code
    this.type = details.type
    this.retryable = details.retryable === true
  }
}

const STATUS_HINTS: Readonly<Record<number, string>> = {
  400: '请求参数不合法',
  401: 'API Key 缺失或无效',
  402: '账号余额不足',
  403: '请求被安全策略拒绝',
  404: '未获取到可用内容',
  408: '请求超时',
  413: '请求体超过大小限制',
  429: '超过 QPS 限速',
  500: '服务端内部错误',
  502: '网关错误',
  503: '服务繁忙',
  504: '下游请求超时',
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.flac': 'audio/flac',
}

/**
 * Whether a status may be retried safely.
 * @param status - HTTP status.
 * @returns whether the request failed for a transient reason.
 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

/**
 * Join one base origin with an API path.
 * @param baseUrl - configured origin, with or without a trailing slash.
 * @param path - absolute API path.
 * @returns the request URL.
 */
export function joinUrl(baseUrl: string | undefined, path: string): string {
  return (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '') + path
}

/**
 * Combine caller cancellation, account revocation, and the request timeout.
 * @param signal - caller or tool cancellation.
 * @param timeoutMs - per-request deadline in milliseconds.
 * @param revoked - account revocation signal.
 * @returns the combined signal, or undefined when no source applies.
 */
export function combineSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
  revoked: AbortSignal | undefined,
): AbortSignal | undefined {
  const signals: AbortSignal[] = []
  if (signal !== undefined) signals.push(signal)
  if (revoked !== undefined) signals.push(revoked)
  if (typeof timeoutMs === 'number' && timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs))
  const [first, second] = signals
  if (first === undefined) return undefined
  return second === undefined ? first : AbortSignal.any(signals)
}

/** Account-authorized transport facts resolved by the caller for one request. */
export interface AccountAuthorization {
  readonly kind: 'account'
  readonly endpoint: string
  readonly headers: Readonly<Record<string, string>>
  readonly revoked?: AbortSignal | undefined
  readonly release?: (() => void) | undefined
  readonly reject?: (() => void | Promise<void>) | undefined
}

/** Transport selection shared by every DeepSeek call. */
export interface TransportOptions {
  readonly fetchImpl?: typeof fetch | undefined
  readonly baseUrl?: string | undefined
  readonly apiKey?: string | undefined
  readonly authorization?: AccountAuthorization | undefined
}

/** One low-level request. */
export interface SendOptions extends TransportOptions {
  /** Absolute API path appended to the origin. */
  readonly path: string
  /** User-facing API name used in failure messages. */
  readonly apiName: string
  /** JSON body; ignored when `formData` is present. */
  readonly body?: unknown
  /** Multipart body. */
  readonly formData?: FormData | undefined
  /** Per-request deadline. */
  readonly timeoutMs?: number | undefined
  /** Caller cancellation. */
  readonly signal?: AbortSignal | undefined
}

/** One upload payload read from disk. */
export interface UploadFile {
  readonly bytes: Uint8Array
  readonly filename: string
  readonly size: number
}

/** One recognized document. */
export interface OcrResult {
  readonly purpose?: string | undefined
  readonly pages: readonly OcrPageView[]
}

/** One page of a recognized document. */
export interface OcrPageView {
  readonly index?: number | undefined
  readonly text?: string | undefined
  readonly finish_reason?: string | undefined
}

/** One speech-recognition result. */
export interface AsrResult {
  readonly text: string
  readonly duration_ms?: number | undefined
}

/** One synthesized audio clip. */
export interface SynthesizedAudio {
  readonly bytes: Uint8Array
  readonly contentType: string
}

/**
 * Narrow one parsed JSON value to a record.
 * @param value - parsed JSON value.
 * @returns whether the value is a non-array object.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the provider's error detail from one failed response.
 * @param response - non-successful response.
 * @returns the recognized message, type, and code.
 */
async function errorDetail(response: Response): Promise<{ message?: string; type?: string; code?: string }> {
  let raw = ''
  try {
    raw = await response.text()
  } catch {
    // A response body that cannot be read leaves the status-derived hint alone.
    return {}
  }
  if (raw.trim() === '') return {}
  try {
    const payload: unknown = JSON.parse(raw)
    const error: unknown = isRecord(payload) && 'error' in payload ? payload.error : payload
    const record = isRecord(error) ? error : {}
    return {
      ...typeof record.message === 'string' ? { message: record.message } : {},
      ...typeof record.type === 'string' ? { type: record.type } : {},
      ...typeof record.code === 'string' ? { code: record.code } : {},
    }
  } catch {
    return { message: raw.slice(0, 300) }
  }
}

/**
 * Send one request and normalize transport failures.
 * @param options - endpoint, body, transport, and cancellation.
 * @returns the successful response.
 * @throws DeepSeekApiError for transport, timeout, revocation, and HTTP failures.
 */
async function send(options: SendOptions): Promise<Response> {
  const {
    fetchImpl = globalThis.fetch, baseUrl, apiKey, authorization, path, body, formData, timeoutMs, signal, apiName,
  } = options
  if (typeof fetchImpl !== 'function') {
    throw new DeepSeekApiError(`${apiName} 失败：当前运行环境没有可用的 fetch 实现`)
  }
  const headers: Record<string, string> = { ...authorization?.headers }
  if (apiKey !== undefined && apiKey !== '') headers.authorization = `Bearer ${apiKey}`
  const init: RequestInit = {
    method: 'POST',
    headers,
    signal: combineSignal(signal, timeoutMs, authorization?.revoked) ?? null,
    ...authorization?.kind === 'account' ? { redirect: 'error' as const } : {},
  }
  if (formData !== undefined) {
    init.body = formData
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  let response: Response
  try {
    response = await fetchImpl(authorization?.endpoint ?? joinUrl(baseUrl, path), init)
  } catch (error) {
    if (signal?.aborted === true) throw signal.reason ?? error
    if (authorization?.revoked?.aborted === true) {
      throw new DeepSeekApiError(`${apiName} 的 DeepSeek 登录状态已失效，请重新登录`, {
        code: 'ACCOUNT_REVOKED', cause: error,
      })
    }
    const failure = isRecord(error) ? error : {}
    const aborted = failure.name === 'TimeoutError' || failure.name === 'AbortError'
    throw new DeepSeekApiError(
      aborted ? `${apiName} 请求已中止（超时或被取消）` : `${apiName} 网络请求失败：${String(failure.message ?? error)}`,
      { retryable: !aborted || failure.name === 'TimeoutError', cause: error },
    )
  }

  if (!response.ok) {
    const detail = await errorDetail(response)
    if (response.status === 401) await authorization?.reject?.()
    const accountRejected = response.status === 401 && authorization?.kind === 'account'
    const hint = accountRejected
      ? 'DeepSeek 登录状态无效或已过期'
      : STATUS_HINTS[response.status] ?? `HTTP ${String(response.status)}`
    const suffix = detail.message === undefined ? '' : `：${detail.message}`
    throw new DeepSeekApiError(`${apiName} 失败（HTTP ${String(response.status)}，${hint}）${suffix}`, {
      status: response.status,
      ...accountRejected ? { code: 'ACCOUNT_UNAUTHORIZED' } : detail.code === undefined ? {} : { code: detail.code },
      ...detail.type === undefined ? {} : { type: detail.type },
      retryable: isRetryableStatus(response.status),
    })
  }
  return response
}

/**
 * Parse one JSON response body.
 * @param response - successful response.
 * @param apiName - user-facing API name used in failure messages.
 * @returns the parsed JSON value, or an empty record for an empty body.
 */
async function readJson(response: Response, apiName: string): Promise<unknown> {
  const raw = await response.text()
  const trimmed = raw.replace(/^\uFEFF/, '').trim()
  if (trimmed === '') return {}
  try {
    return JSON.parse(trimmed)
  } catch (error) {
    throw new DeepSeekApiError(`${apiName} 返回了无法解析的响应`, { cause: error })
  }
}

/**
 * POST one JSON or multipart request.
 * @param options - endpoint, body, transport, and cancellation.
 * @returns the parsed JSON response.
 */
async function postJson(options: SendOptions): Promise<unknown> {
  return readJson(await send(options), options.apiName)
}

/**
 * Build a multipart body from scalar fields and uploads.
 * @param fields - scalar fields, appended first.
 * @param files - uploads in append order.
 * @returns the assembled form data.
 */
function buildFormData(
  fields: Readonly<Record<string, string | number>>,
  files: readonly { readonly field: string; readonly bytes: Uint8Array; readonly filename: string; readonly type?: string }[],
): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value))
  for (const file of files) {
    const type = file.type ?? CONTENT_TYPES[extname(file.filename).toLowerCase()] ?? 'application/octet-stream'
    form.append(file.field, new Blob([new Uint8Array(file.bytes)], { type }), file.filename)
  }
  return form
}

/**
 * Read one local file as an upload payload after size and kind checks.
 * @param filePath - absolute file path.
 * @param options - byte ceiling for the upload.
 * @returns the bytes, base name, and size.
 * @throws when the path is missing, not a regular file, or over the ceiling.
 */
export async function loadUploadFile(
  filePath: string,
  options: { readonly maxBytes?: number } = {},
): Promise<UploadFile> {
  const { maxBytes = MAX_UPLOAD_BYTES } = options
  let info
  try {
    info = await stat(filePath)
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined
    if (code === 'ENOENT') throw new Error(`文件不存在：${filePath}`)
    throw new Error(`无法读取文件 ${filePath}：${String(isRecord(error) ? error.message ?? error : error)}`)
  }
  if (!info.isFile()) throw new Error(`不是普通文件：${filePath}`)
  if (info.size > maxBytes) {
    throw new Error(
      `文件过大（${(info.size / 1024 / 1024).toFixed(1)} MiB），上限 ${(maxBytes / 1024 / 1024).toFixed(0)} MiB：${filePath}`,
    )
  }
  const bytes = await readFile(filePath)
  return { bytes: new Uint8Array(bytes), filename: basename(filePath), size: info.size }
}

/**
 * Recognize one document page by page.
 * @param options - upload, purpose, transport, and cancellation.
 * @returns the recognized pages.
 * @throws DeepSeekApiError for provider failures and malformed responses.
 */
export async function recognizeDocument(
  options: TransportOptions & {
    readonly file: UploadFile
    readonly purpose?: 'text_recognition' | 'rich_layout_recognition' | undefined
    readonly timeoutMs?: number | undefined
    readonly signal?: AbortSignal | undefined
  },
): Promise<OcrResult> {
  const { file, purpose = 'text_recognition', timeoutMs, signal, ...transport } = options
  const data = await postJson({
    ...transport,
    path: '/v1/tools/ocr',
    formData: buildFormData({ purpose }, [{ field: 'file', ...file }]),
    apiName: 'DeepSeek OCR',
    timeoutMs,
    signal,
  })
  if (isRecord(data) && isRecord(data.error)) {
    const message = typeof data.error.message === 'string' ? data.error.message : '未知错误'
    const code = typeof data.error.code === 'string' ? data.error.code : undefined
    throw new DeepSeekApiError(`DeepSeek OCR 失败：${message}`, code === undefined ? {} : { code })
  }
  if (!isRecord(data) || !Array.isArray(data.pages)) {
    throw new DeepSeekApiError('DeepSeek OCR 响应缺少 pages 数组')
  }
  return {
    ...typeof data.purpose === 'string' ? { purpose: data.purpose } : {},
    pages: data.pages.map((page) => {
      const record = isRecord(page) ? page : {}
      return {
        ...typeof record.index === 'number' ? { index: record.index } : {},
        ...typeof record.text === 'string' ? { text: record.text } : {},
        ...typeof record.finish_reason === 'string' ? { finish_reason: record.finish_reason } : {},
      }
    }),
  }
}

/**
 * Transcribe one audio upload.
 * @param options - upload, transport, and cancellation.
 * @returns the recognized text and audio duration.
 * @throws DeepSeekApiError for provider failures and malformed responses.
 */
export async function transcribeAudio(
  options: TransportOptions & {
    readonly file: UploadFile
    readonly timeoutMs?: number | undefined
    readonly signal?: AbortSignal | undefined
  },
): Promise<AsrResult> {
  const { file, timeoutMs, signal, ...transport } = options
  const data = await postJson({
    ...transport,
    path: '/v1/tools/asr',
    formData: buildFormData({}, [{ field: 'file', ...file }]),
    apiName: 'DeepSeek 语音识别',
    timeoutMs,
    signal,
  })
  if (!isRecord(data) || typeof data.text !== 'string') {
    throw new DeepSeekApiError('DeepSeek 语音识别响应缺少 text 字段')
  }
  return {
    text: data.text,
    ...typeof data.duration_ms === 'number' ? { duration_ms: data.duration_ms } : {},
  }
}

/**
 * Synthesize one text into audio bytes.
 * @param options - text, voice, format, transport, and cancellation.
 * @returns the encoded audio and its content type.
 * @throws DeepSeekApiError for provider failures and empty audio.
 */
export async function synthesizeSpeech(
  options: TransportOptions & {
    readonly text: string
    readonly voiceId?: string | undefined
    readonly format?: 'wav' | 'pcm' | undefined
    readonly filterMarkdown?: boolean | undefined
    readonly timeoutMs?: number | undefined
    readonly signal?: AbortSignal | undefined
  },
): Promise<SynthesizedAudio> {
  const {
    text, voiceId = 'stella', format = 'wav', filterMarkdown = true, timeoutMs, signal, ...transport
  } = options
  const response = await send({
    ...transport,
    path: '/v1/tools/tts',
    body: { text, voice_id: voiceId, format, filter_markdown: filterMarkdown },
    apiName: 'DeepSeek 语音合成',
    timeoutMs,
    signal,
  })
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length === 0) throw new DeepSeekApiError('DeepSeek 语音合成返回了空音频')
  return { bytes, contentType: response.headers.get('content-type') ?? 'audio/wav' }
}
