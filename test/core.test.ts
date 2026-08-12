import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, normalise } from '../src/core/config.ts'
import { costCents, formatCents } from '../src/core/cost.ts'
import { fillOf, quantile, seed, step } from '../src/core/controller.ts'
import { accumulate, dayKey, dayRange, peakHour } from '../src/core/day.ts'
import { parseChunk, parseLine } from '../src/core/parse.ts'
import { BASELINE_DAYS, baselineOf, imageFor, TIERS, tierFor } from '../src/core/tiers.ts'
import type { Record_ } from '../src/core/types.ts'

const CONFIG = DEFAULTS

function assistantLine(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-11T13:00:00.000Z',
    uuid: 'record-uuid',
    cwd: '/Users/someone/secret-client-project',
    gitBranch: 'feature/unreleased-thing',
    message: {
      id: 'msg_1',
      role: 'assistant',
      content: [{ type: 'text', text: 'the actual private transcript' }],
      usage: {
        input_tokens: 10,
        output_tokens: 100,
        cache_read_input_tokens: 5000,
        cache_creation: { ephemeral_5m_input_tokens: 20, ephemeral_1h_input_tokens: 30 },
      },
      ...(over['message'] as object | undefined),
    },
    ...over,
  })
}

// --- SPEC §8: extract only timestamp and usage --------------------------------

test('the parser returns token counts and a timestamp, and nothing else', () => {
  const record = parseLine(assistantLine())
  assert.ok(record)

  assert.deepEqual(Object.keys(record).sort(), ['at', 'id', 'usage'])
  assert.deepEqual(Object.keys(record.usage).sort(), [
    'cacheRead',
    'cacheWrite1h',
    'cacheWrite5m',
    'input',
    'output',
  ])

  // The fields that must never survive the boundary.
  const serialised = JSON.stringify(record)
  assert.ok(!serialised.includes('secret-client-project'), 'cwd leaked')
  assert.ok(!serialised.includes('unreleased-thing'), 'git branch leaked')
  assert.ok(!serialised.includes('private transcript'), 'message content leaked')
})

test('the two cache-write tiers are kept apart, because they are priced apart', () => {
  const record = parseLine(assistantLine())!
  assert.equal(record.usage.cacheWrite5m, 20)
  assert.equal(record.usage.cacheWrite1h, 30)
})

test('a record with only the flat cache_creation_input_tokens counts as the 5m tier', () => {
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-11T13:00:00.000Z',
    message: { id: 'msg_old', usage: { output_tokens: 5, cache_creation_input_tokens: 900 } },
  })
  const record = parseLine(line)!
  assert.equal(record.usage.cacheWrite5m, 900)
  assert.equal(record.usage.cacheWrite1h, 0)
})

test('non-assistant records, malformed JSON and missing usage are all skipped', () => {
  assert.equal(parseLine(JSON.stringify({ type: 'user', timestamp: '2026-08-11T13:00:00Z' })), null)
  assert.equal(parseLine('{"type":"assistant" this is not json'), null)
  assert.equal(
    parseLine(JSON.stringify({ type: 'assistant', timestamp: '2026-08-11T13:00:00Z', message: {} })),
    null,
  )
  assert.equal(parseLine(''), null)
})

test('a trailing partial line is handed back, not parsed', () => {
  const whole = assistantLine()
  const { records, remainder } = parseChunk(`${whole}\n${whole.slice(0, 40)}`)

  assert.equal(records.length, 1)
  assert.equal(remainder, whole.slice(0, 40))

  // Prepending the remainder to the rest recovers the dropped record — this is
  // the sequence a mid-write sweep actually produces.
  const next = parseChunk(remainder + whole.slice(40) + '\n')
  assert.equal(next.records.length, 1)
})

// --- SPEC §4: the day boundary ------------------------------------------------

test('a Pigment day runs 04:00 to 03:59, so a night session is one day', () => {
  const evening = new Date(2026, 7, 10, 23, 30).getTime()
  const afterMidnight = new Date(2026, 7, 11, 1, 30).getTime()

  assert.equal(dayKey(evening, 4), '2026-08-10')
  assert.equal(dayKey(afterMidnight, 4), '2026-08-10', 'the 01:30 half of the session split off')

  // The same pair under a midnight boundary is what we are avoiding.
  assert.equal(dayKey(evening, 0), '2026-08-10')
  assert.equal(dayKey(afterMidnight, 0), '2026-08-11')
})

