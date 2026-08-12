import type { Config } from './config.ts'
import { quantile } from './controller.ts'
import type { Day } from './types.ts'

/**
 * What happened today that is worth saying something about. SPEC §7.
 *
 * Five conditions, and the split between which of them may interrupt you is the
 * whole design. Measured against 34 real days:
 *
 *   first     n firings   the biggest day or fastest hour on record fell
 *   rate      4 firings   peak-hour output crossed the user's own p90
 *   late      2 firings   the session ran past 01:00
 *   comeback  0 firings   first day back after three or more away
 *   dead      4 firings   nothing happened
 *   blown     9 firings   the day went past 2x its target
 *
 * `blown` fires on 30% of active days — that is noise, not surprise, and it is
 * already said in paint by the bloom and the tray ring. `dead` would be the app
 * poking you for not working, which contradicts §1 directly: it does not scold
 * you for resting. Both stay in the popover, where you go looking for them.
 *
 * That leaves rate, comeback and late as interruptible: six firings in 34 days,
 * about one or two a week, which is rare enough to still land.
 */

export type EventKind = 'first' | 'rate' | 'comeback' | 'late' | 'dead' | 'blown'

export type Event = {
  kind: EventKind
  key: string
  /** May raise a notification, subject to the daily cap and the preference. */
  notify: boolean
  /** Values the copy interpolates. Never anything but numbers and times. */
  facts: {
    output: number
    target: number
    fill: number
    peakHour: number
    costCents: number
    /** Consecutive idle days immediately before this one. */
    away: number
    /** Local hour the day's last message landed, or null on an idle day. */
    endedAt: number | null
    /** Which record fell, if any. */
    record: 'day' | 'hour' | 'both' | null
    /** The figure that was beaten — the old best of whichever record fell. */
    previousBest: number
  }
}

/** Kinds allowed to interrupt. The rest wait until the popover is opened. */
export const INTERRUPTS: ReadonlySet<EventKind> = new Set<EventKind>(['first', 'rate', 'comeback', 'late'])

/**
 * Peak-hour percentile that counts as a surprising rate.
 *
 * Calibrated per person from their own history, exactly like the controller —
 * an absolute tokens-per-hour threshold would fire constantly for one user and
 * never for another.
 */
const RATE_QUANTILE = 0.9

/**
 * Fewest prior active days before the rate trigger is trusted.
 *
 * With three days of history the p90 is whatever the best of three was, so the
 * app would announce a "record hour" in week one and then never again.
 */
const RATE_MIN_SAMPLE = 8

/**
 * Fewest prior active days before a record counts.
 *
 * Without it, day two is an all-time best and so is day three. A record is only
 * interesting once there is a body of work to beat — the same reason the rate
 * threshold waits for a sample.
 */
const RECORD_MIN_SAMPLE = 8

/** A session that ran into these hours was a late one. */
const LATE_FROM = 1
const LATE_TO = 4

/** Consecutive idle days that make returning worth remarking on. */
const COMEBACK_DAYS = 3

/** Overshoot at which the picture is visibly blown out. */
const BLOWN_AT = 2

/**
 * Events for every day on the wall.
 *
 * Thresholds look only at days BEFORE the one being judged. Including today
 * would let a record hour raise the bar it is being measured against — the same
 * self-reference that made the cold-start seed pin the first day at 100%.
 */
export function detect(days: Day[], _config: Config): Map<string, Event[]> {
  const found = new Map<string, Event[]>()
  const priorPeaks: number[] = []
  const priorOutputs: number[] = []
  let idleRun = 0

  for (const day of days) {
    const events: Event[] = []
    const facts: Event['facts'] = {
      output: day.totals.output,
      target: Math.round(day.target),
      fill: day.fill,
      peakHour: day.totals.peakHourOutput,
      costCents: day.costCents,
      away: idleRun,
      endedAt: day.totals.lastAt === null ? null : new Date(day.totals.lastAt).getHours(),
      record: null,
      previousBest: 0,
    }

    if (day.idle) {
      idleRun++
      events.push({ kind: 'dead', key: day.key, notify: false, facts })
    } else {
      // A record: the biggest day ever, or the fastest hour ever, whichever
      // fell. No arbitrary milestone to cross — it calibrates itself against
      // your own history exactly as the controller and the rate trigger do, so
      // it stays rare however much your volume changes.
      if (priorOutputs.length >= RECORD_MIN_SAMPLE) {
        const bestDay = Math.max(...priorOutputs)
        const bestHour = Math.max(...priorPeaks)
        const beatDay = day.totals.output > bestDay
        const beatHour = day.totals.peakHourOutput > bestHour

        if (beatDay || beatHour) {
          facts.record = beatDay && beatHour ? 'both' : beatDay ? 'day' : 'hour'
          facts.previousBest = beatDay ? bestDay : bestHour
          events.push({ kind: 'first', key: day.key, notify: true, facts })
        }
      }

      if (idleRun >= COMEBACK_DAYS) {
        events.push({ kind: 'comeback', key: day.key, notify: true, facts })
      }
      idleRun = 0

      if (
        priorPeaks.length >= RATE_MIN_SAMPLE &&
        day.totals.peakHourOutput >= quantile(priorPeaks, RATE_QUANTILE)
      ) {
        events.push({ kind: 'rate', key: day.key, notify: true, facts })
      }

      if (facts.endedAt !== null && facts.endedAt >= LATE_FROM && facts.endedAt < LATE_TO) {
        events.push({ kind: 'late', key: day.key, notify: true, facts })
      }

      if (day.fill >= BLOWN_AT) {
        events.push({ kind: 'blown', key: day.key, notify: false, facts })
      }

      priorPeaks.push(day.totals.peakHourOutput)
      priorOutputs.push(day.totals.output)
    }

    if (events.length > 0) found.set(day.key, events)
  }

  return found
}

/**
 * The one event a day leads with.
 *
 * Ranked by how unusual the condition is rather than how loud it is: a record is
 * rarer than a comeback, which is rarer than a fast hour, which is rarer than a
 * late finish. Only one line is ever shown, so the ordering is the editorial
 * decision.
 */
const RANK: EventKind[] = ['first', 'comeback', 'rate', 'late', 'blown', 'dead']

export function headline(events: Event[]): Event | null {
  for (const kind of RANK) {
    const match = events.find((event) => event.kind === kind)
    if (match) return match
  }
  return null
}

/** The headline event, if it is one that may interrupt. */
export function interrupting(events: Event[]): Event | null {
  const ranked = RANK.filter((kind) => INTERRUPTS.has(kind))
  for (const kind of ranked) {
    const match = events.find((event) => event.kind === kind)
    if (match) return match
  }
  return null
}
