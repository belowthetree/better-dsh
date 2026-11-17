// @vitest-environment jsdom
/** Workspace pages keep the shown Workspace, its Session choice, and survive a reload. */
import { beforeEach, expect, it } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createWorkbenchPagesStore, WORKBENCH_PAGES_STORAGE } from '../src/client/workbench-pages.ts'

const ws = (value: string) => value as WorkspaceId
const sid = (value: string) => value as SessionId

beforeEach(() => { localStorage.clear() })

it('selects a Workspace page and records the Session it shows', () => {
  const pages = createWorkbenchPagesStore()
  pages.select(ws('alpha'))
  pages.setSession(ws('alpha'), sid('one'))
  pages.select(ws('beta'))
  expect(pages.store.getSnapshot()).toEqual({
    active: ws('beta'),
    sessions: { [ws('alpha')]: sid('one') },
  })
})

it('cycles the catalog order and wraps around', () => {
  const pages = createWorkbenchPagesStore()
  const ordered = [ws('alpha'), ws('beta'), ws('gamma')]
  expect(pages.cycle(ordered, 1)).toBe(ws('alpha'))
  expect(pages.cycle(ordered, 1)).toBe(ws('beta'))
  expect(pages.cycle(ordered, -1)).toBe(ws('alpha'))
  expect(pages.cycle(ordered, -1)).toBe(ws('gamma'))
  expect(pages.cycle([], 1)).toBeUndefined()
})

it('ensures the stored page, else the fallback, else the first Workspace', () => {
  const pages = createWorkbenchPagesStore()
  const ordered = [ws('alpha'), ws('beta')]
  expect(pages.ensure(ordered, ws('beta'))).toBe(ws('beta'))
  expect(pages.store.getSnapshot().active).toBe(ws('beta'))
  expect(pages.ensure(ordered, ws('missing'))).toBe(ws('beta'))
  pages.retain(new Set(), new Set())
  expect(pages.ensure(ordered)).toBe(ws('alpha'))
  expect(pages.ensure([])).toBeUndefined()
})

it('drops pages and Session choices whose referents left the catalogs', () => {
  const pages = createWorkbenchPagesStore()
  pages.select(ws('alpha'))
  pages.setSession(ws('alpha'), sid('one'))
  pages.setSession(ws('beta'), sid('two'))
  pages.retain(new Set([ws('beta')]), new Set([sid('one')]))
  expect(pages.store.getSnapshot()).toEqual({ active: undefined, sessions: {} })
  pages.select(ws('beta'))
  pages.setSession(ws('beta'), sid('two'))
  pages.retain(new Set([ws('beta')]), new Set([sid('two')]))
  expect(pages.store.getSnapshot()).toEqual({ active: ws('beta'), sessions: { [ws('beta')]: sid('two') } })
})

it('restores the page and its Session choices from the previous run', () => {
  const first = createWorkbenchPagesStore()
  first.select(ws('alpha'))
  first.setSession(ws('alpha'), sid('one'))
  first.select(ws('beta'))
  expect(JSON.parse(localStorage.getItem(WORKBENCH_PAGES_STORAGE) ?? 'null')).toEqual({
    active: 'beta',
    sessions: { alpha: 'one' },
  })
  const restored = createWorkbenchPagesStore()
  expect(restored.store.getSnapshot()).toEqual({ active: ws('beta'), sessions: { [ws('alpha')]: sid('one') } })
})
