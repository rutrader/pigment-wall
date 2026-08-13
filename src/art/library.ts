import type { Shape } from './shapes.ts'
import { IMPORTED } from './imported/index.ts'

/**
 * Thirty authored pictures, ten per tier, plus whatever has been imported.
 *
 * Ten rather than the original four, because four is how often a picture
 * repeats. A pool of four with roughly a third of days landing in one tier puts
 * the same picture on the wall about once a week, which is exactly often enough
 * to notice and be bored by. Ten pushes the repeat out past a month.
 *
 * The format, the palette ordering and the fill are the real deliverable; the
 * drawings answer the question M2 exists to answer — does a 40%-filled image
 * still read as a picture? Adding one means writing a `Drawing` here and
 * nothing else: the loader, the tray and the wall never learn that it changed.
 *
 * Authoring rules, learned from SPEC §6:
 *
 *   - `order` is the sequence colours gain colour in. SUBJECT FIRST, background
 *     LAST. At 40% you want a fully coloured fox on a grey field, which reads as
 *     a finished illustration in a style. Background-first gives a grey fox in a
 *     coloured world, which reads as broken.
 *   - Shapes are painted in list order, later covering earlier — so the sky goes
 *     in first even though it colours in last.
 *   - Coordinates are a 0..1 unit square, so one drawing serves every canvas.
 */

export type Drawing = {
  id: string
  /** 1, 2 or 3 — which complexity pool this belongs to. */
  tier: number
  /** Hex colours, indexed by the `colour` field on each shape. */
  palette: string[]
  /** Palette indices in fill order. Must cover every index the shapes use. */
  order: number[]
  /**
   * Palette indices that are scenery rather than subject.
   *
   * Used only by the tray icon, which needs a SHAPE. Scenic drawings cover the
   * whole canvas, so without this the silhouette is a filled square and both the
   * vessel and its overexposure ring stop meaning anything (SPEC §11).
   */
  background: number[]
  /** Authored composition. Renders at any canvas size. */
  shapes?: Shape[]
  /**
   * An imported picture at its native grid.
   *
   * Raster drawings keep their own size rather than being fitted to the tier's
   * canvas: rescaling pixel art by a non-integer factor (64 → 48) destroys the
   * thing that makes it pixel art. The popover already draws every day at the
   * same on-screen square, so a 64px import sits beside a 16px drawing without
   * looking out of place — it simply carries more detail, which is what a tier
   * is supposed to mean anyway.
   */
  raster?: { size: number; pixels: number[] }
}

const rect = (colour: number, x: number, y: number, w: number, h: number): Shape => ({
  kind: 'rect',
  colour,
  x,
  y,
  w,
  h,
})
const disc = (colour: number, x: number, y: number, r: number): Shape => ({
  kind: 'disc',
  colour,
  x,
  y,
  r,
})
const tri = (colour: number, ...points: [number, number, number, number, number, number]): Shape => ({
  kind: 'tri',
  colour,
  points,
})
const line = (
  colour: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  w: number,
): Shape => ({ kind: 'line', colour, x1, y1, x2, y2, w })

// --- tier 1: 16x16, ~6 colours, one subject, no scenery ----------------------

const mushroom: Drawing = {
  id: 'mushroom',
  tier: 1,
  palette: ['#c0392b', '#e8e0d0', '#8b6f47', '#5d4037'],
  order: [0, 1, 2, 3],
  background: [],
  shapes: [
    // The cap is a dome plus a brim rather than a clipped circle: painting
    // transparency over a finished shape erases whatever was under it too.
    disc(0, 0.5, 0.34, 0.3), // cap dome
    rect(0, 0.14, 0.48, 0.72, 0.12), // cap brim
    rect(2, 0.42, 0.58, 0.16, 0.3), // stem
    rect(3, 0.38, 0.86, 0.24, 0.06), // stem base
    disc(1, 0.34, 0.28, 0.07), // spots
    disc(1, 0.63, 0.34, 0.055),
    disc(1, 0.5, 0.16, 0.04),
  ],
}

const cat: Drawing = {
  id: 'cat',
  tier: 1,
  palette: ['#e67e22', '#f5cba7', '#2c3e50', '#27ae60'],
  order: [0, 1, 2, 3],
  background: [3],
  shapes: [
    rect(3, 0, 0.86, 1, 0.14), // grass, last
    tri(0, 0.24, 0.44, 0.3, 0.16, 0.42, 0.36), // ears
    tri(0, 0.76, 0.44, 0.7, 0.16, 0.58, 0.36),
    disc(0, 0.5, 0.5, 0.3), // head
    disc(1, 0.38, 0.46, 0.06), // eyes
    disc(1, 0.62, 0.46, 0.06),
    disc(2, 0.38, 0.47, 0.03),
    disc(2, 0.62, 0.47, 0.03),
    disc(2, 0.5, 0.6, 0.04), // nose
  ],
}

