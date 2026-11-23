/** Tool-argument path rules: relative paths resolve inside the Session workspace. */
import { isAbsolute, join, resolve } from 'node:path'

/**
 * Resolve one tool argument path against the Session workspace.
 * @param input - raw path argument.
 * @param baseDir - workspace directory relative paths resolve from.
 * @returns the absolute path.
 * @throws when the argument carries no path.
 */
export function resolveToolPath(input: string | undefined, baseDir: string): string {
  const value = (input ?? '').trim()
  if (value === '') throw new Error('文件路径不能为空')
  return isAbsolute(value) ? value : resolve(baseDir, value)
}

/**
 * Name the file one synthesis writes when the call names none.
 * @param baseDir - workspace directory the file lands in.
 * @param audioFormat - requested container.
 * @param now - clock used for the timestamp, for deterministic tests.
 * @returns the absolute default audio path.
 */
export function defaultAudioPath(baseDir: string, audioFormat: 'wav' | 'pcm', now = new Date()): string {
  const stamp = now.toISOString().replace(/\..+$/, '').replace(/[-:]/g, '').replace('T', '-')
  return join(baseDir, `deepseek-tts-${stamp}.${audioFormat === 'pcm' ? 'pcm' : 'wav'}`)
}
