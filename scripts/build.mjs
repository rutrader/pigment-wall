import { build, context } from 'esbuild'
import { cp, mkdir } from 'node:fs/promises'

// Node-side bundles are .cjs: the package is `type: module`, so a CommonJS
// bundle with a .js extension is parsed as ESM and dies on its first require().
// One bundle per process, all of them from the same `src/core` and `src/art`.
// The renderer draws with the exact code the replay tool exercises, so the
// picture in the popover cannot drift from the picture the tests assert on.
const dev = process.argv.includes('--dev')
const watch = process.argv.includes('--watch')

const targets = [
  { entry: 'src/main/index.ts', out: 'dist/main/index.cjs', platform: 'node', external: ['electron'] },
  { entry: 'src/preload/popover.ts', out: 'dist/preload/popover.cjs', platform: 'node', external: ['electron'] },
  { entry: 'src/renderer/popover/main.ts', out: 'dist/renderer/popover/main.js', platform: 'browser', external: [] },
  { entry: 'src/preload/welcome.ts', out: 'dist/preload/welcome.cjs', platform: 'node', external: ['electron'] },
  { entry: 'src/renderer/welcome/main.ts', out: 'dist/renderer/welcome/main.js', platform: 'browser', external: [] },
]

await mkdir('dist/renderer/popover', { recursive: true })
await cp('src/renderer/popover/index.html', 'dist/renderer/popover/index.html')
await mkdir('dist/renderer/welcome', { recursive: true })
await cp('src/renderer/welcome/index.html', 'dist/renderer/welcome/index.html')

for (const target of targets) {
  const options = {
    entryPoints: [target.entry],
    outfile: target.out,
    bundle: true,
    format: target.platform === 'node' ? 'cjs' : 'iife',
    platform: target.platform,
    target: 'node20',
    external: target.external,
    sourcemap: dev,
    minify: !dev,
    logLevel: 'warning',
  }
  if (watch) {
    const ctx = await context(options)
    await ctx.watch()
  } else {
    await build(options)
  }
}

console.log(watch ? 'pigment: watching' : 'pigment: built')