const leaf: Drawing = {
  id: 'leaf',
  tier: 1,
  palette: ['#27ae60', '#1e8449', '#7f5539', '#d5f5e3'],
  order: [0, 1, 2, 3],
  background: [3],
  shapes: [
    rect(3, 0, 0, 1, 1), // sky wash, last
    line(2, 0.5, 0.95, 0.5, 0.4, 0.08), // stem
    disc(0, 0.5, 0.42, 0.32), // blade
    tri(0, 0.5, 0.02, 0.22, 0.5, 0.78, 0.5), // tip
    // A feature thinner than one pixel at the tier's canvas samples to nothing
    // and its colour disappears from the image entirely. At 16px that floor is
    // 1/16 = 0.0625 units, so the vein is deliberately wider than it looks.
    line(1, 0.5, 0.74, 0.5, 0.16, 0.1), // vein
  ],
}

const moon: Drawing = {
  id: 'moon',
  tier: 1,
  palette: ['#f4d03f', '#f9e79f', '#1b2631', '#5dade2'],
  order: [0, 1, 3, 2],
  background: [2, 3],
  shapes: [
    rect(2, 0, 0, 1, 1), // night sky, last
    disc(0, 0.46, 0.5, 0.34), // moon
    disc(2, 0.68, 0.42, 0.28), // crescent bite
    disc(1, 0.34, 0.44, 0.06), // craters
    disc(1, 0.4, 0.62, 0.04),
    disc(3, 0.16, 0.2, 0.035), // stars
    disc(3, 0.82, 0.76, 0.03),
    disc(3, 0.24, 0.82, 0.025),
  ],
}

const apple: Drawing = {
  id: 'apple',
  tier: 1,
  palette: ['#c0392b', '#f1948a', '#7f5539', '#27ae60'],
  order: [0, 1, 2, 3],
  background: [],
  shapes: [
    // Two overlapping lobes rather than one circle: a single disc reads as a
    // ball, and the notch at the top is the whole reason an apple looks like an
    // apple at sixteen pixels.
    disc(0, 0.38, 0.58, 0.28),
    disc(0, 0.62, 0.58, 0.28),
    line(2, 0.5, 0.42, 0.52, 0.2, 0.08), // stem
    disc(3, 0.68, 0.22, 0.11), // leaf
    disc(1, 0.32, 0.48, 0.07), // highlight
  ],
}

const key: Drawing = {
  id: 'key',
  tier: 1,
  palette: ['#f4d03f', '#b7950b', '#ecf0f1', '#34495e'],
  order: [0, 1, 2, 3],
  background: [3],
  shapes: [
    rect(3, 0, 0, 1, 1), // dark ground, last
    disc(0, 0.26, 0.5, 0.2), // bow
    disc(3, 0.26, 0.5, 0.08), // the hole, punched in the ground colour
    rect(0, 0.42, 0.44, 0.46, 0.12), // shaft
    rect(0, 0.66, 0.56, 0.08, 0.14), // teeth
    rect(0, 0.8, 0.56, 0.08, 0.1),
    rect(1, 0.42, 0.53, 0.46, 0.03), // shadow along the shaft
    disc(2, 0.22, 0.4, 0.05), // glint
  ],
}

const mug: Drawing = {
  id: 'mug',
  tier: 1,
  palette: ['#ecf0f1', '#6e4b3a', '#d6eaf8', '#8b6f47'],
  order: [0, 1, 2, 3],
  background: [3],
  shapes: [
    rect(3, 0, 0.82, 1, 0.18), // table, last
    rect(0, 0.22, 0.38, 0.44, 0.46), // body
    // The handle is two strokes, not a ring with a hole: punching a hole means
    // painting the background back over the cup, and at this size the hole eats
    // the handle entirely.
    line(0, 0.66, 0.46, 0.84, 0.56, 0.09),
    line(0, 0.84, 0.56, 0.66, 0.7, 0.09),
    rect(1, 0.24, 0.4, 0.4, 0.1), // coffee
    line(2, 0.34, 0.32, 0.32, 0.12, 0.08), // steam
    line(2, 0.54, 0.32, 0.58, 0.14, 0.08),
  ],
}

const tulip: Drawing = {
  id: 'tulip',
  tier: 1,
  palette: ['#e74c3c', '#f5b7b1', '#27ae60', '#aed6f1'],
  order: [0, 1, 2, 3],
  background: [3],
  shapes: [
    rect(3, 0, 0, 1, 1), // sky, last
    line(2, 0.5, 0.96, 0.5, 0.5, 0.08), // stem
    tri(2, 0.5, 0.68, 0.12, 0.64, 0.5, 0.88), // leaves
    tri(2, 0.5, 0.64, 0.9, 0.58, 0.5, 0.84),
    rect(0, 0.26, 0.34, 0.48, 0.2), // bloom body
    disc(0, 0.5, 0.36, 0.24),
    // Three notches cut with the sky colour give the tulip its scalloped top.
    tri(3, 0.38, 0.1, 0.32, 0.28, 0.44, 0.28),
    tri(3, 0.62, 0.1, 0.56, 0.28, 0.68, 0.28),
    disc(1, 0.38, 0.4, 0.07), // highlight
  ],
}

