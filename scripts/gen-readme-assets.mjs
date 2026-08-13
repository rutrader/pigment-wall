// Generates the README's visual assets from the app's own art.
//
// The hero is not a banner drawn about Pigment Wall — it is Pigment Wall's
// actual output. The same `render` and `colourMask` the app ships with produce
// the pixels here, so the strip on the README is, literally, four real days at
// four fills. If the fill rule changes, the hero changes with it.
//
//   node scripts/gen-readme-assets.mjs
//
// Rows of identical pixels are merged into single rects. A 32x32 drawing is
// 1,024 squares; run-length encoding takes it to roughly 300 and keeps the SVG
// small enough to sit at the top of a README without apology.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { register } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'assets', 'readme')
mkdirSync(out, { recursive: true })

const { render, colourMask, greyOf, overexposed, overexposure } = await import('../src/art/image.ts')
const { LIBRARY } = await import('../src/art/library.ts')

// --- visual system -----------------------------------------------------------
//
// Palette is taken from the drawings themselves rather than invented: the ink is
// the darkest colour in the library, the accent is the orange the popover uses
// for an overexposed day.

const INK = '#12141a'
const PANEL = '#191c24'
const PAPER = '#f4f2ec'
const MUTED = '#8b93a1'
const ACCENT = '#e8973a'
const RULE = '#2a2f3a'

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
const MONO = "ui-monospace, SFMono-Regular, Menlo, 'DejaVu Sans Mono', monospace"

/**
 * Pixels as run-length-merged rects. The one drawing routine everything uses.
 *
 * `grid` coarsens shape-authored drawings, which render at any resolution by
 * design — a gallery thumbnail does not need 48x48 of detail, and every pixel
 * dropped is rects that never reach the file. Imported raster art ignores it
 * and keeps its own grid, because rescaling pixel art is what ruins it.
 */
function tile(drawing, fill, x, y, scale, cap = 4, grid) {
  const image = render(drawing, grid)
  const mask = colourMask(image, fill)
  const blown = overexposure(fill, cap)
  const parts = []

  for (let row = 0; row < image.size; row++) {
    let runStart = 0
    let runColour = null

    const flush = (end) => {
      if (runColour === null || end === runStart) return
      const w = (end - runStart) * scale
      // The +0.06 overlap closes the hairline seams a fractional scale leaves
      // between rows; crispEdges stops the renderer softening pixel borders.
      parts.push(
        `<rect x="${round(x + runStart * scale)}" y="${round(y + row * scale)}" width="${round(w + 0.06)}" height="${round(scale + 0.06)}" fill="${runColour}"/>`,
      )
    }

    for (let col = 0; col <= image.size; col++) {
      const index = row * image.size + col
      const palette = col < image.size ? image.grid.pixels[index] : -2
      const colour =
        palette < 0
          ? null
          : mask[index] === 1
            ? overexposed(image.palette[palette] ?? '#000', blown)
            : greyOf(image.palette[palette] ?? '#000')

      if (colour !== runColour) {
        flush(col)
        runStart = col
        runColour = colour
      }
    }
  }

  return `<g shape-rendering="crispEdges">${parts.join('')}</g>`
}

const round = (n) => Math.round(n * 100) / 100
const pick = (id) => LIBRARY.find((d) => d.id === id) ?? LIBRARY[0]

// --- hero --------------------------------------------------------------------
//
// Composition is "integrated": the title shares a grid with four real days,
// because the progression IS the explanation. A reader who only looks at the
// picture still learns what the app does.

