// @vitest-environment node
/** The DeepSeek application API client maps requests, responses, and failures. */
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_BASE_URL, DeepSeekApiError, combineSignal, joinUrl, loadUploadFile, recognizeDocument,
  synthesizeSpeech, transcribeAudio,
} from '../src/api.ts'

interface Captured {
  readonly url: string
  readonly init: RequestInit
}

/**
 * Replace fetch with one recording responder.
 * @param responder - response factory per request.
 * @returns the recording fetch and its captured calls.
 */
function stubFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Captured[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const requestInit = init ?? {}
    calls.push({ url, init: requestInit })
    return responder(url, requestInit)
  }
  return { fetchImpl, calls }
}

/**
 * Read the multipart entries of one captured body.
 * @param init - captured request init.
 * @returns the form entries in append order.
 */
function formEntries(init: RequestInit): [string, FormDataEntryValue][] {
  const body = init.body as FormData
  return [...body.entries()]
}

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

const transport = (fetchImpl: typeof fetch) => ({ baseUrl: 'https://api.example', apiKey: 'test-key', fetchImpl })

describe('URL and signal helpers', () => {
  it('joins origins and combines cancellation sources', () => {
    expect(joinUrl('https://api.example/', '/v1/tools/ocr')).toBe('https://api.example/v1/tools/ocr')
    expect(joinUrl(undefined, '/x')).toBe(`${DEFAULT_BASE_URL}/x`)
    const first = new AbortController()
    expect(combineSignal(undefined, undefined, undefined)).toBeUndefined()
    expect(combineSignal(first.signal, undefined, undefined)).toBe(first.signal)
    expect(combineSignal(first.signal, 1_000, undefined)).toBeInstanceOf(AbortSignal)
    expect(combineSignal(undefined, 1_000, undefined)).toBeInstanceOf(AbortSignal)
    expect(combineSignal(undefined, 0, undefined)).toBeUndefined()
  })
})

describe('recognizeDocument', () => {
  it('uploads purpose before the file and parses the pages', async () => {
    const { fetchImpl, calls } = stubFetch(() => json({
      purpose: 'rich_layout_recognition',
      pages: [{ index: 0, text: '第一页', finish_reason: 'stop' }],
    }))
    const file = { bytes: new Uint8Array([1, 2, 3]), filename: 'doc.pdf', size: 3 }
    const data = await recognizeDocument({ ...transport(fetchImpl), file, purpose: 'rich_layout_recognition' })
    expect(data.pages).toEqual([{ index: 0, text: '第一页', finish_reason: 'stop' }])
    expect(data.purpose).toBe('rich_layout_recognition')
    const call = calls[0]!
    expect(call.url).toBe('https://api.example/v1/tools/ocr')
    expect((call.init.headers as Record<string, string>).authorization).toBe('Bearer test-key')
    const entries = formEntries(call.init)
    expect(entries.map(([name]) => name)).toEqual(['purpose', 'file'])
    expect(entries[0]![1]).toBe('rich_layout_recognition')
    expect((entries[1]![1] as File).name).toBe('doc.pdf')
  })

  it('reports provider errors and malformed payloads', async () => {
    const provider = stubFetch(() => json({ error: { message: 'bad layout', code: 'layout' } }))
    await expect(recognizeDocument({
      ...transport(provider.fetchImpl),
      file: { bytes: new Uint8Array([1]), filename: 'a.pdf', size: 1 },
    })).rejects.toThrow('DeepSeek OCR 失败：bad layout')

    const missing = stubFetch(() => json({}))
    await expect(recognizeDocument({
      ...transport(missing.fetchImpl),
      file: { bytes: new Uint8Array([1]), filename: 'a.pdf', size: 1 },
    })).rejects.toThrow('DeepSeek OCR 响应缺少 pages 数组')
  })
})

