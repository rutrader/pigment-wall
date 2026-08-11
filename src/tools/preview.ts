import { colourMask, greyOf, overexposed, overexposure, parseHex, render } from '../art/image.ts'
import { LIBRARY, drawingsForTier, type Drawing } from '../art/library.ts'
import { DEFAULTS } from '../core/config.ts'

/**
 * Prints the library to the terminal at a range of fills.
 *
 *   node src/tools/preview.ts [--tier=2] [--id=fox] [--fills=0.25,0.5,1,2.5]
 *
 * M2 exists to answer one question that no amount of specification settles:
 * does a 40%-filled image still read as a picture? This is how you look at it
 * without building a window first. Two pixel rows are packed into one terminal
 * row with a half-block, so the aspect ratio is roughly square.
 */

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k ?? '', v ?? 'true'] as const
  }),
)

const ASCII = args.has('ascii')

const fills = (args.get('fills') ?? '0.25,0.4,0.7,1,2.5')
  .split(',')
  .map(Number)
  .filter((n) => Number.isFinite(n))

let drawings: Drawing[] = LIBRARY
if (args.has('tier')) drawings = drawingsForTier(Number(args.get('tier')))
if (args.has('id')) drawings = LIBRARY.filter((d) => d.id === args.get('id'))

for (const drawing of drawings) {
  const image = render(drawing)
  console.log(`\n\x1b[1m${drawing.id}\x1b[0m  tier ${drawing.tier} · ${image.size}px · ${image.palette.length} colours`)

  const columns = fills.map((fill) => rows(image, fill))
  const labels = fills.map((fill) => `${Math.round(fill * 100)}%`)

  const gap = '  '
  console.log(
    labels
      .map((label, i) => label.padEnd(Math.max(image.size, label.length)))
      .join(gap),
  )

  for (let row = 0; row < columns[0]!.length; row++) {
    console.log(columns.map((column) => column[row]!).join(gap))
  }
}

/**
 * Composition without colour: an uppercase letter per palette entry once it has
 * gained colour, lowercase while still grey, blank outside the silhouette.
 *
 * Useful on a terminal without truecolour, and the only way to read the shape
 * when the output is being piped somewhere that eats escape codes.
 */
function asciiRows(image: ReturnType<typeof render>, fill: number): string[] {
  const mask = colourMask(image, fill)
  const out: string[] = []
  for (let y = 0; y < image.size; y++) {
    let line = ''
    for (let x = 0; x < image.size; x++) {
      const index = y * image.size + x
      const palette = image.grid.pixels[index]!
      if (palette < 0) line += ' '
      else {
        const letter = String.fromCharCode(65 + (palette % 26))
        line += mask[index] === 1 ? letter : letter.toLowerCase()
      }
    }
    out.push(line)
  }
  return out
}

/** One image at one fill, as terminal rows. */
function rows(image: ReturnType<typeof render>, fill: number): string[] {
  if (ASCII) return asciiRows(image, fill)
  const mask = colourMask(image, fill)
  const blown = overexposure(fill, DEFAULTS.overfillCap)
  const out: string[] = []

  for (let y = 0; y < image.size; y += 2) {
    let line = ''
    for (let x = 0; x < image.size; x++) {
      const top = colourAt(image, mask, x, y, blown)
      const bottom = y + 1 < image.size ? colourAt(image, mask, x, y + 1, blown) : null
      line += cell(top, bottom)
    }
    out.push(`${line}\x1b[0m`)
  }
  return out
}

function colourAt(
  image: ReturnType<typeof render>,
  mask: Uint8Array,
  x: number,
  y: number,
  blown: number,
): string | null {
  const index = y * image.size + x
  const palette = image.grid.pixels[index]!
  if (palette < 0) return null // transparent — outside the silhouette
  const hex = image.palette[palette] ?? '#000000'
  return mask[index] === 1 ? overexposed(hex, blown) : greyOf(hex)
}

/** Upper half-block: foreground paints the top pixel, background the bottom. */
function cell(top: string | null, bottom: string | null): string {
  if (top === null && bottom === null) return '\x1b[0m '
  const fg = top ? rgb(top, false) : ''
  const bg = bottom ? rgb(bottom, true) : '\x1b[49m'
  if (top === null) return `${bg} \x1b[0m`
  return `${fg}${bg}▀`
}

function rgb(hex: string, background: boolean): string {
  const { r, g, b } = parseHex(hex)
  return `\x1b[${background ? 48 : 38};2;${r};${g};${b}m`
}