test('the boundary is exclusive at its own hour', () => {
  assert.equal(dayKey(new Date(2026, 7, 11, 3, 59).getTime(), 4), '2026-08-10')
  assert.equal(dayKey(new Date(2026, 7, 11, 4, 0).getTime(), 4), '2026-08-11')
})

test('a day range includes the idle days between its ends', () => {
  const keys = dayRange('2026-07-28', '2026-08-02', 4)
  assert.deepEqual(keys, [
    '2026-07-28',
    '2026-07-29',
    '2026-07-30',
    '2026-07-31',
    '2026-08-01',
    '2026-08-02',
  ])
})

test('peak hour is a rolling window, not a clock hour', () => {
  const base = new Date(2026, 7, 11, 10, 0).getTime()
  const minute = 60_000

  // 40k at 10:50 and 40k at 11:10 are in different clock hours but 20 minutes
  // apart — the rolling window has to see 80k.
  assert.equal(
    peakHour([
      [base, 10_000],
      [base + 50 * minute, 40_000],
      [base + 70 * minute, 40_000],
    ]),
    80_000,
  )

  // Two hours apart: never in one window.
  assert.equal(
    peakHour([
      [base, 40_000],
      [base + 120 * minute, 40_000],
    ]),
    40_000,
  )
})

test('accumulation dedups on response id — the corpus really does repeat records', () => {
  const at = new Date(2026, 7, 11, 13, 0).getTime()
  const usage = { input: 0, output: 100, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 }
  const records: Record_[] = [
    { id: 'msg_a', at, usage },
    { id: 'msg_a', at, usage },
    { id: 'msg_b', at, usage },
  ]

  const totals = accumulate(records, 4)
  const day = totals.get('2026-08-11')!
  assert.equal(day.output, 200, 'the duplicate inflated the total')
  assert.equal(day.messages, 2)
})

// --- SPEC §3: the controller --------------------------------------------------

test('beating the target raises it and missing lowers it', () => {
  const target = 100_000
  assert.ok(step(target, 200_000, CONFIG) > target)
  assert.ok(step(target, 50_000, CONFIG) < target)
})

test('at k=0.15 a monster day moves tomorrow ~6%, not ~30%', () => {
  const raised = step(100_000, 900_000, CONFIG) / 100_000
  assert.ok(raised > 1.05 && raised < 1.07, `expected ~6%, got ${((raised - 1) * 100).toFixed(1)}%`)

  const lowered = step(100_000, 1_000, CONFIG) / 100_000
  assert.ok(lowered > 0.9 && lowered < 0.92, `expected ~-9%, got ${((lowered - 1) * 100).toFixed(1)}%`)
})

test('the target converges on the qth quantile — which is what sets the completion rate', () => {
  // A stable distribution, fed in a repeating order so there is no trend to
  // track: the tracker should settle where 60% of days beat it.
  const days = [20_000, 50_000, 90_000, 140_000, 200_000, 300_000, 450_000, 60_000, 110_000, 170_000]

  let target = CONFIG.seedTarget
  for (let i = 0; i < 2000; i++) target = step(target, days[i % days.length]!, CONFIG)

  let complete = 0
  let running = target
  for (let i = 0; i < 1000; i++) {
    const output = days[i % days.length]!
    if (output >= running) complete++
    running = step(running, output, CONFIG)
  }

  const rate = complete / 1000
  assert.ok(rate > 0.5 && rate < 0.7, `completion settled at ${(rate * 100).toFixed(0)}%, wanted ~60%`)
})

test('the seed is the qth quantile, not the median — a median seed starts above the fixed point', () => {
  const active = [10_000, 50_000, 100_000, 200_000, 400_000]
  const seeded = seed(active, CONFIG)

  assert.equal(seeded, quantile(active, 0.4))
  assert.ok(seeded < quantile(active, 0.5), 'seeding at the median would start the wall too high')
})

test('the target is clamped, and a NaN cannot poison the chain', () => {
  assert.equal(step(CONFIG.maxTarget, 10_000_000, CONFIG), CONFIG.maxTarget)
  assert.equal(step(CONFIG.minTarget, 0, CONFIG), CONFIG.minTarget)
  assert.equal(seed([], CONFIG), CONFIG.seedTarget)
})

test('fill runs past 1.0 and stops at the overfill cap', () => {
  assert.equal(fillOf(50_000, 100_000, CONFIG), 0.5)
  assert.equal(fillOf(100_000, 100_000, CONFIG), 1)

  // The measured Aug 3: 8.7x target. It must not read as a 1.02x day.
  assert.equal(fillOf(870_000, 100_000, CONFIG), CONFIG.overfillCap)
  assert.ok(fillOf(250_000, 100_000, CONFIG) > fillOf(150_000, 100_000, CONFIG))
})

