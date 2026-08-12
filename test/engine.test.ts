import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULTS, type Config } from '../src/core/config.ts'
import { buildWall, seal, toSeal } from '../src/core/engine.ts'
import { emptyStore, readStore, writeStore } from '../src/core/store.ts'
import { emptyDay } from '../src/core/day.ts'
import { EMPTY_USAGE, type Day, type DayTotals } from '../src/core/types.ts'

const CONFIG: Config = DEFAULTS

/** `now` fixed so a test never straddles a real 04:00 boundary. */
const NOW = new Date(2026, 7, 11, 12, 0).getTime()

function totalsFor(entries: Record<string, number>): Map<string, DayTotals> {
  const map = new Map<string, DayTotals>()
  for (const [key, output] of Object.entries(entries)) {
    map.set(key, {
      ...emptyDay(key),
      output,
      usage: { ...EMPTY_USAGE, output },
      messages: 1,
      peakHourOutput: output,
      firstAt: NOW,
      lastAt: NOW,
    })
  }
  return map
}

function wallFrom(entries: Record<string, number>, store = emptyStore()) {
  return buildWall({ totals: totalsFor(entries), store, config: CONFIG, now: NOW, pools: { 1: 4, 2: 4, 3: 4 } })
}

// --- SPEC §4: idle days ------------------------------------------------------

test('an idle day freezes the controller — absence is not evidence about capacity', () => {
  const wall = wallFrom({
    '2026-08-06': 200_000,
    '2026-08-07': 0,
    '2026-08-08': 0,
    '2026-08-09': 200_000,
  })

  const byKey = new Map(wall.days.map((day) => [day.key, day]))
  const before = byKey.get('2026-08-07')!
  const after = byKey.get('2026-08-08')!

  assert.ok(before.idle && after.idle)
  assert.equal(before.target, after.target, 'the idle day moved the target')
  assert.equal(before.targetAfter, before.target)
})

test('a day under the idle floor is idle; the lightest real working day is not', () => {
  const wall = wallFrom({ '2026-08-09': 1_500, '2026-08-10': 11_800 })
  const byKey = new Map(wall.days.map((day) => [day.key, day]))

  assert.equal(byKey.get('2026-08-09')!.idle, true)
  assert.equal(byKey.get('2026-08-10')!.idle, false, 'a real 11.8k day was read as absence')
})

// --- SPEC §9: the seal seam --------------------------------------------------

test('sealed days are taken verbatim and the controller resumes from their targetAfter', () => {
  const sealed: Day = {
    key: '2026-08-01',
    totals: { ...emptyDay('2026-08-01'), output: 999_999 },
    target: 123_456,
    fill: 4,
    idle: false,
    tier: 3,
    imageId: 't3-2',
    costCents: 4242,
    targetAfter: 111_111,
  }

  const wall = buildWall({
    totals: totalsFor({ '2026-08-01': 1, '2026-08-09': 150_000 }),
    store: { ...emptyStore(), days: [sealed] },
    config: CONFIG,
    now: NOW,
    pools: { 1: 4, 2: 4, 3: 4 },
  })

  const kept = wall.days.find((day) => day.key === '2026-08-01')!
  assert.deepEqual(kept, sealed, 'a sealed day was recomputed from fresh totals')

  // The first live day must start exactly where the seal left off.
  const firstLive = wall.days.find((day) => day.key === '2026-08-02')!
  assert.equal(firstLive.target, sealed.targetAfter)
})

test('days inside the 48-hour window are recomputed, not read from the store', () => {
  const stale: Day = {
    key: '2026-08-11',
    totals: emptyDay('2026-08-11'),
    target: 1_000,
    fill: 0,
    idle: true,
    tier: 1,
    imageId: 'stale',
    costCents: 0,
    targetAfter: 1_000,
  }

  const wall = buildWall({
    totals: totalsFor({ '2026-08-11': 300_000 }),
    store: { ...emptyStore(), days: [stale] },
    config: CONFIG,
    now: NOW,
    pools: { 1: 4, 2: 4, 3: 4 },
  })

  const today = wall.days.find((day) => day.key === '2026-08-11')!
  assert.notEqual(today.imageId, 'stale')
  assert.equal(today.idle, false, 'todays real tokens were masked by a stale seal')
  assert.equal(today.totals.output, 300_000)
})

test('only days older than the window are handed to the sealer', () => {
  const wall = wallFrom({ '2026-08-01': 100_000, '2026-08-10': 100_000, '2026-08-11': 100_000 })
  const keys = toSeal(wall, CONFIG, NOW).map((day) => day.key)

  assert.ok(keys.includes('2026-08-01'))
  assert.ok(!keys.includes('2026-08-11'), 'today was sealed while still live')
})

