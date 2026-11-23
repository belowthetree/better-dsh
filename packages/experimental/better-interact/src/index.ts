/**
 * Host half of the Better interact plugin: the orb balloon tool the management
 * persona calls. The tool body only validates and echoes one balloon; the bubble
 * column reads the persisted presentation payload back from the Session log.
 * @module @deepseek-ai/dsh-better-interact
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ORB_BALLOON_MAX_CHARS, ORB_BALLOON_TOOL, type OrbBalloonAction } from './tool.ts'

/** Plugin name registered with Cordis. */
export const name = '@deepseek-ai/dsh-better-interact'

/** Services the balloon tool registers into. */
export const inject = ['tools']

/**
 * Register the orb balloon tool.
 * @param ctx - Host context carrying the tool registry.
 * @returns nothing; the registration stays owned by the plugin fiber.
 */
export function apply(ctx: Context): void {
  const balloon = defineTool({
    name: ORB_BALLOON_TOOL,
    description:
      '在大肥鱼（你）的对话气球里显示一句话，气球出现在悬浮球旁边。text 是用户会看到、也会被朗读出来的一句话；需要点开某个会话时传 sessionId 和 action="open"，不需要点击时用默认的 action="none"。',
    parameters: {
      text: {
        type: 'string',
        required: true,
        description: '气球里要说的话，一到两句话。',
      },
      sessionId: {
        type: 'string',
        description: '点击气球时打开的会话 id，来自 list_session；只有 action="open" 时生效。',
      },
      action: {
        type: 'string',
        enum: ['none', 'open'],
        description: '点击气球的行为：none 不响应点击（默认），open 打开 sessionId 指向的会话。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          sessionId: { type: 'string' },
          action: { type: 'string', enum: ['none', 'open'], required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.action === 'open'
          ? `气球已显示，点击它会打开会话：${value.text}`
          : `气球已显示：${value.text}`,
      }],
      presentationMeta: (_args, value) => ({
        balloon: value.action === 'open' && value.sessionId !== undefined
          ? { text: value.text, sessionId: value.sessionId, action: 'open' }
          : { text: value.text, action: 'none' },
      }),
    },
    // oxlint-disable-next-line typescript/require-await -- async keeps argument failures rejections, as the tool contract expects.
    async execute(args) {
      const text = args.text.trim()
      if (text === '') throw new Error('orb_balloon 需要非空的 text 参数')
      if (text.length > ORB_BALLOON_MAX_CHARS) {
        throw new Error(`orb_balloon 的 text 不能超过 ${ORB_BALLOON_MAX_CHARS} 个字符`)
      }
      const sessionId = args.sessionId === undefined ? undefined : args.sessionId.trim()
      const kept = sessionId === '' ? undefined : sessionId
      const action: OrbBalloonAction = args.action === 'open' ? 'open' : 'none'
      if (action === 'open' && kept === undefined) {
        throw new Error('action="open" 时需要同时给出 sessionId')
      }
      return kept === undefined ? { text, action } : { text, sessionId: kept, action }
    },
  })

  ctx.effect(() => ctx.tools.register(balloon), 'better-interact: orb balloon tool')
}