function hero() {
  const W = 1200
  const H = 380
  const stages = [
    { fill: 0.0, label: '0%', note: 'morning' },
    { fill: 0.45, label: '45%', note: 'by lunch' },
    { fill: 1.0, label: '100%', note: 'done' },
    { fill: 2.6, label: '260%', note: 'too much' },
  ]

  const drawing = pick('fox')
  const grid = render(drawing).size
  // An integer scale keeps every art pixel the same size; a fractional one
  // makes some rows a pixel taller than others, which pixel art shows up.
  const scale = 4
  const size = grid * scale
  const gap = 16
  const startX = W - 60 - stages.length * size - (stages.length - 1) * gap
  const tileY = 118

  const cells = stages
    .map((stage, i) => {
      const x = startX + i * (size + gap)
      return `
    <g>
      <rect x="${x - 6}" y="${tileY - 6}" width="${size + 12}" height="${size + 12}" rx="10" fill="${PANEL}" stroke="${RULE}"/>
      ${tile(drawing, stage.fill, x, tileY, scale)}
      <text x="${x + size / 2}" y="${tileY + size + 40}" font-family="${MONO}" font-size="22" font-weight="600" fill="${stage.fill > 1 ? ACCENT : PAPER}" text-anchor="middle">${stage.label}</text>
      <text x="${x + size / 2}" y="${tileY + size + 66}" font-family="${FONT}" font-size="19" fill="${MUTED}" text-anchor="middle">${stage.note}</text>
    </g>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
  <title id="t">Pigment Wall</title>
  <desc id="d">The same pixel-art fox shown four times: entirely grey at 0 percent of the day's target, partly coloured at 45 percent, fully coloured at 100 percent, and bleached white at 260 percent.</desc>
  <rect width="${W}" height="${H}" rx="18" fill="${INK}"/>
  <text x="60" y="86" font-family="${MONO}" font-size="20" letter-spacing="3" fill="${MUTED}">MACOS · MENU BAR</text>
  <text x="60" y="158" font-family="${FONT}" font-size="64" font-weight="700" fill="${PAPER}" letter-spacing="-1.5">Pigment Wall</text>
  <text x="60" y="206" font-family="${FONT}" font-size="26" fill="${PAPER}" opacity="0.82">A day is a picture.</text>
  <text x="60" y="242" font-family="${FONT}" font-size="26" fill="${ACCENT}">It colours in as you burn tokens.</text>
  <rect x="60" y="286" width="420" height="1" fill="${RULE}"/>
  <text x="60" y="320" font-family="${MONO}" font-size="19" fill="${MUTED}">reads ~/.claude · sends nothing</text>
  <text x="60" y="350" font-family="${MONO}" font-size="19" fill="${MUTED}">TypeScript · Electron</text>
${cells}
</svg>
`
}

// --- the loop ----------------------------------------------------------------
//
// A sequence strip, because the difficulty controller is the one mechanism a
// reader cannot guess from a screenshot.

function loop() {
  const W = 1200
  const H = 260
  const steps = [
    ['1', 'Tokens', 'Read from your own\nsession logs'],
    ['2', 'Target', "Your 40th-percentile\nday, tracked live"],
    ['3', 'Fill', 'tokens ÷ target,\nsubject colours first'],
    ['4', 'Tomorrow', 'Beat it and it rises.\nMiss and it eases.'],
  ]

  const boxW = 252
  const gap = 32
  const startX = (W - steps.length * boxW - (steps.length - 1) * gap) / 2

  const cells = steps
    .map(([n, title, body], i) => {
      const x = startX + i * (boxW + gap)
      const lines = body
        .split('\n')
        .map((line, j) => `<text x="${x + 26}" y="${152 + j * 26}" font-family="${FONT}" font-size="19" fill="${MUTED}">${line}</text>`)
        .join('')
      const arrow =
        i < steps.length - 1
          ? `<path d="M${x + boxW + 8} 116 l14 0 m-5 -5 l5 5 l-5 5" stroke="${RULE}" stroke-width="2" fill="none" stroke-linecap="round"/>`
          : ''
      return `
    <g>
      <rect x="${x}" y="52" width="${boxW}" height="140" rx="12" fill="${PANEL}" stroke="${RULE}"/>
      <text x="${x + 26}" y="90" font-family="${MONO}" font-size="18" fill="${ACCENT}">${n}</text>
      <text x="${x + 26}" y="122" font-family="${FONT}" font-size="26" font-weight="600" fill="${PAPER}">${title}</text>
      ${lines}
      ${arrow}
    </g>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="lt ld">
  <title id="lt">How the difficulty loop works</title>
  <desc id="ld">Four steps: tokens read from session logs, a target at your 40th-percentile day, fill as tokens divided by target, and a target that rises when you beat it and eases when you miss.</desc>
  <rect width="${W}" height="${H}" rx="18" fill="${INK}"/>
  <text x="${W / 2}" y="34" font-family="${MONO}" font-size="19" letter-spacing="2.5" fill="${MUTED}" text-anchor="middle">THE LOOP</text>
${cells}
</svg>
`
}

// --- the library -------------------------------------------------------------

function gallery() {
  const W = 1200
  const perRow = 7
  const size = 148
  const gap = 18
  const shown = LIBRARY.slice(0, 14)
  const rows = Math.ceil(shown.length / perRow)
  const H = 64 + rows * (size + gap)
  const startX = (W - perRow * size - (perRow - 1) * gap) / 2

  // Fills chosen to show the range: some barely begun, some blown out.
  const fills = [0.15, 1, 0.55, 2.2, 0.85, 0.35, 1, 0.7, 0.25, 1.6, 0.95, 0.45, 1, 3.2]

  const cells = shown
    .map((drawing, i) => {
      const x = startX + (i % perRow) * (size + gap)
      const y = 56 + Math.floor(i / perRow) * (size + gap)
      const grid = drawing.raster ? undefined : 24
      const scale = size / render(drawing, grid).size
      return `<g><rect x="${x - 4}" y="${y - 4}" width="${size + 8}" height="${size + 8}" rx="8" fill="${PANEL}" stroke="${RULE}"/>${tile(drawing, fills[i] ?? 1, x, y, scale, 4, grid)}</g>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="gt gd">
  <title id="gt">The drawings</title>
  <desc id="gd">Fourteen pixel-art drawings at different fill levels, from barely started and grey to fully coloured and overexposed.</desc>
  <rect width="${W}" height="${H}" rx="18" fill="${INK}"/>
  <text x="${W / 2}" y="34" font-family="${MONO}" font-size="19" letter-spacing="2.5" fill="${MUTED}" text-anchor="middle">EVERY DAY GETS ONE</text>
${cells}
</svg>
`
}

const assets = { 'hero.svg': hero(), 'loop.svg': loop(), 'gallery.svg': gallery() }
for (const [name, svg] of Object.entries(assets)) {
  writeFileSync(join(out, name), svg)
  console.log(`${name.padEnd(14)} ${(svg.length / 1024).toFixed(1)} KB`)
}