test('sealing is idempotent and drops days that fell out of the window', () => {
  const wall = wallFrom({ '2026-08-01': 100_000 })
  const once = seal(emptyStore(), toSeal(wall, CONFIG, NOW), CONFIG, NOW)
  const twice = seal(once, toSeal(wall, CONFIG, NOW), CONFIG, NOW)
  assert.deepEqual(once.days, twice.days)

  const ancient: Day = { ...once.days[0]!, key: '2020-01-01' }
  const pruned = seal({ ...emptyStore(), days: [ancient, ...once.days] }, [], CONFIG, NOW)
  assert.ok(!pruned.days.some((day) => day.key === '2020-01-01'))
})

test('a recompute of unsealed history matches what a sealed wall reports', () => {
  // This is the regression test for the seam: the same history, once derived
  // wholly from logs and once through a seal, must agree day for day.
  const history = {
    '2026-07-20': 220_000,
    '2026-07-21': 0,
    '2026-07-22': 226_000,
    '2026-07-23': 85_000,
    '2026-08-01': 177_000,
    '2026-08-09': 73_000,
  }

  const fresh = wallFrom(history)
  const store = seal(emptyStore(), toSeal(fresh, CONFIG, NOW), CONFIG, NOW)
  const resumed = buildWall({
    totals: totalsFor(history),
    store,
    config: CONFIG,
    now: NOW,
    pools: { 1: 4, 2: 4, 3: 4 },
  })

  assert.equal(resumed.days.length, fresh.days.length)
  for (let i = 0; i < fresh.days.length; i++) {
    assert.deepEqual(resumed.days[i], fresh.days[i], `day ${fresh.days[i]!.key} drifted across the seam`)
  }
  assert.equal(Math.round(resumed.target), Math.round(fresh.target))
})

// --- SPEC §10: cold start ----------------------------------------------------

test('a cold start seeds from the users own history, not a constant', () => {
  const heavy = wallFrom({ '2026-08-05': 800_000, '2026-08-06': 900_000, '2026-08-07': 700_000 })
  const light = wallFrom({ '2026-08-05': 20_000, '2026-08-06': 30_000, '2026-08-07': 25_000 })

  assert.ok(heavy.days[0]!.target > light.days[0]!.target * 5, 'both users got the same seed')
  assert.notEqual(light.days[0]!.target, CONFIG.seedTarget)
})

test('with no history at all the seed is the configured constant', () => {
  const wall = wallFrom({})
  assert.equal(wall.days[0]!.target, CONFIG.seedTarget)
})

// --- store -------------------------------------------------------------------

test('the store round-trips and is written atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pigment-'))
  try {
    const file = join(dir, 'wall.json')
    const wall = wallFrom({ '2026-08-01': 150_000, '2026-08-02': 90_000 })
    const store = seal(emptyStore(), toSeal(wall, CONFIG, NOW), CONFIG, NOW)

    writeStore(file, store)
    assert.deepEqual(readStore(file).days, store.days)

    const raw = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(raw.version, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a store from a future version is refused, not silently rewritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pigment-'))
  try {
    const file = join(dir, 'wall.json')
    writeFileSync(file, JSON.stringify({ version: 99, days: [] }))
    assert.throws(() => readStore(file), /newer than this build/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unreadable store is quarantined rather than overwritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pigment-'))
  try {
    const file = join(dir, 'wall.json')
    writeFileSync(file, 'this is not json at all')

    assert.deepEqual(readStore(file).days, [])

    // The original bytes survive under a new name; months of wall are not worth
    // losing to a parse bug.
    const rescued = readdirSync(dir).find((name) => name.includes('.unreadable-'))
    assert.ok(rescued, 'the corrupt store was destroyed instead of set aside')
    assert.equal(readFileSync(join(dir, rescued), 'utf8'), 'this is not json at all')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a missing store is an empty wall, not a crash', () => {
  assert.deepEqual(readStore(join(tmpdir(), 'pigment-does-not-exist', 'wall.json')).days, [])
})

test('the first day is not trivially complete — today cannot seed its own target', () => {
  // With no sealed history and one day of data, an unguarded seed equals that
  // day's own output and pins fill at exactly 1.0 forever.
  const only = wallFrom({ '2026-08-11': 500_000 })
  const today = only.days[only.days.length - 1]!

  assert.equal(today.key, '2026-08-11')
  assert.equal(today.target, CONFIG.seedTarget, 'today was used to calibrate itself')
  assert.ok(today.fill > 1, 'a 500k day against a 100k seed should be overexposed')
})

test('yesterday seeds today, but today never seeds today', () => {
  const wall = wallFrom({ '2026-08-09': 40_000, '2026-08-10': 60_000, '2026-08-11': 900_000 })
  const first = wall.days[0]!

  // The seed sees the two finished days and not the live one.
  assert.ok(first.target < 100_000, `seed ${first.target} was dragged up by today`)
  assert.ok(first.target >= 40_000)
})
