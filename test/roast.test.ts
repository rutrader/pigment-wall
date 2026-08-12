import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS } from '../src/core/config.ts'
import { detect, headline, interrupting, INTERRUPTS, type Event } from '../src/core/events.ts'
import { pickQuip, QUIPS, COOLDOWN_DAYS, type Fired } from '../src/core/quips.ts'
import { emptyDay } from '../src/core/day.ts'
import { EMPTY_USAGE, type Day } from '../src/core/types.ts'

const CONFIG = DEFAULTS

function day(over: Partial<Day> & { key: string }): Day {
  const output = over.totals?.output ?? 0
  return {
    key: over.key,
    totals: { ...emptyDay(over.key), output, usage: { ...EMPTY_USAGE, output }, ...over.totals },
    target: over.target ?? 100_000,
    fill: over.fill ?? output / (over.target ?? 100_000),
    idle: over.idle ?? output < CONFIG.idleFloor,
    tier: 2,
    imageId: 't2-0',
    costCents: over.costCents ?? 0,
    targetAfter: over.target ?? 100_000,
  }
}

/** Did `kind` fire on `key`? A day with no events at all counts as "no". */
function fired(found: Map<string, Event[]>, key: string, kind: Event['kind']): boolean {
  return (found.get(key) ?? []).some((event) => event.kind === kind)
}

/** Ten ordinary days, so the rate trigger has the sample it insists on. */
function baseline(peak: number): Day[] {
  return Array.from({ length: 10 }, (_, i) =>
    day({
      key: `2026-07-${String(i + 1).padStart(2, '0')}`,
      totals: { ...emptyDay('x'), output: 100_000, peakHourOutput: peak, lastAt: new Date(2026, 6, i + 1, 18).getTime() },
    }),
  )
}

// --- SPEC §7: what counts as an event ------------------------------------------

test('a fast hour fires only once there is enough history to know what fast is', () => {
  const short = [
    ...baseline(50_000).slice(0, 3),
    day({ key: '2026-07-20', totals: { ...emptyDay('x'), output: 200_000, peakHourOutput: 900_000 } }),
  ]
  assert.ok(!fired(detect(short, CONFIG), '2026-07-20', 'rate'), 'fired on a three-day sample')

  const long = [
    ...baseline(50_000),
    day({ key: '2026-07-20', totals: { ...emptyDay('x'), output: 200_000, peakHourOutput: 900_000 } }),
  ]
  assert.ok(detect(long, CONFIG).get('2026-07-20')!.some((e) => e.kind === 'rate'))
})

test('today is not part of the threshold it is measured against', () => {
  // A single enormous day cannot raise its own bar out of reach — the same
  // self-reference that once pinned the first day at exactly 100%.
  const days = [...baseline(50_000), day({ key: '2026-07-20', totals: { ...emptyDay('x'), output: 200_000, peakHourOutput: 60_000 } })]
  assert.ok(detect(days, CONFIG).get('2026-07-20')!.some((e) => e.kind === 'rate'))
})

test('a comeback needs three days away, not two', () => {
  const build = (gap: number): Day[] => [
    day({ key: '2026-07-01', totals: { ...emptyDay('x'), output: 100_000 } }),
    ...Array.from({ length: gap }, (_, i) => day({ key: `2026-07-${String(i + 2).padStart(2, '0')}`, idle: true })),
    day({ key: `2026-07-${String(gap + 2).padStart(2, '0')}`, totals: { ...emptyDay('x'), output: 100_000 } }),
  ]

  const twoDays = build(2)
  assert.ok(!fired(detect(twoDays, CONFIG), twoDays[twoDays.length - 1]!.key, 'comeback'))

  const threeDays = build(3)
  const back = detect(threeDays, CONFIG).get(threeDays[threeDays.length - 1]!.key)!
  const comeback = back.find((e) => e.kind === 'comeback')!
  assert.ok(comeback)
  assert.equal(comeback.facts.away, 3, 'the copy needs to know how long you were gone')
})

test('a late finish is measured by when the day ended', () => {
  const late = day({
    key: '2026-07-20',
    totals: { ...emptyDay('x'), output: 100_000, lastAt: new Date(2026, 6, 21, 2, 30).getTime() },
  })
  const evening = day({
    key: '2026-07-21',
    totals: { ...emptyDay('x'), output: 100_000, lastAt: new Date(2026, 6, 21, 19, 0).getTime() },
  })

  assert.ok(detect([late], CONFIG).get('2026-07-20')!.some((e) => e.kind === 'late'))
  assert.ok(!fired(detect([evening], CONFIG), '2026-07-21', 'late'))
})

// --- what may interrupt ---------------------------------------------------------

