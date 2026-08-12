import { colourMask, greyOf, overexposed, overexposure, resolve, type Image } from '../../art/image.ts'
import { dayLabel } from '../../core/day.ts'

/**
 * The popover: today's picture, and the wall of everything before it.
 *
 * It draws with the SAME `src/art` code the tests and the replay tool use, so
 * the picture here cannot drift from the picture those assert on. The renderer
 * owns no rules — it is handed a fill and an image id and paints them.
 */

type DayView = {
  kind: 'day'
  key: string
  imageId: string
  fill: number
  idle: boolean
  tier: number
  output: number
  target: number
  cost: string
  peakHour: number
}

type AwayView = { kind: 'away'; from: string; to: string; days: number }

type Payload = {
  today: Omit<DayView, 'kind'>
  tier: number
  overfillCap: number
  boundaryHour: number
  roast: { kind: string; text: string } | null
  entries: Array<DayView | AwayView>
}

declare global {
  interface Window {
    pigment: {
      onSnapshot: (handler: (snapshot: Payload) => void) => void
      request: () => Promise<Payload | null>
    }
  }
}

const todayCanvas = document.querySelector<HTMLCanvasElement>('#today')!
const todayMeta = document.querySelector<HTMLDivElement>('#today-meta')!
const todayWhen = document.querySelector<HTMLDivElement>('#today-when')!
const todayFill = document.querySelector<HTMLDivElement>('#today-fill')!
const wall = document.querySelector<HTMLDivElement>('#wall')!
const roastLine = document.querySelector<HTMLDivElement>('#roast')!

window.pigment.onSnapshot(paint)
void window.pigment.request().then((snapshot) => {
  if (snapshot) paint(snapshot)
})

function paint(payload: Payload): void {
  const today = payload.today
  drawInto(todayCanvas, resolve(today.imageId), today.fill, payload.overfillCap, TODAY_PX)

  todayWhen.textContent = dayLabel(today.key, payload.boundaryHour)

  const percent = Math.round(today.fill * 100)
  todayFill.textContent = `${percent}%`
  todayFill.classList.toggle('over', today.fill > 1)
  todayMeta.textContent = today.idle
    ? 'nothing yet today'
    : `${today.output.toLocaleString()} of ${today.target.toLocaleString()} tokens · tier ${today.tier} · ${today.cost}`

  // Every kind shows here, including the two that may not interrupt: this is
  // the surface you came looking at, so nothing is being pushed on you.
  roastLine.textContent = payload.roast?.text ?? ''
  roastLine.dataset['kind'] = payload.roast?.kind ?? ''
  roastLine.hidden = !payload.roast

  wall.replaceChildren(
    // Newest first: the thing you came to look at should not be a scroll away.
    ...[...payload.entries].reverse().map((entry) => tile(entry, payload.overfillCap)),
  )
}

function tile(entry: DayView | AwayView, cap: number): HTMLElement {
  if (entry.kind === 'away') {
    const strip = document.createElement('div')
    strip.className = 'away'
    strip.textContent = `away · ${entry.days} days`
    strip.title = `${entry.from} → ${entry.to}`
    return strip
  }

  const cell = document.createElement('div')
  cell.className = entry.idle ? 'tile idle' : 'tile'

  const canvas = document.createElement('canvas')
  drawInto(canvas, resolve(entry.imageId), entry.fill, cap, TILE_PX)
  cell.append(canvas)

  cell.title = entry.idle
    ? `${entry.key} · nothing`
    : `${entry.key} · ${Math.round(entry.fill * 100)}% · ${entry.output.toLocaleString()} tokens · ${entry.cost}`
  return cell
}

/**
 * Rough on-screen size in CSS pixels. The three tiers have different canvases
 * (16, 32, 48), so a fixed SCALE would render a tier-3 day three times the size
 * of a tier-1 day — at scale 12 that is a 576px image inside a 420px popover.
 * A target size and a derived integer scale keeps every day the same size.
 */
const TODAY_PX = 132
const TILE_PX = 44

/**
 * Backing-store scale. The CSS size is fixed, so what varies here is only how
 * many device pixels back each art pixel — at least 2 so the canvas stays crisp
 * on retina and the browser never has to interpolate upward.
 */
function scaleFor(size: number, target: number): number {
  return Math.max(2, Math.ceil((target * 2) / size))
}

/**
 * Draws an image at a fill onto a canvas at an integer scale.
 *
 * Integer scale and `imageSmoothingEnabled = false` are both load-bearing: a
 * fractional scale or any smoothing turns hard pixel edges into a grey haze,
 * which is exactly the "looks broken" failure the whole grayscale-to-colour
 * mechanic depends on avoiding.
 */
function drawInto(canvas: HTMLCanvasElement, image: Image, fill: number, cap: number, target: number): void {
  const scale = scaleFor(image.size, target)
  canvas.width = image.size * scale
  canvas.height = image.size * scale
  // Every day occupies the same square whatever its tier. Tier is meant to read
  // as DETAIL, not as size: a 48px tier-3 day rendered three times larger than a
  // 16px tier-1 day just looks like a layout bug.
  canvas.style.width = `${target}px`
  canvas.style.height = `${target}px`

  const context = canvas.getContext('2d')
  if (!context) return
  context.imageSmoothingEnabled = false
  context.clearRect(0, 0, canvas.width, canvas.height)

  const mask = colourMask(image, fill)
  const blown = overexposure(fill, cap)

  for (let y = 0; y < image.size; y++) {
    for (let x = 0; x < image.size; x++) {
      const index = y * image.size + x
      const palette = image.grid.pixels[index]!
      if (palette < 0) continue // transparent: the silhouette's outside

      const hex = image.palette[palette] ?? '#000000'
      context.fillStyle = mask[index] === 1 ? overexposed(hex, blown) : greyOf(hex)
      context.fillRect(x * scale, y * scale, scale, scale)
    }
  }

  // The bloom past 100%: a soft wash over the whole picture, rising with the
  // overshoot. SPEC §7 wants "too much" to be visible without a badge.
  if (blown > 0) {
    context.fillStyle = `rgba(255, 255, 255, ${0.10 + blown * 0.28})`
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
}
