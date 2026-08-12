import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, screen, shell, Tray } from 'electron'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultConfigFile, loadConfig, type Config } from '../core/config.ts'
import { Pigment, type Snapshot } from '../core/app.ts'
import { dayLabel } from '../core/day.ts'
import { formatCents } from '../core/cost.ts'
import { iconPng, iconStep } from './icon.ts'

/**
 * The Electron shell. SPEC §12, milestone M2.
 *
 * Deliberately thin: every decision was made in `src/core`, which is why that
 * half could be tuned against sixty days of real history before a window
 * existed. This file owns exactly three things — when to tick, when to redraw
 * the icon, and what the popover is handed.
 */

/**
 * `.jsonc`, not `.json`, because the file carries `//` comments.
 *
 * Our loader strips them, but nothing else does: an editor validating a
 * `.json` file flags every comment line as a syntax error, and so would `jq` or
 * any later tool. `.jsonc` is the recognised name for JSON-with-comments and is
 * understood natively by editors, which costs nothing and stops the file
 * declaring itself invalid.
 *
 * A `config.json` from an earlier build is still read, and left where it is
 * rather than migrated — silently rewriting someone's settings file to a new
 * path is a worse surprise than an odd extension.
 */
const USER_DATA = app.getPath('userData')
const CONFIG_JSONC = join(USER_DATA, 'config.jsonc')
const CONFIG_LEGACY = join(USER_DATA, 'config.json')
const CONFIG_FILE = existsSync(CONFIG_JSONC) || !existsSync(CONFIG_LEGACY) ? CONFIG_JSONC : CONFIG_LEGACY
const STORE = join(USER_DATA, 'wall.json')

/**
 * The config file is WRITTEN on first run, not merely read.
 *
 * A settings file that only exists once you create it is a settings file nobody
 * knows about. Every knob here — the day boundary, the completion rate, how
 * fast the bar reacts — is real, tested and documented, and until M4 there was
 * no way to discover any of it short of reading the source.
 */
function ensureConfigFile(): void {
  if (existsSync(CONFIG_FILE)) return
  mkdirSync(USER_DATA, { recursive: true })
  writeFileSync(CONFIG_FILE, defaultConfigFile())
}

ensureConfigFile()
let CONFIG: Config = loadConfig(CONFIG_FILE)
let configStamp = mtimeOf(CONFIG_FILE)

/**
 * How often the logs are re-read.
 *
 * Five seconds, matching Tenant's fast cadence. A sweep in steady state reads a
 * few KB, so this is cheap; the expensive thing would be redrawing the icon at
 * the same rate, which `iconStep` prevents.
 */
const TICK_MS = 5_000

/** The directory walk is far more expensive than a stat, so it runs rarely. */
const WALK_MS = 60_000

let tray: Tray | null = null
let popover: BrowserWindow | null = null
let welcome: BrowserWindow | null = null
let pigment: Pigment | null = null
let latest: Snapshot | null = null
let lastStep = -1
let walkedAt = 0

