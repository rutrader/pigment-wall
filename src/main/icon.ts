import { overexposure, resolve, type Image } from '../art/image.ts'
import { encodePng } from './png.ts'

/**
 * The menu-bar icon. SPEC §11.
 *
 * v1 is a macOS TEMPLATE image: alpha carries the shape, RGB is forced black,
 * and the system tints it for light and dark menu bars. That is how an icon
 * looks native, and it is bought at a real price — an app about colour shows no
 * colour in the menu bar until phase 2.
 *
 * So fill is encoded in alpha instead. The shape is today's picture reduced to
 * its silhouette; pixels that have gained colour are solid, the rest are faint.
 * You glance up and see a half-solid fox: how far along you are, and which day
 * this is, without opening anything.
 *
 * Three rules, each from §11:
 *
 *   - Rendered at 2× (32px) and handed to macOS as a retina image. Silhouettes
 *     break up if you draw them at 16 and let anything upscale.
 *   - Overexposure cannot be shown in colour here, so past 100% the shape gains
 *     a RING outside its outline — a shape cue, not a colour cue.
 *   - No animation. The caller redraws only when fill crosses a step, because a
 *     visibly creeping icon is delightful for a week and a tax forever.
 */

/** Logical points. macOS menu-bar icons are ~16pt of content in a 22pt bar. */
export const ICON_POINTS = 16
const SCALE = 2

/** Alpha for a pixel inside the silhouette that has not yet gained colour. */
const GHOST = 0.22
const SOLID = 1

export type IconState = {
  imageId: string
  fill: number
  /** Cap from config, so the ring saturates at the same point the art does. */
  overfillCap: number
  /** No data at all: draw a hollow outline instead of a filled shape. */
  empty?: boolean
}

export function iconPng(state: IconState): Buffer {
  const image = state.empty ? null : resolve(state.imageId)
  const size = ICON_POINTS * SCALE

  const alpha = image ? alphaField(image, state, size) : null
  const outline = image ? outlineOf(image, size) : null
  const ring = image ? ringOf(image, size, overexposure(state.fill, state.overfillCap)) : null

  return encodePng(size, (x, y) => {
    const index = y * size + x

    if (!alpha) {
      // No data: a hollow square, so "nothing yet" is visibly different from
      // "empty picture" rather than an invisible icon.
      const edge = x === 1 || y === 1 || x === size - 2 || y === size - 2
      const inside = x >= 1 && y >= 1 && x <= size - 2 && y <= size - 2
      return { r: 0, g: 0, b: 0, a: inside && edge ? 255 * 0.5 : 0 }
    }

    const a = Math.max(alpha[index]!, ring ? ring[index]! : 0, outline ? outline[index]! : 0)
    // Template image: RGB must be black, the system supplies the colour.
    return { r: 0, g: 0, b: 0, a: a * 255 }
  })
}

/**
 * Per-pixel alpha: solid where filled, ghosted where not, zero outside.
 *
 * The icon fills the subject shape BOTTOM-UP by the day's overall fill, rather
 * than replaying the palette order the picture uses. The popover shows which
 * thing gained colour; the tray answers a cruder question — how far along am I —
 * and a rising water line answers it legibly at 16 points where palette order
 * would just flicker.
 */
function alphaField(image: Image, state: IconState, size: number): Float32Array {
  const field = new Float32Array(size * size)
  if (image.subject.length === 0) return field

  const lit = new Set(
    image.subject.slice(0, Math.round(Math.min(state.fill, 1) * image.subject.length)),
  )

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Nearest-neighbour from the art grid — a pixel-art silhouette must stay
      // hard-edged; smoothing it produces a grey smudge at 16pt.
      const sx = Math.floor((x / size) * image.size)
      const sy = Math.floor((y / size) * image.size)
      const source = sy * image.size + sx
      if (!subjectAt(image, source)) continue
      field[y * size + x] = lit.has(source) ? SOLID : GHOST
    }
  }

  return field
}

/** Membership test shared by the alpha, outline and ring passes. */
function subjectAt(image: Image, index: number): boolean {
  return image.subjectMask[index] === 1
}

/**
 * A one-pixel edge around the silhouette, always solid.
 *
 * Without it a barely-started day is a uniform 22%-alpha blob, which reads as
 * "the app is broken" rather than "the day has just begun". The outline keeps
 * the shape legible at every fill.
 */
function outlineOf(image: Image, size: number): Float32Array {
  const field = new Float32Array(size * size)
  const inside = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= size || y >= size) return false
    const sx = Math.floor((x / size) * image.size)
    const sy = Math.floor((y / size) * image.size)
    return subjectAt(image, sy * image.size + sx)
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inside(x, y)) continue
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)
      if (edge) field[y * size + x] = 0.75
    }
  }

  return field
}

/**
 * The overexposure cue: a halo one pixel outside the silhouette.
 *
 * §11 v1 cannot say "too much" in colour, so it says it in shape. Intensity
 * tracks the same 0..1 overshoot the picture uses for bloom, so the tray and the
 * popover agree about how extreme the day was.
 */
function ringOf(image: Image, size: number, amount: number): Float32Array {
  const field = new Float32Array(size * size)
  if (amount <= 0) return field

  const inside = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= size || y >= size) return false
    const sx = Math.floor((x / size) * image.size)
    const sy = Math.floor((y / size) * image.size)
    return subjectAt(image, sy * image.size + sx)
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inside(x, y)) continue
      const touches =
        inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1)
      if (touches) field[y * size + x] = 0.35 + 0.65 * amount
    }
  }

  return field
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
