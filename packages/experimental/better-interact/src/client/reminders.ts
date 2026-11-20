/**
 * Attention reminders the orb speaks: the pending Session interactions that wait
 * for the user (an approval, a question, or a plan review), collapsed into the
 * single item the comic speech balloon shows.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Kind of one reminder, narrowed from a pending interaction's domain discriminator. */
export type ReminderKind = 'approval' | 'question' | 'plan-review' | 'other'

/**
 * Fields a reminder reads from one pending interaction. The domains that publish
 * interactions carry their own richer objects; this projection keeps the
 * reminder independent of them.
 */
export interface ReminderInteraction {
  /** Opaque request identity. */
  readonly key: string
  /** Domain presentation discriminator. */
  readonly kind: string
  /** Session whose UI can answer the request. */
  readonly sessionId: SessionId
  /** Tool requesting a decision, on approvals. */
  readonly toolName?: string
  /** Question batch, on questions and plan reviews. */
  readonly questions?: readonly { readonly question: string }[]
}

/** The interaction the balloon speaks about. */
export interface OrbReminder {
  /** Session whose conversation holds the request. */
  readonly sessionId: SessionId
  /** Narrowed kind of the chosen interaction. */
  readonly kind: ReminderKind
  /** Tool asking for an approval, or the first question's text; absent otherwise. */
  readonly detail: string | undefined
  /** Further pending interactions this balloon does not show. */
  readonly others: number
}

/** Copy keys the balloon's sentence uses. */
export type ReminderMessageKey = 'reminder.approval' | 'reminder.question' | 'reminder.planReview' | 'reminder.pending'

/**
 * Translate one reminder sentence.
 * @param key - copy key selected for the reminder.
 * @param params - sentence placeholders.
 * @returns the localized sentence.
 */
export type ReminderTranslate = (key: ReminderMessageKey, params: Record<string, unknown>) => string

/** Decision order: a permission request first, then a plan review, then a question. */
const PRIORITY: Readonly<Record<ReminderKind, number>> = { approval: 0, 'plan-review': 1, question: 2, other: 3 }

/**
 * Narrow a pending interaction's discriminator to a reminder kind.
 * @param interaction - projected pending interaction.
 * @returns the known kind, or `other` for a domain this balloon does not know.
 */
function reminderKind(interaction: ReminderInteraction): ReminderKind {
  return interaction.kind === 'approval' || interaction.kind === 'plan-review' || interaction.kind === 'question'
    ? interaction.kind
    : 'other'
}

/**
 * Read the sentence detail of one reminder kind.
 * @param interaction - projected pending interaction.
 * @param kind - narrowed reminder kind.
 * @returns the tool name for an approval, the first question's text for a question, otherwise undefined.
 */
function reminderDetail(interaction: ReminderInteraction, kind: ReminderKind): string | undefined {
  if (kind === 'approval') return interaction.toolName
  if (kind === 'question' || kind === 'plan-review') return interaction.questions?.[0]?.question
  return undefined
}

/**
 * Pick the pending interaction the balloon should speak about. Ties keep a
 * stable order by request key so the same map always yields the same reminder.
 * @param pending - pending interactions keyed by Session.
 * @returns the highest-priority interaction and the count of the rest, or undefined while nothing waits.
 */
export function orbReminder(pending: ReadonlyMap<SessionId, ReminderInteraction>): OrbReminder | undefined {
  let best: { readonly interaction: ReminderInteraction; readonly kind: ReminderKind } | undefined
  for (const interaction of pending.values()) {
    const kind = reminderKind(interaction)
    if (best === undefined || PRIORITY[kind] < PRIORITY[best.kind]
      || (PRIORITY[kind] === PRIORITY[best.kind] && interaction.key < best.interaction.key)) {
      best = { interaction, kind }
    }
  }
  if (best === undefined) return undefined
  return {
    sessionId: best.interaction.sessionId,
    kind: best.kind,
    detail: reminderDetail(best.interaction, best.kind),
    others: pending.size - 1,
  }
}

/**
 * Compose the balloon's sentence for one reminder.
 * @param reminder - reminder to speak.
 * @param title - display title of its Session.
 * @param t - bound locale translator.
 * @returns the localized sentence.
 */
export function reminderMessage(reminder: OrbReminder, title: string, t: ReminderTranslate): string {
  if (reminder.kind === 'approval' && reminder.detail !== undefined) {
    return t('reminder.approval', { title, tool: reminder.detail })
  }
  if (reminder.kind === 'question' && reminder.detail !== undefined) {
    return t('reminder.question', { title, question: reminder.detail })
  }
  if (reminder.kind === 'plan-review') return t('reminder.planReview', { title })
  return t('reminder.pending', { title })
}
