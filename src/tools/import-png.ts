import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { guessOrder, importPng, importSheet, type Imported } from '../art/import.ts'

/**
 * Turns a PNG — or a whole sprite sheet — into `Drawing` modules.
 *
 *   node src/tools/import-png.ts art.png --tier=3 [--id=cassette]
 *                                [--order=3,1,0] [--background=2,5]
 *
 *   node src/tools/import-png.ts sheet.png --sheet=8x5 --tier=2 [--prefix=kenney]
 *                                [--min=12]
 *
 *   node src/tools/import-png.ts ./pack/Tiles/ --tier=2 [--prefix=dungeon] [--min=12]
 *
 * A directory imports every PNG inside it — asset packs usually ship separate
 * sprites as well as a sheet, and separate files come with names worth keeping.
 *
 * Prints the palette it found — index, swatch, share of the picture, and whether
 * it touches the border — then writes `src/art/imported/<id>.ts`. Two fields are
 * guesses the tool cannot make well and you should check by eye: `order` and
 * `background` (SPEC §6, §11). Re-run with the flags to correct them.
 *
 * Sheet mode skips empty cells, trims each sprite to its opaque bounds and pads
 * it back to a square. Sprites on transparency need no `background` at all —
 * transparency already means "outside the picture", which is what the tray icon
 * uses for its silhouette.
 */

const [file, ...rest] = process.argv.slice(2)
if (!file) {
  console.error('usage: node src/tools/import-png.ts <file.png> --tier=N [--id=name]')
  console.error('       node src/tools/import-png.ts <sheet.png> --sheet=COLSxROWS --tier=N [--prefix=name]')
  process.exit(1)
}

const args = new Map(
  rest.map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k ?? '', v ?? 'true'] as const
  }),
)

const tier = Number(args.get('tier') ?? 3)
const slug = (value: string): string =>
  value.replace(/\.png$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '')

const outDir = join('src', 'art', 'imported')
mkdirSync(outDir, { recursive: true })

if (args.has('sheet')) importSheetFile()
else if (isDirectory(file!)) importFolder()
else importSingle()

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

// --- single image --------------------------------------------------------------

function importSingle(): void {
  const id = args.get('id') ?? slug(basename(file!))
  const imported = importPng(readFileSync(file!))

  console.log(`\n${file}`)
  console.log(`  native grid ${imported.size}×${imported.size} (${imported.block}× in the file)`)
  report(imported)

  const background = args.has('background')
    ? numbers(String(args.get('background')))
    : imported.edge
  const order = args.has('order') ? numbers(String(args.get('order'))) : guessOrder(imported)

  if (!mayWrite(id)) {
    console.error(`\n  ${id} already exists. Re-importing would discard any order or`)
    console.error('  background you corrected by hand. Pass --force to replace it.\n')
    process.exit(1)
  }

  const path = write(id, imported, order, background, basename(file!))
  writeIndex()
  console.log(`\n  order      ${JSON.stringify(order)}${args.has('order') ? '' : '   (guessed)'}`)
  console.log(`  background ${JSON.stringify(background)}${args.has('background') ? '' : '   (guessed: colours touching the border)'}`)
  console.log(`\n  wrote ${path}\n`)
}

// --- sprite sheet --------------------------------------------------------------

function importSheetFile(): void {
  const spec = String(args.get('sheet'))
  const match = /^(\d+)x(\d+)$/i.exec(spec)
  if (!match) {
    console.error(`--sheet must look like 8x5 (columns x rows), got "${spec}"`)
    process.exit(1)
  }

  const columns = Number(match[1])
  const rows = Number(match[2])
  const prefix = args.get('prefix') ?? slug(basename(file!))
  // Below this many opaque pixels a cell is a speck — a stray dot or an
  // anti-aliasing crumb left in the sheet, not a picture worth a day.
  const min = Number(args.get('min') ?? 12)

  const sliced = importSheet(readFileSync(file!), { columns, rows })

  console.log(`\n${file}`)
  console.log(`  ${columns}×${rows} grid · ${sliced.length} non-empty cells of ${columns * rows}`)
  console.log(`  upscale ${sliced[0]?.imported.block ?? 1}× in the file\n`)
  console.log('  cell   id                     grid  colours  pixels')

  let written = 0
  let skipped = 0
  for (const { cell, imported } of sliced) {
    const opaque = imported.counts.reduce((a, b) => a + b, 0)
    const id = `${prefix}-${String(cell).padStart(2, '0')}`

    if (opaque < min) {
      console.log(`  ${String(cell).padStart(4)}   ${id.padEnd(22)} ${`${imported.size}²`.padStart(5)}  ${String(imported.palette.length).padStart(7)}  ${String(opaque).padStart(6)}  skipped (too small)`)
      continue
    }

    if (!mayWrite(id)) {
      skipped++
      continue
    }

    // Sprites arrive on transparency, so nothing is scenery and the whole
    // sprite is the silhouette. That is the fiddly authoring decision gone.
    write(id, imported, guessOrder(imported), [], `${basename(file!)} cell ${cell}`)
    written++
    console.log(`  ${String(cell).padStart(4)}   ${id.padEnd(22)} ${`${imported.size}²`.padStart(5)}  ${String(imported.palette.length).padStart(7)}  ${String(opaque).padStart(6)}`)
  }

  const total = writeIndex()
  console.log(`\n  wrote ${written} drawings to ${outDir}/ (${total} there in total)`)
  if (skipped > 0) console.log(`  ${skipped} already existed and were left alone (--force to replace).`)
  console.log('  they are live: src/art/imported/index.ts is regenerated and LIBRARY spreads it.')
  console.log('  drop any you dislike by deleting the file and re-running an import.\n')
}

