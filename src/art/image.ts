import { drawingsForTier, type Drawing } from './library.ts'
import { colourCounts, paint, type Grid } from './shapes.ts'
import { TIERS } from '../core/tiers.ts'

/**
 * Turning a drawing plus a fill fraction into pixels. SPEC §6.
 *
 * The picture is never MISSING — it is grayscale from the first moment, full
 * composition and full detail, just desaturated. Colour then spreads through it,
 * so a partial image always reads as a picture; the only question is whether the
 * pattern of colour looks deliberate.
 *
 * Two layers make it look deliberate:
 *
 *   1. Palette order, authored. Which THING gains colour next is a decision the
 *      drawing carries with it — subject first, background last.
 *   2. Bottom-up within each colour. So progress is continuous to the pixel
 *      rather than jumping a whole band at a time.
 *
 * Bands are weighted by pixel count, not counted equally. If sky is 60% of the
 * pixels and an eye is four of them, equal weighting stalls the fill visibly on
 * the sky and blinks straight through the eye.
 */

export type Image = {
  id: string
  tier: number
  size: number
  palette: string[]
  order: number[]
  grid: Grid
  /** Pixel indices grouped by palette entry, each pre-sorted bottom-up. */
  bands: Map<number, number[]>
  /** Non-transparent pixels. The denominator for every fill calculation. */
  total: number
  /**
   * Subject pixels, sorted bottom-up — the tray icon's vessel.
   *
   * Scenery is excluded, because a scenic drawing covers the whole canvas and
   * its "silhouette" would be a filled square: no shape to recognise and no
   * outside for the overexposure ring to occupy (SPEC §11).
   */
  subject: number[]
  /** Parallel to the grid: 1 where a pixel belongs to the subject. */
  subjectMask: Uint8Array
}

/** Renders a drawing at the canvas size its tier calls for. */
export function render(drawing: Drawing, size?: number): Image {
  // A raster drawing is already at the grid its artist chose; only authored
  // shape lists are resolution-independent.
  const canvas = drawing.raster
    ? drawing.raster.size
    : size ?? TIERS.find((tier) => tier.index === drawing.tier)?.canvas ?? 32

  const grid = drawing.raster
    ? { size: canvas, pixels: Int8Array.from(drawing.raster.pixels) }
    : paint(canvas, drawing.shapes ?? [])

  const bands = new Map<number, number[]>()
  for (let i = 0; i < grid.pixels.length; i++) {
    const colour = grid.pixels[i]!
    if (colour < 0) continue
    const band = bands.get(colour)
    if (band) band.push(i)
    else bands.set(colour, [i])
  }

  // Bottom-up: higher y first, and within a row left to right so the advance is
  // steady rather than jittering across the canvas.
  for (const band of bands.values()) {
    band.sort((a, b) => {
      const ay = Math.floor(a / canvas)
      const by = Math.floor(b / canvas)
      return ay === by ? a - b : by - ay
    })
  }

  let total = 0
  for (const count of colourCounts(grid).values()) total += count

  const scenery = new Set(drawing.background)
  const subject: number[] = []
  for (const [colour, band] of bands) {
    if (!scenery.has(colour)) subject.push(...band)
  }
  const subjectMask = new Uint8Array(grid.pixels.length)
  for (const index of subject) subjectMask[index] = 1

  subject.sort((a, b) => {
    const ay = Math.floor(a / canvas)
    const by = Math.floor(b / canvas)
    return ay === by ? a - b : by - ay
  })

  return {
    id: drawing.id,
    tier: drawing.tier,
    size: canvas,
    palette: drawing.palette,
    order: drawing.order,
    grid,
    bands,
    total,
    subject,
    subjectMask,
  }
}

/**
 * Which pixels are coloured at a given fill.
 *
 * Returns a mask parallel to `grid.pixels`: true means "show the palette
 * colour", false means "show the grey". Fill above 1 saturates the mask — the
 * overshoot is expressed by `overexposure`, not by colouring more pixels,
 * because there are no more pixels to colour.
 */
export function colourMask(image: Image, fill: number): Uint8Array {
  const mask = new Uint8Array(image.grid.pixels.length)
  if (fill <= 0 || image.total === 0) return mask

  let budget = Math.min(fill, 1) * image.total

  for (const colour of image.order) {
    if (budget <= 0) break
    const band = image.bands.get(colour)
    if (!band || band.length === 0) continue

    const take = Math.min(band.length, Math.round(budget))
    for (let i = 0; i < take; i++) mask[band[i]!] = 1
    budget -= band.length
  }

  return mask
}

/**
 * How far past full a day went, as 0..1. SPEC §7.
 *
 * The renderer maps this onto saturation and bloom: past 100% the image keeps
 * colouring past natural, and at the extreme it is blown out. Kept as a separate
 * scalar so the mask stays a simple boolean and the bleach is one multiply.
 */
export function overexposure(fill: number, cap: number): number {
  if (fill <= 1 || cap <= 1) return 0
  return Math.min(1, (fill - 1) / (cap - 1))
}

/**
 * The grey a colour desaturates to.
 *
 * Rec. 709 luminance, then pulled toward mid-grey. Pure luminance makes a dark
 * navy sky almost black, which reads as a hole in the picture rather than as an
 * uncoloured region — the whole composition has to stay legible while grey.
 */
export function greyOf(hex: string): string {
  const { r, g, b } = parseHex(hex)
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const flattened = Math.round(luma * 0.55 + 128 * 0.45)
  const channel = flattened.toString(16).padStart(2, '0')
  return `#${channel}${channel}${channel}`
}

/** Pushes a colour past its natural saturation, toward white at the extreme. */
export function overexposed(hex: string, amount: number): string {
  if (amount <= 0) return hex
  const { r, g, b } = parseHex(hex)
  const boost = 1 + amount * 0.7
  const toward = amount * amount * 0.75
  const channel = (value: number): string => {
    const lifted = Math.min(255, value * boost)
    const blown = lifted + (255 - lifted) * toward
    return Math.round(Math.min(255, blown)).toString(16).padStart(2, '0')
  }
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

export function parseHex(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

/**
 * The image a day shows, resolved from its stored id.
 *
 * `imageFor` in tiers.ts produces ids like `t2-3`; the wall stores that string,
 * so the picture a sealed day shows can never drift even if the library is
 * reordered later — the slot is what was written down.
 */
export function resolve(imageId: string): Image {
  const match = /^t(\d+)-(\d+)$/.exec(imageId)
  const tier = match ? Number(match[1]) : 2
  const slot = match ? Number(match[2]) : 0

  const pool = drawingsForTier(tier)
  const drawing = pool.length > 0 ? pool[slot % pool.length]! : drawingsForTier(2)[0]!
  return render(drawing)
}

/** How many drawings exist per tier — what `imageFor` needs to pick a slot. */
export function poolSizes(): Record<number, number> {
  return {
    1: drawingsForTier(1).length,
    2: drawingsForTier(2).length,
    3: drawingsForTier(3).length,
  }
}
