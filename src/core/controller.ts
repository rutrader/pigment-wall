import type { Config } from './config.ts'

/**
 * SPEC §3: the entire adaptive loop. One float of state.
 *
 * A Frugal-1U quantile tracker in log space. It converges on the qth quantile
 * of daily output tokens without storing a single past day:
 *
 *     if today > target:  target *= exp(+k·q)        // you beat it → harder
 *     else:               target *= exp(−k·(1−q))    // you missed  → easier
 *
 * Setting `q` IS setting the completion rate — the target settles where you
 * exceed it (1−q) of the time. q=0.4 therefore means ~60% of active days
 * complete, and there is no second difficulty knob to keep in sync.
 *
 * There is no smoothing window and no array of past days. The memory is
 * exponential and its half-life is `k`. At k=0.15 a monster day raises tomorrow
 * ~6% and a miss lowers it ~9%, which is a slow tide rather than a thermostat —
 * the app should not visibly go soft the moment you have a bad afternoon.
 */

/**
 * Folds one day's output into the target.
 *
 * Idle days must not be passed here: absence is not evidence about capacity
 * (SPEC §4), and the caller freezes the target instead.
 */
export function step(target: number, output: number, config: Config): number {
  const exponent = output > target ? config.k * config.q : -config.k * (1 - config.q)
  const clamped = Math.max(-config.maxStep, Math.min(config.maxStep, exponent))
  return clamp(target * Math.exp(clamped), config)
}

export function clamp(target: number, config: Config): number {
  if (!Number.isFinite(target)) return config.seedTarget
  return Math.min(config.maxTarget, Math.max(config.minTarget, target))
}

/**
 * The starting target for a wall with no controller state yet.
 *
 * SPEC §10: backfill is what solves cold start. Seeding from the user's own
 * history means day one is already calibrated to them, instead of spending
 * three weeks converging from an arbitrary constant — precisely the window in
 * which someone decides whether to keep the app.
 *
 * Seed at the qth quantile, NOT the median. The tracker's fixed point IS the
 * qth quantile, so seeding there starts the wall already at rest; seeding at
 * the median starts it above the fixed point and spends the first fortnight
 * walking down, marking real working days as misses on the way. Replaying the
 * measured history showed exactly that — a median seed completed 52% of active
 * days across the window and only reached the intended rate once it converged.
 */
export function seed(activeOutputs: number[], config: Config): number {
  if (activeOutputs.length === 0) return config.seedTarget
  return clamp(quantile(activeOutputs, config.q), config)
}

/** Linear-interpolated quantile. `values` is not mutated. */
export function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]!
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]!
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower)
}

/**
 * How full today's image is: tokens ÷ target, and past 1.0 it keeps going.
 *
 * SPEC §7: overshoot is rendered as overexposure rather than discarded. On the
 * measured history Aug 3 hit 8.7× target — under a cap-at-full rule it would be
 * indistinguishable from a 1.02× day, losing the most extreme day of the month.
 * The curve stops at `overfillCap` so the renderer has a bounded input.
 */
export function fillOf(output: number, target: number, config: Config): number {
  if (target <= 0) return 0
  return Math.min(config.overfillCap, output / target)
}
