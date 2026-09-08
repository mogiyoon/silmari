// The installed silmari version. The bundle gets it from package.json at build time (esbuild define); a source run reads the file.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

declare const __SIL_VERSION__: string | undefined
export const silVersion = (): string => {
  if (typeof __SIL_VERSION__ === 'string') return __SIL_VERSION__
  try { return (JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string }).version } catch { return '0.0.0' }
}

/** Compares two dotted versions numerically: negative when a < b, 0 when equal, positive when a > b. */
export const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0), pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d }
  return 0
}
