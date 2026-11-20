// @vitest-environment node
/** The orb's reminder derivation chooses one pending request and words it. */
import { expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { orbReminder, reminderMessage, type ReminderInteraction, type ReminderTranslate } from '../src/client/reminders.ts'

const sid = (value: string) => value as SessionId

/** One approval request. */
function approval(session: string, toolName = 'bash'): ReminderInteraction {
  return { key: `approval:${session}`, kind: 'approval', sessionId: sid(session), toolName }
}

/** One question request. */
function question(session: string, text = 'Continue?'): ReminderInteraction {
  return { key: `question:${session}`, kind: 'question', sessionId: sid(session), questions: [{ question: text }] }
}

/** One plan review request. */
function planReview(session: string): ReminderInteraction {
  return {
    key: `question:plan:${session}`, kind: 'plan-review', sessionId: sid(session), questions: [{ question: 'Review the plan?' }],
  }
}

/** One interaction of a domain the balloon does not know. */
function background(session: string): ReminderInteraction {
  return { key: `background:${session}`, kind: 'background', sessionId: sid(session) }
}

/** Translate to a stable form that shows every placeholder it received. */
const t: ReminderTranslate = (key, params) => {
  const parts = [key, typeof params.title === 'string' ? params.title : '']
  if (typeof params.tool === 'string') parts.push(params.tool)
  if (typeof params.question === 'string') parts.push(params.question)
  return parts.join('|')
}

it('finds no reminder while nothing waits', () => {
  expect(orbReminder(new Map())).toBeUndefined()
})

it('prefers an approval and counts the rest of the pending requests', () => {
  const pending = new Map<SessionId, ReminderInteraction>([
    [sid('s1'), question('s1')],
    [sid('s2'), approval('s2', 'write')],
    [sid('s3'), planReview('s3')],
  ])
  expect(orbReminder(pending)).toEqual({
    sessionId: sid('s2'), kind: 'approval', detail: 'write', others: 2,
  })
})

it('ranks a plan review above a question', () => {
  const pending = new Map<SessionId, ReminderInteraction>([
    [sid('s1'), question('s1')],
    [sid('s2'), planReview('s2')],
  ])
  expect(orbReminder(pending)).toEqual({
    sessionId: sid('s2'), kind: 'plan-review', detail: 'Review the plan?', others: 1,
  })
})

it('reports an unknown domain as a generic request without detail', () => {
  const pending = new Map<SessionId, ReminderInteraction>([[sid('s1'), background('s1')]])
  expect(orbReminder(pending)).toEqual({ sessionId: sid('s1'), kind: 'other', detail: undefined, others: 0 })
})

it('keeps a stable choice between equal-priority requests', () => {
  const pending = new Map<SessionId, ReminderInteraction>([
    [sid('s2'), { ...approval('s2'), key: 'approval:9' }],
    [sid('s1'), { ...approval('s1'), key: 'approval:1' }],
  ])
  expect(orbReminder(pending)?.sessionId).toBe(sid('s1'))
})

it('words an approval, a question, a plan review, and a generic request', () => {
  expect(reminderMessage({ sessionId: sid('s1'), kind: 'approval', detail: 'bash', others: 0 }, 'Alpha', t))
    .toBe('reminder.approval|Alpha|bash')
  expect(reminderMessage({ sessionId: sid('s1'), kind: 'question', detail: 'Continue?', others: 0 }, 'Alpha', t))
    .toBe('reminder.question|Alpha|Continue?')
  expect(reminderMessage({ sessionId: sid('s1'), kind: 'plan-review', detail: 'Review the plan?', others: 0 }, 'Alpha', t))
    .toBe('reminder.planReview|Alpha')
  expect(reminderMessage({ sessionId: sid('s1'), kind: 'other', detail: undefined, others: 0 }, 'Alpha', t))
    .toBe('reminder.pending|Alpha')
})

it('falls back to the generic sentence when the domain detail is absent', () => {
  expect(reminderMessage({ sessionId: sid('s1'), kind: 'approval', detail: undefined, others: 0 }, 'Alpha', t))
    .toBe('reminder.pending|Alpha')
  expect(reminderMessage({ sessionId: sid('s1'), kind: 'question', detail: undefined, others: 0 }, 'Alpha', t))
    .toBe('reminder.pending|Alpha')
})
