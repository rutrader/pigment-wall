import { EMPTY_USAGE, addUsage, type DayTotals, type Record_ } from './types.ts'

/**
 * SPEC §4: a Pigment day runs from `boundaryHour` to `boundaryHour - 1:59`.
 *
 * With the default 04:00, a session that starts at 23:00 and ends at 01:30 is
 * one day, not two — which matters because 27% of this user's output lands in
 * exactly that window.
 */

const HOUR_MS = 3_600_000

/**
 * The `YYYY-MM-DD` a moment belongs to.
 *
 * Implemented by shifting local wall-clock back by `boundaryHour` and taking
 * the calendar date of the result: 03:59 shifts into the previous day, 04:00
 * stays put. Date arithmetic is done on local components rather than epoch
 * offsets so a DST jump moves the boundary with the clock instead of leaving it
 * an hour adrift — and with 03:00–07:00 empty in the data, a DST-shifted
 * boundary lands in dead time either way.
 */
export function dayKey(at: number, boundaryHour: number): string {
  const d = new Date(at)
  d.setHours(d.getHours() - boundaryHour)
  const year = d.getFullYear()
  const month = `${d.getMonth() + 1}`.padStart(2, '0')
  const dayOfMonth = `${d.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${dayOfMonth}`
}

/** Epoch ms at which the given day key begins. The inverse of `dayKey`. */
export function dayStart(key: string, boundaryHour: number): number {
  const [year, month, dayOfMonth] = key.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, dayOfMonth ?? 1, boundaryHour, 0, 0, 0).getTime()
}

/** Every day key from `from` to `to` inclusive, including the idle ones. */
export function dayRange(from: string, to: string, boundaryHour: number): string[] {
  const keys: string[] = []
  const end = dayStart(to, boundaryHour)
  for (let at = dayStart(from, boundaryHour); at <= end; ) {
    keys.push(dayKey(at, boundaryHour))
    // Step by 25h then re-normalise, so a 23-hour DST day cannot be skipped and
    // a 25-hour one cannot be emitted twice.
    const next = new Date(at)
    next.setDate(next.getDate() + 1)
    at = next.getTime()
  }
  return keys
}

/**
 * How a day should be labelled on screen, given the wall clock.
 *
 * Between midnight and the boundary hour the calendar says one date and the
 * Pigment day is still the previous one. That is the whole point of §4 — a
 * night session stays one picture — but a popover that just says "today" with
 * no date looks stale rather than deliberate, which is precisely how it was
 * first reported.
 */
export function dayLabel(key: string, boundaryHour: number, now: number = Date.now()): string {
  const [year, month, dayOfMonth] = key.split('-').map(Number)
  const date = new Date(year ?? 1970, (month ?? 1) - 1, dayOfMonth ?? 1)
  const label = date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

  const clock = new Date(now)
  const sameCalendarDay =
    clock.getFullYear() === date.getFullYear() &&
    clock.getMonth() === date.getMonth() &&
    clock.getDate() === date.getDate()

  if (sameCalendarDay) return label
  return `${label} · until ${String(boundaryHour).padStart(2, '0')}:00`
}

export function emptyDay(key: string): DayTotals {
  return {
    key,
    output: 0,
    usage: EMPTY_USAGE,
    messages: 0,
    peakHourOutput: 0,
    firstAt: null,
    lastAt: null,
  }
}

/**
 * Accumulates records into per-day totals, deduplicating by response id.
 *
 * Dedup is not optional: the corpus contains genuinely duplicated records
 * across files, and without it every total inflates (SPEC §8). The `seen` set
 * is passed in so a caller streaming several files shares one identity space.
 */
export function accumulate(
  records: Iterable<Record_>,
  boundaryHour: number,
  into: Map<string, DayTotals> = new Map(),
  seen: Set<string> = new Set(),
): Map<string, DayTotals> {
  // Peak-hour needs each day's messages in time order, but records arrive
  // file-by-file. Collect timings first, compute the rolling maximum after.
  const timings = new Map<string, Array<[number, number]>>()

  for (const record of records) {
    if (seen.has(record.id)) continue
    seen.add(record.id)

    const key = dayKey(record.at, boundaryHour)
    const totals = into.get(key) ?? emptyDay(key)

    totals.output += record.usage.output
    totals.usage = addUsage(totals.usage, record.usage)
    totals.messages += 1
    totals.firstAt = totals.firstAt === null ? record.at : Math.min(totals.firstAt, record.at)
    totals.lastAt = totals.lastAt === null ? record.at : Math.max(totals.lastAt, record.at)

    into.set(key, totals)

    const list = timings.get(key)
    if (list) list.push([record.at, record.usage.output])
    else timings.set(key, [[record.at, record.usage.output]])
  }

  for (const [key, list] of timings) {
    const totals = into.get(key)
    if (totals) totals.peakHourOutput = Math.max(totals.peakHourOutput, peakHour(list))
  }

  return into
}

/**
 * Highest output-token count in any rolling 60-minute window.
 *
 * This is the roast trigger (SPEC §7), chosen because rate is the genuinely
 * surprising quantity and — unlike a daily total — cannot be reached by
 * grinding all day. Two pointers, so a 900-message day is still linear.
 */
export function peakHour(events: Array<[number, number]>): number {
  const sorted = [...events].sort((a, b) => a[0] - b[0])
  let best = 0
  let running = 0
  let tail = 0

  for (let head = 0; head < sorted.length; head++) {
    running += sorted[head]![1]
    while (sorted[head]![0] - sorted[tail]![0] > HOUR_MS) {
      running -= sorted[tail]![1]
      tail++
    }
    if (running > best) best = running
  }

  return best
}
