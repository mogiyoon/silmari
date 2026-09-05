// Bundles sil into one cjs file (core included) and puts the viewer HTML next to it. Only dist/ goes to npm.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const viewer = resolve(import.meta.dirname, '../viewer/dist/index.html')
if (!existsSync(viewer)) { console.error('The viewer is not built: pnpm --filter @silmari/viewer build'); process.exit(2) }
mkdirSync('dist', { recursive: true })
copyFileSync(viewer, 'dist/viewer.html')
await build({
  entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  outfile: 'dist/sil.cjs', logLevel: 'info', // The shebang from main.ts is kept as is
  logOverride: { 'empty-import-meta': 'silent' }, // view.ts checks typeof __dirname first
})
