import type { Record_, Usage } from './types.ts'

/**
 * SPEC §8, the hard rule: EXTRACT ONLY `timestamp` AND `usage`.
 *
 * Tenant enforced the equivalent structurally — its scanner never opens a file
 * ("the creature senses THAT you think, never WHAT"). Pigment cannot: token
 * counts live inside the transcripts. So the guarantee degrades from an
 * architectural property to a discipline, and this function is where the
 * discipline lives. An assistant record also carries `cwd`, `gitBranch`,
 * `sessionId` and the message `content` itself — none of it is read, none of it
 * is returned, and nothing downstream is given a field that could hold it.
 */

/** Cheap pre-filter: JSON.parse on 35k lines is the expensive part, not this. */
const MARKER = '"assistant"'

export function parseLine(line: string): Record_ | null {
  if (line.length === 0 || !line.includes(MARKER)) return null

  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    // A partial line (Claude Code mid-write) or a corrupt record. Skipping is
    // right: the tailer will re-read the completed line on the next sweep.
    return null
  }

  const record = raw as Record<string, unknown>
  if (record['type'] !== 'assistant') return null

  const at = Date.parse(String(record['timestamp'] ?? ''))
  if (!Number.isFinite(at)) return null

  const message = record['message']
  if (!isObject(message)) return null

  const usage = readUsage(message['usage'])
  if (!usage) return null

  // Dedup key. `message.id` is the right one — a record duplicated across files
  // keeps its response id, which is exactly the case we must collapse. `uuid`
  // is per-record and only a fallback for logs that omit the message id.
  const id = str(message['id']) ?? str(record['uuid'])
  if (!id) return null

  return { id, at, usage }
}

function readUsage(value: unknown): Usage | null {
  if (!isObject(value)) return null

  // The two cache-write tiers are priced differently (cost.ts), so they are
  // kept apart. Older records carry only the flat `cache_creation_input_tokens`
  // — attribute those to the 5m tier, the cheaper and far more common one.
  const creation = value['cache_creation']
  let write5m = 0
  let write1h = 0
  if (isObject(creation)) {
    write5m = int(creation['ephemeral_5m_input_tokens'])
    write1h = int(creation['ephemeral_1h_input_tokens'])
  }
  if (write5m === 0 && write1h === 0) write5m = int(value['cache_creation_input_tokens'])

  return {
    input: int(value['input_tokens']),
    output: int(value['output_tokens']),
    cacheWrite5m: write5m,
    cacheWrite1h: write1h,
    cacheRead: int(value['cache_read_input_tokens']),
  }
}

/**
 * Parses a chunk of newline-delimited records, returning the records found and
 * any trailing partial line.
 *
 * The remainder matters: the tailer reads a byte range that can land mid-line
 * while Claude Code is still writing. Returning it lets the caller prepend it
 * to the next read instead of dropping a record (SPEC §8).
 */
export function parseChunk(chunk: string): { records: Record_[]; remainder: string } {
  const records: Record_[] = []
  let start = 0

  while (true) {
    const end = chunk.indexOf('\n', start)
    if (end === -1) break
    const record = parseLine(chunk.slice(start, end))
    if (record) records.push(record)
    start = end + 1
  }

  return { records, remainder: chunk.slice(start) }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function int(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
