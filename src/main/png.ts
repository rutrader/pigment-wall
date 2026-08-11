import { deflateSync } from 'node:zlib'

/**
 * A hand-rolled PNG writer, so the repo needs no image dependency.
 *
 * Ported from Tenant's `scripts/gen-tray-icon.mjs`, which generated its tray
 * icon at build time. Pigment needs the same thing at RUNTIME — the icon
 * changes as the day fills — so it moves into `src/` and gains a colour path.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

export type RGBA = { r: number; g: number; b: number; a: number }

/**
 * Encodes a square RGBA image.
 *
 * `at` is sampled once per pixel; no filtering, because a pixel-art icon must
 * not be resampled into mush on the way out.
 */
export function encodePng(size: number, at: (x: number, y: number) => RGBA): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let p = 0

  for (let y = 0; y < size; y++) {
    raw[p++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const { r, g, b, a } = at(x, y)
      raw[p++] = clamp(r)
      raw[p++] = clamp(g)
      raw[p++] = clamp(b)
      raw[p++] = clamp(a)
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}
