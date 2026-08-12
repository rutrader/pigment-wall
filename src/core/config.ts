import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/**
 * Every tunable in one place, with the SPEC §0 measurement that justifies it.
 *
 * A malformed or missing config must not stop Pigment from running — it falls
 * back to these defaults and carries on, because an app that refuses to launch
 * over a config typo is worse than one that is slightly mis-tuned.
 */

export type Config = {
  /** Where session logs live. */
  root: string
  /** Directory below `root` to walk, and the extension that marks a transcript. */
  dir: string
  extension: string
  maxDepth: number

  /**
   * Local hour a Pigment day begins. SPEC §4: 04:00, not midnight — 27% of this
   * user's output lands 22:00–02:00 and 03:00–07:00 is empty. Configurable
   * because a company laptop runs on a different rhythm.
   */
  boundaryHour: number

  /** Below this many output tokens a day is idle: it freezes the controller. */
  idleFloor: number

  /** Frugal-1U quantile tracker (SPEC §3). q=0.4 → ~60% of active days complete. */
  q: number
  k: number
  minTarget: number
  maxTarget: number
  /** Safety rail on a single day's move. Rarely binds at k=0.15. */
  maxStep: number

  /** Target when there is no history at all to seed from. */
  seedTarget: number

  /** How far back the wall goes, and how far back backfill reconstructs (SPEC §10). */
  windowDays: number

  /** Days newer than this are recomputed from logs; older ones are sealed (SPEC §9). */
  recomputeHours: number

  /** Past 100% the image overexposes; the curve stops here (SPEC §7). */
  overfillCap: number
}

export const DEFAULTS: Config = {
  root: join(homedir(), '.claude'),
  dir: 'projects',
  extension: '.jsonl',
  maxDepth: 3,

  boundaryHour: 4,
  idleFloor: 2_000,

  q: 0.4,
  k: 0.15,
  minTarget: 30_000,
  maxTarget: 600_000,
  maxStep: 0.15,

  seedTarget: 100_000,

  windowDays: 60,
  recomputeHours: 48,

  overfillCap: 4,
}

export function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

export function loadConfig(file: string): Config {
  try {
    return normalise(JSON.parse(stripComments(readFileSync(file, 'utf8'))) as Partial<Config>)
  } catch {
    return DEFAULTS
  }
}

/**
 * Removes `//` line comments so the config file can explain itself.
 *
 * JSON has no comments, and a settings file whose every key is a bare number is
 * useless to the person editing it — `"q": 0.4` means nothing without the
 * sentence that says q IS the completion rate. Stripping comments on read costs
 * ten lines and makes the file teachable.
 *
 * String-aware, or a `//` inside a path would truncate the file.
 */
export function stripComments(text: string): string {
  let out = ''
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!

    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      out += char
      continue
    }

    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
      continue
    }

    out += char
  }

  return out
}

/**
 * The commented file written on first run.
 *
 * Every knob carries the measurement that produced its default, because the
 * defaults are only defensible with the reason attached — and because a user
 * who changes `q` without knowing it sets the completion rate will change it
 * back in confusion.
 */
export function defaultConfigFile(): string {
  return `{
  // Pigment reads this at launch and whenever the file changes.
  // Delete any line to fall back to its default.
  //
  // The .jsonc extension is deliberate: this is JSON with comments, which
  // editors understand under that name and would flag as errors under .json.

  // Where the session logs live, and how deep to walk.
  "root": ${JSON.stringify(DEFAULTS.root)},
  "dir": "projects",

  // The hour a Pigment day begins, 0-23.
  // 4, not midnight: a night session should be one picture, not two.
  "boundaryHour": ${DEFAULTS.boundaryHour},

  // Below this many output tokens a day counts as idle: grey square, and the
  // difficulty target freezes rather than dropping.
  "idleFloor": ${DEFAULTS.idleFloor},

  // The difficulty loop. Two numbers, and they do different jobs.
  //
  // q IS the completion rate. The target settles at your qth percentile day,
  // so you finish (1 - q) of them. 0.4 means about 60% of working days
  // complete the picture. Lower q = easier.
  "q": ${DEFAULTS.q},
  //
  // k is how fast the bar reacts. At 0.15 a huge day raises tomorrow ~6% and a
  // miss lowers it ~9%: a slow tide. At 0.3 the app visibly flinches whenever
  // you have a bad afternoon.
  //
  // Careful going below ~0.1: the picture's complexity tier is decided by how
  // far the target has moved from its own recent average, so a target that
  // barely moves means the tier never changes and that whole signal dies.
  "k": ${DEFAULTS.k},

  // Hard limits on the target, whatever the loop wants.
  "minTarget": ${DEFAULTS.minTarget},
  "maxTarget": ${DEFAULTS.maxTarget},

  // How far back the wall goes.
  "windowDays": ${DEFAULTS.windowDays},

  // Days newer than this are recomputed from the logs every launch; older ones
  // are frozen. Covers a Mac asleep at the boundary and sessions resumed the
  // next morning with yesterday's timestamps.
  "recomputeHours": ${DEFAULTS.recomputeHours},

  // How far past 100% the picture keeps overexposing before it stops.
  "overfillCap": ${DEFAULTS.overfillCap}
}
`
}

/** Every field clamped to a sane range: a typo must not produce a broken loop. */
export function normalise(raw: Partial<Config>): Config {
  const root = typeof raw.root === 'string' ? expandHome(raw.root) : DEFAULTS.root
  return {
    root: isAbsolute(root) ? root : DEFAULTS.root,
    dir: str(raw.dir, DEFAULTS.dir),
    extension: str(raw.extension, DEFAULTS.extension),
    maxDepth: int(raw.maxDepth, DEFAULTS.maxDepth, 1, 10),

    // A boundary outside 0–23 is meaningless; anything else would silently
    // shift every day key by a day.
    boundaryHour: int(raw.boundaryHour, DEFAULTS.boundaryHour, 0, 23),
    idleFloor: int(raw.idleFloor, DEFAULTS.idleFloor, 0, 1_000_000),

    // q outside (0,1) would make the tracker walk one way forever.
    q: num(raw.q, DEFAULTS.q, 0.01, 0.99),
    // k above ~0.5 turns the slow tide into a thermostat (SPEC §3).
    k: num(raw.k, DEFAULTS.k, 0.001, 0.5),
    minTarget: int(raw.minTarget, DEFAULTS.minTarget, 1_000, 10_000_000),
    maxTarget: int(raw.maxTarget, DEFAULTS.maxTarget, 1_000, 10_000_000),
    maxStep: num(raw.maxStep, DEFAULTS.maxStep, 0.01, 1),

    seedTarget: int(raw.seedTarget, DEFAULTS.seedTarget, 1_000, 10_000_000),

    windowDays: int(raw.windowDays, DEFAULTS.windowDays, 1, 3650),
    recomputeHours: int(raw.recomputeHours, DEFAULTS.recomputeHours, 0, 24 * 30),

    overfillCap: num(raw.overfillCap, DEFAULTS.overfillCap, 1, 100),
  }
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function num(value: unknown, fallback: number, lo: number, hi: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(hi, Math.max(lo, value))
}

function int(value: unknown, fallback: number, lo: number, hi: number): number {
  return Math.round(num(value, fallback, lo, hi))
}