const fish: Drawing = {
  id: 'fish',
  tier: 1,
  palette: ['#f39c12', '#e67e22', '#2c3e50', '#5dade2'],
  order: [0, 1, 2, 3],
  background: [3],
  shapes: [
    rect(3, 0, 0, 1, 1), // water, last
    disc(0, 0.5, 0.52, 0.28), // body
    tri(0, 0.24, 0.52, 0.04, 0.28, 0.04, 0.76), // tail
    tri(1, 0.38, 0.28, 0.62, 0.28, 0.5, 0.1), // dorsal fin
    tri(1, 0.44, 0.74, 0.64, 0.74, 0.54, 0.9), // belly fin
    disc(2, 0.66, 0.44, 0.06), // eye
  ],
}

const bulb: Drawing = {
  id: 'bulb',
  tier: 1,
  palette: ['#f4d03f', '#ffffff', '#7f8c8d', '#2c3e50'],
  order: [0, 1, 2, 3],
  background: [3],
  shapes: [
    rect(3, 0, 0, 1, 1), // dark, last
    disc(0, 0.5, 0.38, 0.32), // glass
    rect(0, 0.36, 0.56, 0.28, 0.12), // neck
    rect(2, 0.32, 0.66, 0.36, 0.22), // screw base
    rect(3, 0.32, 0.72, 0.36, 0.04), // thread grooves
    rect(3, 0.32, 0.8, 0.36, 0.04),
    // A plain yellow disc reads as a sun, not a bulb. The V of filament is the
    // one mark that says which it is, so it is white and deliberately fat.
    line(1, 0.4, 0.5, 0.5, 0.3, 0.07),
    line(1, 0.5, 0.3, 0.6, 0.5, 0.07),
  ],
}

// --- tier 2: 32x32, ~10 colours, subject plus a little scenery ---------------

const fox: Drawing = {
  id: 'fox',
  tier: 2,
  palette: ['#e67e22', '#d35400', '#fdebd0', '#2c3e50', '#7f8c8d', '#27ae60', '#a9dfbf'],
  order: [0, 1, 2, 3, 4, 5, 6],
  background: [5, 6],
  shapes: [
    rect(6, 0, 0, 1, 0.62), // pale sky, last
    rect(5, 0, 0.62, 1, 0.38), // grass
    line(1, 0.14, 0.72, 0.02, 0.5, 0.13), // tail
    disc(1, 0.16, 0.68, 0.1),
    rect(0, 0.22, 0.5, 0.46, 0.3), // body
    disc(0, 0.66, 0.42, 0.19), // head
    tri(0, 0.54, 0.34, 0.58, 0.14, 0.68, 0.3), // ears
    tri(0, 0.82, 0.34, 0.8, 0.14, 0.7, 0.3),
    disc(2, 0.72, 0.5, 0.09), // muzzle
    disc(2, 0.14, 0.6, 0.06), // tail tip
    disc(3, 0.62, 0.4, 0.035), // eye
    disc(3, 0.78, 0.52, 0.03), // nose
    rect(4, 0.26, 0.76, 0.07, 0.12), // legs
    rect(4, 0.54, 0.76, 0.07, 0.12),
  ],
}

const house: Drawing = {
  id: 'house',
  tier: 2,
  palette: ['#c0392b', '#e8daef', '#f4d03f', '#5d4037', '#2c3e50', '#7dcea0', '#aed6f1'],
  order: [0, 1, 2, 3, 4, 5, 6],
  background: [5, 6],
  shapes: [
    rect(6, 0, 0, 1, 0.7), // sky, last
    rect(5, 0, 0.7, 1, 0.3), // ground
    rect(1, 0.2, 0.44, 0.6, 0.34), // walls
    tri(0, 0.12, 0.46, 0.5, 0.14, 0.88, 0.46), // roof
    rect(3, 0.44, 0.58, 0.14, 0.2), // door
    rect(2, 0.26, 0.52, 0.12, 0.12), // windows
    rect(2, 0.64, 0.52, 0.12, 0.12),
    rect(4, 0.31, 0.52, 0.02, 0.12), // window frames
    rect(4, 0.69, 0.52, 0.02, 0.12),
    rect(3, 0.68, 0.2, 0.08, 0.18), // chimney
  ],
}

const boat: Drawing = {
  id: 'boat',
  tier: 2,
  palette: ['#8b4513', '#ecf0f1', '#e74c3c', '#2980b9', '#5dade2', '#f4d03f', '#d6eaf8'],
  order: [0, 1, 2, 3, 4, 5, 6],
  background: [3, 4, 6],
  shapes: [
    rect(6, 0, 0, 1, 0.58), // sky, last
    rect(4, 0, 0.58, 1, 0.42), // sea
    disc(5, 0.78, 0.18, 0.11), // sun
    tri(0, 0.18, 0.68, 0.82, 0.68, 0.7, 0.82), // hull
    rect(0, 0.18, 0.62, 0.64, 0.07),
    line(0, 0.48, 0.62, 0.48, 0.18, 0.035), // mast
    tri(1, 0.5, 0.2, 0.5, 0.6, 0.8, 0.6), // main sail
    tri(2, 0.46, 0.24, 0.46, 0.6, 0.2, 0.6), // jib
    rect(3, 0, 0.86, 1, 0.05), // wave
    rect(3, 0, 0.94, 1, 0.04),
  ],
}

