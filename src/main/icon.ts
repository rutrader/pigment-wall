import { greyOf, overexposed, overexposure, parseHex, resolve, type Image } from '../art/image.ts'
import { encodePng } from './png.ts'

/**
 * The menu-bar icon. SPEC §11, phase 2.
 *
 * v1 was a macOS TEMPLATE image: alpha carried the shape, RGB was forced black,
 * and the system tinted it. Native-looking, and bought at a real price — an app
 * about colour showed no colour in the menu bar. This is the trade §11 always
 * intended to reverse once the rest worked.
 *
 * The icon is now today's picture reduced to its subject silhouette, filling
 * BOTTOM-UP as the day goes on: coloured below the water line, grey above it.
 * That is the popover's own mechanic at 16 points, so the two surfaces say the
 * same thing in the same language — you glance up and see a half-coloured fox,
 * which is both how far along you are and which day this is.
 *
 * Bottom-up rather than the popover's palette order, deliberately. The popover
 * answers *which thing gained colour*; the tray answers the cruder *how far
 * along am I*, and a rising water line answers that legibly at a size where
 * palette order would just flicker.
 *
 * Four rules, each from §11 and each load-bearing:
 *
 *   - Drawn at 2x (32px) and handed to macOS as a retina image. Silhouettes
 *     break up if you draw at 16 and let anything upscale.
 *   - Every icon carries a 1px contrasting halo. A non-template colour icon has
 *     no system tinting to save it, and dark art on a dark menu bar — or a
 *     wallpaper showing through — is otherwise invisible.
 *   - Extreme states differ by SHAPE, not only colour. Overexposure blooms past
 *     the outline; no-data is a hollow square. Roughly 8% of male viewers will
 *     not distinguish some of these palettes at all.
 *   - No animation. The caller redraws only when fill crosses a step.
 */

/** Logical points. macOS menu-bar icons are ~16pt of content in a 22pt bar. */
export const ICON_POINTS = 16
const SCALE = 2

export type IconState = {
  imageId: string
  fill: number
  /** Cap from config, so the bloom saturates where the picture's does. */
  overfillCap: number
  /** No data at all: draw a hollow outline instead of a filled shape. */
  empty?: boolean
  /**
   * Whether the menu bar is currently dark.
   *
   * A template image never needed this — the system tinted it. A colour icon
   * has to pick its own contrast, so the caller passes the current appearance
   * and redraws when it changes.
   */
  dark?: boolean
}

type RGBA = { r: number; g: number; b: number; a: number }

const CLEAR: RGBA = { r: 0, g: 0, b: 0, a: 0 }

export function iconPng(state: IconState): Buffer {
  const size = ICON_POINTS * SCALE
  const halo = state.dark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 }

  if (state.empty) return emptyIcon(size, halo)

  const image = resolve(state.imageId)
  const blown = overexposure(state.fill, state.overfillCap)

  // The water line: how many of the subject's pixels, counted bottom-up, have
  // gained colour. `subject` is already sorted bottom-up by the art layer.
  const lit = new Set(
    image.subject.slice(0, Math.round(Math.min(state.fill, 1) * image.subject.length)),
  )

  const at = (x: number, y: number): number => sourceIndex(image, x, y, size)
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < size && y < size && image.subjectMask[at(x, y)] === 1

  return encodePng(size, (x, y) => {
    if (inside(x, y)) {
      const index = at(x, y)
      const hex = image.palette[image.grid.pixels[index]!] ?? '#000000'
      const { r, g, b } = parseHex(lit.has(index) ? overexposed(hex, blown) : greyOf(hex))
      return { r, g, b, a: 255 }
    }

    // Outside the silhouette: the halo, and the bloom that grows out of it.
    const touching = inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1)
    if (!touching) return CLEAR

    if (blown > 0) {
      // Overexposure pushes the halo warm and bright — the same "too much" the
      // picture shows, in a place a 16pt shape can carry it.
      return { r: 255, g: 220 - Math.round(60 * blown), b: 150 - Math.round(90 * blown), a: 140 + Math.round(115 * blown) }
    }

    return { ...halo, a: 150 }
  })
}

/**
 * No data yet: a hollow square.
 *
 * Different in SHAPE from every real day, not merely paler, so "nothing has
 * happened yet" can never be mistaken for "a day that has barely started".
 */
function emptyIcon(size: number, halo: { r: number; g: number; b: number }): Buffer {
  return encodePng(size, (x, y) => {
    const inset = x >= 3 && y >= 3 && x <= size - 4 && y <= size - 4
    const edge = x === 3 || y === 3 || x === size - 4 || y === size - 4
    return inset && edge ? { ...halo, a: 130 } : CLEAR
  })
}

/** Nearest-neighbour sample. Pixel art must stay hard-edged at any size. */
function sourceIndex(image: Image, x: number, y: number, size: number): number {
  const sx = Math.min(image.size - 1, Math.floor((x / size) * image.size))
  const sy = Math.min(image.size - 1, Math.floor((y / size) * image.size))
  return sy * image.size + sx
}

/**
 * Whether a fill change is worth a redraw.
 *
 * §11: redraw only when fill crosses a 2% step — about 50 redraws on a working
 * day, invisible cost, and still noticeable when you glance up.
 */
export function iconStep(fill: number): number {
  return Math.round(fill * 50)
}
