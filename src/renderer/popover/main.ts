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

type Payload = {
  today: DayView
  tier: number
  overfillCap: number
  boundaryHour: number
  roast: { kind: string; text: string } | null
  days: DayView[]
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

  wall.replaceChildren(...calendar(payload))
}

/** Monday-first, because the working week is the rhythm being displayed. */
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * The wall as a calendar: seven columns, one row per week, newest week first.
 *
 * Position encodes the date, which is the entire point — the flow layout this
 * replaced could not answer "how was last Tuesday?" without hovering over
 * squares one at a time. It also makes the weekly rhythm visible: a column of
 * bright Sundays beside a column of pale Tuesdays (SPEC §6a).
 *
 * Newest week on top rather than a calendar's usual order, so today is always
 * on the first row and never behind a scroll.
 */
function calendar(payload: Payload): HTMLElement[] {
  const byKey = new Map(payload.days.map((day) => [day.key, day]))
  const rows: HTMLElement[] = [header()]

  const weeks = groupIntoWeeks(payload.days)
  for (const week of weeks.reverse()) {
    const row = document.createElement('div')
    row.className = 'week'

    const label = document.createElement('div')
    label.className = 'week-label'
    // The Monday's day-of-month is enough of a time axis in 26px; the month
    // changing is visible from the number wrapping back to a low one.
    label.textContent = String(Number(week[0]!.slice(-2)))
    row.append(label)

    for (const key of week) {
      const day = byKey.get(key)
      row.append(day ? tile(day, payload.overfillCap, key === payload.today.key) : blank())
    }
    rows.push(row)
  }

  return rows
}

function header(): HTMLElement {
  const row = document.createElement('div')
  row.className = 'week head'
  const spacer = document.createElement('div')
  spacer.className = 'week-label'
  row.append(spacer)
  for (const letter of WEEKDAYS) {
    const cell = document.createElement('div')
    cell.className = 'weekday'
    cell.textContent = letter
    row.append(cell)
  }
  return row
}

/**
 * Every week the wall touches, as seven day-keys each.
 *
 * Weeks are complete even at the edges: the first week is padded backwards and
 * the current one forwards, because a ragged grid loses the column alignment
 * that is the whole reason for the layout.
 */
function groupIntoWeeks(days: DayView[]): string[][] {
  if (days.length === 0) return []

  const first = new Date(`${days[0]!.key}T00:00:00`)
  const last = new Date(`${days[days.length - 1]!.key}T00:00:00`)

  // getDay() is Sunday-based; shift so Monday is 0.
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  last.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)))

  const weeks: string[][] = []
  const cursor = new Date(first)
  while (cursor <= last) {
    const week: string[] = []
    for (let i = 0; i < 7; i++) {
      week.push(
        `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`,
      )
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

/** A day outside the wall's range — holds the column, shows nothing. */
function blank(): HTMLElement {
  const cell = document.createElement('div')
  cell.className = 'tile empty'
  return cell
}

function tile(entry: DayView, cap: number, isToday = false): HTMLElement {
  const cell = document.createElement('div')
  cell.className = `tile${entry.idle ? ' idle' : ''}${isToday ? ' today' : ''}`

  const canvas = document.createElement('canvas')
  drawInto(canvas, resolve(entry.imageId), entry.fill, cap, TILE_PX)
  cell.append(canvas)

  cell.title = entry.idle
    ? `${entry.key} · nothing`
    // SPEC §7 asks for the raw multiplier here, not the percentage the header
    // shows — 2.4x reads as "how far past" in a way 240% does not.
    : `${entry.key} · ${entry.fill.toFixed(1)}× · ${entry.output.toLocaleString()} tokens · ${entry.cost}`
  return cell
}

/**
 * Rough on-screen size in CSS pixels. The three tiers have different canvases
 * (16, 32, 48), so a fixed SCALE would render a tier-3 day three times the size
 * of a tier-1 day — at scale 12 that is a 576px image inside a 420px popover.
 * A target size and a derived integer scale keeps every day the same size.
 */
const TODAY_PX = 128
const TILE_PX = 46

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