const bird: Drawing = {
  id: 'bird',
  tier: 2,
  palette: ['#2980b9', '#5dade2', '#f39c12', '#2c3e50', '#ecf0f1', '#27ae60', '#d6eaf8'],
  order: [0, 1, 2, 3, 4, 5, 6],
  background: [5, 6],
  shapes: [
    rect(6, 0, 0, 1, 0.74), // sky, last
    rect(5, 0, 0.74, 1, 0.26), // hedge
    disc(0, 0.46, 0.5, 0.24), // body
    disc(0, 0.66, 0.34, 0.15), // head
    tri(0, 0.1, 0.42, 0.34, 0.44, 0.24, 0.66), // tail
    tri(1, 0.34, 0.44, 0.62, 0.5, 0.4, 0.66), // wing
    tri(2, 0.78, 0.32, 0.94, 0.37, 0.78, 0.42), // beak
    disc(3, 0.7, 0.3, 0.035), // eye
    disc(4, 0.71, 0.29, 0.014), // catchlight
    line(2, 0.46, 0.72, 0.44, 0.84, 0.03), // legs
    line(2, 0.56, 0.72, 0.58, 0.84, 0.03),
  ],
}

const owl: Drawing = {
  id: 'owl',
  tier: 2,
  palette: ['#8b6f47', '#e8daef', '#f4d03f', '#2c3e50', '#e67e22', '#5d4037', '#aed6f1'],
  order: [0, 1, 2, 3, 4, 5, 6],
  background: [5, 6],
  shapes: [
    rect(6, 0, 0, 1, 1), // sky, last
    rect(5, 0, 0.78, 1, 0.07), // branch
    disc(0, 0.5, 0.48, 0.3), // body
    tri(0, 0.24, 0.32, 0.28, 0.1, 0.44, 0.28), // ear tufts
    tri(0, 0.76, 0.32, 0.72, 0.1, 0.56, 0.28),
    disc(1, 0.5, 0.62, 0.18), // breast
    disc(1, 0.38, 0.4, 0.12), // face discs
    disc(1, 0.62, 0.4, 0.12),
    disc(2, 0.38, 0.4, 0.08), // irises
    disc(2, 0.62, 0.4, 0.08),
    disc(3, 0.38, 0.4, 0.04), // pupils
    disc(3, 0.62, 0.4, 0.04),
    tri(4, 0.5, 0.44, 0.45, 0.55, 0.55, 0.55), // beak
    rect(4, 0.39, 0.75, 0.06, 0.06), // feet, gripping the branch
    rect(4, 0.55, 0.75, 0.06, 0.06),
  ],
}

const cactus: Drawing = {
  id: 'cactus',
  tier: 2,
  palette: ['#27ae60', '#1e8449', '#e74c3c', '#f4d03f', '#e59866', '#f39c12', '#f5b7b1'],
  order: [0, 1, 2, 3, 4, 5, 6],
  background: [3, 4, 6],
  shapes: [
    rect(6, 0, 0, 1, 0.72), // desert sky, last
    disc(5, 0.78, 0.2, 0.1), // sun
    rect(4, 0, 0.64, 1, 0.16), // dune
    rect(3, 0, 0.78, 1, 0.22), // sand
    rect(0, 0.44, 0.24, 0.14, 0.58), // trunk
    rect(0, 0.24, 0.44, 0.22, 0.08), // left arm, out then up
    rect(0, 0.24, 0.32, 0.08, 0.2),
    rect(0, 0.56, 0.54, 0.2, 0.08), // right arm
    rect(0, 0.68, 0.4, 0.08, 0.22),
    line(1, 0.51, 0.3, 0.51, 0.78, 0.04), // shaded ridge
    disc(2, 0.51, 0.22, 0.06), // flower
  ],
}

const balloon: Drawing = {
  id: 'balloon',
  tier: 2,
  palette: ['#e74c3c', '#f4d03f', '#2980b9', '#8b6f47', '#5d4037', '#ecf0f1', '#5dade2'],
  order: [0, 1, 2, 3, 4, 5, 6],
  background: [5, 6],
  shapes: [
    rect(6, 0, 0, 1, 1), // sky, last
    disc(5, 0.18, 0.72, 0.12), // clouds
    disc(5, 0.3, 0.75, 0.1),
    disc(5, 0.84, 0.24, 0.09),
    disc(0, 0.5, 0.38, 0.28), // envelope
    tri(0, 0.24, 0.42, 0.76, 0.42, 0.5, 0.66), // taper down to the mouth
    // Both bands are sized to the envelope's width at their own height — a
    // stripe that overshoots is a stripe floating in the sky.
    rect(1, 0.24, 0.34, 0.52, 0.08),
    rect(2, 0.28, 0.5, 0.44, 0.06),
    line(4, 0.42, 0.63, 0.45, 0.75, 0.03), // rigging
    line(4, 0.58, 0.63, 0.55, 0.75, 0.03),
    rect(3, 0.43, 0.74, 0.14, 0.11), // basket
  ],
}

