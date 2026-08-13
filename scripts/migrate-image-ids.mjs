/**
 * One-shot: rewrite sealed `t<tier>-<slot>` image ids as drawing names.
 *
 * Days sealed before drawings were named recorded a POSITION in the tier pool.
 * Growing a pool renumbers every position, so those days would change picture —
 * once, on the next launch, and again on every future change to the library.
 *
 * The old pools are known exactly (they are below), so the position each day
 * recorded can still be turned back into the picture it actually showed. That is
 * only true right now, while the mapping is still recoverable; run this before
 * the pools change again and the history is preserved for good.
 *
 * Safe to run twice — a day that already has a name is left alone.
 *
 *   node scripts/migrate-image-ids.mjs [--write]
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The library as it stood when slot ids were written, in LIBRARY order. */
const OLD_POOLS = {
  1: ['mushroom', 'cat', 'leaf', 'moon'],
  2: ['fox', 'house', 'boat', 'bird'],
  3: ['cassette', 'lighthouse', 'forest', 'mountain', 'town'],
}

const store = join(homedir(), 'Library/Application Support/pigment-wall/wall.json')
const write = process.argv.includes('--write')

if (!existsSync(store)) {
  console.log(`no store at ${store} — nothing to migrate`)
  process.exit(0)
}

const wall = JSON.parse(readFileSync(store, 'utf8'))
const days = wall.days ?? []
let changed = 0
let unmapped = 0

for (const day of days) {
  const match = /^t(\d+)-(\d+)$/.exec(day.imageId ?? '')
  if (!match) continue

  const pool = OLD_POOLS[Number(match[1])]
  if (!pool) {
    unmapped++
    continue
  }

  // The resolver has always wrapped an out-of-range slot, so wrap here too —
  // otherwise the migration would show a different picture than the app did.
  const name = pool[Number(match[2]) % pool.length]
  console.log(`  ${day.key}  ${day.imageId} → ${name}`)
  day.imageId = name
  changed++
}

console.log(`\n${changed} of ${days.length} days migrated${unmapped ? `, ${unmapped} unmapped` : ''}`)

if (!write) {
  console.log('dry run — pass --write to apply')
  process.exit(0)
}

copyFileSync(store, `${store}.bak`)
writeFileSync(store, JSON.stringify(wall, null, 2))
console.log(`written; previous store kept at ${store}.bak`)
