import { test } from 'node:test'
import assert from 'node:assert/strict'
import { colourMask, greyOf, overexposed, overexposure, parseHex, poolSizes, render, resolve } from '../src/art/image.ts'
import { LIBRARY, drawingsForTier } from '../src/art/library.ts'
import { TIERS } from '../src/core/tiers.ts'

/** Fraction of an image's pixels that are coloured at a given fill. */
function coloured(image: ReturnType<typeof render>, fill: number): number {
  const mask = colourMask(image, fill)
  let on = 0
  for (const value of mask) on += value
  return on / image.total
}

// --- the library is well-formed ----------------------------------------------

test('every drawing declares a fill order covering exactly the colours it uses', () => {
  for (const drawing of LIBRARY) {
    const image = render(drawing)
    const used = [...image.bands.keys()].sort((a, b) => a - b)
    const ordered = [...drawing.order].sort((a, b) => a - b)

    assert.deepEqual(ordered, used, `${drawing.id}: order and used colours disagree`)
    assert.equal(new Set(drawing.order).size, drawing.order.length, `${drawing.id}: duplicate in order`)
    for (const index of drawing.order) {
      assert.ok(drawing.palette[index], `${drawing.id}: order references missing palette entry ${index}`)
    }
  }
})

test('every tier has a pool of at least four, so repeats are not weekly', () => {
  const pools = poolSizes()
  for (const tier of [1, 2, 3]) {
    assert.ok((pools[tier] ?? 0) >= 4, `tier ${tier} has only ${pools[tier]} drawings`)
  }
})

test('each drawing renders at its tier canvas and fills it', () => {
  for (const drawing of LIBRARY) {
    const image = render(drawing)
    const tier = TIERS.find((t) => t.index === drawing.tier)!

    // An imported picture keeps the grid its artist drew on; rescaling pixel
    // art by a non-integer factor is what destroys it.
    const expected = drawing.raster ? drawing.raster.size : tier.canvas
    assert.equal(image.size, expected, `${drawing.id}: wrong canvas`)
    assert.ok(image.total > 0, `${drawing.id}: rendered empty`)
    // Tier-1 drawings are silhouettes on transparency by design — that is what
    // gives the tray icon a shape to fill. So the floor is "clearly a picture",
    // not "covers the canvas".
    const floor = drawing.tier === 1 ? 0.15 : 0.5
    assert.ok(
      image.total > image.size * image.size * floor,
      `${drawing.id}: only ${image.total} of ${image.size ** 2} pixels painted`,
    )
  }
})

test('an authored drawing renders at any canvas size, so tiers are not separate art', () => {
  const drawing = drawingsForTier(2).find((d) => d.shapes)!
  for (const size of [16, 22, 32, 48, 64]) {
    const image = render(drawing, size)
    assert.equal(image.size, size)
    assert.ok(image.total > 0)
  }
})

// --- SPEC §6: the fill ---------------------------------------------------------

test('fill is monotonic — more tokens never un-colour a pixel', () => {
  for (const drawing of LIBRARY) {
    const image = render(drawing)
    let previous: ReturnType<typeof colourMask> = new Uint8Array(image.grid.pixels.length)

    for (let fill = 0; fill <= 1.0001; fill += 0.05) {
      const mask = colourMask(image, fill)
      for (let i = 0; i < mask.length; i++) {
        assert.ok(
          mask[i]! >= previous[i]!,
          `${drawing.id}: pixel ${i} lost its colour between ${(fill - 0.05).toFixed(2)} and ${fill.toFixed(2)}`,
        )
      }
      previous = mask
    }
  }
})

test('0% colours nothing and 100% colours everything', () => {
  for (const drawing of LIBRARY) {
    const image = render(drawing)
    assert.equal(coloured(image, 0), 0, `${drawing.id}: something was coloured at zero`)
    assert.equal(coloured(image, 1), 1, `${drawing.id}: not finished at full`)
  }
})

test('the coloured fraction tracks the fill fraction closely', () => {
  // This is what makes the bar honest: 40% filled must look like 40% of the
  // picture, not 40% of the palette entries.
  for (const drawing of LIBRARY) {
    const image = render(drawing)
    for (const fill of [0.15, 0.3, 0.5, 0.7, 0.9]) {
      const actual = coloured(image, fill)
      assert.ok(
        Math.abs(actual - fill) < 0.05,
        `${drawing.id}: at ${fill} fill, ${(actual * 100).toFixed(0)}% of pixels were coloured`,
      )
    }
  }
})

test('the subject colours before the background', () => {
  // The authored contract: at 40% you want a coloured subject on a grey field.
  // Backgrounds are painted first and listed last, so they are the largest band
  // that remains untouched early on.
  for (const drawing of LIBRARY) {
    const image = render(drawing)
    const mask = colourMask(image, 0.4)

    const lastColour = drawing.order[drawing.order.length - 1]!
    const background = image.bands.get(lastColour)!
    const litBackground = background.filter((index) => mask[index] === 1).length

    assert.ok(
      litBackground / background.length < 0.35,
      `${drawing.id}: background was ${((litBackground / background.length) * 100).toFixed(0)}% coloured at 40% fill`,
    )
  }
})