// --- SPEC §5: tiers make the controller visible -------------------------------

test('a tier is relative to the trailing level, so it fires for any user scale', () => {
  assert.equal(tierFor(100_000, 100_000).index, 2)
  assert.equal(tierFor(80_000, 100_000).index, 1)
  assert.equal(tierFor(130_000, 100_000).index, 3)

  // A coworker running a tenth of the volume gets the same three tiers.
  assert.equal(tierFor(8_000, 10_000).index, 1)
  assert.equal(tierFor(13_000, 10_000).index, 3)
})

test('absolute bands would have collapsed to one tier on the real range', () => {
  // The measured controller range was ~102k-192k. Under the relative rule that
  // spread produces more than one tier; that is the whole reason it changed.
  const observed = [102_000, 120_000, 148_000, 165_000, 192_000]
  const baseline = baselineOf(observed)
  const tiers = new Set(observed.map((target) => tierFor(target, baseline).index))
  assert.ok(tiers.size > 1, 'the tier signal never fires')
})

test('the baseline is a median, so one spike week cannot re-label normal days', () => {
  assert.equal(baselineOf([100_000, 110_000, 120_000]), 110_000)
  assert.equal(baselineOf([100_000, 110_000, 120_000, 900_000]), 115_000)
  assert.equal(baselineOf([]), 0)
})

test('image choice is deterministic in the date, so recomputing a day is stable', () => {
  const tier = TIERS[1]!
  assert.equal(imageFor('2026-08-11', tier, 4), imageFor('2026-08-11', tier, 4))
  assert.notEqual(imageFor('2026-08-11', tier, 4), imageFor('2026-08-12', tier, 4))
  assert.ok(imageFor('2026-08-11', tier, 4).startsWith('t2-'))
})

test('BASELINE_DAYS is long enough to outlast a bad week', () => {
  assert.ok(BASELINE_DAYS >= 14)
})

// --- SPEC §2: cost, for the roast only ----------------------------------------

test('cost prices the two cache-write tiers separately', () => {
  const oneMillion5m = costCents({
    input: 0,
    output: 0,
    cacheWrite5m: 1_000_000,
    cacheWrite1h: 0,
    cacheRead: 0,
  })
  const oneMillion1h = costCents({
    input: 0,
    output: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 1_000_000,
    cacheRead: 0,
  })

  assert.equal(oneMillion5m, 625, '5m writes are 1.25x the $5 input rate')
  assert.equal(oneMillion1h, 1000, '1h writes are 2x the $5 input rate')
})

test('a million output tokens is $25 and a million cache reads is 50 cents', () => {
  assert.equal(
    formatCents(
      costCents({ input: 0, output: 1_000_000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 }),
    ),
    '$25.00',
  )
  assert.equal(
    formatCents(
      costCents({ input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 1_000_000 }),
    ),
    '$0.50',
  )
})

// --- config -------------------------------------------------------------------

test('a config typo falls back rather than producing a broken loop', () => {
  const config = normalise({
    boundaryHour: 99,
    q: 5,
    k: -1,
    idleFloor: -10,
  } as never)

  assert.ok(config.boundaryHour >= 0 && config.boundaryHour <= 23)
  assert.ok(config.q > 0 && config.q < 1)
  assert.ok(config.k > 0 && config.k <= 0.5)
  assert.ok(config.idleFloor >= 0)
})

test('a relative root is refused — it would walk the wrong tree', () => {
  assert.equal(normalise({ root: './somewhere' }).root, DEFAULTS.root)
})

// --- SPEC §5: which picture a day gets ----------------------------------------

test('a deck deals every picture once before any repeats', async () => {
  const { imageFor, deck } = await import('../src/core/tiers.ts')
  const tier = TIERS[2]!

  for (const pool of [4, 5, 7]) {
    const seen = new Map<string, number>()
    let shortestGap = Infinity
    const date = new Date(Date.UTC(2026, 0, 1))

    for (let i = 0; i < 730; i++) {
      const key = date.toISOString().slice(0, 10)
      const id = imageFor(key, tier, pool)
      if (seen.has(id)) shortestGap = Math.min(shortestGap, i - seen.get(id)!)
      seen.set(id, i)
      date.setUTCDate(date.getUTCDate() + 1)
    }

    assert.equal(seen.size, pool, `pool ${pool}: not every picture was used`)
    // A hash would allow a gap of 1 — the same picture two days running. That
    // is the failure the deck exists to prevent.
    assert.ok(shortestGap >= 2, `pool ${pool}: same picture repeated after ${shortestGap} day(s)`)
  }
})

