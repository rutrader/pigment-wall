// Builds out/Pigment.app, with no packaging dependency.
//
// electron-builder would be by far the largest thing in this repo, and it earns
// its keep with auto-update, installers and multi-platform targets — none of
// which a personal, macOS-only menu-bar app needs yet. What it does here is:
// copy Electron.app, drop our bundle in, rewrite six Info.plist keys, sign.
// We ship zero runtime dependencies, so "our bundle" is dist/ and a package.json.
//
// Signing has two modes, chosen by what is actually available:
//
//   ad-hoc      the default. Enough to launch locally, and — unlike running
//               `npx electron .` — enough to have a bundle identity, which is
//               what macOS requires before it will grant notification rights.
//               That is the whole reason this script exists at M4 rather than
//               later: the roast layer is inert until the app is a bundle.
//
//   Developer ID  when a "Developer ID Application" identity is in the keychain,
//               or one is named in PIGMENT_IDENTITY. Adds the hardened runtime
//               and entitlements, which notarization requires. Handing the app
//               to anyone else needs this plus `npm run notarize`.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const APP_NAME = 'Pigment'
const BUNDLE_ID = 'com.pigment.app'
const out = join(root, 'out')
const appPath = join(out, `${APP_NAME}.app`)
const plist = join(appPath, 'Contents', 'Info.plist')

const electronDist = join(root, 'node_modules', 'electron', 'dist', 'Electron.app')
if (!existsSync(electronDist)) {
  console.error('Electron is not installed — run `npm install` first.')
  process.exit(1)
}
if (!existsSync(join(root, 'dist', 'main', 'index.cjs'))) {
  console.error('No build found — run `npm run build` first.')
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(electronDist, appPath, { recursive: true, verbatimSymlinks: true })

// Replace Electron's default app with ours.
const resources = join(appPath, 'Contents', 'Resources')
rmSync(join(resources, 'default_app.asar'), { force: true })
const appDir = join(resources, 'app')
mkdirSync(appDir, { recursive: true })
cpSync(join(root, 'dist'), appDir, { recursive: true })
writeFileSync(
  join(appDir, 'package.json'),
  `${JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      // The bundles are CJS. The app root's package.json is what Electron reads
      // first, so it has to say so here regardless of the repo's own "module".
      type: 'commonjs',
      main: 'main/index.cjs',
    },
    null,
    2,
  )}\n`,
)

// The executable's name is what shows up in Activity Monitor, in crash logs and
// — the one that matters here — in the Notifications pane of System Settings.
renameSync(join(appPath, 'Contents', 'MacOS', 'Electron'), join(appPath, 'Contents', 'MacOS', APP_NAME))

const set = (key, value) =>
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist], { stdio: 'pipe' })
const add = (key, type, value) => {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} ${type} ${value}`, plist], { stdio: 'pipe' })
  } catch {
    set(key, value)
  }
}

set('CFBundleExecutable', APP_NAME)
set('CFBundleName', APP_NAME)
add('CFBundleDisplayName', 'string', APP_NAME)
set('CFBundleIdentifier', BUNDLE_ID)
set('CFBundleShortVersionString', pkg.version)
set('CFBundleVersion', pkg.version)
// SPEC §11: the tray is the entire surface. setActivationPolicy('accessory')
// does this at runtime; LSUIElement does it before a single frame is drawn, so
// there is no flicker of a Dock icon on launch.
add('LSUIElement', 'string', '1')

// --- signing -----------------------------------------------------------------

const identity = process.env.PIGMENT_IDENTITY ?? findDeveloperId()

if (identity) {
  // The hardened runtime is required for notarization, and it blocks the JIT
  // and unsigned-memory tricks a JavaScript engine needs — hence the two
  // entitlements. Without them a signed Electron app launches to a blank screen.
  const entitlements = join(out, 'entitlements.plist')
  writeFileSync(
    entitlements,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
</dict>
</plist>
`,
  )

  // Inside-out: nested helpers and frameworks must be signed before the bundle
  // that contains them, or the outer signature seals over unsigned code.
  const nested = execFileSync(
    'find',
    [join(appPath, 'Contents', 'Frameworks'), '-name', '*.app', '-o', '-name', '*.framework', '-o', '-name', '*.dylib'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean)

  for (const target of nested) sign(target, identity, entitlements)
  sign(appPath, identity, entitlements)

  console.log(`built ${appPath}`)
  console.log(`signed with: ${identity}`)
  console.log('next: npm run notarize')
} else {
  // Rewriting the bundle invalidates Electron's own signature, and macOS refuses
  // to launch an Electron app whose signature no longer matches.
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'pipe' })
  } catch (error) {
    console.warn('codesign failed; the app may refuse to launch:', error.message)
  }

  console.log(`built ${appPath}`)
  console.log('ad-hoc signed — runs on this machine, not distributable.')
  console.log('for a signed build, install a "Developer ID Application" certificate and re-run.')
}

function sign(target, identity, entitlements) {
  execFileSync(
    'codesign',
    [
      '--force',
      '--timestamp',
      '--options', 'runtime',
      '--entitlements', entitlements,
      '--sign', identity,
      target,
    ],
    { stdio: 'pipe' },
  )
}

/** The first Developer ID Application identity in the keychain, if any. */
function findDeveloperId() {
  try {
    const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
    const match = /"(Developer ID Application: [^"]+)"/.exec(out)
    return match ? match[1] : null
  } catch {
    return null
  }
}