// --- a folder of separate sprites ----------------------------------------------

function importFolder(): void {
  const prefix = args.get('prefix') ?? slug(basename(file!))
  const min = Number(args.get('min') ?? 12)

  const files = readdirSync(file!)
    .filter((name) => name.toLowerCase().endsWith('.png'))
    .sort()

  if (files.length === 0) {
    console.error(`no PNGs in ${file}. Asset packs often nest them — try a subfolder.`)
    process.exit(1)
  }

  console.log(`\n${file}`)
  console.log(`  ${files.length} PNGs\n`)
  console.log('  id                       grid  colours  pixels')

  let written = 0
  let refused = 0
  let skipped = 0

  for (const name of files) {
    const id = `${prefix}-${slug(name)}`
    let imported

    try {
      // Trimmed, because separate sprites are rarely square and usually sit in
      // a padded canvas.
      imported = importPng(readFileSync(join(file!, name)), { trim: true })
    } catch (error) {
      refused++
      if (refused <= 3) console.log(`  ${id.padEnd(24)} ${String((error as Error).message).slice(0, 60)}`)
      continue
    }

    const opaque = imported.counts.reduce((a, b) => a + b, 0)
    if (opaque < min) continue

    if (!mayWrite(id)) {
      skipped++
      continue
    }

    write(id, imported, guessOrder(imported), [], name)
    written++
    console.log(
      `  ${id.padEnd(24)} ${`${imported.size}²`.padStart(5)}  ` +
        `${String(imported.palette.length).padStart(7)}  ${String(opaque).padStart(6)}`,
    )
  }

  if (refused > 3) console.log(`  … and ${refused - 3} more refused`)
  const total = writeIndex()
  console.log(`\n  wrote ${written} drawings to ${outDir}/ (${total} there in total)`)
  if (skipped > 0) console.log(`  ${skipped} already existed and were left alone (--force to replace).`)
  if (refused > 0) {
    console.log(`  ${refused} refused — the art is not pixel art, or not a format we read.`)
    console.log('  Kenney ships both kinds; look for the ones tagged pixel art, e.g. Tiny Dungeon.')
  }
  console.log('  they are live: src/art/imported/index.ts is regenerated and LIBRARY spreads it.\n')
}

// --- shared --------------------------------------------------------------------

function report(imported: Imported): void {
  const total = imported.counts.reduce((a, b) => a + b, 0)
  console.log(`  ${imported.palette.length} colours, ${total} opaque pixels\n`)
  console.log('  idx  colour     share  edge')
  imported.palette.forEach((hex, i) => {
    const share = ((imported.counts[i]! / total) * 100).toFixed(1).padStart(5)
    console.log(`  ${String(i).padStart(3)}  ${hex}  ${share}%${imported.edge.includes(i) ? '  yes' : ''}`)
  })
}

/**
 * Whether an existing drawing may be replaced.
 *
 * `order` and `background` are the two fields a person corrects by hand after
 * importing, and re-running an import silently threw those corrections away —
 * twice, during development, on the same drawing. Imports are additive now;
 * replacing an existing drawing takes --force.
 */
function mayWrite(id: string): boolean {
  return args.has('force') || !existsSync(join(outDir, `${id}.ts`))
}

function write(
  id: string,
  imported: Imported,
  order: number[],
  background: number[],
  source: string,
): string {
  // A drawing whose order omits a colour renders it permanently grey, which
  // looks like a bug rather than a choice. Catch it here, not in review.
  const used = imported.palette.map((_, i) => i).filter((i) => imported.counts[i]! > 0)
  const missing = used.filter((i) => !order.includes(i))
  if (missing.length > 0) throw new Error(`${id}: order is missing colours ${missing.join(', ')}`)

  const constant = id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())
  const module_ = `import type { Drawing } from '../library.ts'

/**
 * Imported from ${source} — ${imported.size}×${imported.size}, ${imported.palette.length} colours.
 *
 * \`order\` was guessed by the importer: subject colours by area, largest first.
 * It is the one field worth checking by eye — it decides which part of the
 * picture gains colour next (SPEC §6).
 */
export const ${constant}: Drawing = {
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

  const path = join(outDir, `${id}.ts`)
  writeFileSync(path, module_)
  return path
}

function numbers(value: string): number[] {
  return value.split(',').filter(Boolean).map(Number)
}

/**
 * Rewrites `src/art/imported/index.ts` to re-export every drawing in the folder.
 *
 * Imports are static so the bundler can see them, but hand-maintaining forty
 * import lines is how a folder and a library drift apart. The index is derived
 * from what is actually on disk, so deleting a drawing is deleting one file.
 */
function writeIndex(): number {
  const files = readdirSync(outDir)
    .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
    .sort()

  const constant = (name: string): string =>
    name.replace(/\.ts$/, '').replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())

  const body = `import type { Drawing } from '../library.ts'
${files.map((f) => `import { ${constant(f)} } from './${f}'`).join('\n')}

/**
 * Every imported drawing, generated by \`npm run import\`.
 *
 * Do not edit by hand — it is rewritten from the contents of this folder on
 * every import. To remove a drawing, delete its file and re-run the importer
 * (or any import) to refresh this list.
 */
export const IMPORTED: Drawing[] = [
${files.map((f) => `  ${constant(f)},`).join('\n')}
]
`

  writeFileSync(join(outDir, 'index.ts'), body)
  return files.length
}