test('every picture appears about equally often over two years', async () => {
  const { imageFor } = await import('../src/core/tiers.ts')
  const counts = new Map<string, number>()
  const date = new Date(Date.UTC(2026, 0, 1))

  for (let i = 0; i < 730; i++) {
    const id = imageFor(date.toISOString().slice(0, 10), TIERS[1]!, 4)
    counts.set(id, (counts.get(id) ?? 0) + 1)
    date.setUTCDate(date.getUTCDate() + 1)
  }

  const ideal = 730 / 4
  for (const [id, count] of counts) {
    assert.ok(Math.abs(count - ideal) / ideal < 0.05, `${id} appeared ${count} times, expected ~${ideal}`)
  }
})

test('a deal is stable, so recomputing a day never changes its picture', async () => {
  const { imageFor, deck } = await import('../src/core/tiers.ts')
  assert.equal(imageFor('2026-08-12', TIERS[2]!, 5), imageFor('2026-08-12', TIERS[2]!, 5))
  assert.deepEqual(deck(6, 12345), deck(6, 12345))
  assert.notDeepEqual(deck(6, 12345), deck(6, 999))
  assert.deepEqual([...deck(6, 42)].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5])
})

// --- SPEC §4: saying which day you are looking at ------------------------------

test('after midnight the label says the day is still the previous one', async () => {
  const { dayLabel } = await import('../src/core/day.ts')

  // 00:17 on the 12th: the Pigment day is still the 11th, until 04:00. This is
  // the exact case that got reported as "the stats look stale".
  const justAfterMidnight = new Date(2026, 7, 12, 0, 17).getTime()
  const label = dayLabel('2026-08-11', 4, justAfterMidnight)
  assert.match(label, /11/)
  assert.match(label, /until 04:00/, 'no hint about why the date is not the wall-clock one')

  // Same day by the wall clock: no explanation needed.
  const afternoon = new Date(2026, 7, 11, 15, 0).getTime()
  assert.equal(dayLabel('2026-08-11', 4, afternoon).includes('until'), false)

  // And once the boundary passes, the label moves on.
  const afterBoundary = new Date(2026, 7, 12, 4, 30).getTime()
  assert.equal(dayLabel('2026-08-12', 4, afterBoundary).includes('until'), false)
})

// --- M4: the config surface -----------------------------------------------------

test('the written config file parses back to the defaults', async () => {
  const { defaultConfigFile, stripComments, normalise, DEFAULTS } = await import('../src/core/config.ts')

  // The file is the documentation, so it must stay in sync with the defaults it
  // claims to show — a file that says q is 0.4 while the code uses 0.5 is worse
  // than no file.
  const parsed = JSON.parse(stripComments(defaultConfigFile())) as Record<string, unknown>
  const config = normalise(parsed)

  for (const key of ['boundaryHour', 'idleFloor', 'q', 'k', 'windowDays', 'recomputeHours', 'overfillCap'] as const) {
    assert.equal(config[key], DEFAULTS[key], `${key} in the written file disagrees with the default`)
  }
  assert.equal(config.root, DEFAULTS.root)
})

test('comment stripping does not damage strings containing slashes', async () => {
  const { stripComments } = await import('../src/core/config.ts')

  // A Windows-style or URL-ish path inside a string must survive: truncating at
  // the first `//` would silently rewrite the user's log directory.
  const text = '{ "root": "/Users/x/http://not-a-comment", "q": 0.4 } // trailing'
  const parsed = JSON.parse(stripComments(text)) as { root: string; q: number }
  assert.equal(parsed.root, '/Users/x/http://not-a-comment')
  assert.equal(parsed.q, 0.4)

  assert.equal(JSON.parse(stripComments('{"a":1 // one\n, "b":2}')).b, 2)
  assert.equal(stripComments('{"escaped":"a\\"//b"}').includes('//b'), true)
})

test('a hand-edited config still cannot produce a broken loop', async () => {
  const { stripComments, normalise } = await import('../src/core/config.ts')

  // Someone will set q to 5 or k to 0. The clamps are what stop that becoming a
  // wall that never completes or a target that never moves.
  const edited = `{
    // my settings
    "q": 5,
    "k": 0,
    "boundaryHour": 30
  }`
  const config = normalise(JSON.parse(stripComments(edited)))
  assert.ok(config.q > 0 && config.q < 1)
  assert.ok(config.k > 0)
  assert.ok(config.boundaryHour >= 0 && config.boundaryHour <= 23)
})
