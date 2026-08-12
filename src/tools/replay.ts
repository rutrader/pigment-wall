import { DEFAULTS, normalise, type Config } from '../core/config.ts'
import { formatCents } from '../core/cost.ts'
import { accumulate } from '../core/day.ts'
import { buildWall } from '../core/engine.ts'
import { emptyStore } from '../core/store.ts'
import { poolSizes } from '../art/image.ts'
import { Tail } from '../core/tail.ts'
import { BASELINE_DAYS, baselineOf, tierFor } from '../core/tiers.ts'

/**
 * Runs your ACTUAL history through the controller and prints the wall as ASCII.
 *
 *   node src/tools/replay.ts [--days=60] [--q=0.4] [--k=0.15] [--boundary=4]
 *
 * This exists because `q` and `k` cannot be tuned by USING the app — that is
 * three weeks per experiment. They are tuned by replaying sixty days in half a
 * second and looking at the result. Tenant's replay tool says the same thing
 * about its own constants, and it was right.
 *
 * It is also the regression test for the seam in SPEC §9: this path recomputes
 * everything from logs with no store at all, so its output is what a sealed
 * wall must agree with.
 */

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k ?? '', v ?? 'true'] as const
  }),
)

function arg(name: string, fallback: number): number {
  const raw = args.get(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

const config: Config = normalise({
  ...DEFAULTS,
  windowDays: arg('days', DEFAULTS.windowDays),
  q: arg('q', DEFAULTS.q),
  k: arg('k', DEFAULTS.k),
  boundaryHour: arg('boundary', DEFAULTS.boundaryHour),
  // Replay derives everything from logs: nothing is sealed, so nothing is
  // frozen and a changed q or k is visible all the way back.
  recomputeHours: 24 * 3650,
})

const now = Date.now()
const since = now - config.windowDays * 86_400_000

const started = Date.now()
const tail = new Tail(config)
const records = await tail.readAll(since)
const totals = accumulate(records, config.boundaryHour)
const wall = buildWall({ totals, store: emptyStore(), config, now, pools: poolSizes() })
const elapsed = Date.now() - started

const WIDTH = 24

console.log(
  `\npigment replay · q=${config.q} k=${config.k} boundary=${String(config.boundaryHour).padStart(2, '0')}:00 ` +
    `· ${records.length} records in ${elapsed}ms\n`,
)
console.log(`${pad('day', 12)}${padStart('tokens', 9)}${padStart('target', 9)}${padStart('fill', 6)}  ${pad('bar', WIDTH + 2)} tier   cost`)

let complete = 0
let active = 0
let overexposed = 0

for (const day of wall.days) {
  if (!day.idle) {
    active++
    if (day.fill >= 1) complete++
    if (day.fill >= 2) overexposed++
  }

  console.log(
    pad(day.key, 12) +
      padStart(day.idle ? '—' : String(day.totals.output), 9) +
      padStart(String(Math.round(day.target)), 9) +
      padStart(day.idle ? '' : `${Math.round(day.fill * 100)}%`, 6) +
      '  ' +
      pad(bar(day.fill, config.overfillCap), WIDTH + 2) +
      `  t${day.tier}  ` +
      padStart(day.idle ? '' : formatCents(day.costCents), 8),
  )
}

console.log(
  `\ncompleted ${complete}/${active} active days (${pct(complete / Math.max(active, 1))})` +
    ` · overexposed ≥2× on ${overexposed}` +
    ` · final target ${Math.round(wall.target).toLocaleString()} → tier ${tierFor(wall.target, baselineOf(wall.days.slice(-BASELINE_DAYS).map((d) => d.target))).index}` +
    ` · tier mix ${tierMix(wall.days)}\n`,
)

/**
 * Gray → filled → overexposed, in one line of text.
 *
 * The `#` run is the image colouring in; `+` past the end is the part SPEC §7
 * renders as bloom and bleach. Showing the overshoot is the whole point — a
 * bar that stopped at 100% would make an 8.7× day look like a 1.02× one, which
 * is exactly the failure the cap-at-full option was rejected for.
 */
function bar(fill: number, cap: number): string {
  const filled = Math.min(WIDTH, Math.round(Math.min(fill, 1) * WIDTH))
  const over = Math.round(Math.min(Math.max(fill - 1, 0) / (cap - 1), 1) * 6)
  return '#'.repeat(filled) + '·'.repeat(WIDTH - filled) + (over > 0 ? ` ${'+'.repeat(over)}` : '')
}

/** How many days landed in each tier — the check that the signal fires at all. */
function tierMix(days: Array<{ tier: number }>): string {
  const counts = [0, 0, 0]
  for (const day of days) counts[day.tier - 1] = (counts[day.tier - 1] ?? 0) + 1
  return counts.map((n, i) => `t${i + 1}:${n}`).join(' ')
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}