const campfire: Drawing = {
  id: 'campfire',
  tier: 2,
  palette: ['#e74c3c', '#f39c12', '#f4d03f', '#8b6f47', '#5d4037', '#7f5539', '#1b2631'],
  order: [0, 1, 2, 3, 4, 5, 6],
  background: [5, 6],
  shapes: [
    rect(6, 0, 0, 1, 1), // night, last
    rect(5, 0, 0.8, 1, 0.2), // ground
    tri(0, 0.5, 0.14, 0.26, 0.74, 0.74, 0.74), // outer flame
    tri(1, 0.5, 0.34, 0.34, 0.74, 0.66, 0.74), // inner flame
    tri(2, 0.5, 0.5, 0.42, 0.76, 0.58, 0.76), // core
    line(3, 0.18, 0.84, 0.82, 0.78, 0.07), // logs, crossed
    line(4, 0.2, 0.77, 0.82, 0.86, 0.07),
    disc(2, 0.26, 0.28, 0.025), // sparks
    disc(2, 0.74, 0.2, 0.022),
    disc(1, 0.68, 0.4, 0.02),
  ],
}

const whale: Drawing = {
  id: 'whale',
  tier: 2,
  // The whale started the same blue as the sea it swims in, which was invisible
  // at full fill and only worked while the water was still grey. It is now the
  // darkest thing in the picture, so it reads at every fill.
  palette: ['#154360', '#aed6f1', '#ecf0f1', '#2c3e50', '#2980b9', '#5dade2', '#d6eaf8'],
  order: [0, 1, 2, 3, 4, 5, 6],
  background: [4, 5, 6],
  shapes: [
    rect(6, 0, 0, 1, 0.5), // sky, last
    rect(5, 0, 0.5, 1, 0.5), // sea
    rect(4, 0, 0.86, 1, 0.14), // deep water
    disc(0, 0.42, 0.62, 0.26), // head
    rect(0, 0.42, 0.5, 0.32, 0.24), // body
    tri(0, 0.72, 0.62, 0.96, 0.42, 0.96, 0.78), // fluke
    disc(1, 0.4, 0.72, 0.16), // pale belly
    disc(2, 0.3, 0.55, 0.04), // eye, pale so it shows on a dark body
    disc(3, 0.3, 0.55, 0.018),
    disc(2, 0.36, 0.3, 0.06), // spout
    disc(2, 0.31, 0.2, 0.045),
    disc(2, 0.43, 0.17, 0.035),
  ],
}

const snail: Drawing = {
  id: 'snail',
  tier: 2,
  palette: ['#e67e22', '#b9770e', '#f5cba7', '#2c3e50', '#27ae60', '#7dcea0', '#d6eaf8'],
  order: [0, 1, 2, 3, 4, 5, 6],
  background: [4, 5, 6],
  shapes: [
    rect(6, 0, 0, 1, 0.72), // sky, last
    rect(5, 0, 0.72, 1, 0.28), // grass
    rect(4, 0, 0.7, 1, 0.05), // the leaf it is crossing
    rect(2, 0.22, 0.6, 0.5, 0.12), // foot
    disc(2, 0.26, 0.52, 0.1), // head
    line(2, 0.22, 0.48, 0.17, 0.3, 0.04), // antennae
    line(2, 0.31, 0.47, 0.33, 0.28, 0.04),
    disc(3, 0.17, 0.28, 0.035), // eyes
    disc(3, 0.33, 0.26, 0.035),
    // Shell last, over the body, so the spiral reads as a solid object rather
    // than a decal.
    disc(0, 0.62, 0.5, 0.24),
    disc(1, 0.62, 0.5, 0.14),
    disc(0, 0.62, 0.5, 0.07),
  ],
}

// --- tier 3: 48x48, ~16 colours, a scene ------------------------------------

const lighthouse: Drawing = {
  id: 'lighthouse',
  tier: 3,
  palette: [
    '#ecf0f1', '#c0392b', '#f4d03f', '#7f8c8d', '#2c3e50',
    '#34495e', '#2980b9', '#5dade2', '#1b2631', '#f9e79f',
  ],
  order: [2, 0, 1, 4, 3, 5, 6, 7, 9, 8],
  background: [5, 6, 7, 8],
  shapes: [
    rect(8, 0, 0, 1, 0.66), // night sky, last
    rect(6, 0, 0.66, 1, 0.34), // sea
    disc(9, 0.86, 0.12, 0.05), // moon, clear of the beam that sweeps left
    rect(5, 0.0, 0.62, 1, 0.1), // headland
    tri(0, 0.36, 0.72, 0.64, 0.72, 0.56, 0.2), // tower
    tri(1, 0.4, 0.6, 0.6, 0.6, 0.575, 0.44), // red band
    rect(4, 0.46, 0.16, 0.14, 0.08), // lantern housing
    rect(2, 0.47, 0.18, 0.12, 0.05), // the light
    tri(2, 0.53, 0.2, 0.05, 0.06, 0.05, 0.3), // beam
    rect(3, 0.36, 0.7, 0.28, 0.04), // base
    rect(7, 0, 0.8, 1, 0.04), // wave crests
    rect(7, 0, 0.9, 1, 0.03),
  ],
}

