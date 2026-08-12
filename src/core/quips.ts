import { formatCents } from './cost.ts'
import type { Event, EventKind } from './events.ts'
import { hash } from './tiers.ts'

/**
 * The sharp tongue. SPEC §7.
 *
 * Tone was settled during design: sharp, not warm — commentary that lands after
 * the behaviour rather than a carrot dangled before it. Nothing in here
 * congratulates you for burning tokens, because the moment it does the app is a
 * slot machine.
 *
 * Six conditions, four lines each. That ratio matters more than it looks: six
 * lines on one condition is dead content inside a fortnight, whereas twenty
 * lines across five conditions plus the thirty-day repeat filter keeps the
 * surface alive for a couple of months. When it does go stale, adding lines here
 * is the entire fix.
 *
 * Placeholders are filled from `Event.facts`:
 *   {cost} {tokens} {rate} {percent} {target} {away} {time} {best}
 */
export const QUIPS: Record<EventKind, string[]> = {
  first: [
    'A new record: {rate} in an hour, beating {best}. Nobody is keeping score. Except this.',
    'Your biggest ever. {tokens} tokens, {cost}. The previous best was {best}.',
    'That is an all-time high. The bar you just set is the one you will be measured against.',
    'Record broken — {best} was the number to beat. It is not any more.',
  ],
  rate: [
    '{rate} tokens in one hour. Whatever that was, it is over now.',
    'Peak hour: {rate}. That is {cost} of thinking you will read once.',
    'You just had your fastest hour in weeks. Hope the tests pass.',
    '{rate} tokens/hour. The model is keeping up. Are you?',
  ],
  comeback: [
    '{away} days away and straight back to {tokens} tokens. No easing in, then.',
    'Welcome back. The bar did not move while you were gone — {target}.',
    '{away} days of nothing, and today you spent {cost} before stopping.',
    'The gap is on the wall for good now. Worth it, presumably.',
  ],
  late: [
    'Still going at {time}. The picture finished hours ago.',
    '{time}, and {cost} deep. Nothing good is written at {time}.',
    'That is a {time} finish. Tomorrow is going to be great.',
    'You and the model, {time}. Very romantic.',
  ],
  blown: [
    '{percent} of target. The picture ran out of colours to give you.',
    'Overexposed at {percent}. That is {cost} past the point of the exercise.',
    '{tokens} against a target of {target}. The bar is going up, you know.',
    'The image is blown out. It cannot go any brighter; you can.',
  ],
  dead: [
    'Nothing today. The picture stays grey, which is honest.',
    'Not a token. The bar will drop tomorrow — it always does.',
    'A blank day. They are allowed.',
    'Zero. The wall records it without comment.',
  ],
}

export type Fired = {
  key: string
  kind: EventKind
  /** Index into the pool, so a reworded line does not count as already seen. */
  slot: number
}

/** Days a line must sit out before it can be used again. */
export const COOLDOWN_DAYS = 30

/**
 * Picks a line for an event.
 *
 * Deterministic in the day, so recomputing a day yields the same words — the
 * wall must not quietly rewrite its own history. Lines used within the cooldown
 * are skipped; if every line in a pool is on cooldown — which happens whenever a
 * condition fires more often than its pool has lines — the stalest is reused,
 * because a stale joke beats no joke.
 */
export function pickQuip(event: Event, history: Fired[], dayNumber: number): { text: string; slot: number } {
  const pool = QUIPS[event.kind]
  const recent = new Set(
    history
      .filter((fired) => fired.kind === event.kind && dayNumber - dayIndexOf(fired.key) < COOLDOWN_DAYS)
      .map((fired) => fired.slot),
  )

  const fresh = pool.map((_, index) => index).filter((index) => !recent.has(index))
  if (fresh.length > 0) {
    const slot = fresh[hash(`${event.key}/${event.kind}`) % fresh.length]!
    return { text: fill(pool[slot]!, event), slot }
  }

  // Every line is on cooldown — which happens whenever a condition fires more
  // often than its pool has lines. Reach for the STALEST rather than hashing
  // again: hashing can land on the line used two days ago while one from three
  // weeks back sits unused, which is the most conspicuous possible repeat.
  const lastUsed = new Map<number, number>()
  for (const fired of history) {
    if (fired.kind !== event.kind) continue
    lastUsed.set(fired.slot, Math.max(lastUsed.get(fired.slot) ?? -Infinity, dayIndexOf(fired.key)))
  }

  let slot = 0
  let oldest = Infinity
  for (let index = 0; index < pool.length; index++) {
    const used = lastUsed.get(index) ?? -Infinity
    if (used < oldest) {
      oldest = used
      slot = index
    }
  }

  return { text: fill(pool[slot]!, event), slot }
}

function fill(template: string, event: Event): string {
  const { facts } = event
  return template
    .replaceAll('{cost}', formatCents(facts.costCents))
    .replaceAll('{tokens}', facts.output.toLocaleString())
    .replaceAll('{rate}', facts.peakHour.toLocaleString())
    .replaceAll('{percent}', `${Math.round(facts.fill * 100)}%`)
    .replaceAll('{target}', facts.target.toLocaleString())
    .replaceAll('{away}', String(facts.away))
    .replaceAll('{time}', facts.endedAt === null ? 'some hour' : `${String(facts.endedAt).padStart(2, '0')}:00`)
    .replaceAll('{best}', facts.previousBest.toLocaleString())
}

function dayIndexOf(key: string): number {
  const [year, month, dayOfMonth] = key.split('-').map(Number)
  return Math.floor(Date.UTC(year ?? 1970, (month ?? 1) - 1, dayOfMonth ?? 1) / 86_400_000)
}
