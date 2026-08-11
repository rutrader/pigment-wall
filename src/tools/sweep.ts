import { DEFAULTS, normalise } from '../core/config.ts'
import { accumulate } from '../core/day.ts'
import { buildWall } from '../core/engine.ts'
import { emptyStore } from '../core/store.ts'
import { poolSizes } from '../art/image.ts'
import { Tail } from '../core/tail.ts'

/**
 * Sweeps the controller's two constants against your real history.
 *
 *   node src/tools/sweep.ts [--days=60]
 *
 * SPEC §3 fixes q=0.4 and k=0.15 by argument; this is the check that the
 * argument survives contact with the data. Reading it: `complete` should land
 * near the intended 60%, `settled` (the back half of the window, after the
 * tracker has converged) is the number that actually matters, `tiers` must not
 * be a single number — a dead tier signal is a dead mechanic — and `move` is how
 * far the target walks on a typical day, which decides whether the loop feels
 * like a slow tide or a thermostat.
 */

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k ?? '', v ?? 'true'] as const
  }),
)

const days = Number(args.get('days') ?? DEFAULTS.windowDays) || DEFAULTS.windowDays
const now = Date.now()

const base = normalise({ ...DEFAULTS, windowDays: days, recomputeHours: 24 * 3650 })
const records = await new Tail(base).readAll(now - days * 86_400_000)
const totals = accumulate(records, base.boundaryHour)

const QS = [0.3, 0.35, 0.4, 0.45, 0.5]
const KS = [0.05, 0.1, 0.15, 0.2, 0.3]

console.log(`\nsweep over ${records.length} records, ${totals.size} days with activity\n`)
console.log(`    q     k  complete  settled     tiers    move  capped   final target`)

for (const q of QS) {
  for (const k of KS) {
    const config = normalise({ ...base, q, k })
    const wall = buildWall({ totals, store: emptyStore(), config, now, pools: poolSizes() })

    const active = wall.days.filter((day) => !day.idle)
    const settled = active.slice(Math.floor(active.length / 2))

    const complete = active.filter((day) => day.fill >= 1).length
    const settledComplete = settled.filter((day) => day.fill >= 1).length
    const capped = active.filter((day) => day.fill >= config.overfillCap).length

    const tiers = [1, 2, 3].map((t) => wall.days.filter((day) => day.tier === t).length)

    // Typical day-over-day move in the target. The "slow tide vs thermostat"
    // number: idle days are excluded because a frozen target is not a move.
    const moves: number[] = []
    for (let i = 1; i < wall.days.length; i++) {
      const previous = wall.days[i - 1]!.target
      const current = wall.days[i]!.target
      if (previous > 0 && current !== previous) moves.push(Math.abs(current / previous - 1))
    }
    const move = moves.length > 0 ? moves.reduce((a, b) => a + b, 0) / moves.length : 0

    console.log(
      `${q.toFixed(2).padStart(5)}${k.toFixed(2).padStart(6)}` +
        `${pct(complete / Math.max(active.length, 1)).padStart(10)}` +
        `${pct(settledComplete / Math.max(settled.length, 1)).padStart(9)}` +
        `   ${tiers.map((n) => String(n).padStart(2)).join('/')}` +
        `${pct(move).padStart(8)}` +
        `${String(capped).padStart(8)}` +
        `${Math.round(wall.target).toLocaleString().padStart(15)}` +
        (q === DEFAULTS.q && k === DEFAULTS.k ? '  <- spec' : ''),
    )
  }
  console.log()
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}
