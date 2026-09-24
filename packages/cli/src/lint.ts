// sil lint. Interface 1. Design §4.1 · §4.2.
import { resolve } from 'node:path'
import { loadDirAsync, existsIn, globIn, buildGraph, readConfig, projectNotes, addDiagnostics, format, summary } from '@silmari/core/node'
import { silVersion } from './version.ts'
// format and summary live in core so the terminal, the extension and a browser page print the same words
export { readConfig, format, summary }

export async function lint(dir: string, opt: { strict?: boolean; json?: boolean } = {}): Promise<number> {
  const root = resolve(dir)
  const cfg = readConfig(root)
  const strict = opt.strict ?? cfg.strict
  // Project-level notes (L-I06 old SILMARI.md · L-I07 notes waiting in .sil/updates/). Same function as the VS Code extension; the installed version differs
  const graph = addDiagnostics(buildGraph(await loadDirAsync(root, cfg.scan.exclude), { exists: existsIn(root), glob: globIn(root), entry: cfg.entry }), projectNotes(root, silVersion(), cfg))
  if (opt.json) process.stdout.write(JSON.stringify(graph, null, 2) + '\n')
  else process.stdout.write((graph.diagnostics.length ? format(graph.diagnostics) : 'No problems\n') + summary(graph) + '\n')
  const errors = graph.diagnostics.some((d) => d.severity === 'error')
  return strict && errors ? 1 : 0
}
