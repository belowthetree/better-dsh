// @vitest-environment node
/** OCR and recognition results become compact model-facing text. */
import { describe, expect, it } from 'vitest'
import { formatAsrResult, formatOcrResult, truncate } from '../src/format.ts'

describe('truncate', () => {
  it('keeps text within budget and states what it omitted', () => {
    expect(truncate('短文本', 10)).toBe('短文本')
    expect(truncate('abcdef', 0)).toBe('abcdef')
    expect(truncate('abcdef', Number.NaN)).toBe('abcdef')
    expect(truncate('abcdef', 3)).toBe('abc\n…（内容已截断：共 6 字，只显示前 3 字）')
    expect(truncate('abcdef', 3, '识别结果')).toContain('识别结果已截断')
  })
})

describe('formatOcrResult', () => {
  it('numbers pages and marks a truncated page', () => {
    const text = formatOcrResult({
      purpose: 'rich_layout_recognition',
      pages: [
        { index: 0, text: '第一页文字', finish_reason: 'stop' },
        { index: 1, text: '第二页文字', finish_reason: 'length' },
      ],
    }, { filename: 'doc.pdf' })
    expect(text).toContain('文件：doc.pdf（purpose: rich_layout_recognition，共 2 页）')
    expect(text).toContain('--- 第 1 页 ---\n第一页文字')
    expect(text).toContain('--- 第 2 页 ---（该页输出达到上限，文本不完整）\n第二页文字')
  })

  it('falls back to an unnamed source and an empty result', () => {
    const text = formatOcrResult({ pages: [] })
    expect(text).toContain('文件：(未命名)（purpose: text_recognition，共 0 页）')
    expect(text).toContain('（没有识别出文本。）')
  })

  it('honors the output budget', () => {
    const pages = Array.from({ length: 5 }, (_, index) => ({ index, text: 'x'.repeat(50) }))
    const text = formatOcrResult({ pages }, { maxOutputChars: 80 })
    expect(text).toContain('识别结果已截断')
  })
})

describe('formatAsrResult', () => {
  it('reports the audio duration when the provider measured it', () => {
    expect(formatAsrResult({ text: '你好', duration_ms: 3_200 })).toContain('（音频时长 3.20 秒）')
  })

  it('omits the duration when the provider did not measure it', () => {
    expect(formatAsrResult({ text: '你好' })).toBe('识别结果：\n你好')
  })
})
