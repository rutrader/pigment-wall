import type { Usage } from './types.ts'

/**
 * SPEC §2: cost never appears on the wall — only in roast copy. It is computed
 * here, in one module, because Anthropic changes prices and a stale constant
 * should be a one-line fix rather than a hunt.
 *
 * Dollars per million tokens, Claude Opus 5:
 *   input $5.00 · output $25.00 · cache read $0.50 (0.1× input)
 *   cache write $6.25 at the 5m TTL (1.25×) and $10.00 at 1h (2×)
 *
 * The logs report the two cache-write tiers separately, so they are priced
 * separately rather than lumped at one rate.
 */
export type Rates = {
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
}

export const OPUS_5: Rates = {
  input: 5,
  output: 25,
  cacheWrite5m: 6.25,
  cacheWrite1h: 10,
  cacheRead: 0.5,
}

/**
 * Cents, so a day's cost is an integer and survives JSON round-trips without
 * float drift accumulating across a sealed wall.
 */
export function costCents(usage: Usage, rates: Rates = OPUS_5): number {
  const dollars =
    (usage.input * rates.input +
      usage.output * rates.output +
      usage.cacheWrite5m * rates.cacheWrite5m +
      usage.cacheWrite1h * rates.cacheWrite1h +
      usage.cacheRead * rates.cacheRead) /
    1e6
  return Math.round(dollars * 100)
}

/** `$38.92` — the form the roast copy uses. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
