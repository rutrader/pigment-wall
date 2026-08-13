import { join } from 'node:path'
import type { Config } from './config.ts'
import { accumulate } from './day.ts'
import { buildWall, seal, toSeal, type Wall } from './engine.ts'
import { emptyStore, readStore, writeStore, type Store } from './store.ts'
import { Tail } from './tail.ts'
import { poolIds } from '../art/image.ts'
import { BASELINE_DAYS, baselineOf, dayNumber, tierFor, type Tier } from './tiers.ts'
import { detect, headline, interrupting, type Event } from './events.ts'
import { pickQuip, type Fired } from './quips.ts'
import type { Day, DayTotals } from './types.ts'

/**
 * The whole of Pigment behind one object.
 *
 * This exists so M2 has exactly one thing to call. Without it the Electron main
 * process would grow its own copy of
 * tail → accumulate → buildWall → toSeal → seal → writeStore, the replay tool
 * would keep its copy, and the two would drift — at which point the wall you
 * tune against and the wall you look at are no longer the same wall, which is
 * the one bug this design cannot tolerate (SPEC §9).
 */

export type Snapshot = {
  wall: Wall
  /** The day the tray icon and popover are showing. Never null once started. */
  today: Day
  tier: Tier
  /** Records ingested by the sweep that produced this snapshot. */
  ingested: number
  /**
   * Today's line, if today did anything worth a remark. Always safe to show —
   * the popover is where you went looking (SPEC §7).
   */
  roast: { kind: Event['kind']; text: string } | null
  /**
   * The same line, but only when the event may interrupt AND nothing has
   * interrupted yet today. Null means the caller must stay quiet.
   */
  interrupt: { kind: Event['kind']; text: string; slot: number } | null
}

export class Pigment {
  private readonly config: Config
  private readonly storeFile: string
  private readonly tail: Tail

  private store: Store = emptyStore()
  private totals = new Map<string, DayTotals>()
  private seen = new Set<string>()
  private started = false

  constructor(config: Config, storeFile?: string) {
    this.config = config
    this.tail = new Tail(config)
    this.storeFile = storeFile ?? join(config.root, 'pigment', 'wall.json')
  }

  /**
   * First run of the process: read the sealed wall, then backfill everything
   * inside the window from the logs.
   *
   * The backfill is not an optimisation, it is what makes day one meaningful
   * (SPEC §10) — and it doubles as the correction pass for a boundary the
   * machine slept through, since the recompute window is re-derived from
   * scratch here rather than trusted from the store.
   */
  async start(now: number = Date.now()): Promise<Snapshot> {
    this.store = readStore(this.storeFile)

    const since = now - this.config.windowDays * 86_400_000
    const records = await this.tail.readAll(since)

    this.totals = new Map()
    this.seen = new Set()
    accumulate(records, this.config.boundaryHour, this.totals, this.seen)
    this.started = true

    return this.commit(now, records.length)
  }

  /**
   * Steady state: read only what was appended since the last call.
   *
   * Cheap by construction — a few KB per call once the cursors are warm — so it
   * is safe to run on a short interval. `start()` is called implicitly if the
   * caller forgot, because a tick that silently reported an empty wall would be
   * a much worse failure than a slow first tick.
   */
  async tick(now: number = Date.now()): Promise<Snapshot> {
    if (!this.started) return this.start(now)

    const records = await this.tail.sweep()
    accumulate(records, this.config.boundaryHour, this.totals, this.seen)

    return this.commit(now, records.length)
  }

  /**
   * Re-walks the log directory.
   *
   * Transcripts grow by appending, which does not change their parent
   * directory's mtime — so a brand-new session file is invisible until the tree
   * is walked again. The caller drives this on its own slow cadence.
   */
  async refreshFiles(): Promise<void> {
    await this.tail.refresh()
  }

  /** The sealed wall as it stands, without touching the filesystem. */
  peek(): Store {
    return this.store
  }

  /**
   * Records that a line was delivered, so it will not be repeated inside the
   * cooldown and nothing else interrupts today.
   */
  markDelivered(key: string, kind: Event['kind'], slot: number): void {
    this.store = { ...this.store, roasts: [...this.store.roasts, { key, kind, slot }] }
    writeStore(this.storeFile, this.store)
  }

  setOnboarded(): void {
    this.store = { ...this.store, prefs: { ...this.store.prefs, onboarded: true } }
    writeStore(this.storeFile, this.store)
  }

  setNotify(notify: boolean): void {
    this.store = { ...this.store, prefs: { ...this.store.prefs, notify } }
    writeStore(this.storeFile, this.store)
  }

  /**
   * Rebuilds the wall from current totals, seals what has aged out, and
   * persists. One path, so a sealed day can only ever be the day that was just
   * derived — there is no second code path that could seal a different number.
   */
  private commit(now: number, ingested: number): Snapshot {
    const wall = buildWall({
      totals: this.totals,
      store: this.store,
      config: this.config,
      now,
      pools: poolIds(),
    })

    const sealed = seal(this.store, toSeal(wall, this.config, now), this.config, now)

    // Only write when the sealed set actually changed. A menu-bar app that
    // fsyncs every few seconds for no reason is a laptop-battery bug.
    if (!sameDays(sealed.days, this.store.days)) {
      this.store = sealed
      writeStore(this.storeFile, sealed)
    }

    const today = wall.days[wall.days.length - 1]!
    const baseline = baselineOf(
      wall.days.slice(-BASELINE_DAYS - 1, -1).map((day) => day.target),
    )

    // Quip history is DERIVED by replaying the wall, not read from what was
    // delivered. Only interruptions are ever recorded, so a stored history
    // would leave every popover-only line — dead days especially — outside the
    // cooldown: the measured month repeated "a blank day" twice in eight days.
    // The wall is already the durable record; the words follow from it.
    const found = detect(wall.days, this.config)
    const history: Fired[] = []
    let roast: Snapshot['roast'] = null
    let todaysSlot = 0

    for (const day of wall.days) {
      const events = found.get(day.key)
      if (!events) continue
      const lead = headline(events)
      if (!lead) continue

      const picked = pickQuip(lead, history, dayNumber(day.key))
      history.push({ key: day.key, kind: lead.kind, slot: picked.slot })

      if (day.key === today.key) {
        roast = { kind: lead.kind, text: picked.text }
        todaysSlot = picked.slot
      }
    }

    // One interruption a day, and only if nothing has interrupted today already.
    // The cap is what keeps this rare enough to still land (SPEC §7).
    const events = found.get(today.key) ?? []
    const spokenToday = this.store.roasts.some((fired) => fired.key === today.key)
    const loud = this.store.prefs.notify && !spokenToday ? interrupting(events) : null
    const interrupt = loud && roast ? { kind: loud.kind, text: roast.text, slot: todaysSlot } : null

    return { wall, today, tier: tierFor(today.target, baseline), ingested, roast, interrupt }
  }
}

function sameDays(a: Day[], b: Day[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!
    const right = b[i]!
    if (left.key !== right.key || left.fill !== right.fill || left.targetAfter !== right.targetAfter) {
      return false
    }
  }
  return true
}
