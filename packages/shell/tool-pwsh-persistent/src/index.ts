/* jscpd:ignore-start -- deliberate mirror of tool-bash-persistent (persistent-pty note 2026-08-11-pwsh-persistent-pty):
   the PowerShell counterpart shares the session registry, polling loop, and reset contract by design. */
/**
 * Model-facing persistent `pwsh` tool over the owner-scoped PTY seam.
 * @module @deepseek-ai/dsh-tool-pwsh-persistent
 */

import type {} from '@deepseek-ai/dsh-working-directory'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { truncateWithoutSplittingSurrogatePair } from '@deepseek-ai/dsh-output-retention'
import type { TerminalReadResult, TerminalSessionId } from '@deepseek-ai/dsh-terminal'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { defineTool, ToolArgsError, ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'

// TODO: Replace the file-search advice; arbitrary command output need not come from a searchable file.
const TRUNCATED_MESSAGE = '<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with Select-String in order to find the line numbers of what you are looking for.</NOTE>'
const LOST_PREFIX_MESSAGE = '<response clipped><NOTE>The beginning of this command output was dropped by the terminal scrollback limit. The following text is the earliest retained output.</NOTE>\n'
const SHELL_RESET_MESSAGE = 'The persistent pwsh shell was reset; the next pwsh call starts from the workspace with a fresh current directory and environment.'
const TIMEOUT_CODE = 'PERSISTENT_PWSH_TIMEOUT'
// One page is enough to find a just-emitted completion marker; the full
// scrollback is assembled only when a command settles or needs partial output.
const SCROLLBACK_PAGE_LINES = 1_000
const POLL_INTERVAL_MS = 25

const DEFAULT_DESCRIPTION = 'Run commands in a persistent PowerShell shell. State, including the current directory and exported environment variables, persists across calls for this agent.'

interface ResolvedConfig {
  backendType: string
  timeoutMs: number
  maxOutputChars: number
  description: string
}

interface CommandMarkers {
  start: string
  end: string
}

interface RetainedOutput {
  text: string
  truncated: boolean
}

interface CapturedOutput {
  text: string
  incomplete: boolean
  /**
   * Whether the executed wrapper announced itself. Without that marker the
   * retained text holds only the interactive echo of the submitted wrapper, so
   * no command output exists yet.
   */
  started: boolean
  exitCode?: number
}

interface PersistentShells {
  get(owner: Agent, signal: AbortSignal): Promise<TerminalSessionId>
  reset(owner: Agent, reason: string): Promise<void>
}

function maybeTruncate(content: string, maxOutputChars: number, incomplete = false): string {
  if (content.length <= maxOutputChars && !incomplete) return content
  return content.length <= maxOutputChars
    ? content + TRUNCATED_MESSAGE
    : truncateWithoutSplittingSurrogatePair(content, maxOutputChars) + TRUNCATED_MESSAGE
}

const START_TAG = '__DSH_PERSISTENT_PWSH_START_'
const END_TAG = '__DSH_PERSISTENT_PWSH_END_'

function markers(): CommandMarkers {
  const nonce = randomUUID()
  return {
    start: `${START_TAG}${nonce}__`,
    end: `${END_TAG}${nonce}:`,
  }
}

/**
 * Emit one marker as two concatenated quoted literals.
 *
 * The interactive shell echoes the submitted wrapper source, so a marker kept
 * in a single literal would also appear in the transcript before the wrapper
 * runs. Splitting it leaves every contiguous marker occurrence attributable to
 * the executed wrapper.
 * @param marker - the contiguous marker the extraction searches for.
 * @param tag - the marker's fixed prefix, emitted as the first literal.
 * @returns the PowerShell expression that prints `marker`.
 */
function markerExpression(marker: string, tag: string): string {
  return `'${tag}' + '${marker.slice(tag.length)}'`
}

/**
 * Escape a command body for embedding in the wrapper's double-quoted string.
 * Backtick escapes keep every character literal: backtick first so the
 * escapes this function inserts are never re-escaped, `$` so no expansion
 * happens at wrapper construction, and `\r\n`/ESC so multi-line commands and
 * raw control bytes ride one physical input line without PSReadLine mangling.
 * @param value - the model's PowerShell command text.
 * @returns the escaped double-quoted-string body.
 */
function quoteForPwsh(value: string): string {
  return value
    .replaceAll('`', '``')
    .replaceAll('"', '`"')
    .replaceAll('$', '`$')
    .replaceAll('\r', '')
    .replaceAll('\n', '`n')
    .replaceAll('\x1b', '`e')
}

function wrapCommand(command: string, marker: CommandMarkers): string {
  // Keep the wrapper on one physical line: PSReadLine renders the echoed
  // input, and a wrapped line would split the echo the extraction ignores.
  // Both markers go out through markerExpression, so the echo cannot contain
  // either of them, and the status regex still needs digits right after the
  // end marker, which only the executed wrapper prints.
  const body = quoteForPwsh(command)
  return `Write-Output (${markerExpression(marker.start, START_TAG)}); $LASTEXITCODE = $null; $__s = 1; try { Invoke-Expression "${body}"; $__ok = $? } catch { $__ok = $false }; if ($null -ne $LASTEXITCODE) { $__s = [int]$LASTEXITCODE } else { $__s = if ($__ok) { 0 } else { 1 } }; Write-Output (${markerExpression(marker.end, END_TAG)} + $__s)`
}

function trimTrailingNewline(text: string): string {
  return text.replace(/\r?\n$/, '')
}

function commandOutput(snapshot: RetainedOutput, marker: CommandMarkers): CapturedOutput | undefined {
  const text = snapshot.text
  const end = text.lastIndexOf(marker.end)
  // Terminal padding belongs to the status line, not to captured command output.
  const status = /^(\d+) *\r?\n/.exec(text.slice(end + marker.end.length))?.[1]
  if (status === undefined) return undefined
  // The echo carries neither marker, so the last occurrence before the status
  // is the line the executing wrapper printed ahead of the command body.
  const startMarker = text.lastIndexOf(marker.start, end)
  const start = startMarker < 0 ? 0 : startMarker + marker.start.length
  return {
    text: text.slice(start, end).replace(/^\r?\n/, '').replace(/\r?\n$/, ''),
    incomplete: startMarker < 0,
    started: true,
    exitCode: Number(status),
  }
}

function partialOutput(
  snapshot: RetainedOutput,
  marker: CommandMarkers,
  fallback: string,
): CapturedOutput {
  const startMarker = snapshot.text.lastIndexOf(marker.start)
  if (startMarker >= 0) {
    return {
      text: trimTrailingNewline(snapshot.text.slice(startMarker + marker.start.length).replace(/^\r?\n/, '')),
      incomplete: false,
      started: true,
    }
  }
  const fallbackStart = fallback.lastIndexOf(marker.start)
  if (fallbackStart >= 0) {
    const afterStart = fallback.slice(fallbackStart + marker.start.length).replace(/^\r?\n/, '')
    const fallbackEnd = afterStart.lastIndexOf(marker.end)
    return {
      text: trimTrailingNewline(fallbackEnd < 0 ? afterStart : afterStart.slice(0, fallbackEnd)),
      incomplete: false,
      started: true,
    }
  }
  // Neither buffer holds a marker, so the retained text cannot be attributed to
  // this command. A truncated transcript dropped its oldest lines first —
  // including the echo and the marker that followed it — so its tail still
  // carries output; an intact transcript holds only the interactive echo.
  return snapshot.truncated
    ? { text: trimTrailingNewline(snapshot.text), incomplete: true, started: false }
    : { text: '', incomplete: false, started: false }
}

async function pause(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
}

function nextScrollbackOffset(page: TerminalReadResult, offset: number): number | undefined {
  if (page.text.length === 0 || page.lineEnd <= offset) return undefined
  return page.lineEnd
}

function retainedScrollback(
  ctx: Context,
  owner: Agent,
  id: TerminalSessionId,
  latest = ctx.terminals.read(owner, id, { offset: 0, count: SCROLLBACK_PAGE_LINES }),
): RetainedOutput {
  const pages: string[] = latest.text.length === 0 ? [] : [latest.text]
  let offset = latest.lineEnd
  let truncated = latest.truncated
  while (true) {
    if (offset >= latest.totalLines) break
    const page = ctx.terminals.read(owner, id, { offset, count: SCROLLBACK_PAGE_LINES })
    truncated ||= page.truncated
    if (page.text.length > 0) pages.unshift(page.text)
    const next = nextScrollbackOffset(page, offset)
    if (next === undefined || next >= page.totalLines) break
    offset = next
  }
  return { text: pages.join('\n'), truncated }
}

function renderCaptured(output: CapturedOutput, maxOutputChars: number): string {
  const rendered = maybeTruncate(output.text, maxOutputChars, output.incomplete)
  const withPrefix = output.incomplete && output.text.length > 0
    ? LOST_PREFIX_MESSAGE + rendered
    : rendered
  const marker = output.exitCode !== undefined && output.exitCode !== 0
    ? `[exit code: ${output.exitCode}]`
    : undefined
  return appendStatusMarker(withPrefix, marker)
}

function appendStatusMarker(content: string, marker: string | undefined): string {
  if (marker === undefined) return content
  return content.length === 0 ? marker : `${content}\n${marker}`
}

function renderShellExitStatus(
  content: string,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): string {
  const marker = signal !== null
    ? `[shell killed by signal: ${signal}]`
    : exitCode !== null
      ? `[shell exited: code ${exitCode}]`
      : '[shell exited]'
  return appendStatusMarker(content, marker)
}

/**
 * Render the exited-session result, reset the owner's shell, and reset the
 * message that tells the model the next call starts fresh.
 * @param shells - the owner-scoped registry to reset.
 * @param status - the exited session status (exit code and signal).
 * @returns the complete model-facing result.
 */
async function respondToSessionExit(
  ctx: Context,
  shells: PersistentShells,
  owner: Agent,
  id: TerminalSessionId,
  status: { exitCode: number | null; signal: NodeJS.Signals | null },
  marker: CommandMarkers,
  fallback: string,
  config: ResolvedConfig,
): Promise<string> {
  const snapshot = retainedScrollback(ctx, owner, id)
  await shells.reset(owner, 'persistent pwsh shell exited')
  return [
    renderShellExitStatus(
      renderCaptured(partialOutput(snapshot, marker, fallback), config.maxOutputChars),
      status.exitCode,
      status.signal,
    ),
    SHELL_RESET_MESSAGE,
  ].filter(part => part.length > 0).join('\n')
}

function persistentShells(ctx: Context, config: ResolvedConfig): PersistentShells {
  const pending = new WeakMap<Agent, Promise<TerminalSessionId>>()
  const live = new Map<Agent, TerminalSessionId>()
  const creating = new Set<Promise<TerminalSessionId>>()
  const ownerCleanupInstalled = new WeakSet<Agent>()
  const lifecycle = new AbortController()

  const close = async (owner: Agent, id: TerminalSessionId, reason: string): Promise<void> => {
    if (!ctx.terminals.list(owner).some(snapshot => snapshot.sessionId === id)) return
    await ctx.terminals.kill(owner, id, reason)
  }

  ctx.effect(() => async () => {
    lifecycle.abort(new Error('tool-pwsh-persistent disposed during shell creation'))
    await Promise.allSettled([...creating])
    const closing = [...live].map(async ([owner, id]) => { await close(owner, id, 'tool-pwsh-persistent disposed') })
    await Promise.all(closing)
    live.clear()
  }, 'tool-pwsh-persistent shell cleanup')

  const reset = async (owner: Agent, reason: string): Promise<void> => {
    pending.delete(owner)
    const id = live.get(owner)
    live.delete(owner)
    if (id !== undefined) await close(owner, id, reason)
  }

  const get = (owner: Agent, signal: AbortSignal): Promise<TerminalSessionId> => {
    const existing = pending.get(owner)
    if (existing !== undefined) return existing
    const combinedSignal = AbortSignal.any([signal, lifecycle.signal])
    const creation = (async () => {
      try {
        const cwd = await ctx.workingDirectory.ensure(owner, combinedSignal)
        const spawned = await ctx.terminals.spawn(owner, {
          type: config.backendType,
          cwd,
        }, combinedSignal)
        live.set(owner, spawned.sessionId)
        if (!ownerCleanupInstalled.has(owner)) {
          ownerCleanupInstalled.add(owner)
          owner.ctx.effect(() => () => {
            pending.delete(owner)
            live.delete(owner)
          }, 'tool-pwsh-persistent owner cache cleanup')
        }
        return spawned.sessionId
      } catch (error: unknown) {
        await reset(owner, 'persistent pwsh initialization failed')
        throw error
      }
    })()
    const tracked = creation.finally(() => {
      creating.delete(tracked)
    })
    creating.add(tracked)
    pending.set(owner, tracked)
    return tracked
  }

  return { get, reset }
}

async function executeCommand(
  ctx: Context,
  shells: PersistentShells,
  owner: Agent,
  command: string,
  config: ResolvedConfig,
  upstream: AbortSignal,
): Promise<string> {
  using commandDeadline = deadline(upstream, config.timeoutMs, TIMEOUT_CODE)
  let id: TerminalSessionId
  try {
    id = await shells.get(owner, commandDeadline.signal)
  } catch (error: unknown) {
    // Initialization owns rollback; only this caller's cancellation becomes ABORTED.
    if (upstream.aborted && error === upstream.reason) return ''
    throw error
  }
  const marker = markers()
  const wrapped = wrapCommand(command, marker)
  let first = true
  let fallback = ''

  while (true) {
    // The shell may flip to exited between iterations (a fast `exit` can
    // settle the previous send while its exit event is still in flight, and
    // the echoed wrapper can then carry a marker end without status digits);
    // re-observing status before the next send closes that gap.
    const status = ctx.terminals.list(owner).find(session => session.sessionId === id)?.status
    if (status?.kind === 'exited') {
      return await respondToSessionExit(ctx, shells, owner, id, status, marker, fallback, config)
    }
    let operation
    let result
    try {
      operation = ctx.terminals.startSend(owner, id, {
        text: first ? wrapped : '',
        submit: first,
        signal: commandDeadline.signal,
      })
      first = false
      result = await operation.done
    } catch (error: unknown) {
      await shells.reset(owner, 'persistent pwsh send failed')
      throw error
    }
    const incremental = operation.readOutput()
    fallback = incremental.delta.length > 0 ? fallback + incremental.delta : result.viewport
    const latest = ctx.terminals.read(owner, id, { offset: 0, count: SCROLLBACK_PAGE_LINES })
    const timedOut = timeoutOf(commandDeadline.signal, TIMEOUT_CODE)
    if (timedOut !== undefined) {
      const snapshot = retainedScrollback(ctx, owner, id, latest)
      const partial = renderCaptured(partialOutput(snapshot, marker, fallback), config.maxOutputChars)
      await shells.reset(owner, 'persistent pwsh command timed out')
      return [
        // TODO: Report a timeout only; this signal does not establish an OOM.
        `Your command timed out after ${Math.round(timedOut.timeoutMs / 1000)} seconds or experienced an OOM error. Below is partial output:`,
        partial,
        SHELL_RESET_MESSAGE,
      ].join('\n')
    }
    if (commandDeadline.signal.aborted) {
      await shells.reset(owner, 'persistent pwsh command aborted')
      // ToolRuntime publishes ABORTED after this cancelled invocation settles.
      return ''
    }
    if (latest.text.includes(marker.end)) {
      const complete = commandOutput(retainedScrollback(ctx, owner, id, latest), marker)
      if (complete !== undefined) return renderCaptured(complete, config.maxOutputChars)
    }
    if (result.sessionStatus.kind === 'exited') {
      return await respondToSessionExit(ctx, shells, owner, id, result.sessionStatus, marker, fallback, config)
    }
    // The shell reads stdin again (its prompt, or a foreground child's own
    // read) without having printed the end marker — an interrupt, a replaced
    // shell, or an interactive child. Return what was captured instead of
    // spinning until the command deadline, but only once the wrapper announced
    // itself: readiness also settles while the shell is still rendering the
    // submitted wrapper, and returning then would report that echo instead of
    // the command's output.
    if (result.waitReason === 'stdin_read') {
      const snapshot = retainedScrollback(ctx, owner, id, latest)
      const partial = partialOutput(snapshot, marker, fallback)
      if (partial.started) return renderCaptured(partial, config.maxOutputChars)
    }
    await pause()
  }
}

/**
 * Register the model-facing persistent `pwsh` tool.
 * @param ctx - plugin context carrying tools and the owner-scoped PTY service.
 * @param config - selected PTY backend and command deadline.
 */
function registerPersistentPwsh(ctx: Context, config: ResolvedConfig): void {
  const shells = persistentShells(ctx, config)
  const queues = new WeakMap<Agent, Promise<void>>()

  const serialized = async <T>(owner: Agent, operation: () => Promise<T>): Promise<T> => {
    const prior = queues.get(owner) ?? Promise.resolve()
    const run = prior.then(operation, operation)
    const tail = run.then(() => undefined, () => undefined)
    queues.set(owner, tail)
    try {
      return await run
    } finally {
      if (queues.get(owner) === tail) queues.delete(owner)
    }
  }

  ctx.tools.register(defineTool({
    name: 'pwsh',
    description: config.description,
    parameters: {
      command: {
        type: 'string',
        required: true,
        description: 'The PowerShell command to run. Relative path is preferred in the command.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      if (args.command.trim().length === 0) throw new ToolArgsError(['command must be a non-empty string'])
      const owner = exec.agent
      if (owner === undefined) throw new ToolContextUnavailableError('pwsh requires an owning agent session')
      return serialized(owner, async () => {
        if (exec.signal.aborted) return '' // ToolRuntime publishes ABORTED after settlement.
        return executeCommand(ctx, shells, owner, args.command, config, exec.signal)
      })
    },
    presentCall: args => ({ card: 'terminal', title: args.command }),
  }))
}

export const name = 'tool-pwsh-persistent'
export const inject = ['tools', 'terminals', 'workingDirectory']

/** Configuration for the persistent pwsh tool. */
export interface Config {
  /** PTY backend used for each owner-isolated persistent shell (default `shell`). */
  backendType?: string
  /** Wall-clock limit for one command (default 300000). */
  timeoutMs?: number
  /** Maximum returned command-output characters before clipping (default 16000). */
  maxOutputChars?: number
  /** Model-facing tool description; deployments may describe their environment. */
  description?: string
}

/** Runtime configuration schema for the persistent pwsh tool. */
export const Config: z<Config> = z.object({
  backendType: z.string().default('shell'),
  timeoutMs: z.number().default(300_000),
  maxOutputChars: z.number().default(16_000),
  description: z.string().default(DEFAULT_DESCRIPTION),
})

/** Register one owner-scoped persistent `pwsh` tool. */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    backendType: config.backendType ?? 'shell',
    timeoutMs: config.timeoutMs ?? 300_000,
    maxOutputChars: config.maxOutputChars ?? 16_000,
    description: config.description ?? DEFAULT_DESCRIPTION,
  }
  if (resolved.backendType.trim().length === 0) {
    throw new Error('tool-pwsh-persistent: backendType must be non-empty')
  }
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs <= 0) {
    throw new Error('tool-pwsh-persistent: timeoutMs must be a positive safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxOutputChars) || resolved.maxOutputChars <= 0) {
    throw new Error('tool-pwsh-persistent: maxOutputChars must be a positive safe integer')
  }
  if (resolved.description.trim().length === 0) {
    throw new Error('tool-pwsh-persistent: description must be non-empty')
  }
  registerPersistentPwsh(ctx, resolved)
}

/* jscpd:ignore-end */
