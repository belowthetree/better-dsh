// @vitest-environment node
/** The host half registers one balloon tool and validates what it accepts. */
import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { apply, inject } from '../src/index.ts'
import { ORB_BALLOON_MAX_CHARS, ORB_BALLOON_TOOL } from '../src/tool.ts'

/** Capture one registration and run the plugin. */
function registered(): { tool: ToolDefinition; disposers: (() => void)[] } {
  const definitions: ToolDefinition[] = []
  const disposers: (() => void)[] = []
  const ctx = {
    effect: (register: () => () => void) => {
      disposers.push(register())
      return () => {}
    },
    tools: { register: (definition: ToolDefinition) => { definitions.push(definition); return () => {} } },
  }
  apply(ctx as never)
  const tool = definitions[0]
  if (tool === undefined) throw new Error('the balloon tool was not registered')
  return { tool, disposers }
}

describe('orb balloon tool', () => {
  it('declares itself and its arguments', () => {
    expect(inject).toEqual(['tools'])
    const { tool } = registered()
    expect(tool.name).toBe(ORB_BALLOON_TOOL)
    expect(tool.description).toContain('对话气球')
    expect(tool.parameters).toMatchObject({
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' },
        sessionId: { type: 'string' },
        action: { type: 'string', enum: ['none', 'open'] },
      },
    })
  })

  it('returns the text and click behaviour the balloon needs', async () => {
    const { tool } = registered()
    await expect(tool.execute({ text: ' 开会别迟到 ', action: 'none' }, {} as never))
      .resolves.toEqual({ text: '开会别迟到', action: 'none' })
    await expect(tool.execute({ text: '看这个会话', sessionId: ' s2 ', action: 'open' }, {} as never))
      .resolves.toEqual({ text: '看这个会话', sessionId: 's2', action: 'open' })
    await expect(tool.execute({ text: '就一句话' }, {} as never))
      .resolves.toEqual({ text: '就一句话', action: 'none' })
  })

  it('rejects an empty or oversized text and an open action without a session', async () => {
    const { tool } = registered()
    await expect(tool.execute({ text: '   ' }, {} as never)).rejects.toThrow(/需要非空的 text/)
    await expect(tool.execute({ text: 'x'.repeat(ORB_BALLOON_MAX_CHARS + 1) }, {} as never))
      .rejects.toThrow(new RegExp(`不能超过 ${String(ORB_BALLOON_MAX_CHARS)}`))
    await expect(tool.execute({ text: 'hi', action: 'open' }, {} as never)).rejects.toThrow(/需要同时给出 sessionId/)
    await expect(tool.execute({ text: 'hi', sessionId: '   ', action: 'open' }, {} as never))
      .rejects.toThrow(/需要同时给出 sessionId/)
  })

  it('renders one confirmation line and persists the balloon with its click action', async () => {
    const { tool } = registered()
    const plain = await tool.execute({ text: '提醒你喝水' }, {} as never)
    expect(tool.output.render({}, plain as never)).toEqual([{ type: 'text', text: '气球已显示：提醒你喝水' }])
    expect(tool.output.presentationMeta?.({}, plain as never))
      .toEqual({ balloon: { text: '提醒你喝水', action: 'none' } })

    const opened = await tool.execute({ text: '看这个会话', sessionId: 's2', action: 'open' }, {} as never)
    expect(tool.output.render({}, opened as never))
      .toEqual([{ type: 'text', text: '气球已显示，点击它会打开会话：看这个会话' }])
    expect(tool.output.presentationMeta?.({}, opened as never))
      .toEqual({ balloon: { text: '看这个会话', sessionId: 's2', action: 'open' } })
  })

  it('keeps the registration and disposal inside one fiber effect', () => {
    const dispose = vi.fn()
    let registeredDispose: (() => void) | undefined
    const ctx = {
      effect: (register: () => () => void) => { registeredDispose = register(); return () => {} },
      tools: { register: () => dispose },
    }
    apply(ctx as never)
    expect(dispose).not.toHaveBeenCalled()
    registeredDispose?.()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
