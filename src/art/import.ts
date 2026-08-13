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

  const imported = collect(png, block, { x: 0, y: 0, w: size, h: size })
  // Untrimmed reads never return null; a fully transparent single image is the
  // caller's mistake and deserves saying so rather than a confusing empty
  // drawing later.
  if (!imported) throw new Error('image is entirely transparent')
  return imported
}

/** One sprite lifted out of a sheet, with the cell it came from. */
export type Sliced = {
  /** Zero-based cell index, reading left to right and top to bottom. */
  cell: number
  column: number
  row: number
  imported: Imported
}

/**
 * Slices a sprite sheet into one drawing per cell.
 *
 * Asset packs ship sheets — one PNG holding forty sprites in a grid — and the
 * single-image importer would mean cropping forty times by hand. This is the
 * difference between "download a CC0 pack" and "have a picture for every day".
 *
 * Sprites suit this app better than the scenes it shipped with: they arrive on
 * transparent backgrounds, and transparency is already how the art layer says
 * "outside the picture". That yields a clean tray silhouette for free and
 * removes the one genuinely fiddly authoring decision — which palette entries
 * count as scenery.
 */
export function importSheet(
  buffer: Buffer,
  options: { columns: number; rows: number; maxSize?: number },
): Sliced[] {
  const { columns, rows } = options
  if (columns < 1 || rows < 1) throw new Error('a sheet needs at least one column and one row')

  const png = decodePng(buffer)

  // The upscale factor is a property of the whole sheet, not of one cell — a
  // sheet exported at 4x is 4x everywhere. Detecting per cell would let a flat
  // sprite claim a coarser grid than its neighbours and import at half size.
  const block = detectBlock(png, options.maxSize ?? 512)
  const artW = png.width / block
  const artH = png.height / block

  if (artW % columns !== 0 || artH % rows !== 0) {
    throw new Error(
      `a ${columns}×${rows} grid does not divide this sheet evenly ` +
        `(${artW}×${artH} art pixels). Check the cell count.`,
    )
  }

  const cellW = artW / columns
  const cellH = artH / rows
  const out: Sliced[] = []

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const rect = { x: column * cellW, y: row * cellH, w: cellW, h: cellH }
      // An empty cell is padding in the sheet, not a drawing. Sheets are
      // routinely ragged on the last row.
      const imported = collect(png, block, rect, true)
      if (!imported) continue
      out.push({ cell: row * columns + column, column, row, imported })
    }
  }

  return out
}

/**
 * Reads one rectangle of art pixels into a drawing.
 *
 * With `trim`, the result is cropped to the opaque bounding box and then padded
 * back to a square. Sheet cells are usually larger than the sprite inside them
 * and rarely square; a drawing that is mostly empty space renders as a tiny
 * subject in a big frame, and the app assumes a square grid throughout.
 */
function collect(
  png: { width: number; data: Uint8Array },
  block: number,
  rect: { x: number; y: number; w: number; h: number },
  trim = false,
): Imported | null {
  const sample = (x: number, y: number): { hex: string; opaque: boolean } => {
    // Sample the block's centre: block edges can carry resampling artefacts if
    // the file was ever scaled by something that interpolated.
    const sx = Math.floor((rect.x + x) * block + block / 2)
    const sy = Math.floor((rect.y + y) * block + block / 2)
    const o = (sy * png.width + sx) * 4
    return {
      hex: rgbToHex(png.data[o]!, png.data[o + 1]!, png.data[o + 2]!),
      opaque: png.data[o + 3]! >= 128,
    }
  }

  let bounds = { x0: 0, y0: 0, x1: rect.w - 1, y1: rect.h - 1 }
  if (trim) {
    let x0 = rect.w
    let y0 = rect.h
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        if (!sample(x, y).opaque) continue
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
    }
    if (x1 < 0) return null // nothing opaque here: an empty cell
    bounds = { x0, y0, x1, y1 }
  }

  const width = bounds.x1 - bounds.x0 + 1
  const height = bounds.y1 - bounds.y0 + 1
  const size = trim ? Math.max(width, height) : rect.w
  const padX = trim ? Math.floor((size - width) / 2) : 0
  const padY = trim ? Math.floor((size - height) / 2) : 0

  const palette: string[] = []
  const index = new Map<string, number>()
  const counts: number[] = []
  const pixels: number[] = new Array(size * size).fill(-1)
  const edge = new Set<number>()

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { hex, opaque } = sample(bounds.x0 + x, bounds.y0 + y)
      if (!opaque) continue

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

      const px = padX + x
      const py = padY + y
      counts[slot] = counts[slot]! + 1
      pixels[py * size + px] = slot
      if (px === 0 || py === 0 || px === size - 1 || py === size - 1) edge.add(slot)
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
