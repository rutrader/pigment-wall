// Notarizes and staples out/Pigment Wall.app.
//
// Separate from packaging because it is the only step that needs the network,
// an Apple ID and a round trip to Apple's servers — usually a minute or two,
// occasionally much longer. Packaging must stay fast and offline.
//
// Requires a stored credential profile, created once:
//
//   xcrun notarytool store-credentials "pigment" \
//     --apple-id you@example.com --team-id TEAMID --password <app-specific-password>
//
// The app-specific password comes from appleid.apple.com, not your Apple ID
// password. Override the profile name with PIGMENT_NOTARY_PROFILE.

import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const appPath = join(root, 'out', 'Pigment Wall.app')
const zipPath = join(root, 'out', 'PigmentWall.zip')
const profile = process.env.PIGMENT_NOTARY_PROFILE ?? 'pigment'

if (!existsSync(appPath)) {
  console.error('No app found — run `npm run package` first.')
  process.exit(1)
}

// Notarization rejects an ad-hoc signature outright, so check before the upload
// rather than after a two-minute wait.
const signature = execFileSync('codesign', ['-dv', '--verbose=2', appPath], {
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
})
if (!/Authority=Developer ID Application/.test(signature)) {
  console.error('The app is not signed with a Developer ID certificate.')
  console.error('Install one (Xcode > Settings > Accounts > Manage Certificates) and re-run `npm run package`.')
  process.exit(1)
}

// ditto, not zip: it is the only archiver that preserves the symlinks and
// extended attributes inside an .app bundle. A plain zip notarizes a corpse.
rmSync(zipPath, { force: true })
execFileSync('ditto', ['-c', '-k', '--keepParent', appPath, zipPath], { stdio: 'inherit' })

console.log('submitting to Apple — this usually takes a minute or two…')
execFileSync(
  'xcrun',
  ['notarytool', 'submit', zipPath, '--keychain-profile', profile, '--wait'],
  { stdio: 'inherit' },
)

// Stapling attaches the ticket to the bundle, so Gatekeeper can verify it
// offline. Without it the first launch on a machine with no network fails.
execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' })
execFileSync('spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath], { stdio: 'inherit' })

console.log(`\nnotarized and stapled: ${appPath}`)
console.log('this build can be handed to someone else.')