test('within a colour, pixels fill from the bottom up', () => {
  const image = render(drawingsForTier(1)[0]!)
  const first = image.order[0]!
  const band = image.bands.get(first)!

  // Take a fill small enough to be inside the first band.
  const fraction = (band.length * 0.5) / image.total
  const mask = colourMask(image, fraction)

  const lit = band.filter((index) => mask[index] === 1)
  const unlit = band.filter((index) => mask[index] === 0)
  assert.ok(lit.length > 0 && unlit.length > 0, 'the band was not partially filled')

  const lowestUnlit = Math.min(...unlit.map((index) => Math.floor(index / image.size)))
  const highestLit = Math.max(...lit.map((index) => Math.floor(index / image.size)))
  assert.ok(highestLit >= lowestUnlit, 'colour rose from the top instead of the bottom')
})

test('a four-pixel band does not take as long as a huge one', () => {
  // Weighted by area, not counted equally — otherwise the fill visibly stalls.
  const image = render(drawingsForTier(2).find((d) => d.id === 'fox')!)
  const sizes = [...image.bands.values()].map((band) => band.length).sort((a, b) => a - b)
  const smallest = sizes[0]!
  const largest = sizes[sizes.length - 1]!
  assert.ok(largest > smallest * 3, 'test needs a drawing with uneven bands')

  // The small band should be crossed in far less fill than the large one.
  const spanOf = (target: number): number => {
    let start = -1
    for (let fill = 0; fill <= 1.0001; fill += 0.01) {
      const lit = coloured(image, fill)
      if (start < 0 && lit > 0) start = fill
    }
    return target
  }
  spanOf(0)

  const smallSpan = smallest / image.total
  const largeSpan = largest / image.total
  assert.ok(largeSpan > smallSpan * 3, 'bands are not area-weighted')
})

// --- SPEC §7: overexposure ----------------------------------------------------

test('overexposure is zero until full, then climbs to one at the cap', () => {
  assert.equal(overexposure(0.5, 4), 0)
  assert.equal(overexposure(1, 4), 0)
  assert.equal(overexposure(2.5, 4), 0.5)
  assert.equal(overexposure(4, 4), 1)
  assert.equal(overexposure(9, 4), 1, 'past the cap must clamp, not keep rising')
})

test('an overexposed colour moves toward white and never past it', () => {
  const base = '#c0392b'
  assert.equal(overexposed(base, 0), base)

  const mild = parseHex(overexposed(base, 0.3))
  const extreme = parseHex(overexposed(base, 1))
  const original = parseHex(base)

  assert.ok(mild.r >= original.r && mild.g >= original.g)
  assert.ok(extreme.r >= mild.r && extreme.g >= mild.g && extreme.b >= mild.b)
  for (const channel of [extreme.r, extreme.g, extreme.b]) {
    assert.ok(channel <= 255 && channel >= 0)
  }
})

test('grey keeps dark colours legible instead of turning them into holes', () => {
  const nightSky = parseHex(greyOf('#1b2631'))
  assert.ok(nightSky.r > 60, `a near-black sky greyed to ${nightSky.r}, which reads as a hole`)

  // Order is still preserved: lighter colours grey lighter.
  assert.ok(parseHex(greyOf('#ecf0f1')).r > parseHex(greyOf('#2c3e50')).r)
  const grey = parseHex(greyOf('#e67e22'))
  assert.equal(grey.r, grey.g)
  assert.equal(grey.g, grey.b)
})

// --- resolution ---------------------------------------------------------------

test('an image id resolves to the same picture every time', () => {
  assert.equal(resolve('t2-1').id, resolve('t2-1').id)
  assert.equal(resolve('t1-0').tier, 1)
  assert.equal(resolve('t3-2').tier, 3)
})

test('an unknown or out-of-range id still yields a picture rather than throwing', () => {
  assert.ok(resolve('t2-99').total > 0)
  assert.ok(resolve('nonsense').total > 0)
})

// --- SPEC §11: the tray silhouette --------------------------------------------

test('every drawing has a subject silhouette that is not the whole canvas', () => {
  // A scenic drawing covers the frame, so without marked scenery its
  // "silhouette" is a filled square: no shape, and no outside for the ring.
  for (const drawing of LIBRARY) {
    const image = render(drawing)
    assert.ok(image.subject.length > 0, `${drawing.id}: no subject at all`)
    assert.ok(
      image.subject.length < image.size * image.size * 0.8,
      `${drawing.id}: subject covers ${((image.subject.length / image.size ** 2) * 100).toFixed(0)}% of the canvas — the icon would be a square`,
    )
  }
})

