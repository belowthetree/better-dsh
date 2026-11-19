// @vitest-environment node
/** Managed-conversation page derivation stays separate from real Workspace pages. */
import { expect, it } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MANAGE_PAGE_ID, workbenchGroups } from '../src/client/workbench-groups.ts'

const ws = (value: string) => value as WorkspaceId
const sid = (value: string) => value as SessionId

function session(id: string, updatedAt: number, agentPreset?: string, origin?: 'subagent'): SessionSummary {
  return {
    id: sid(id),
    displayTitle: id,
    running: false,
    retainedBy: {},
    blank: false,
    updatedAt,
    ...(agentPreset === undefined ? {} : { agentPreset }),
    ...(origin === undefined ? {} : { origin }),
  }
}

function workspace(id: string, title: string, sessionIds: SessionId[]): WorkspaceView {
  return { workspaceId: ws(id), title, path: `E:\\Project\\${id}`, sessionIds, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
}

it('puts the managed conversation first and removes it from its real Workspace page', () => {
  const groups = workbenchGroups(
    [workspace('default', 'default-workspace', [sid('managed'), sid('ordinary')])],
    {
      [sid('managed')]: session('managed', 20, 'manage'),
      [sid('ordinary')]: session('ordinary', 10),
    },
    '大肥鱼',
  )
  expect(groups.map(group => [group.workspaceId, group.title, group.sessionIds])).toEqual([
    [MANAGE_PAGE_ID, '大肥鱼', [sid('managed')]],
    [ws('default'), 'default-workspace', [sid('ordinary')]],
  ])
  expect(groups[0]?.manages).toBe(true)
  expect(groups[1]?.manages).toBe(false)
})

it('omits the managed page when no managed Session exists', () => {
  const groups = workbenchGroups(
    [workspace('default', 'default-workspace', [sid('ordinary')])],
    { [sid('ordinary')]: session('ordinary', 10) },
    '大肥鱼',
  )
  expect(groups.map(group => group.workspaceId)).toEqual([ws('default')])
})

it('sorts managed Sessions newest first and ignores other presets and subagents', () => {
  const groups = workbenchGroups(
    [],
    {
      [sid('older')]: session('older', 10, 'manage'),
      [sid('newer')]: session('newer', 20, 'manage'),
      [sid('other')]: session('other', 30, 'coding'),
      [sid('child')]: session('child', 40, 'manage', 'subagent'),
    },
    '大肥鱼',
  )
  expect(groups).toHaveLength(1)
  expect(groups[0]?.sessionIds).toEqual([sid('newer'), sid('older')])
})
