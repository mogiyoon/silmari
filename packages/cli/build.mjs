// Bundles sil into one cjs file (core included) and puts the viewer HTML next to it. Only dist/ goes to npm.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const viewer = resolve(import.meta.dirname, '../viewer/dist/index.html')
if (!existsSync(viewer)) { console.error('The viewer is not built: pnpm --filter @silmari/viewer build'); process.exit(2) }
mkdirSync('dist', { recursive: true })
copyFileSync(viewer, 'dist/viewer.html')
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'))
await build({
  entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  define: { __SIL_VERSION__: JSON.stringify(pkg.version) }, // sil --version
  outfile: 'dist/sil.cjs', logLevel: 'info', // The shebang from main.ts is kept as is
  logOverride: { 'empty-import-meta': 'silent' }, // view.ts checks typeof __dirname first
})