test('resting and overshooting are never allowed to interrupt', () => {
  // SPEC §1: the app does not scold you for resting. And an overshoot fires on
  // 30% of active days, which is noise rather than surprise.
  assert.equal(INTERRUPTS.has('dead'), false)
  assert.equal(INTERRUPTS.has('blown'), false)
  assert.ok(INTERRUPTS.has('rate') && INTERRUPTS.has('comeback') && INTERRUPTS.has('late'))

  const idle = detect([day({ key: '2026-07-20', idle: true })], CONFIG).get('2026-07-20')!
  assert.ok(headline(idle), 'a dead day still has something to say in the popover')
  assert.equal(interrupting(idle), null, 'but it must not push a notification')

  const over = detect(
    [day({ key: '2026-07-21', totals: { ...emptyDay('x'), output: 300_000 }, target: 100_000 })],
    CONFIG,
  ).get('2026-07-21')!
  assert.equal(over.find((e) => e.kind === 'blown')!.notify, false)
  assert.equal(interrupting(over), null)
})

test('one day leads with one line, rarest condition first', () => {
  const events: Event[] = (['dead', 'blown', 'late', 'rate', 'comeback'] as const).map((kind) => ({
    kind,
    key: '2026-07-20',
    notify: true,
    facts: { output: 0, target: 0, fill: 0, peakHour: 0, costCents: 0, away: 0, endedAt: null },
  }))
  assert.equal(headline(events)!.kind, 'comeback')
  assert.equal(headline(events.filter((e) => e.kind !== 'comeback'))!.kind, 'rate')
})

// --- the quips ------------------------------------------------------------------

test('every condition has four lines and every placeholder resolves', () => {
  const event: Event = {
    kind: 'rate',
    key: '2026-07-20',
    notify: true,
    facts: { output: 250_000, target: 130_000, fill: 1.9, peakHour: 140_000, costCents: 8362, away: 4, endedAt: 2 },
  }

  for (const kind of Object.keys(QUIPS) as Array<keyof typeof QUIPS>) {
    assert.equal(QUIPS[kind].length, 4, `${kind} does not have four lines`)
    for (let slot = 0; slot < 4; slot++) {
      const text = pickQuip({ ...event, kind }, [], 20_000).text
      assert.ok(!text.includes('{'), `unresolved placeholder in ${kind}: ${text}`)
      assert.ok(text.length > 10)
    }
  }
})

test('a line is not repeated inside the cooldown', () => {
  const event: Event = {
    kind: 'late',
    key: '2026-08-01',
    notify: true,
    facts: { output: 1, target: 1, fill: 1, peakHour: 1, costCents: 1, away: 0, endedAt: 2 },
  }

  const history: Fired[] = []
  const dayZero = 20_000
  const used = new Set<number>()

  // Four consecutive days must use all four lines before any repeats.
  for (let i = 0; i < 4; i++) {
    const key = `2026-08-0${i + 1}`
    const picked = pickQuip({ ...event, key }, history, dayZero + i)
    assert.ok(!used.has(picked.slot), `line ${picked.slot} repeated on day ${i}`)
    used.add(picked.slot)
    history.push({ key, kind: 'late', slot: picked.slot })
  }
  assert.equal(used.size, 4)

  // Once every line is on cooldown the pool is released rather than failing.
  const fifth = pickQuip({ ...event, key: '2026-08-05' }, history, dayZero + 4)
  assert.ok(fifth.text.length > 0)

  // And after the cooldown expires the first line is available again.
  const later = pickQuip({ ...event, key: '2026-09-20' }, history, dayZero + COOLDOWN_DAYS + 5)
  assert.ok(later.text.length > 0)
})

test('the same day always gets the same words', () => {
  const event: Event = {
    kind: 'blown',
    key: '2026-08-03',
    notify: false,
    facts: { output: 850_000, target: 100_000, fill: 4, peakHour: 165_000, costCents: 31563, away: 0, endedAt: 23 },
  }
  assert.equal(pickQuip(event, [], 20_000).text, pickQuip(event, [], 20_000).text)
})

test('an exhausted pool reuses the stalest line, not a random one', () => {
  const event: Event = {
    kind: 'rate',
    key: '2026-08-20',
    notify: true,
    facts: { output: 1, target: 1, fill: 1, peakHour: 1, costCents: 1, away: 0, endedAt: 12 },
  }

  // All four lines used, slot 2 longest ago. With everything on cooldown the
  // pick must be slot 2 — hashing again could land on yesterday's line.
  const history: Fired[] = [
    { key: '2026-08-01', kind: 'rate', slot: 2 },
    { key: '2026-08-10', kind: 'rate', slot: 0 },
    { key: '2026-08-15', kind: 'rate', slot: 3 },
    { key: '2026-08-19', kind: 'rate', slot: 1 },
  ]

  assert.equal(pickQuip(event, history, 20_680).slot, 2)
})

test('history from another condition does not gag this one', () => {
  const event: Event = {
    kind: 'dead',
    key: '2026-08-20',
    notify: false,
    facts: { output: 0, target: 1, fill: 0, peakHour: 0, costCents: 0, away: 1, endedAt: null },
  }
  const noise: Fired[] = [0, 1, 2, 3].map((slot) => ({ key: '2026-08-19', kind: 'rate' as const, slot }))
  const picked = pickQuip(event, noise, 20_680)
  assert.ok(QUIPS.dead.includes(picked.text), 'picked from the wrong pool')
})
