import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULTS, normalise, type Config } from '../src/core/config.ts'
import { Pigment } from '../src/core/app.ts'
import { Tail } from '../src/core/tail.ts'

/**
 * SPEC §8's always-on path.
 *
 * `readAll` is exercised every time the replay tool runs against 267 MB of real
 * logs. `sweep` is not — it is the code that runs every few seconds for as long
 * as the app is installed, and its failure modes (a cursor left mid-line, a
 * rotated file read from a stale offset, a record counted twice) all present
 * downstream as "the icon sometimes doesn't update". So it gets driven here
 * against a directory that is appended to, truncated and deleted underneath it.
 */

function fixture(): { dir: string; config: Config; file: (name: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), 'pigment-tail-'))
  mkdirSync(join(dir, 'projects', 'a-project'), { recursive: true })
  return {
    dir,
    config: normalise({ ...DEFAULTS, root: dir }),
    file: (name: string) => join(dir, 'projects', 'a-project', name),
  }
}

let counter = 0

/** One assistant record, newline-terminated. `output` is the only thing varied. */
function line(output: number, at = '2026-08-11T13:00:00.000Z'): string {
  counter += 1
  return `${JSON.stringify({
    type: 'assistant',
    timestamp: at,
    message: { id: `msg_${counter}`, usage: { output_tokens: output } },
  })}\n`
}

function sum(records: Array<{ usage: { output: number } }>): number {
  return records.reduce((total, record) => total + record.usage.output, 0)
}