describe('transcribeAudio', () => {
  it('uses the account authorization endpoint and headers', async () => {
    const { fetchImpl, calls } = stubFetch(() => json({ request_id: 'asr-1', text: '你好', duration_ms: 3_200 }))
    const data = await transcribeAudio({
      fetchImpl,
      authorization: {
        kind: 'account',
        endpoint: 'https://api.example/v1/tools/asr',
        headers: { 'x-dsh-auth-token': 'account-token' },
      },
      file: { bytes: new Uint8Array([4, 5]), filename: 'speech.wav', size: 2 },
    })
    expect(data).toEqual({ text: '你好', duration_ms: 3_200 })
    const call = calls[0]!
    expect(call.url).toBe('https://api.example/v1/tools/asr')
    const headers = call.init.headers as Record<string, string>
    expect(headers['x-dsh-auth-token']).toBe('account-token')
    expect(headers.authorization).toBeUndefined()
    expect(formEntries(call.init)[0]![1]).toBeInstanceOf(File)
  })

  it('rejects a response without text', async () => {
    const { fetchImpl } = stubFetch(() => json({ request_id: 'asr-1' }))
    await expect(transcribeAudio({
      ...transport(fetchImpl), file: { bytes: new Uint8Array([1]), filename: 'a.wav', size: 1 },
    })).rejects.toThrow('DeepSeek 语音识别响应缺少 text 字段')
  })
})

describe('synthesizeSpeech', () => {
  it('sends the voice selection and returns the audio bytes', async () => {
    const { fetchImpl, calls } = stubFetch(() => new Response(new Uint8Array([82, 73, 70, 70]), {
      headers: { 'content-type': 'audio/wav' },
    }))
    const audio = await synthesizeSpeech({ ...transport(fetchImpl), text: '你好', voiceId: 'tide' })
    expect([...audio.bytes]).toEqual([82, 73, 70, 70])
    expect(audio.contentType).toBe('audio/wav')
    const requestBody = calls[0]!.init.body
    const body = JSON.parse(typeof requestBody === 'string' ? requestBody : '{}') as Record<string, unknown>
    expect(body).toEqual({ text: '你好', voice_id: 'tide', format: 'wav', filter_markdown: true })
    expect((calls[0]!.init.headers as Record<string, string>)['content-type']).toBe('application/json')
  })

  it('rejects an empty audio response', async () => {
    const { fetchImpl } = stubFetch(() => new Response(new Uint8Array(), { headers: { 'content-type': 'audio/wav' } }))
    await expect(synthesizeSpeech({ ...transport(fetchImpl), text: '你好' }))
      .rejects.toThrow('DeepSeek 语音合成返回了空音频')
  })
})

