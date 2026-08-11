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
      if (depth !== 8) throw new Error(`only 8-bit PNGs are supported (got ${depth}-bit)`)
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

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = unfilter(raw, width, height, channels, stride)

  return { width, height, data: toRgba(pixels, width, height, colourType, palette, transparency) }
}

const CHANNELS: Record<number, number | undefined> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/**
 * Reverses PNG's per-scanline filters.
 *
 * Every row is prefixed with a filter byte and encoded relative to its left and
 * upper neighbours. Skipping this step yields an image that looks like static —
 * which is the classic symptom of a hand-rolled decoder that forgot filters.
 */
function unfilter(
  raw: Buffer,
  width: number,
  height: number,
  channels: number,
  stride: number,
): Uint8Array {
  const out = new Uint8Array(height * stride)
  let position = 0

  for (let y = 0; y < height; y++) {
    const filter = raw[position++]!
    const row = y * stride
    const previous = row - stride

    for (let x = 0; x < stride; x++) {
      const value = raw[position++]!
      const left = x >= channels ? out[row + x - channels]! : 0
      const up = y > 0 ? out[previous + x]! : 0
      const upLeft = y > 0 && x >= channels ? out[previous + x - channels]! : 0

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
  pixels: Uint8Array,
  width: number,
  height: number,
  colourType: number,
  palette: Uint8Array | null,
  transparency: Uint8Array | null,
): Uint8Array {
  const out = new Uint8Array(width * height * 4)

  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    switch (colourType) {
      case 0: {
        const v = pixels[i]!
        out[o] = v
        out[o + 1] = v
        out[o + 2] = v
        out[o + 3] = 255
        break
      }
      case 2: {
        out[o] = pixels[i * 3]!
        out[o + 1] = pixels[i * 3 + 1]!
        out[o + 2] = pixels[i * 3 + 2]!
        out[o + 3] = 255
        break
      }
      case 3: {
        const index = pixels[i]!
        if (!palette) throw new Error('indexed PNG without a palette')
        out[o] = palette[index * 3]!
        out[o + 1] = palette[index * 3 + 1]!
        out[o + 2] = palette[index * 3 + 2]!
        out[o + 3] = transparency?.[index] ?? 255
        break
      }
      case 4: {
        const v = pixels[i * 2]!
        out[o] = v
        out[o + 1] = v
        out[o + 2] = v
        out[o + 3] = pixels[i * 2 + 1]!
        break
      }
      case 6: {
        out[o] = pixels[i * 4]!
        out[o + 1] = pixels[i * 4 + 1]!
        out[o + 2] = pixels[i * 4 + 2]!
        out[o + 3] = pixels[i * 4 + 3]!
        break
      }
    }
  }

  return out
}
