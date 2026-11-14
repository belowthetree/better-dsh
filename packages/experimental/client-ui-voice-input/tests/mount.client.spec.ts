/** The voice plugin binds slots and copy to the shared capture service without owning it. */
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { inject, mountVoiceInput } from '../src/client/mount.ts'
import { apply as hostApply } from '../src/index.ts'
import { VoiceInput, type VoiceInputInjected } from '../src/client/VoiceInput.tsx'
import { fakeCapture, PROVIDER } from './capture-service.client.ts'

/** Narrow the erased registry payload before exercising its registered actions. */
function assertVoiceActions(value: Record<string, unknown>): asserts value is Record<string, unknown> & VoiceInputInjected {
  for (const name of ['begin', 'finish', 'cancel', 'captureSnapshot', 'selectMicrophone', 'previewMicrophone',
    'configure', 'prepare', 'cancelPreparation', 'openSettings', 'setHandsFree', 'takeTranscript'] as const) assert.equal(typeof value[name], 'function')
  assert.equal(typeof value.hooks, 'object')
}

async function fixture(navigation = true) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const fake = fakeCapture()
  ctx.provide('voiceCapture', fake.capture)
  const openBundle = vi.fn()
  if (navigation) ctx.provide('pluginNavigation', { openBundle })
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: {
    'conversation.input.activity': { kind: 'single', scope: 'session' },
    'plugins.bundle.activation': { kind: 'keyed', scope: 'root' },
    'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
  } } as never, () => null)
  return { ctx, fake, openBundle }
}

it('serves the composer and preparation slots from the shared capture service', async () => {
  hostApply()
  const b = await fixture()
  const fiber = b.ctx.plugin({ inject: [...inject], apply: mountVoiceInput })
  await fiber
  const entry = b.ctx.slots.entries('conversation.input.activity').find(item => item.component === VoiceInput)
  expect(entry).toMatchObject({ locale: 'voice-input' })
  const actions = entry!.inject!()
  assertVoiceActions(actions)
  expect(actions.hooks.voiceSnapshot.getSnapshot()).toEqual(b.fake.snapshots.getSnapshot())
  expect(actions.hooks.microphoneDevice.getSnapshot()).toEqual({ id: '', label: '' })
  expect(actions.hooks.handsFree.getSnapshot()).toBe(false)
  expect(actions.takeTranscript()).toBeNull()
  actions.setHandsFree(true)
  expect(actions.hooks.handsFree.getSnapshot()).toBe(true)
  b.fake.snapshots.set({ ...b.fake.snapshots.getSnapshot(), device: { id: 'usb', label: 'USB microphone' }, level: 0.4 })
  await vi.waitFor(() => { expect(actions.hooks.voiceSnapshot.getSnapshot().level).toBe(0.4) })
  expect(actions.hooks.microphoneDevice.getSnapshot()).toEqual({ id: 'usb', label: 'USB microphone' })
  await vi.waitFor(() => { expect(actions.hooks.speechReadiness.getSnapshot().connected).toBe(true) })
  actions.openSettings()
  expect(b.openBundle).toHaveBeenCalledWith('@deepseek-ai/dsh-experimental-voice-input-bundle')
  actions.selectMicrophone({ id: 'usb', label: 'USB microphone' })
  expect(b.fake.calls.setDevice).toHaveBeenCalledWith({ id: 'usb', label: 'USB microphone' })
  expect(actions.captureSnapshot()).toMatchObject({ level: 0.4, device: { id: 'usb' } })
  const changes = vi.fn()
  const unsubscribe = actions.hooks.microphoneDevice.subscribe(changes)
  b.fake.snapshots.set({ ...b.fake.snapshots.getSnapshot(), device: { id: 'internal', label: 'Built-in' } })
  await vi.waitFor(() => { expect(changes).toHaveBeenCalled() })
  expect(actions.hooks.microphoneDevice.getSnapshot()).toEqual({ id: 'internal', label: 'Built-in' })
  unsubscribe()
  await actions.begin()
  await actions.finish()
  await actions.cancel()
  expect(b.fake.calls.begin).toHaveBeenCalledOnce()
  expect(b.fake.calls.finish).toHaveBeenCalledOnce()
  expect(b.fake.calls.cancel).toHaveBeenCalledOnce()
  const signal = new AbortController().signal
  await actions.previewMicrophone({ id: '', label: '' }, () => {}, signal)
  expect(b.fake.calls.preview).toHaveBeenCalledWith({ id: '', label: '' }, expect.any(Function), signal)
  await actions.configure({ language: 'zh' })
  await actions.prepare(PROVIDER, { downloadSource: 'https://hf-mirror.com' })
  await actions.cancelPreparation(PROVIDER)
  expect(b.fake.calls.configure).toHaveBeenCalledWith({ language: 'zh' })
  expect(b.fake.calls.prepare).toHaveBeenCalledWith(PROVIDER, { downloadSource: 'https://hf-mirror.com' })
  expect(b.fake.calls.cancelPreparation).toHaveBeenCalledWith(PROVIDER)
  for (const slot of ['plugins.bundle.config', 'plugins.bundle.activation'] as const) {
    const item = b.ctx.slots.entries(slot)[0]!
    expect(item.locale).toBe('voice-input')
    expect(item.inject!().hooks).toBe(actions.hooks)
  }
  await fiber.dispose()
  expect(b.ctx.slots.entries('conversation.input.activity')).toHaveLength(0)
  expect(b.ctx.slots.entries('plugins.bundle.activation')).toHaveLength(0)
  expect(b.ctx.slots.entries('plugins.bundle.config')).toHaveLength(0)
  expect(b.ctx.get('voiceCapture')).toBeDefined()
  expect(b.fake.calls.cancel).toHaveBeenCalledOnce()
})

it('starts without the Plugins page navigation and follows its presence', async () => {
  const b = await fixture(false)
  const fiber = b.ctx.plugin({ inject: [...inject], apply: mountVoiceInput })
  await fiber
  const entry = b.ctx.slots.entries('conversation.input.activity').find(item => item.component === VoiceInput)!
  const actions = entry.inject!()
  assertVoiceActions(actions)
  expect(actions.hooks.pluginNavigation.getSnapshot()).toBe(false)
  expect(() => { actions.openSettings() }).not.toThrow()
  const navigation = b.ctx.plugin({ apply: (ctx: Context) => { ctx.provide('pluginNavigation', { openBundle: b.openBundle } as never) } })
  await navigation
  await vi.waitFor(() => { expect(actions.hooks.pluginNavigation.getSnapshot()).toBe(true) })
  actions.openSettings()
  expect(b.openBundle).toHaveBeenCalledWith('@deepseek-ai/dsh-experimental-voice-input-bundle')
  await navigation.dispose()
  expect(actions.hooks.pluginNavigation.getSnapshot()).toBe(false)
  await fiber.dispose()
})

it('reports an unexpected snapshot observation failure', async () => {
  const b = await fixture()
  b.fake.capture.follow = vi.fn(async function* () { throw new Error('broken observer') })
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const fiber = b.ctx.plugin({ inject: [...inject], apply: mountVoiceInput })
    await fiber
    await vi.waitFor(() => { expect(report).toHaveBeenCalledWith('voice input: capture observation failed', expect.any(Error)) })
    await fiber.dispose()
  } finally { report.mockRestore() }
})