test('scenery is excluded from the silhouette but still in the picture', () => {
  for (const drawing of LIBRARY) {
    const image = render(drawing)
    for (const scenery of drawing.background) {
      const band = image.bands.get(scenery)!
      assert.ok(band.length > 0, `${drawing.id}: scenery ${scenery} is not in the drawing`)
      for (const index of band) {
        assert.equal(image.subjectMask[index], 0, `${drawing.id}: scenery leaked into the silhouette`)
      }
    }
  }
})

test('the silhouette is ordered bottom-up so the icon fills like a vessel', () => {
  const image = render(drawingsForTier(2).find((d) => d.id === 'fox')!)
  const rows = image.subject.map((index) => Math.floor(index / image.size))
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i]! <= rows[i - 1]!, 'silhouette pixels are not ordered bottom-up')
  }
})

// --- the PNG importer ----------------------------------------------------------

test('the decoder round-trips what the encoder writes', async () => {
  const { encodePng } = await import('../src/main/png.ts')
  const { decodePng } = await import('../src/art/png.ts')

  // A pattern that exercises every filter path: flat runs, vertical gradients
  // and single-pixel changes.
  const png = encodePng(16, (x, y) => ({ r: x * 16, g: y * 16, b: (x ^ y) * 16, a: x === y ? 128 : 255 }))
  const back = decodePng(png)

  assert.equal(back.width, 16)
  assert.equal(back.height, 16)
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const o = (y * 16 + x) * 4
      assert.equal(back.data[o], x * 16, `red at ${x},${y}`)
      assert.equal(back.data[o + 1], y * 16, `green at ${x},${y}`)
      assert.equal(back.data[o + 3], x === y ? 128 : 255, `alpha at ${x},${y}`)
    }
  }
})

test('the importer recovers the artist grid from an upscaled file', async () => {
  const { encodePng } = await import('../src/main/png.ts')
  const { importPng, guessOrder } = await import('../src/art/import.ts')

  // An 8x8 picture saved at 7x: a red square on a blue field, plus a single
  // one-pixel dot. The dot matters — without a feature that is exactly one art
  // pixel wide, a coarser grid is also uniform and the detector would rightly
  // return that instead (see the note on minimal grids in import.ts).
  const BLOCK = 7
  const png = encodePng(8 * BLOCK, (x, y) => {
    const gx = Math.floor(x / BLOCK)
    const gy = Math.floor(y / BLOCK)
    const middle = gx >= 2 && gx <= 5 && gy >= 2 && gy <= 5
    if (gx === 1 && gy === 6) return { r: 200, g: 30, b: 30, a: 255 }
    return middle ? { r: 200, g: 30, b: 30, a: 255 } : { r: 30, g: 60, b: 200, a: 255 }
  })

  const imported = importPng(png)
  assert.equal(imported.block, BLOCK, 'did not find the upscale factor')
  assert.equal(imported.size, 8, 'did not recover the artist grid')
  assert.equal(imported.palette.length, 2)

  // The blue reaches the border, the red does not — that is the scenery guess.
  const blue = imported.palette.indexOf('#1e3cc8')
  const red = imported.palette.indexOf('#c81e1e')
  assert.deepEqual(imported.edge, [blue])
  assert.deepEqual(guessOrder(imported), [red, blue], 'subject must colour before scenery')
})

test('transparent pixels import as outside the picture', async () => {
  const { encodePng } = await import('../src/main/png.ts')
  const { importPng } = await import('../src/art/import.ts')

  const png = encodePng(8, (x) => (x < 4 ? { r: 10, g: 200, b: 10, a: 255 } : { r: 0, g: 0, b: 0, a: 0 }))
  const imported = importPng(png)

  assert.equal(imported.palette.length, 1)
  assert.equal(imported.pixels.filter((p) => p === -1).length, imported.size * imported.size / 2)
})

test('a photo is refused rather than imported as a 4000-colour drawing', async () => {
  const { encodePng } = await import('../src/main/png.ts')
  const { importPng } = await import('../src/art/import.ts')

  const gradient = encodePng(64, (x, y) => ({ r: x * 4, g: y * 4, b: (x + y) * 2, a: 255 }))
  assert.throws(() => importPng(gradient), /not pixel art/)
})

test('the imported cassette is a well-formed drawing', () => {
  const cassette = LIBRARY.find((d) => d.id === 'cassette')
  assert.ok(cassette, 'the cassette was never registered in the library')

  const image = render(cassette)
  assert.equal(image.size, 64, 'the 64x64 grid was not preserved')
  assert.equal(image.palette.length, 10)

  // Same contract every authored drawing has to meet.
  const used = [...image.bands.keys()].sort((a, b) => a - b)
  assert.deepEqual([...cassette.order].sort((a, b) => a - b), used)
  assert.ok(image.subject.length > 0 && image.subject.length < 64 * 64 * 0.8)
})