const forest: Drawing = {
  id: 'forest',
  tier: 3,
  palette: [
    '#1e8449', '#27ae60', '#7dcea0', '#7f5539', '#5d4037',
    '#f4d03f', '#aed6f1', '#d6eaf8', '#e67e22', '#2c3e50',
  ],
  order: [8, 9, 0, 1, 2, 3, 4, 5, 6, 7],
  background: [2, 6, 7],
  shapes: [
    rect(7, 0, 0, 1, 0.72), // sky, last
    rect(6, 0, 0.62, 1, 0.12), // far haze
    rect(2, 0, 0.74, 1, 0.26), // forest floor
    disc(5, 0.8, 0.16, 0.08), // sun
    line(4, 0.2, 0.78, 0.2, 0.44, 0.05), // trunks
    line(4, 0.5, 0.8, 0.5, 0.34, 0.06),
    line(3, 0.78, 0.78, 0.78, 0.46, 0.05),
    tri(0, 0.5, 0.16, 0.28, 0.56, 0.72, 0.56), // canopies
    tri(1, 0.2, 0.3, 0.04, 0.62, 0.36, 0.62),
    tri(1, 0.78, 0.32, 0.6, 0.64, 0.96, 0.64),
    disc(8, 0.34, 0.84, 0.035), // fallen leaves
    disc(8, 0.62, 0.88, 0.03),
    disc(9, 0.46, 0.9, 0.025),
  ],
}

const mountain: Drawing = {
  id: 'mountain',
  tier: 3,
  palette: [
    '#ecf0f1', '#7f8c8d', '#566573', '#2c3e50', '#27ae60',
    '#1e8449', '#5dade2', '#aed6f1', '#f4d03f', '#34495e',
  ],
  order: [8, 0, 1, 2, 3, 9, 4, 5, 6, 7],
  background: [4, 6, 7, 9],
  shapes: [
    rect(7, 0, 0, 1, 0.68), // sky, last
    disc(8, 0.18, 0.16, 0.07), // sun
    tri(2, 0.06, 0.72, 0.36, 0.26, 0.66, 0.72), // back peak
    tri(1, 0.34, 0.72, 0.66, 0.18, 0.98, 0.72), // main peak
    tri(0, 0.56, 0.32, 0.66, 0.18, 0.76, 0.32), // snow cap
    tri(0, 0.26, 0.38, 0.36, 0.26, 0.46, 0.38),
    rect(9, 0, 0.7, 1, 0.06), // treeline shadow
    rect(4, 0, 0.74, 1, 0.14), // meadow
    rect(6, 0, 0.88, 1, 0.12), // lake
    tri(5, 0.14, 0.66, 0.2, 0.76, 0.26, 0.66), // small firs
    tri(5, 0.74, 0.66, 0.8, 0.76, 0.86, 0.66),
    rect(3, 0.19, 0.74, 0.02, 0.04),
    rect(3, 0.79, 0.74, 0.02, 0.04),
  ],
}

const town: Drawing = {
  id: 'town',
  tier: 3,
  palette: [
    '#e74c3c', '#f39c12', '#8e44ad', '#ecf0f1', '#2c3e50',
    '#f4d03f', '#5d4037', '#34495e', '#1b2631', '#7dcea0',
  ],
  order: [5, 0, 1, 2, 3, 6, 4, 9, 7, 8],
  background: [7, 8, 9],
  shapes: [
    rect(8, 0, 0, 1, 0.74), // dusk sky, last
    rect(7, 0, 0.5, 1, 0.24), // far rooftops
    rect(9, 0, 0.86, 1, 0.14), // street
    rect(0, 0.06, 0.46, 0.22, 0.42), // buildings
    rect(1, 0.32, 0.36, 0.2, 0.52),
    rect(2, 0.56, 0.5, 0.18, 0.38),
    rect(3, 0.78, 0.42, 0.18, 0.46),
    tri(6, 0.3, 0.38, 0.42, 0.24, 0.54, 0.38), // a gable
    rect(5, 0.1, 0.54, 0.06, 0.06), // lit windows
    rect(5, 0.2, 0.54, 0.06, 0.06),
    rect(5, 0.36, 0.44, 0.06, 0.06),
    rect(5, 0.6, 0.58, 0.06, 0.06),
    rect(5, 0.82, 0.5, 0.06, 0.06),
    rect(4, 0.1, 0.68, 0.06, 0.06),
    rect(4, 0.62, 0.7, 0.06, 0.06),
    rect(4, 0.84, 0.66, 0.06, 0.06),
  ],
}

