import type { Config } from './config.ts'
import { clamp, fillOf, seed, step } from './controller.ts'
import { costCents } from './cost.ts'
import { dayKey, dayRange, emptyDay } from './day.ts'
import { BASELINE_DAYS, baselineOf, imageFor, tierFor } from './tiers.ts'
import type { Store } from './store.ts'
import type { Day, DayTotals } from './types.ts'

/**
 * Turns raw day totals into the wall: runs the controller, assigns tiers and
 * images, and decides what gets sealed.
 *
 * The seam this module manages is SPEC §9's whole point — sealed days are
 * authoritative and never recomputed, recent days are always re-derived. Each
 * of the three alternatives fails a real case:
 *
 *   - Always recompute → dies when Claude Code rotates its logs.
 *   - Seal at the boundary and never look back → dies because the Mac is asleep
 *     at 04:00 most nights, and because a session resumed the next morning
 *     writes messages stamped yesterday (39 of 179 files were appended more
 *     than a day after creation).
 *   - A 48-hour recompute window survives both.
 */

export type Wall = {
  days: Day[]
  /** Controller state after the last day. What tomorrow will be judged against. */
  target: number
  /** Days at or after this key are live; everything before it is sealed. */
  sealedThrough: string | null
}

export type BuildInput = {
  totals: Map<string, DayTotals>
  store: Store
  config: Config
  now: number
  /**
   * How many drawings exist per tier.
   *
   * Per-tier, not one number: the pools drift apart the moment a drawing is
   * added to one tier, and a global count silently makes the extra art
   * unreachable — `hash % 4` never yields slot 4.
   */
  pools: Record<number, number>
}

/**
 * Builds the wall from sealed history plus freshly-computed recent days.
 *
 * Sealed days are taken verbatim. The controller chain resumes from the last
 * sealed day's `targetAfter`, so a seal is a genuine checkpoint rather than a
 * cache that could disagree with a replay.
 */
export function buildWall(input: BuildInput): Wall {
  const { totals, store, config, now, pools } = input

  const cutoffKey = dayKey(now - config.recomputeHours * 3_600_000, config.boundaryHour)
  const windowStartKey = dayKey(now - config.windowDays * 86_400_000, config.boundaryHour)
  const todayKey = dayKey(now, config.boundaryHour)

  // Sealed days inside the window, in order. Anything at or after the cutoff is
  // discarded and recomputed: it is still inside the live window.
  const sealed = store.days
    .filter((day) => day.key >= windowStartKey && day.key < cutoffKey)
    .sort((a, b) => a.key.localeCompare(b.key))

  const days: Day[] = [...sealed]
  const last = sealed[sealed.length - 1]

  // Where the live stretch starts, and what target it starts from.
  let target: number
  let from: string
  if (last) {
    target = clamp(last.targetAfter, config)
    from = nextKey(last.key, config.boundaryHour)
  } else {
    // No sealed history: this is a cold start, so seed from the user's own
    // history (SPEC §10) rather than an arbitrary constant.
    //
    // Today is excluded, and that exclusion is load-bearing. Today is still
    // being written; including it means the seed tracks the very number it is
    // meant to judge, so the target equals today's output and the first day is
    // pinned at exactly 100% no matter what happens. You cannot calibrate
    // against a day that has not finished.
    const active = [...totals.entries()]
      .filter(([key, totals]) => key !== todayKey && totals.output >= config.idleFloor)
      .map(([, totals]) => totals.output)
    target = seed(active, config)
    from = earliestKey(totals, windowStartKey)
  }

  // Tiers are relative to the trailing target level (tiers.ts), so the baseline
  // walks forward with the wall. Sealed days contribute their own targets, which
  // is why the seam does not produce a tier discontinuity on the first live day.
  const targetHistory = sealed.map((day) => day.target)

  for (const key of dayRange(from, todayKey, config.boundaryHour)) {
    const dayTotals = totals.get(key) ?? emptyDay(key)
    const idle = dayTotals.output < config.idleFloor

    const tier = tierFor(target, baselineOf(targetHistory.slice(-BASELINE_DAYS)))
    targetHistory.push(target)
    const day: Day = {
      key,
      totals: dayTotals,
      target,
      fill: fillOf(dayTotals.output, target, config),
      idle,
      tier: tier.index,
      imageId: imageFor(key, tier, pools[tier.index] ?? 1),
      costCents: costCents(dayTotals.usage),
      // An idle day freezes the controller: absence is not evidence about
      // capacity, it is absence of evidence (SPEC §4).
      targetAfter: idle ? target : step(target, dayTotals.output, config),
    }

    days.push(day)
    target = day.targetAfter
  }

  return {
    days,
    target,
    sealedThrough: last ? last.key : null,
  }
}

/**
 * The days a wall should persist: everything older than the recompute window.
 *
 * Called after `buildWall`, so what gets sealed is exactly what was just
 * derived — there is no second code path that could seal a different number.
 */
export function toSeal(wall: Wall, config: Config, now: number): Day[] {
  const cutoffKey = dayKey(now - config.recomputeHours * 3_600_000, config.boundaryHour)
  return wall.days.filter((day) => day.key < cutoffKey)
}

/** Merges freshly-sealed days into the store, newest write winning per key. */
export function seal(store: Store, days: Day[], config: Config, now: number): Store {
  const byKey = new Map<string, Day>()
  for (const day of store.days) byKey.set(day.key, day)
  for (const day of days) byKey.set(day.key, day)

  const windowStartKey = dayKey(now - config.windowDays * 86_400_000, config.boundaryHour)
  return {
    ...store,
    days: [...byKey.values()]
      .filter((day) => day.key >= windowStartKey)
      .sort((a, b) => a.key.localeCompare(b.key)),
  }
}

function nextKey(key: string, boundaryHour: number): string {
  const [year, month, dayOfMonth] = key.split('-').map(Number)
  const date = new Date(year ?? 1970, (month ?? 1) - 1, dayOfMonth ?? 1, boundaryHour)
  date.setDate(date.getDate() + 1)
  return dayKey(date.getTime(), boundaryHour)
}

function earliestKey(totals: Map<string, DayTotals>, floor: string): string {
  let earliest: string | null = null
  for (const key of totals.keys()) {
    if (key < floor) continue
    if (earliest === null || key < earliest) earliest = key
  }
  return earliest ?? floor
}
