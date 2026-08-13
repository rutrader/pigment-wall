import { inflateSync } from 'node:zlib'

/**
 * A PNG decoder — the mirror of the encoder in `src/main/png.ts`.
 *
 * Exists so drawings can come from a paint program instead of a shape list.
 * Shape lists were the right call when twelve pictures had to appear with no
 * artist; they are the wrong long-term source. SPEC §5's scaling plan always
 * assumed art would arrive as files.
 *
 * Supports the four colour types a pixel-art tool actually emits at 8 bits:
 * greyscale, truecolour, indexed and their alpha variants. Interlaced PNGs are
 * rejected rather than mis-decoded — no pixel-art exporter produces them, and a
 * silently scrambled image is far worse than a clear error.
 */

export type Decoded = {
  width: number
  height: number
  /** RGBA, four bytes per pixel, row-major. */
  data: Uint8Array
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function decodePng(buffer: Buffer): Decoded {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (buffer[i] !== SIGNATURE[i]) throw new Error('not a PNG')
  }

  let width = 0
  let height = 0
  let depth = 0
  let colourType = 0
  let palette: Uint8Array | null = null
  let transparency: Uint8Array | null = null
  const idat: Buffer[] = []

  let offset = 8
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)
    offset += 12 + length // length + type + data + crc

    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]!
      colourType = body[9]!
      if (body[12] !== 0) throw new Error('interlaced PNGs are not supported')
      if (![1, 2, 4, 8, 16].includes(depth)) throw new Error(`odd PNG bit depth: ${depth}`)
    } else if (type === 'PLTE') {
      palette = new Uint8Array(body)
    } else if (type === 'tRNS') {
      transparency = new Uint8Array(body)
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
  }

  if (width === 0 || height === 0) throw new Error('PNG has no IHDR')

  const channels = CHANNELS[colourType]
  if (!channels) throw new Error(`unsupported colour type ${colourType}`)

  // Sub-byte depths are the norm for indexed pixel art: a 16-colour sprite is
  // 4-bit, and a two-colour one 2-bit. Tools write the smallest depth that
  // fits, so refusing anything but 8-bit refuses most real pixel art.
  const bitsPerPixel = channels * depth
  const bytesPerLine = Math.ceil((width * bitsPerPixel) / 8)
  // Filters operate on whole bytes; below 8 bits per pixel the unit is one byte.
  const filterBpp = Math.max(1, Math.ceil(bitsPerPixel / 8))

  const raw = inflateSync(Buffer.concat(idat))
  const lines = unfilter(raw, height, filterBpp, bytesPerLine)

  return {
    width,
    height,
    data: toRgba(lines, width, height, bytesPerLine, channels, depth, colourType, palette, transparency),
  }
}

/**
 * One sample, whatever the bit depth.
 *
 * At 8 bits a sample is a byte. Below that they are packed several to a byte,
 * most significant first. At 16 the high byte is enough — nothing here needs
 * more precision than a screen has.
 */
function sampleOf(
  lines: Uint8Array,
  lineStart: number,
  index: number,
  depth: number,
): number {
  if (depth === 8) return lines[lineStart + index]!
  if (depth === 16) return lines[lineStart + index * 2]!

  const bitOffset = index * depth
  const byte = lines[lineStart + (bitOffset >> 3)]!
  const shift = 8 - depth - (bitOffset & 7)
  return (byte >> shift) & ((1 << depth) - 1)
}

const CHANNELS: Record<number, number | undefined> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/**
 * Reverses PNG's per-scanline filters.
 *
 * Every row is prefixed with a filter byte and encoded relative to its left and
 * upper neighbours. Skipping this step yields an image that looks like static —
 * the classic symptom of a hand-rolled decoder that forgot filters.
 *
 * Filtering is defined on BYTES, not on pixels, so `bpp` here is the byte
 * distance to the left neighbour: one byte whenever a pixel is smaller than
 * that, which is every sub-8-bit image.
 */
function unfilter(raw: Buffer, height: number, bpp: number, bytesPerLine: number): Uint8Array {
  const out = new Uint8Array(height * bytesPerLine)
  let position = 0

  for (let y = 0; y < height; y++) {
    const filter = raw[position++]!
    const row = y * bytesPerLine
    const previous = row - bytesPerLine

    for (let x = 0; x < bytesPerLine; x++) {
      const value = raw[position++]!
      const left = x >= bpp ? out[row + x - bpp]! : 0
      const up = y > 0 ? out[previous + x]! : 0
      const upLeft = y > 0 && x >= bpp ? out[previous + x - bpp]! : 0

      let result: number
      switch (filter) {
        case 0:
          result = value
          break
        case 1:
          result = value + left
          break
        case 2:
          result = value + up
          break
        case 3:
          result = value + ((left + up) >> 1)
          break
        case 4:
          result = value + paeth(left, up, upLeft)
          break
        default:
          throw new Error(`unknown PNG filter ${filter}`)
      }
      out[row + x] = result & 0xff
    }
  }

  return out
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

function toRgba(
  lines: Uint8Array,
  width: number,
  height: number,
  bytesPerLine: number,
  channels: number,
  depth: number,
  colourType: number,
  palette: Uint8Array | null,
  transparency: Uint8Array | null,
): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  // Greyscale below 8 bits is a fraction of full white, not a byte value: at
  // 2-bit, level 2 of 3 is two-thirds grey.
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1

  for (let y = 0; y < height; y++) {
    const lineStart = y * bytesPerLine
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const base = x * channels
      const sample = (c: number): number => sampleOf(lines, lineStart, base + c, depth)

      switch (colourType) {
        case 0: {
          const v = Math.round(sample(0) * scale)
          out[o] = v
          out[o + 1] = v
          out[o + 2] = v
          out[o + 3] = 255
          break
        }
        case 2: {
          out[o] = sample(0)
          out[o + 1] = sample(1)
          out[o + 2] = sample(2)
          out[o + 3] = 255
          break
        }
        case 3: {
          if (!palette) throw new Error('indexed PNG without a palette')
          const index = sample(0)
          out[o] = palette[index * 3] ?? 0
          out[o + 1] = palette[index * 3 + 1] ?? 0
          out[o + 2] = palette[index * 3 + 2] ?? 0
          out[o + 3] = transparency?.[index] ?? 255
          break
        }
        case 4: {
          const v = Math.round(sample(0) * scale)
          out[o] = v
          out[o + 1] = v
          out[o + 2] = v
          out[o + 3] = Math.round(sample(1) * scale)
          break
        }
        case 6: {
          out[o] = sample(0)
          out[o + 1] = sample(1)
          out[o + 2] = sample(2)
          out[o + 3] = sample(3)
          break
        }
      }
    }
  }

  return out
}
