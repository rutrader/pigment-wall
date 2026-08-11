/**
 * A tiny rasteriser, so an image can be AUTHORED rather than generated.
 *
 * SPEC §5 chose a hand-drawn set for v1 precisely because procedural pixel art
 * reads as procedural pixel art. But typing a 48×48 grid by hand is 2,304
 * characters per picture, which is why nobody does it twice. A short list of
 * shapes is the middle path: the composition is still a person's decision — what
 * overlaps what, where the eye goes — while the pixels are filled in by code.
 *
 * Everything is expressed in a 0..1 unit square and scaled to the canvas at
 * render time, so one authored image renders at 16, 32 or 48 px without being
 * redrawn. That is what makes the three tiers the same drawings at different
 * detail rather than three separate art tasks.
 */

/** A pixel grid of palette indices. -1 is transparent — the silhouette's outside. */
export type Grid = {
  size: number
  pixels: Int8Array
}

export type Shape =
  | { kind: 'rect'; colour: number; x: number; y: number; w: number; h: number }
  | { kind: 'disc'; colour: number; x: number; y: number; r: number }
  /** An axis-aligned triangle, given by its three unit-square corners. */
  | { kind: 'tri'; colour: number; points: [number, number, number, number, number, number] }
  /** A thick line, for stems, branches and outlines. */
  | { kind: 'line'; colour: number; x1: number; y1: number; x2: number; y2: number; w: number }

export function blank(size: number): Grid {
  const pixels = new Int8Array(size * size)
  pixels.fill(-1)
  return { size, pixels }
}

/**
 * Paints shapes in order, later ones covering earlier ones.
 *
 * Painter's algorithm rather than anything cleverer: at 16 px a single pixel is
 * 6% of the width, so any attempt at coverage-based blending just produces mud.
 * A pixel belongs to exactly one palette entry, which is also what makes the
 * palette-ordered fill in SPEC §6 possible at all.
 */
export function paint(size: number, shapes: Shape[]): Grid {
  const grid = blank(size)

  for (const shape of shapes) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Sample at the pixel's centre, so a shape that spans half the canvas
        // covers half the pixels rather than half-plus-one.
        const u = (x + 0.5) / size
        const v = (y + 0.5) / size
        if (covers(shape, u, v)) grid.pixels[y * size + x] = shape.colour
      }
    }
  }

  return grid
}

function covers(shape: Shape, u: number, v: number): boolean {
  switch (shape.kind) {
    case 'rect':
      return u >= shape.x && u < shape.x + shape.w && v >= shape.y && v < shape.y + shape.h

    case 'disc': {
      const dx = u - shape.x
      const dy = v - shape.y
      return dx * dx + dy * dy <= shape.r * shape.r
    }

    case 'tri': {
      const [ax, ay, bx, by, cx, cy] = shape.points
      // Barycentric sign test. Consistent signs mean the point is inside,
      // whichever way round the winding happens to be.
      const d1 = cross(u, v, ax, ay, bx, by)
      const d2 = cross(u, v, bx, by, cx, cy)
      const d3 = cross(u, v, cx, cy, ax, ay)
      const negative = d1 < 0 || d2 < 0 || d3 < 0
      const positive = d1 > 0 || d2 > 0 || d3 > 0
      return !(negative && positive)
    }

    case 'line': {
      // Distance from the point to the segment, compared against half-width.
      const dx = shape.x2 - shape.x1
      const dy = shape.y2 - shape.y1
      const lengthSquared = dx * dx + dy * dy
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(0, Math.min(1, ((u - shape.x1) * dx + (v - shape.y1) * dy) / lengthSquared))
      const px = shape.x1 + t * dx - u
      const py = shape.y1 + t * dy - v
      return px * px + py * py <= (shape.w / 2) * (shape.w / 2)
    }
  }
}

function cross(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by)
}

/** Palette indices actually used, in first-seen order. Authoring aid. */
export function usedColours(grid: Grid): number[] {
  const seen: number[] = []
  for (const index of grid.pixels) {
    if (index >= 0 && !seen.includes(index)) seen.push(index)
  }
  return seen.sort((a, b) => a - b)
}

/** How many pixels each palette index occupies. Drives the weighted fill (§6). */
export function colourCounts(grid: Grid): Map<number, number> {
  const counts = new Map<number, number>()
  for (const index of grid.pixels) {
    if (index >= 0) counts.set(index, (counts.get(index) ?? 0) + 1)
  }
  return counts
}