const desert: Drawing = {
  id: 'desert',
  tier: 3,
  palette: [
    '#27ae60', '#1e8449', '#a04000', '#f39c12', '#f4d03f',
    '#d4ac0d', '#e59866', '#f5b7b1', '#7e5109', '#fadbd8',
  ],
  order: [0, 1, 2, 8, 3, 4, 5, 6, 9, 7],
  background: [4, 5, 6, 7, 9],
  shapes: [
    rect(7, 0, 0, 1, 0.62), // hot sky, last
    disc(3, 0.74, 0.2, 0.1), // sun
    disc(9, 0.18, 0.16, 0.06), // thin cloud
    disc(9, 0.27, 0.18, 0.05),
    rect(6, 0, 0.54, 1, 0.12), // haze on the horizon
    rect(5, 0, 0.64, 1, 0.16), // far dune
    rect(4, 0, 0.78, 1, 0.22), // near sand
    tri(2, 0.04, 0.66, 0.18, 0.54, 0.32, 0.66), // rock
    rect(0, 0.46, 0.34, 0.09, 0.46), // saguaro
    rect(0, 0.3, 0.5, 0.16, 0.07),
    rect(0, 0.3, 0.4, 0.07, 0.14),
    rect(0, 0.55, 0.56, 0.15, 0.07),
    rect(0, 0.63, 0.44, 0.07, 0.16),
    line(1, 0.5, 0.36, 0.5, 0.8, 0.025), // shaded ridge
    rect(8, 0.4, 0.8, 0.26, 0.03), // shadow pooling at the base
  ],
}

const windmill: Drawing = {
  id: 'windmill',
  tier: 3,
  palette: [
    '#ecf0f1', '#e8daef', '#c0392b', '#5d4037', '#f4d03f',
    '#7dcea0', '#27ae60', '#aed6f1', '#ffffff', '#d4ac0d',
  ],
  order: [0, 1, 2, 3, 4, 6, 5, 9, 8, 7],
  background: [5, 6, 7, 8, 9],
  shapes: [
    rect(7, 0, 0, 1, 0.66), // sky, last
    disc(8, 0.18, 0.14, 0.07), // cloud
    disc(8, 0.28, 0.16, 0.055),
    rect(6, 0, 0.6, 1, 0.14), // far field
    rect(5, 0, 0.74, 1, 0.26), // near field
    tri(9, 0.44, 0.74, 0.58, 0.74, 0.74, 1), // path, widening towards the viewer
    tri(1, 0.34, 0.74, 0.66, 0.74, 0.5, 0.3), // tower
    tri(2, 0.39, 0.34, 0.61, 0.34, 0.5, 0.18), // cap
    rect(3, 0.46, 0.62, 0.08, 0.12), // door
    rect(4, 0.46, 0.48, 0.08, 0.08), // lit window
    // Four sails from one hub. Drawn last so they cross the sky and the tower
    // both, which is what makes the mill read as machinery.
    line(0, 0.5, 0.32, 0.86, 0.13, 0.035),
    line(0, 0.5, 0.32, 0.13, 0.5, 0.035),
    line(0, 0.5, 0.32, 0.69, 0.64, 0.03),
    line(0, 0.5, 0.32, 0.29, 0.05, 0.03),
  ],
}

const island: Drawing = {
  id: 'island',
  tier: 3,
  palette: [
    '#27ae60', '#1e8449', '#8b6f47', '#5d4037', '#f4d03f',
    '#5dade2', '#2980b9', '#d6eaf8', '#f9e79f', '#ffffff',
  ],
  order: [0, 1, 2, 3, 4, 8, 5, 6, 9, 7],
  background: [5, 6, 7, 9],
  shapes: [
    rect(7, 0, 0, 1, 0.5), // sky, last
    disc(8, 0.8, 0.16, 0.09), // sun
    disc(9, 0.16, 0.14, 0.06), // cloud
    rect(6, 0, 0.5, 1, 0.5), // open sea
    rect(5, 0, 0.62, 1, 0.14), // shallows
    disc(4, 0.5, 0.84, 0.34), // sand
    line(2, 0.47, 0.78, 0.42, 0.4, 0.045), // trunk, leaning
    disc(0, 0.3, 0.36, 0.13), // fronds
    disc(0, 0.55, 0.34, 0.13),
    disc(1, 0.42, 0.27, 0.12),
    disc(1, 0.45, 0.46, 0.1),
    disc(3, 0.44, 0.45, 0.035), // coconuts
    disc(3, 0.51, 0.47, 0.03),
    rect(6, 0, 0.92, 1, 0.03), // a wave in the foreground
  ],
}

const aurora: Drawing = {
  id: 'aurora',
  tier: 3,
  palette: [
    '#2ecc71', '#48c9b0', '#a569bd', '#ecf0f1', '#5d6d7e',
    '#34495e', '#1e8449', '#f9e79f', '#1b2631', '#aed6f1',
  ],
  order: [0, 1, 2, 3, 6, 4, 5, 9, 7, 8],
  background: [8],
  shapes: [
    rect(8, 0, 0, 1, 1), // polar night, last
    disc(7, 0.14, 0.1, 0.022), // stars
    disc(7, 0.86, 0.16, 0.02),
    disc(7, 0.6, 0.06, 0.024),
    disc(7, 0.32, 0.22, 0.018),
    // The bands are strokes rather than shapes because an aurora has no edge;
    // three at slightly different angles is enough to read as movement.
    line(2, 0.02, 0.24, 0.98, 0.14, 0.045),
    line(0, 0.02, 0.34, 0.98, 0.22, 0.07),
    line(1, 0.02, 0.46, 0.98, 0.32, 0.05),
    tri(5, 0, 0.86, 0.34, 0.54, 0.7, 0.86), // ridges
    tri(4, 0.4, 0.86, 0.78, 0.6, 1, 0.86),
    rect(9, 0, 0.84, 1, 0.16), // frozen lake
    rect(3, 0, 0.82, 1, 0.04), // snow line
    tri(6, 0.15, 0.68, 0.21, 0.84, 0.27, 0.68), // firs
    tri(6, 0.81, 0.7, 0.87, 0.84, 0.93, 0.7),
  ],
}