describe('failure mapping', () => {
  it('keeps status, provider code, and retryability', async () => {
    const unauthorized = stubFetch(() => json({ error: { message: 'Authentication Fails', code: 'invalid_api_key' } }, 401))
    const failure = await recognizeDocument({
      ...transport(unauthorized.fetchImpl),
      file: { bytes: new Uint8Array([1]), filename: 'a.pdf', size: 1 },
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DeepSeekApiError)
    const apiError = failure as DeepSeekApiError
    expect(apiError.status).toBe(401)
    expect(apiError.retryable).toBe(false)
    expect(apiError.code).toBe('invalid_api_key')
    expect(apiError.message).toContain('API Key 缺失或无效')

    const limited = stubFetch(() => json({ error: { message: 'Rate limit' } }, 429))
    const limitedFailure = await transcribeAudio({
      ...transport(limited.fetchImpl), file: { bytes: new Uint8Array([1]), filename: 'a.wav', size: 1 },
    }).catch((error: unknown) => error)
    expect((limitedFailure as DeepSeekApiError).retryable).toBe(true)
    expect((limitedFailure as DeepSeekApiError).status).toBe(429)
  })

  it('rejects the account credential on a 401 account request', async () => {
    const reject = vi.fn()
    const { fetchImpl } = stubFetch(() => json({ error: { message: 'expired' } }, 401))
    const failure = await transcribeAudio({
      fetchImpl,
      authorization: {
        kind: 'account', endpoint: 'https://api.example/v1/tools/asr', headers: {}, reject,
      },
      file: { bytes: new Uint8Array([1]), filename: 'a.wav', size: 1 },
    }).catch((error: unknown) => error)
    expect((failure as DeepSeekApiError).code).toBe('ACCOUNT_UNAUTHORIZED')
    expect(reject).toHaveBeenCalledOnce()
  })

  it('maps a network failure, a timeout, and a revocation', async () => {
    const down = stubFetch(() => { throw new TypeError('fetch failed') })
    const failure = await transcribeAudio({
      ...transport(down.fetchImpl), file: { bytes: new Uint8Array([1]), filename: 'a.wav', size: 1 },
    }).catch((error: unknown) => error)
    expect((failure as DeepSeekApiError).message).toContain('网络请求失败')

    const timeout = stubFetch(() => { throw new DOMException('timed out', 'TimeoutError') })
    const timedOut = await transcribeAudio({
      ...transport(timeout.fetchImpl), file: { bytes: new Uint8Array([1]), filename: 'a.wav', size: 1 },
    }).catch((error: unknown) => error)
    expect((timedOut as DeepSeekApiError).retryable).toBe(true)
    expect((timedOut as DeepSeekApiError).message).toContain('请求已中止')

    const revoked = new AbortController()
    revoked.abort()
    const revokedFailure = await transcribeAudio({
      fetchImpl: down.fetchImpl,
      authorization: {
        kind: 'account', endpoint: 'https://api.example/v1/tools/asr', headers: {}, revoked: revoked.signal,
      },
      file: { bytes: new Uint8Array([1]), filename: 'a.wav', size: 1 },
    }).catch((error: unknown) => error)
    expect((revokedFailure as DeepSeekApiError).code).toBe('ACCOUNT_REVOKED')
  })

  it('keeps the caller cancellation reason', async () => {
    const lifetime = new AbortController()
    const reason = new DOMException('caller stopped', 'AbortError')
    const { fetchImpl } = stubFetch(() => { lifetime.abort(reason); throw reason })
    const failure = await transcribeAudio({
      ...transport(fetchImpl), signal: lifetime.signal,
      file: { bytes: new Uint8Array([1]), filename: 'a.wav', size: 1 },
    }).catch((error: unknown) => error)
    expect(failure).toBe(reason)
  })

  it('reports a missing fetch implementation, invalid JSON, and an empty body', async () => {
    vi.stubGlobal('fetch', undefined)
    await expect(transcribeAudio({
      baseUrl: 'https://api.example',
      file: { bytes: new Uint8Array([1]), filename: 'a.wav', size: 1 },
    })).rejects.toThrow('没有可用的 fetch 实现')
    vi.unstubAllGlobals()

    const invalid = stubFetch(() => new Response('not json', { headers: { 'content-type': 'application/json' } }))
    await expect(transcribeAudio({
      ...transport(invalid.fetchImpl), file: { bytes: new Uint8Array([1]), filename: 'a.wav', size: 1 },
    })).rejects.toThrow('返回了无法解析的响应')

    const empty = stubFetch(() => new Response('', { headers: { 'content-type': 'application/json' } }))
    await expect(transcribeAudio({
      ...transport(empty.fetchImpl), file: { bytes: new Uint8Array([1]), filename: 'a.wav', size: 1 },
    })).rejects.toThrow('响应缺少 text 字段')
  })
})

describe('loadUploadFile', () => {
  it('reads one file and reports its name and size', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    const file = join(directory, 'doc.pdf')
    await writeFile(file, new Uint8Array([1, 2, 3]))
    const upload = await loadUploadFile(file)
    expect(upload.filename).toBe('doc.pdf')
    expect(upload.size).toBe(3)
    expect([...upload.bytes]).toEqual([1, 2, 3])
  })

  it('rejects a missing file, a directory, and an oversized file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-suite-'))
    await expect(loadUploadFile(join(directory, 'nope.pdf'))).rejects.toThrow('文件不存在')
    await expect(loadUploadFile(directory)).rejects.toThrow('不是普通文件')
    const file = join(directory, 'big.pdf')
    await writeFile(file, new Uint8Array([1, 2, 3]))
    await expect(loadUploadFile(file, { maxBytes: 2 })).rejects.toThrow('文件过大')
  })
})
