import { open, readdir, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { Config } from './config.ts'
import { parseChunk } from './parse.ts'
import type { Record_ } from './types.ts'

/**
 * Incremental reader over the session logs. SPEC §8.
 *
 * The shape is forced by measurement, not preference: the corpus is 267 MB
 * across 179 files, 26 MB of it touched in a single day, and a full parse costs
 * 0.54s. Cheap once; ruinous on a five-second poll. So each file carries a byte
 * cursor and a sweep reads only what was appended past it — a few KB per tick
 * in steady state.
 *
 * Three details are load-bearing, each answering an observed condition:
 *
 *   - A trailing partial line is held back, not parsed. Claude Code may be
 *     mid-write when the sweep lands.
 *   - A file that SHRANK resets to offset 0: truncation or rotation.
 *   - The directory tree is re-walked on its own cadence. Transcripts grow by
 *     appending, which does not touch the parent directory's mtime, so
 *     directory-level change detection would silently miss every active
 *     session — the cache has to be the file list, never the change signal.
 */

export type Cursor = {
  offset: number
  /** Bytes after the last newline in the previous read: a line still being written. */
  remainder: string
}

export class Tail {
  private readonly config: Config
  private readonly cursors = new Map<string, Cursor>()
  private files: string[] = []
  private walked = false

  constructor(config: Config) {
    this.config = config
  }

  /** Re-walk the tree. Call on first use and on a slow cadence thereafter. */
  async refresh(): Promise<void> {
    const found: string[] = []
    await collect(join(this.config.root, this.config.dir), this.config, 1, found)
    this.files = found
    this.walked = true
  }

  /**
   * Reads every file from the start, returning all records not older than
   * `sinceMs`, and leaves each cursor at end-of-file.
   *
   * This is the backfill path (SPEC §10) and the launch path. Files whose mtime
   * predates the window are skipped outright: a record can never be newer than
   * its file's last write, so such a file cannot contain anything in range.
   */
  async readAll(sinceMs: number): Promise<Record_[]> {
    if (!this.walked) await this.refresh()

    const records: Record_[] = []
    for (const path of this.files) {
      const info = await statOrNull(path)
      if (!info) continue

      this.cursors.set(path, { offset: info.size, remainder: '' })
      if (info.mtimeMs < sinceMs) continue

      const chunk = await readRange(path, 0, info.size)
      if (chunk === null) continue
      for (const record of parseChunk(chunk).records) {
        if (record.at >= sinceMs) records.push(record)
      }
    }
    return records
  }

  /**
   * Reads only what has been appended since the last call.
   *
   * Returns records in file order, not time order — the accumulator does not
   * care, and sorting 179 files' worth of appends on every tick would be paying
   * for an ordering nothing downstream uses.
   */
  async sweep(): Promise<Record_[]> {
    if (!this.walked) await this.refresh()

    const records: Record_[] = []
    let missing = false

    for (const path of this.files) {
      const info = await statOrNull(path)
      if (!info) {
        missing = true
        continue
      }

      const cursor = this.cursors.get(path) ?? { offset: 0, remainder: '' }

      // Shrunk: truncated or rotated under us. Start over rather than read from
      // an offset that now points into the middle of a different line.
      if (info.size < cursor.offset) {
        cursor.offset = 0
        cursor.remainder = ''
      }
      if (info.size === cursor.offset) {
        this.cursors.set(path, cursor)
        continue
      }

      const chunk = await readRange(path, cursor.offset, info.size - cursor.offset)
      if (chunk === null) continue

      const parsed = parseChunk(cursor.remainder + chunk)
      records.push(...parsed.records)
      this.cursors.set(path, { offset: info.size, remainder: parsed.remainder })
    }

    // A vanished file means the cached list is stale; re-walk next sweep.
    if (missing) this.walked = false

    return records
  }
}

async function collect(dir: string, config: Config, depth: number, out: string[]): Promise<void> {
  if (depth > config.maxDepth) return

  let items
  try {
    items = await readdir(dir, { withFileTypes: true })
  } catch {
    // Missing or unreadable is normal — ~/.claude's layout is not ours.
    return
  }

  for (const item of items) {
    const full = join(dir, item.name)
    if (item.isDirectory()) await collect(full, config, depth + 1, out)
    else if (item.isFile() && item.name.endsWith(config.extension)) out.push(full)
  }
}

async function statOrNull(path: string) {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

async function readRange(path: string, offset: number, length: number): Promise<string | null> {
  if (length <= 0) return ''
  let handle
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.allocUnsafe(length)
    const { bytesRead } = await handle.read(buffer, 0, length, offset)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}

/** The path segments a file lives under, for tests that need a stable identity. */
export function relativeTo(root: string, path: string): string {
  return (path.startsWith(root) ? path.slice(root.length) : path).split(sep).filter(Boolean).join('/')
}
