// Bundles the extension and copies the viewer HTML. The extension host is CJS, so the output is cjs.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const viewer = resolve(import.meta.dirname, '../viewer/dist/index.html')
if (!existsSync(viewer)) { console.error('The viewer is not built: pnpm --filter @silmari/viewer build'); process.exit(2) }
mkdirSync('dist', { recursive: true })
copyFileSync(viewer, 'dist/viewer.html')
await build({
  entryPoints: ['src/extension.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  external: ['vscode'], outfile: 'dist/extension.cjs', sourcemap: true, logLevel: 'info',
})
