import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { guessOrder, importPng } from '../art/import.ts'

/**
 * Turns a PNG into a `Drawing` module.
 *
 *   node src/tools/import-png.ts <file.png> --tier=3 [--id=cassette]
 *                                [--order=3,1,0] [--background=2,5]
 *
 * Prints the palette it found — index, swatch, share of the picture, and
 * whether it touches the border — then writes `src/art/imported/<id>.ts`. Two
 * fields are guesses the tool cannot make well and you should correct by eye:
 * `order` and `background` (SPEC §6, §11). Re-run with the flags to fix them.
 */

const [file, ...rest] = process.argv.slice(2)
if (!file) {
  console.error('usage: node src/tools/import-png.ts <file.png> --tier=N [--id=name]')
  process.exit(1)
}

const args = new Map(
  rest.map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k ?? '', v ?? 'true'] as const
  }),
)

const id = args.get('id') ?? basename(file).replace(/\.png$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
const tier = Number(args.get('tier') ?? 3)

const imported = importPng(readFileSync(file))
const total = imported.counts.reduce((a, b) => a + b, 0)

console.log(`\n${file}`)
console.log(`  native grid ${imported.size}×${imported.size} (${imported.block}× in the file)`)
console.log(`  ${imported.palette.length} colours, ${total} opaque pixels\n`)
console.log('  idx  colour     share  edge')
imported.palette.forEach((hex, i) => {
  const share = ((imported.counts[i]! / total) * 100).toFixed(1).padStart(5)
  const edge = imported.edge.includes(i) ? '  yes' : ''
  console.log(`  ${String(i).padStart(3)}  ${hex}  ${share}%${edge}`)
})

const background = args.has('background')
  ? String(args.get('background')).split(',').filter(Boolean).map(Number)
  : imported.edge
const order = args.has('order')
  ? String(args.get('order')).split(',').filter(Boolean).map(Number)
  : guessOrder(imported)

// A drawing whose order omits a colour renders that colour as permanently grey,
// which looks like a bug rather than a choice. Catch it here, not in review.
const used = imported.palette.map((_, i) => i).filter((i) => imported.counts[i]! > 0)
const missing = used.filter((i) => !order.includes(i))
if (missing.length > 0) throw new Error(`order is missing colours: ${missing.join(', ')}`)

const module_ = `import type { Drawing } from '../library.ts'

/**
 * Imported from ${basename(file)} — ${imported.size}×${imported.size}, ${imported.palette.length} colours.
 *
 * \`order\` and \`background\` were guessed by the importer and are the two
 * fields worth checking by eye: order is the sequence colours gain colour in
 * (subject first, background last), and background marks what the tray icon
 * should leave out of the silhouette.
 */
export const ${id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}: Drawing = {
  id: '${id}',
  tier: ${tier},
  palette: ${JSON.stringify(imported.palette)},
  order: ${JSON.stringify(order)},
  background: ${JSON.stringify(background)},
  raster: {
    size: ${imported.size},
    pixels: ${JSON.stringify(imported.pixels)},
  },
}
`

mkdirSync(join('src', 'art', 'imported'), { recursive: true })
const out = join('src', 'art', 'imported', `${id}.ts`)
writeFileSync(out, module_)
console.log(`\n  order      ${JSON.stringify(order)}${args.has('order') ? '' : '   (guessed)'}`)
console.log(`  background ${JSON.stringify(background)}${args.has('background') ? '' : '   (guessed: colours touching the border)'}`)
console.log(`\n  wrote ${out}\n`)
