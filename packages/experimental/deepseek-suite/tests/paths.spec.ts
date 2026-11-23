// @vitest-environment node
/** Tool-argument paths resolve against the Session workspace. */
import { describe, expect, it } from 'vitest'
import { isAbsolute } from 'node:path'
import { defaultAudioPath, resolveToolPath } from '../src/paths.ts'

describe('resolveToolPath', () => {
  it('keeps absolute paths and resolves relative ones inside the workspace', () => {
    const absolute = resolveToolPath('E:\\docs\\a.pdf', 'E:\\Project\\ws')
    expect(isAbsolute(absolute)).toBe(true)
    expect(absolute).toMatch(/docs[\\/]a\.pdf$/)
    expect(resolveToolPath('docs/a.pdf', 'E:\\Project\\ws')).toMatch(/ws[\\/]docs[\\/]a\.pdf$/)
  })

  it('trims the argument and rejects an empty path', () => {
    expect(resolveToolPath('  a.pdf  ', '/ws')).toMatch(/a\.pdf$/)
    expect(() => resolveToolPath('   ', '/ws')).toThrow('文件路径不能为空')
    expect(() => resolveToolPath(undefined, '/ws')).toThrow('文件路径不能为空')
  })
})

describe('defaultAudioPath', () => {
  it('stamps the default file name per format', () => {
    const now = new Date('2026-11-14T04:05:06.123Z')
    expect(defaultAudioPath('/ws', 'wav', now)).toMatch(/deepseek-tts-20261114-040506\.wav$/)
    expect(defaultAudioPath('/ws', 'pcm', now)).toMatch(/deepseek-tts-20261114-040506\.pcm$/)
  })
})