function mtimeOf(file: string): number {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Picks up an edited config without a restart.
 *
 * Tuning `q` and `k` is the whole reason those knobs are exposed, and a loop
 * you must quit and relaunch to try is a loop nobody tunes. The engine is
 * rebuilt from scratch on change, which is cheap — a full backfill is half a
 * second — and avoids any question of half-applied settings.
 */
async function reloadConfigIfChanged(): Promise<boolean> {
  const stamp = mtimeOf(CONFIG_FILE)
  if (stamp === configStamp) return false

  configStamp = stamp
  CONFIG = loadConfig(CONFIG_FILE)
  pigment = new Pigment(CONFIG, STORE)
  lastStep = -1 // force the icon to redraw against the new target
  return true
}

app.on('window-all-closed', () => {
  // A menu-bar app does not quit when its popover closes.
})

app.whenReady().then(async () => {
  // `accessory` means no Dock icon and no app-menu presence: the tray is the
  // entire surface, exactly as Tenant does it.
  app.setActivationPolicy?.('accessory')

  pigment = new Pigment(CONFIG, STORE)
  tray = new Tray(emptyIcon())
  tray.setToolTip('Pigment')
  tray.on('click', togglePopover)
  tray.on('right-click', showMenu)

  await tick()
  setInterval(() => void tick(), TICK_MS)

  // First run. Shown after the first tick so the wall is already built behind
  // it — dismissing the panel lands on a populated app rather than an empty one.
  if (!pigment.peek().prefs.onboarded) showWelcome()

  // Dev affordance: opening the popover normally needs a click on the tray,
  // which is awkward to drive from a script or a screenshot run.
  if (process.env['PIGMENT_OPEN']) {
    togglePopover()
    popover?.focus()
  }
})

async function tick(): Promise<void> {
  if (!pigment) return

  try {
    const now = Date.now()
    await reloadConfigIfChanged()
    if (now - walkedAt > WALK_MS) {
      walkedAt = now
      // A new session file only becomes visible after a re-walk; without this a
      // brand-new project would never be counted.
      await pigment.refreshFiles()
    }

    latest = await pigment.tick(now)
    paintTray(latest)
    popover?.webContents.send('pigment:snapshot', payload(latest))
    speak(latest)
  } catch (error) {
    // A bad tick must never take the app down — the next one is five seconds
    // away and the wall on disk is untouched.
    console.error('pigment: tick failed', error)
  }
}

/**
 * Delivers at most one interruption a day. SPEC §7.
 *
 * The cap is the whole design: uncapped, this would have fired on most days in
 * early August and been muted inside a fortnight. Capped, it lands one or two
 * times a week on the measured history.
 *
 * Posted through the ordinary notification API with no urgency flags, so Focus
 * and Do Not Disturb suppress it exactly as the user configured them — the app
 * does not get to decide it is more important than that.
 */
function speak(snapshot: Snapshot): void {
  // Dev affordance: notifications only fire on genuinely rare conditions, so
  // without a way to force one the delivery path is untestable — which is how
  // it shipped broken in M3, verified everywhere except at the point of
  // delivery.
  if (process.env['PIGMENT_TEST_ROAST']) {
    show('Still going at 02:00. The picture finished hours ago.')
    return
  }

  if (!snapshot.interrupt || !pigment) return
  if (!Notification.isSupported()) return

  const { kind, text, slot } = snapshot.interrupt
  // Recorded BEFORE showing: if the notification throws, the day is still spent.
  // A silent miss beats a loop that re-fires the same line every five seconds.
  pigment.markDelivered(snapshot.today.key, kind, slot)

  show(text)
}

function show(text: string): void {
  const notification = new Notification({ title: 'Pigment', body: text, silent: false })

  // macOS refuses notifications to an app it has not been asked about. Running
  // unpackaged that is always — `npx electron .` is the generic Electron binary,
  // and every send fails with UNErrorDomain error 1. It starts working once the
  // app is a signed bundle the user has approved, which is M4.
  //
  // The line is not lost when this happens: the popover carries every roast
  // regardless, and that is the surface the user actually goes to.
  notification.on('failed', (_event, error) => {
    console.warn('pigment: notification refused by the system —', error)
  })
  notification.on('show', () => console.log('pigment: notification delivered'))

  notification.show()
}

function paintTray(snapshot: Snapshot): void {
  if (!tray) return

  const step = iconStep(snapshot.today.fill)
  if (step !== lastStep) {
    lastStep = step
    const png = iconPng({
      imageId: snapshot.today.imageId,
      fill: snapshot.today.fill,
      overfillCap: CONFIG.overfillCap,
    })
    const image = nativeImage.createFromBuffer(png, { scaleFactor: 2 })
    image.setTemplateImage(true)
    tray.setImage(image)
  }

  const percent = Math.round(snapshot.today.fill * 100)
  const target = Math.round(snapshot.today.target).toLocaleString()
  tray.setToolTip(
    `${dayLabel(snapshot.today.key, CONFIG.boundaryHour)} — ${percent}% · ` +
      `${snapshot.today.totals.output.toLocaleString()} of ${target} tokens · tier ${snapshot.tier.index}`,
  )
}

function emptyIcon(): Electron.NativeImage {
  const image = nativeImage.createFromBuffer(
    iconPng({ imageId: '', fill: 0, overfillCap: CONFIG.overfillCap, empty: true }),
    { scaleFactor: 2 },
  )
  image.setTemplateImage(true)
  return image
}

/** Everything the renderer needs, and nothing it does not. */
function payload(snapshot: Snapshot) {
  return {
    today: day(snapshot.today),
    tier: snapshot.tier.index,
    overfillCap: CONFIG.overfillCap,
    boundaryHour: CONFIG.boundaryHour,
    roast: snapshot.roast,
    days: snapshot.wall.days.map(day),
  }
}

function day(value: Snapshot['today']) {
  return {
    key: value.key,
    imageId: value.imageId,
    fill: value.fill,
    idle: value.idle,
    tier: value.tier,
    output: value.totals.output,
    target: Math.round(value.target),
    cost: formatCents(value.costCents),
    peakHour: value.totals.peakHourOutput,
  }
}

function togglePopover(): void {
  if (popover?.isVisible()) {
    popover.hide()
    return
  }
  if (!popover) popover = createPopover()
  positionPopover(popover)
  popover.show()
  if (latest) popover.webContents.send('pigment:snapshot', payload(latest))
}

/**
 * The first-run panel.
 *
 * Pigment opens your transcripts — it has to, the token counts are inside them
 * — so it owes you a plain account of what it takes from there before it starts
 * taking it. That is the whole content: what it reads, what it never reads,
 * that it sends nothing anywhere.
 */
function showWelcome(): void {
  if (welcome) {
    welcome.show()
    return
  }

  welcome = new BrowserWindow({
    width: 460,
    height: 380,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    title: 'Pigment',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/welcome.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  welcome.loadFile(join(__dirname, '../renderer/welcome/index.html'))
  welcome.once('ready-to-show', () => welcome?.show())
  welcome.on('closed', () => {
    welcome = null
  })

  // An accessory app has no Dock icon, so a window it opens does not come
  // forward on its own — without this the panel appears behind everything.
  app.focus({ steal: true })
}

ipcMain.on('pigment:onboarded', () => {
  pigment?.setOnboarded()
  welcome?.close()
})

function createPopover(): BrowserWindow {
  const window = new BrowserWindow({
    width: 420,
    height: 540,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Vibrancy makes it read as a real popover rather than a floating rectangle.
    vibrancy: 'popover',
    visualEffectState: 'active',
    webPreferences: {
      preload: join(__dirname, '../preload/popover.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  window.loadFile(join(__dirname, '../renderer/popover/index.html'))
  // Clicking away dismisses, like every other menu-bar popover on the system.
  // Held open under PIGMENT_OPEN: at launch the terminal still has focus, so
  // the window would blur and hide itself the instant it appeared.
  if (!process.env['PIGMENT_OPEN']) window.on('blur', () => window.hide())
  return window
}

function positionPopover(window: BrowserWindow): void {
  const bounds = tray?.getBounds()
  if (!bounds) return

  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
  const size = window.getBounds()
  const x = Math.round(bounds.x + bounds.width / 2 - size.width / 2)
  const y = Math.round(bounds.y + bounds.height + 4)

  // Keep it on screen when the icon sits near the right edge.
  const maxX = display.workArea.x + display.workArea.width - size.width - 8
  window.setPosition(Math.max(display.workArea.x + 8, Math.min(x, maxX)), y, false)
}

function showMenu(): void {
  const today = latest?.today
  tray?.popUpContextMenu(
    Menu.buildFromTemplate([
      {
        label: today
          ? `${dayLabel(today.key, CONFIG.boundaryHour)} — ${Math.round(today.fill * 100)}% of ${Math.round(today.target).toLocaleString()}`
          : 'Reading your history…',
        enabled: false,
      },
      {
        // First item on purpose: the escape hatch has to be obvious the moment
        // the roasts start to grate (SPEC §7).
        label: 'Roast me',
        type: 'checkbox',
        checked: pigment?.peek().prefs.notify ?? true,
        click: (item) => pigment?.setNotify(item.checked),
      },
      { type: 'separator' },
      { label: 'Open Pigment', click: togglePopover },
      { label: 'Settings…', click: () => void shell.openPath(CONFIG_FILE) },
      { label: 'About Pigment…', click: showWelcome },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
}

ipcMain.handle('pigment:request', () => (latest ? payload(latest) : null))