const train: Drawing = {
  id: 'train',
  tier: 3,
  palette: [
    '#c0392b', '#e67e22', '#2c3e50', '#f4d03f', '#ecf0f1',
    '#7f8c8d', '#8b6f47', '#27ae60', '#7dcea0', '#aed6f1',
  ],
  order: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  background: [7, 8, 9],
  shapes: [
    rect(9, 0, 0, 1, 0.6), // sky, last
    rect(7, 0, 0.52, 1, 0.12), // hedge
    rect(8, 0, 0.64, 1, 0.36), // field
    rect(5, 0, 0.82, 1, 0.025), // rails
    rect(5, 0, 0.88, 1, 0.025),
    rect(6, 0.06, 0.845, 0.06, 0.045), // sleepers
    rect(6, 0.3, 0.845, 0.06, 0.045),
    rect(6, 0.54, 0.845, 0.06, 0.045),
    rect(6, 0.78, 0.845, 0.06, 0.045),
    rect(0, 0.14, 0.56, 0.34, 0.2), // boiler
    rect(2, 0.09, 0.5, 0.06, 0.28), // buffer plate
    rect(0, 0.18, 0.44, 0.08, 0.14), // funnel
    rect(1, 0.5, 0.54, 0.22, 0.22), // carriages
    rect(1, 0.74, 0.54, 0.22, 0.22),
    rect(3, 0.3, 0.5, 0.08, 0.08), // cab and carriage windows
    rect(3, 0.54, 0.6, 0.07, 0.07),
    rect(3, 0.78, 0.6, 0.07, 0.07),
    disc(2, 0.2, 0.78, 0.05), // wheels, sitting on the near rail
    disc(2, 0.38, 0.78, 0.05),
    disc(2, 0.58, 0.78, 0.04),
    disc(2, 0.86, 0.78, 0.04),
    disc(4, 0.22, 0.34, 0.06), // steam, trailing back over the train
    disc(4, 0.33, 0.26, 0.05),
    disc(4, 0.45, 0.2, 0.04),
  ],
}

const waterfall: Drawing = {
  id: 'waterfall',
  tier: 3,
  palette: [
    '#5dade2', '#ecf0f1', '#2980b9', '#7f8c8d', '#566573',
    '#27ae60', '#1e8449', '#d6eaf8', '#5d4037', '#aed6f1',
  ],
  // The cliffs and the pool are scenery, not subject. They fill almost the whole
  // frame, and counting them left the tray silhouette at 78% of the canvas — a
  // square with a nick out of it. Excluded, the silhouette is the falling column,
  // which is the one shape this picture actually is.
  order: [0, 1, 5, 6, 8, 3, 4, 2, 9, 7],
  background: [2, 3, 4, 7, 9],
  shapes: [
    rect(7, 0, 0, 1, 1), // sky, last
    rect(3, 0, 0.24, 0.34, 0.76), // left cliff
    rect(4, 0.66, 0.18, 0.34, 0.82), // right cliff
    rect(0, 0.34, 0.26, 0.32, 0.5), // the fall
    rect(1, 0.38, 0.26, 0.07, 0.5), // white streaks in it
    rect(1, 0.55, 0.3, 0.06, 0.46),
    rect(2, 0, 0.76, 1, 0.24), // pool
    rect(9, 0.28, 0.7, 0.44, 0.09), // mist where it lands
    rect(5, 0, 0.2, 0.34, 0.06), // moss along the cliff tops
    rect(5, 0.66, 0.14, 0.34, 0.06),
    tri(6, 0.09, 0.2, 0.16, 0.03, 0.23, 0.2), // trees on the rim
    tri(6, 0.77, 0.14, 0.84, 0, 0.91, 0.14),
    disc(8, 0.19, 0.87, 0.06), // rocks in the pool
    disc(8, 0.81, 0.89, 0.05),
  ],
}

export const LIBRARY: Drawing[] = [
  // Everything under `imported/`, registered by `npm run import`.
  ...IMPORTED,
  mushroom,
  cat,
  leaf,
  moon,
  apple,
  key,
  mug,
  tulip,
  fish,
  bulb,
  fox,
  house,
  boat,
  bird,
  owl,
  cactus,
  balloon,
  campfire,
  whale,
  snail,
  lighthouse,
  forest,
  mountain,
  town,
  desert,
  windmill,
  island,
  aurora,
  train,
  waterfall,
]

export function drawingsForTier(tier: number): Drawing[] {
  return LIBRARY.filter((drawing) => drawing.tier === tier)
}
