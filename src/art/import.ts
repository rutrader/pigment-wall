import { decodePng } from './png.ts'

/**
 * Turning a PNG into a drawing.
 *
 * The hard part is not decoding, it is recovering the ARTIST'S grid. Pixel art
 * is almost always exported upscaled — the cassette is a 64×64 picture saved at
 * 1216×1216, nineteen screen pixels per art pixel. Downsampling that by
 * averaging destroys exactly what makes it pixel art, so the importer finds the
 * block size instead and samples one pixel per block.
 */

export type Imported = {
  size: number
  /** Palette indices, row-major. -1 is transparent. */
  pixels: number[]
  palette: string[]
  /** Pixel count per palette index, for reporting and ordering. */
  counts: number[]
  /** Indices whose pixels touch the border — the scenery guess. */
  edge: number[]
  /** Screen pixels per art pixel in the source file. 1 when already native. */
  block: number
}

/** Above this a "palette" is really a gradient, and the art is not pixel art. */
const MAX_COLOURS = 64

export function importPng(buffer: Buffer, options: { maxSize?: number } = {}): Imported {
  const png = decodePng(buffer)
  if (png.width !== png.height) {
    throw new Error(`image must be square (got ${png.width}×${png.height})`)
  }

  const block = detectBlock(png, options.maxSize ?? 128)
  const size = png.width / block

  const palette: string[] = []
  const index = new Map<string, number>()
  const counts: number[] = []
  const pixels: number[] = new Array(size * size).fill(-1)
  const edge = new Set<number>()

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sample the block's centre: edges of a block can carry resampling
      // artefacts if the file was ever scaled by something that interpolated.
      const sx = Math.floor(x * block + block / 2)
      const sy = Math.floor(y * block + block / 2)
      const o = (sy * png.width + sx) * 4

      // Anything substantially transparent is outside the picture.
      if (png.data[o + 3]! < 128) continue

      const hex = rgbToHex(png.data[o]!, png.data[o + 1]!, png.data[o + 2]!)
      let slot = index.get(hex)
      if (slot === undefined) {
        slot = palette.length
        index.set(hex, slot)
        palette.push(hex)
        counts.push(0)
        if (palette.length > MAX_COLOURS) {
          throw new Error(
            `image has more than ${MAX_COLOURS} colours — this looks like a photo or a gradient, not pixel art`,
          )
        }
      }

      counts[slot] = counts[slot]! + 1
      pixels[y * size + x] = slot
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) edge.add(slot)
    }
  }

  return { size, pixels, palette, counts, edge: [...edge].sort((a, b) => a - b), block }
}

/**
 * The largest block size for which every block is a single flat colour.
 *
 * Uniformity is the signal: in genuine pixel art scaled up by N, every N×N
 * block is one colour, and no larger block is. Falling back to 1 means the file
 * is already at its native resolution.
 *
 * Note it finds the MINIMAL faithful grid, not necessarily the artist's. A
 * drawing whose every 2×2 art-pixel block happens to be uniform imports at half
 * the nominal resolution — which is lossless by definition (the blocks were
 * uniform) and simply a smaller, equivalent picture. Only art with at least one
 * single-pixel feature pins the grid exactly, which real pixel art almost
 * always has.
 */
function detectBlock(png: { width: number; data: Uint8Array }, maxSize: number): number {
  const candidates: number[] = []
  for (let block = 1; block <= png.width; block++) {
    if (png.width % block !== 0) continue
    if (png.width / block > maxSize) continue
    candidates.push(block)
  }

  // Largest first: the biggest uniform block is the artist's pixel.
  for (const block of candidates.reverse()) {
    if (uniform(png, block)) return block
  }
  return 1
}

function uniform(png: { width: number; data: Uint8Array }, block: number): boolean {
  if (block === 1) return true
  const size = png.width / block

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const base = ((y * block) * png.width + x * block) * 4
      for (let dy = 0; dy < block; dy++) {
        for (let dx = 0; dx < block; dx++) {
          const o = ((y * block + dy) * png.width + x * block + dx) * 4
          if (
            png.data[o] !== png.data[base] ||
            png.data[o + 1] !== png.data[base + 1] ||
            png.data[o + 2] !== png.data[base + 2] ||
            png.data[o + 3] !== png.data[base + 3]
          ) {
            return false
          }
        }
      }
    }
  }

  return true
}

/**
 * A first guess at the fill order: subject before scenery, big before small.
 *
 * Only a guess. Which thing should gain colour first is an authorial decision
 * (SPEC §6) and the importer cannot make it — but "everything that does not
 * touch the border, largest area first, then the border colours" is right often
 * enough to be worth starting from and correcting by eye.
 */
export function guessOrder(imported: Imported): number[] {
  const scenery = new Set(imported.edge)
  const byArea = (a: number, b: number): number => imported.counts[b]! - imported.counts[a]!

  const subject = imported.palette.map((_, i) => i).filter((i) => !scenery.has(i) && imported.counts[i]! > 0)
  const background = imported.palette.map((_, i) => i).filter((i) => scenery.has(i) && imported.counts[i]! > 0)

  return [...subject.sort(byArea), ...background.sort(byArea)]
}

function rgbToHex(r: number, g: number, b: number): string {
  const channel = (value: number): string => value.toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}