test('a sweep returns only what was appended since the last one', async () => {
  const { dir, config, file } = fixture()
  try {
    writeFileSync(file('one.jsonl'), line(100) + line(200))
    const tail = new Tail(config)

    assert.equal(sum(await tail.sweep()), 300, 'first sweep missed the existing content')
    assert.equal((await tail.sweep()).length, 0, 'an unchanged file was re-read')

    appendFileSync(file('one.jsonl'), line(50))
    assert.equal(sum(await tail.sweep()), 50, 'the append was not read incrementally')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a record split across two sweeps is read exactly once, when it completes', async () => {
  const { dir, config, file } = fixture()
  try {
    const whole = line(500)
    const cut = Math.floor(whole.length / 2)

    // Claude Code is mid-write: the file ends in half a record.
    writeFileSync(file('partial.jsonl'), whole.slice(0, cut))
    const tail = new Tail(config)

    assert.equal((await tail.sweep()).length, 0, 'a half-written record was parsed')

    appendFileSync(file('partial.jsonl'), whole.slice(cut))
    const completed = await tail.sweep()
    assert.equal(completed.length, 1, 'the completed record was lost')
    assert.equal(sum(completed), 500)

    assert.equal((await tail.sweep()).length, 0, 'the record came back a second time')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a partial line is held across many sweeps, one byte at a time', async () => {
  const { dir, config, file } = fixture()
  try {
    const whole = line(777)
    writeFileSync(file('drip.jsonl'), '')
    const tail = new Tail(config)
    await tail.sweep()

    let seen = 0
    for (const char of whole) {
      appendFileSync(file('drip.jsonl'), char)
      seen += (await tail.sweep()).length
    }

    assert.equal(seen, 1, `record surfaced ${seen} times under byte-at-a-time writes`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a truncated file is re-read from the start, not from a stale offset', async () => {
  const { dir, config, file } = fixture()
  try {
    writeFileSync(file('rotated.jsonl'), line(100) + line(200) + line(300))
    const tail = new Tail(config)
    assert.equal(sum(await tail.sweep()), 600)

    // Rotation: the path now holds a shorter, different file. Reading from the
    // old offset would land mid-line and silently drop everything before it.
    writeFileSync(file('rotated.jsonl'), line(42))
    assert.equal(sum(await tail.sweep()), 42, 'the rotated file was read from a stale offset')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a file appended to long after creation is still followed', async () => {
  // 39 of 179 real files were appended more than 24h after creation — resumed
  // sessions are normal, so a tail that assumed append-once would lose them.
  const { dir, config, file } = fixture()
  try {
    writeFileSync(file('resumed.jsonl'), line(100))
    const tail = new Tail(config)
    await tail.sweep()

    appendFileSync(file('resumed.jsonl'), line(900, '2026-08-12T09:00:00.000Z'))
    assert.equal(sum(await tail.sweep()), 900)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a file that appears after the first walk is picked up', async () => {
  const { dir, config, file } = fixture()
  try {
    writeFileSync(file('first.jsonl'), line(100))
    const tail = new Tail(config)
    await tail.sweep()

    writeFileSync(file('second.jsonl'), line(250))
    // The walk runs on its own cadence; the caller drives it.
    await tail.refresh()
    assert.equal(sum(await tail.sweep()), 250, 'a new session file was never seen')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a deleted file does not throw and triggers a re-walk', async () => {
  const { dir, config, file } = fixture()
  try {
    writeFileSync(file('doomed.jsonl'), line(100))
    writeFileSync(file('survivor.jsonl'), line(200))
    const tail = new Tail(config)
    await tail.sweep()

    rmSync(file('doomed.jsonl'))
    assert.equal((await tail.sweep()).length, 0)

    // The stale list was invalidated, so a file added now is seen without an
    // explicit refresh.
    writeFileSync(file('third.jsonl'), line(300))
    assert.equal(sum(await tail.sweep()), 300)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a missing log directory yields nothing rather than throwing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pigment-empty-'))
  try {
    const tail = new Tail(normalise({ ...DEFAULTS, root: dir }))
    assert.equal((await tail.sweep()).length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readAll leaves the cursors at EOF, so the next sweep is not a re-read', async () => {
  const { dir, config, file } = fixture()
  try {
    writeFileSync(file('one.jsonl'), line(100) + line(200))
    const tail = new Tail(config)

    assert.equal(sum(await tail.readAll(0)), 300)
    assert.equal((await tail.sweep()).length, 0, 'backfill and the first sweep double-counted')

    appendFileSync(file('one.jsonl'), line(7))
    assert.equal(sum(await tail.sweep()), 7)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- the composition seam ----------------------------------------------------

test('start then tick accumulates without double-counting', async () => {
  const { dir, config, file } = fixture()
  try {
    const at = new Date(2026, 7, 11, 13, 0).toISOString()
    writeFileSync(file('live.jsonl'), line(120_000, at))

    const pigment = new Pigment(config, join(dir, 'wall.json'))
    const now = new Date(2026, 7, 11, 14, 0).getTime()

    const first = await pigment.start(now)
    assert.equal(first.today.totals.output, 120_000)
    assert.equal(first.today.key, '2026-08-11')

    // A tick with nothing new must not change the day.
    const idle = await pigment.tick(now)
    assert.equal(idle.ingested, 0)
    assert.equal(idle.today.totals.output, 120_000)

    appendFileSync(file('live.jsonl'), line(30_000, at))
    const after = await pigment.tick(now)
    assert.equal(after.ingested, 1)
    assert.equal(after.today.totals.output, 150_000, 'the append was lost or counted twice')

    // Today must not feed its own target, or the fill can never move.
    assert.equal(after.today.target, first.today.target, 'today calibrated against itself')
    assert.ok(after.today.fill > first.today.fill, 'more tokens did not colour more of the image')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a restarted process resumes from the sealed wall on disk', async () => {
  const { dir, config, file } = fixture()
  try {
    const store = join(dir, 'wall.json')
    const old = new Date(2026, 7, 1, 13, 0).toISOString()
    writeFileSync(file('old.jsonl'), line(300_000, old))

    const now = new Date(2026, 7, 11, 14, 0).getTime()
    const first = await new Pigment(config, store).start(now)
    const sealedTarget = first.wall.days.find((day) => day.key === '2026-08-01')!.targetAfter

    // A fresh process, same store: the sealed day must come back identical and
    // the controller must resume from it rather than reseeding.
    const second = new Pigment(config, store)
    const resumed = await second.start(now)

    assert.ok(second.peek().days.length > 0, 'nothing was sealed to disk')
    const reloaded = resumed.wall.days.find((day) => day.key === '2026-08-01')!
    assert.equal(reloaded.targetAfter, sealedTarget)
    assert.equal(resumed.wall.days.length, first.wall.days.length)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a tick that changes nothing does not rewrite the store', async () => {
  const { dir, config, file } = fixture()
  try {
    const store = join(dir, 'wall.json')
    writeFileSync(file('old.jsonl'), line(300_000, new Date(2026, 7, 1, 13, 0).toISOString()))

    const now = new Date(2026, 7, 11, 14, 0).getTime()
    const pigment = new Pigment(config, store)
    await pigment.start(now)

    const before = pigment.peek()
    await pigment.tick(now)
    assert.equal(pigment.peek(), before, 'an idle tick replaced the store object')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- SPEC §11: the icon --------------------------------------------------------

test('the icon encodes a valid PNG at every fill, including empty and blown out', async () => {
  const { iconPng, iconStep } = await import('../src/main/icon.ts')

  for (const state of [
    { imageId: 't1-0', fill: 0, overfillCap: 4 },
    { imageId: 't2-1', fill: 0.5, overfillCap: 4 },
    { imageId: 't3-2', fill: 1, overfillCap: 4 },
    { imageId: 't2-3', fill: 3.9, overfillCap: 4 },
    { imageId: '', fill: 0, overfillCap: 4, empty: true },
  ]) {
    const png = iconPng(state)
    assert.deepEqual(
      [...png.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      'not a PNG',
    )
    assert.ok(png.length > 60, 'suspiciously small icon')
  }

  // The redraw gate: a 2% step, so a working day costs ~50 redraws not ~17,000.
  assert.equal(iconStep(0.5), iconStep(0.509))
  assert.notEqual(iconStep(0.5), iconStep(0.53))
})

type Pixel = { r: number; g: number; b: number; a: number }

/** Opaque and partially-opaque pixels of a rendered icon. */
async function iconPixels(state: {
  imageId: string
  fill: number
  overfillCap: number
  empty?: boolean
  dark?: boolean
}): Promise<{ solid: Pixel[]; halo: Pixel[]; size: number }> {
  const { iconPng } = await import('../src/main/icon.ts')
  const { decodePng } = await import('../src/art/png.ts')
  const png = decodePng(iconPng(state))

  const solid: Pixel[] = []
  const halo: Pixel[] = []
  for (let i = 0; i < png.width * png.height; i++) {
    const o = i * 4
    const px = { r: png.data[o]!, g: png.data[o + 1]!, b: png.data[o + 2]!, a: png.data[o + 3]! }
    if (px.a === 255) solid.push(px)
    else if (px.a > 0) halo.push(px)
  }
  return { solid, halo, size: png.width }
}

const saturated = (p: { r: number; g: number; b: number }): boolean =>
  Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b) > 24

// --- SPEC §11 phase 2: the icon carries colour --------------------------------

test('an unstarted day is grey and a finished one is not', async () => {
  const fresh = await iconPixels({ imageId: 't2-1', fill: 0, overfillCap: 4 })
  assert.ok(fresh.solid.length > 0, 'nothing was drawn')
  assert.equal(fresh.solid.some(saturated), false, 'colour appeared before any tokens were spent')

  const done = await iconPixels({ imageId: 't2-1', fill: 1, overfillCap: 4 })
  assert.ok(done.solid.filter(saturated).length > 20, 'a finished day should be visibly coloured')
})

test('colour rises from the bottom as the day fills', async () => {
  const { iconPng } = await import('../src/main/icon.ts')
  const { decodePng } = await import('../src/art/png.ts')

  const litRows = async (fill: number): Promise<number[]> => {
    const png = decodePng(iconPng({ imageId: 't2-1', fill, overfillCap: 4 }))
    const rows: number[] = []
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const o = (y * png.width + x) * 4
        const px = { r: png.data[o]!, g: png.data[o + 1]!, b: png.data[o + 2]! }
        if (png.data[o + 3] === 255 && saturated(px)) {
          rows.push(y)
          break
        }
      }
    }
    return rows
  }

  const half = await litRows(0.5)
  const full = await litRows(1)
  assert.ok(half.length > 0, 'half a day coloured nothing')
  assert.ok(full.length > half.length, 'more fill must colour more of the shape')

  // Everything coloured at half fill sits in the lower part: a water line, not
  // a wash. The popover's palette order would scatter colour instead.
  const { size } = await iconPixels({ imageId: 't2-1', fill: 0.5, overfillCap: 4 })
  assert.ok(Math.min(...half) > size * 0.3, 'colour reached the top before the bottom was full')
})

test('every icon carries a halo, and it flips with the menu bar', async () => {
  // A non-template colour icon gets no system tinting: without contrast it
  // disappears against a menu bar of a similar shade.
  const onLight = await iconPixels({ imageId: 't2-1', fill: 0.6, overfillCap: 4, dark: false })
  const onDark = await iconPixels({ imageId: 't2-1', fill: 0.6, overfillCap: 4, dark: true })

  assert.ok(onLight.halo.length > 10, 'no halo drawn for a light menu bar')
  assert.ok(onDark.halo.length > 10, 'no halo drawn for a dark menu bar')

  const brightness = (list: Pixel[]): number =>
    list.reduce((sum, p) => sum + p.r + p.g + p.b, 0) / Math.max(list.length, 1)

  assert.ok(
    brightness(onDark.halo) > brightness(onLight.halo) + 100,
    'the halo does not change with the menu bar appearance',
  )
})

test('overexposure is visible in shape as well as colour', async () => {
  const normal = await iconPixels({ imageId: 't2-1', fill: 1, overfillCap: 4, dark: true })
  const blown = await iconPixels({ imageId: 't2-1', fill: 3, overfillCap: 4, dark: true })

  // Roughly 8% of male viewers cannot rely on a hue cue, so the bloom also gets
  // denser — legible without seeing the colour change at all.
  const opacity = (list: Pixel[]): number =>
    list.reduce((sum, p) => sum + p.a, 0) / Math.max(list.length, 1)
  assert.ok(opacity(blown.halo) > opacity(normal.halo), 'the bloom is a colour-only cue')
})

test('no data at all is a different shape, not merely a paler one', async () => {
  const empty = await iconPixels({ imageId: '', fill: 0, overfillCap: 4, empty: true })
  const day = await iconPixels({ imageId: 't2-1', fill: 0, overfillCap: 4 })

  // A hollow square: nothing fully opaque, and a real day fills far more of the
  // canvas. "Nothing yet" must never read as "a day that barely started".
  assert.equal(empty.solid.length, 0)
  assert.ok(empty.halo.length > 20)
  assert.ok(day.solid.length > empty.halo.length, 'a real day should be more filled in')
})
