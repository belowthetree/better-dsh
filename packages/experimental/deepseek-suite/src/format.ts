/** Turn DeepSeek OCR and speech-recognition responses into compact model-facing text. */

/** One recognized document page. */
export interface OcrPage {
  /** Zero-based page position in the source document. */
  readonly index?: number | undefined
  /** Page text, empty when the page carries none. */
  readonly text?: string | undefined
  /** Why the provider stopped; `length` marks a truncated page. */
  readonly finish_reason?: string | undefined
}

/** One OCR response body. */
export interface OcrResult {
  readonly purpose?: string | undefined
  readonly pages: readonly OcrPage[]
}

/** One speech-recognition response body. */
export interface AsrResult {
  readonly text: string
  readonly duration_ms?: number | undefined
}

/**
 * Truncate one text at the output budget, stating what was omitted.
 * @param text - complete text.
 * @param limit - maximum characters to keep.
 * @param label - localized name of the truncated content.
 * @returns the text unchanged within budget, or the head plus an omission note.
 */
export function truncate(text: string, limit: number, label = '内容'): string {
  const value = text
  if (!Number.isFinite(limit) || limit <= 0 || value.length <= limit) return value
  return `${value.slice(0, limit)}\n…（${label}已截断：共 ${value.length} 字，只显示前 ${limit} 字）`
}

/**
 * Join the non-empty blocks of one result.
 * @param blocks - candidate blocks.
 * @returns the blocks separated by blank lines.
 */
function joinBlocks(blocks: readonly string[]): string {
  return blocks.filter(block => typeof block === 'string' && block.trim() !== '').join('\n\n')
}

/**
 * Format one OCR response as page-by-page text.
 * @param data - OCR response body.
 * @param options - source filename and the output character budget.
 * @returns the model-facing result text.
 */
export function formatOcrResult(
  data: OcrResult,
  options: { readonly filename?: string; readonly maxOutputChars?: number } = {},
): string {
  const { filename = '', maxOutputChars = 40_000 } = options
  const pages = data.pages
  const header = `文件：${filename || '(未命名)'}（purpose: ${data.purpose ?? 'text_recognition'}，共 ${String(pages.length)} 页）`
  const body = pages.map((page) => {
    const note = page.finish_reason === 'length' ? '（该页输出达到上限，文本不完整）' : ''
    return `--- 第 ${String((page.index ?? 0) + 1)} 页 ---${note}\n${page.text ?? ''}`
  }).join('\n\n')
  return truncate(joinBlocks([header, body === '' ? '（没有识别出文本。）' : body]), maxOutputChars, '识别结果')
}

/**
 * Format one speech-recognition response.
 * @param data - recognition response body.
 * @param options - output character budget.
 * @returns the model-facing result text.
 */
export function formatAsrResult(
  data: AsrResult,
  options: { readonly maxOutputChars?: number } = {},
): string {
  const { maxOutputChars = 40_000 } = options
  const seconds = typeof data.duration_ms === 'number' ? (data.duration_ms / 1000).toFixed(2) : undefined
  const header = seconds === undefined ? '识别结果：' : `识别结果（音频时长 ${seconds} 秒）：`
  return truncate(`${header}\n${data.text}`, maxOutputChars, '识别结果')
}
