// @vitest-environment jsdom
/** Workbench cards keep strip order, wrap with Ctrl+Tab, and survive a reload. */
import { beforeEach, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createWorkbenchTabsStore, WORKBENCH_TAB_LIMIT, WORKBENCH_TABS_STORAGE } from '../src/client/workbench-tabs.ts'

const sid = (value: string) => value as SessionId

beforeEach(() => { localStorage.clear() })

it('appends a card and activates it without reordering cards that already exist', () => {
  const tabs = createWorkbenchTabsStore()
  tabs.select(sid('a'))
  tabs.select(sid('b'))
  tabs.select(sid('c'))
  tabs.select(sid('a'))
  tabs.select(sid('a'))
  expect(tabs.store.getSnapshot()).toEqual({ sessionIds: [sid('a'), sid('b'), sid('c')], active: sid('a') })
})

it('wraps Ctrl+Tab around the strip and seeds an empty strip from the fallback', () => {
  const tabs = createWorkbenchTabsStore()
  expect(tabs.cycle(1, sid('first'))).toBe(sid('first'))
  tabs.select(sid('second'))
  expect(tabs.cycle(1)).toBe(sid('first'))
  expect(tabs.cycle(-1)).toBe(sid('second'))
  expect(tabs.cycle(-1)).toBe(sid('first'))
  expect(tabs.ensure()).toBe(sid('first'))
  expect(tabs.cycle(1, undefined)).toBe(sid('second'))
})

it('cycles from either end when a restored strip lost its selection', () => {
  const tabs = createWorkbenchTabsStore()
  tabs.store.set({ sessionIds: [sid('a'), sid('b')], active: undefined })
  expect(tabs.cycle(1)).toBe(sid('a'))
  tabs.store.set({ sessionIds: [sid('a'), sid('b')], active: undefined })
  expect(tabs.cycle(-1)).toBe(sid('b'))
})

it('has no card to ensure without a strip or a catalog Session', () => {
  const tabs = createWorkbenchTabsStore()
  expect(tabs.ensure()).toBeUndefined()
  expect(tabs.cycle(1, undefined)).toBeUndefined()
})

it('leaves a strip alone while every card still has its Session', () => {
  const tabs = createWorkbenchTabsStore()
  tabs.select(sid('a'))
  tabs.select(sid('b'))
  tabs.retain(new Set([sid('a'), sid('b')]))
  expect(tabs.store.getSnapshot()).toEqual({ sessionIds: [sid('a'), sid('b')], active: sid('b') })
})

it('drops the oldest card when the strip passes its limit', () => {
  const tabs = createWorkbenchTabsStore()
  for (let index = 0; index <= WORKBENCH_TAB_LIMIT; index += 1) tabs.select(sid(`s${String(index)}`))
  const state = tabs.store.getSnapshot()
  expect(state.sessionIds).toHaveLength(WORKBENCH_TAB_LIMIT)
  expect(state.sessionIds[0]).toBe(sid('s1'))
  expect(state.active).toBe(sid(`s${String(WORKBENCH_TAB_LIMIT)}`))
})

it('prunes cards whose Session left the catalog and repairs the selection', () => {
  const tabs = createWorkbenchTabsStore()
  tabs.select(sid('a'))
  tabs.select(sid('b'))
  tabs.retain(new Set([sid('b')]))
  expect(tabs.store.getSnapshot()).toEqual({ sessionIds: [sid('b')], active: sid('b') })
  tabs.retain(new Set())
  expect(tabs.store.getSnapshot()).toEqual({ sessionIds: [], active: undefined })
})

it('ensures the stored active card, else the first card, else the catalog fallback', () => {
  const tabs = createWorkbenchTabsStore()
  expect(tabs.ensure(sid('catalog'))).toBe(sid('catalog'))
  tabs.select(sid('second'))
  tabs.store.set({ sessionIds: [sid('catalog'), sid('second')], active: undefined })
  expect(tabs.ensure()).toBe(sid('catalog'))
})

it('restores the strip and the most recently used card from the previous run', () => {
  const first = createWorkbenchTabsStore()
  first.select(sid('older'))
  first.select(sid('recent'))
  expect(JSON.parse(localStorage.getItem(WORKBENCH_TABS_STORAGE) ?? 'null')).toEqual({
    sessionIds: [sid('older'), sid('recent')],
    active: sid('recent'),
  })
  const restored = createWorkbenchTabsStore()
  expect(restored.store.getSnapshot()).toEqual({ sessionIds: [sid('older'), sid('recent')], active: sid('recent') })
})
