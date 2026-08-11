import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { dirname } from 'node:path'
import type { Day } from './types.ts'

/**
 * The durable wall. SPEC §9.
 *
 * Days older than the recompute window are sealed here and never derived again.
 * That is what makes the wall outlive `~/.claude`: Claude Code rotates its own
 * logs, and a wall recomputed from scratch on every launch would be only as
 * durable as somebody else's cache directory.
 *
 * Each sealed day stores the controller's target BEFORE and AFTER it, so the
 * chain can be replayed and audited rather than resting on one opaque float
 * nobody can explain.
 */

const VERSION = 1

export type StoreFile = {
  version: number
  days: Day[]
}

export type Store = {
  /** Sealed days, ascending by key. */
  days: Day[]
}

export function emptyStore(): Store {
  return { days: [] }
}

/**
 * Reads the store, tolerating everything except a file from the future.
 *
 * A file written by a NEWER version is not ours to interpret — refusing beats
 * silently discarding fields we do not understand and writing back a lossy
 * version of someone's history.
 */
export function readStore(file: string): Store {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    if (!existsSync(file)) return emptyStore()
    // Present but unreadable: quarantine rather than overwrite. The wall may be
    // months of someone's history and a parse bug must not consume it.
    quarantine(file)
    return emptyStore()
  }

  const parsed = raw as Partial<StoreFile>
  if (typeof parsed.version !== 'number') return emptyStore()
  if (parsed.version > VERSION) {
    throw new Error(`store version ${parsed.version} is newer than this build (${VERSION})`)
  }
  if (!Array.isArray(parsed.days)) return emptyStore()

  const days = parsed.days.filter(isDay).sort((a, b) => a.key.localeCompare(b.key))
  return { days }
}

export function writeStore(file: string, store: Store): void {
  const payload: StoreFile = { version: VERSION, days: store.days }
  writeJsonAtomic(file, payload)
}

/**
 * tmp + fsync + rename.
 *
 * rename() is atomic only with respect to bytes that reached the disk — without
 * the fsync a power loss can atomically install a file of zeros, which is
 * strictly worse than no file at all.
 */
export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  try {
    const fd = openSync(tmp, 'w')
    try {
      writeSync(fd, JSON.stringify(value))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, file)
  } catch (error) {
    if (existsSync(tmp)) {
      try {
        unlinkSync(tmp)
      } catch {
        // Nothing useful to do; the next write overwrites it anyway.
      }
    }
    throw error
  }
}

function quarantine(file: string): void {
  try {
    renameSync(file, `${file}.unreadable-${Date.now()}`)
  } catch {
    // If even the rename fails, leaving the file alone is still safer than
    // truncating it.
  }
}

function isDay(value: unknown): value is Day {
  if (typeof value !== 'object' || value === null) return false
  const day = value as Record<string, unknown>
  return (
    typeof day['key'] === 'string' &&
    typeof day['target'] === 'number' &&
    typeof day['fill'] === 'number' &&
    typeof day['targetAfter'] === 'number' &&
    typeof day['totals'] === 'object' &&
    day['totals'] !== null
  )
}
