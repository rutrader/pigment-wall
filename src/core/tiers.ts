/**
 * SPEC §5: complexity is not difficulty.
 *
 * Fill is tokens ÷ target, so the target alone decides how hard a day is —
 * adding pixels changes only how finely the fill is chopped up. Tiers exist for
 * exactly one reason: to make the controller's state VISIBLE. After a heavy
 * week the picture is noticeably busier, and the raised bar announces itself
 * through the art instead of hiding in a float.
 *
 * Three tiers, not five. With twelve drawings, five tiers gives 2–3 each —
 * repeats every ~10 days and a difference between adjacent tiers nobody can
 * see. Three gives four apiece and unmistakable jumps.
 *
 * AMENDMENT to the spec's first draft, forced by replaying real history: the
 * tier bands were originally absolute token counts (<90k, 90k–200k, >200k). On
 * the measured data the controller's entire operating range was 102k–192k, so
 * every single day for sixty days landed in tier 2 and the tier signal never
 * fired once. Absolute bands only work if you already know the user's scale —
 * which is exactly the thing the controller exists to learn.
 *
 * So a tier is now RELATIVE: today's target against the trailing median of
 * recent targets. Tier 3 means "the bar is higher than you've been running";
 * tier 1 means it dropped. That is self-calibrating, works for a coworker whose
 * volume is a tenth of yours, and — unlike an absolute band — cannot silently
 * degrade into a constant.
 */

export type Tier = {
  index: number
  canvas: number
  colours: number
}

export const TIERS: Tier[] = [
  { index: 1, canvas: 16, colours: 6 },
  { index: 2, canvas: 32, colours: 10 },
  { index: 3, canvas: 48, colours: 16 },
]

/**
 * How far the target must move from the trailing baseline to change tiers.
 *
 * −8% / +10%, chosen by measurement rather than taste. The first draft used
 * ±13%, which is about one and a half controller steps at k=0.15 and sounded
 * principled; swept against the real history it produced 12/18/3 — tier 3 fired
 * on 9% of days, so the "the bar went up" signal was nearly invisible. Widening
 * the usable range by narrowing the bands gives 15/11/7, roughly even thirds.
 *
 * Note this is a DISPLAY tuning, deliberately. The sweep also showed k=0.20
 * would fix the mix — but distorting the control loop to make the readout look
 * better is the wrong lever. k answers to the completion rate; these two
 * numbers answer to whether you can see the tier change.
 */
export const TIER_DOWN = 0.92
export const TIER_UP = 1.1

/** Days of target history the baseline is taken over. */
export const BASELINE_DAYS = 21

export function tierFor(target: number, baseline: number): Tier {
  if (baseline <= 0) return TIERS[1]!
  const ratio = target / baseline
  if (ratio < TIER_DOWN) return TIERS[0]!
  if (ratio > TIER_UP) return TIERS[2]!
  return TIERS[1]!
}

/**
 * Trailing median of recent targets — the level a tier is judged against.
 *
 * Median rather than mean so one 4× spike week cannot drag the baseline up and
 * quietly re-label a normal day as tier 1.
 */
export function baselineOf(recentTargets: number[]): number {
  if (recentTargets.length === 0) return 0
  const sorted = [...recentTargets].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * Which image a given day shows.
 *
 * Deterministic in the date, so recomputing a day (SPEC §9) yields the same fox
 * rather than a different one on every launch.
 *
 * A shuffled DECK rather than a hash. Hashing the date is the obvious approach
 * and it is uniform in the long run — within 1% over two years — but uniform is
 * the wrong property. Independent draws cluster: a real ten-day stretch put the
 * same picture on four days, three of them consecutive. A deck deals every image
 * once before any repeats, so the shortest possible gap between two showings of
 * one picture is bounded by the pool size instead of being luck.
 *
 * The deck is reshuffled each cycle, seeded by the cycle number, so the order
 * still varies rather than marching 1,2,3,4,1,2,3,4 forever.
 */
export function imageFor(key: string, tier: Tier, poolSize: number): string {
  if (poolSize <= 0) return `t${tier.index}-0`

  const day = dayNumber(key)
  const cycle = Math.floor(day / poolSize)
  const position = ((day % poolSize) + poolSize) % poolSize

  return `t${tier.index}-${dealFor(poolSize, cycle, tier.index)[position]}`
}

/**
 * One cycle's deal, adjusted so it does not open on the card the last deal
 * closed with.
 *
 * Without this the deck is even but the boundary still stings: a picture can be
 * last on Tuesday and first on Wednesday, which is exactly the back-to-back
 * repeat the deck was introduced to remove. Swapping the first two cards is
 * enough, and it stays deterministic — every process computes the same deal for
 * the same cycle.
 */
function dealFor(poolSize: number, cycle: number, tier: number): number[] {
  const cards = deck(poolSize, hash(`${cycle}/${tier}`))
  if (poolSize < 2) return cards

  const previous = deck(poolSize, hash(`${cycle - 1}/${tier}`))
  if (cards[0] === previous[poolSize - 1]) {
    const swap = cards[0]!
    cards[0] = cards[1]!
    cards[1] = swap
  }

  return cards
}

/** Days since 1970-01-01 for a `YYYY-MM-DD` key. Calendar-only, no timezone. */
export function dayNumber(key: string): number {
  const [year, month, dayOfMonth] = key.split('-').map(Number)
  return Math.floor(Date.UTC(year ?? 1970, (month ?? 1) - 1, dayOfMonth ?? 1) / 86_400_000)
}

/** Fisher-Yates over a seeded LCG: same seed, same deal, every time. */
export function deck(size: number, seed: number): number[] {
  const cards = Array.from({ length: size }, (_, i) => i)
  let state = seed >>> 0

  for (let i = size - 1; i > 0; i--) {
    // Numerical Recipes LCG. Its high bits are well mixed, which is why the
    // shift is there — the low bits of an LCG cycle far too regularly.
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const j = (state >>> 16) % (i + 1)
    const swap = cards[i]!
    cards[i] = cards[j]!
    cards[j] = swap
  }

  return cards
}

export function hash(value: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}
