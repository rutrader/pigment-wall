import type { Shape } from './shapes.ts'
import { cassette } from './imported/cassette.ts'

/**
 * Twelve authored pictures, four per tier.
 *
 * These are SCAFFOLDING. The format, the palette ordering and the fill are the
 * real deliverable; the drawings are placeholders good enough to answer the
 * question M2 exists to answer — does a 40%-filled image still read as a
 * picture? Replacing one means writing a new `Drawing` here and nothing else:
 * the loader, the tray and the wall never learn that it changed.
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

export const LIBRARY: Drawing[] = [
  cassette,
  mushroom,
  cat,
  leaf,
  moon,
  fox,
  house,
  boat,
  bird,
  lighthouse,
  forest,
  mountain,
  town,
]

export function drawingsForTier(tier: number): Drawing[] {
  return LIBRARY.filter((drawing) => drawing.tier === tier)
}
