/**
 * The only shapes that cross module boundaries.
 *
 * SPEC §8: a Usage carries token counts and nothing else. There is deliberately
 * no field on any type here that could hold a byte of transcript content — the
 * parser extracts four numbers and a timestamp, and the type system is the
 * first place that rule is enforced.
 */

/** One assistant response's token usage. Priced by `cost.ts`, summed by `day.ts`. */
export type Usage = {
  input: number
  output: number
  /** Cache writes at the 5-minute TTL — 1.25× input rate. */
  cacheWrite5m: number
  /** Cache writes at the 1-hour TTL — 2× input rate. */
  cacheWrite1h: number
  cacheRead: number
}

/**
 * One assistant message, reduced to what Pigment needs.
 *
 * `id` exists solely for dedup: the corpus contains genuinely duplicated
 * records across files, and without dedup every total inflates (SPEC §8).
 */
export type Record_ = {
  id: string
  /** Epoch ms, from the log's own `timestamp` — never file mtime (SPEC §8). */
  at: number
  usage: Usage
}

/** A day's accumulated totals. `key` is `YYYY-MM-DD` at the configured boundary. */
export type DayTotals = {
  key: string
  output: number
  usage: Usage
  messages: number
  /** Highest output tokens in any rolling 60-minute window. Roast trigger (SPEC §7). */
  peakHourOutput: number
  /** Epoch ms of the first and last message. Null on an idle day. */
  firstAt: number | null
  lastAt: number | null
}

/** A day as it appears on the wall: totals plus what the controller made of them. */
export type Day = {
  key: string
  totals: DayTotals
  /** The target this day was judged against. */
  target: number
  /** tokens / target, clamped to [0, OVERFILL_CAP]. Past 1 the image overexposes. */
  fill: number
  idle: boolean
  tier: number
  imageId: string
  costCents: number
  /** The controller's target *after* this day was folded in — the replay anchor. */
  targetAfter: number
}

export const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    cacheRead: a.cacheRead + b.cacheRead,
  }
}
