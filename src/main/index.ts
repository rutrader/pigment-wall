import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { join } from 'node:path'
import { DEFAULTS, loadConfig } from '../core/config.ts'
import { Pigment, type Snapshot } from '../core/app.ts'
import { collapse } from '../core/engine.ts'
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

const CONFIG = loadConfig(join(app.getPath('userData'), 'config.json'))
const STORE = join(app.getPath('userData'), 'wall.json')

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
let pigment: Pigment | null = null
let latest: Snapshot | null = null
let lastStep = -1
let walkedAt = 0

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
    if (now - walkedAt > WALK_MS) {
      walkedAt = now
      // A new session file only becomes visible after a re-walk; without this a
      // brand-new project would never be counted.
      await pigment.refreshFiles()
    }

    latest = await pigment.tick(now)
    paintTray(latest)
    popover?.webContents.send('pigment:snapshot', payload(latest))
  } catch (error) {
    // A bad tick must never take the app down — the next one is five seconds
    // away and the wall on disk is untouched.
    console.error('pigment: tick failed', error)
  }
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
    entries: collapse(snapshot.wall.days).map((entry) =>
      entry.kind === 'away'
        ? { kind: 'away' as const, from: entry.from, to: entry.to, days: entry.days }
        : { kind: 'day' as const, ...day(entry.day) },
    ),
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

function createPopover(): BrowserWindow {
  const window = new BrowserWindow({
    width: 420,
    height: 420,
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
      { type: 'separator' },
      { label: 'Open Pigment', click: togglePopover },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
}

ipcMain.handle('pigment:request', () => (latest ? payload(latest) : null))
