// sil lint. Interface 1. Design §4.1 · §4.2.
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { loadDirAsync, existsIn, buildGraph, readConfig, type Diagnostic, type Severity } from '@silmari/core'
export { readConfig }



const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
const MARK: Record<Severity, string> = { error: '✖', warning: '▲', info: '·' }

export function format(diags: Diagnostic[]): string {
  const sorted = [...diags].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (a.where < b.where ? -1 : a.where > b.where ? 1 : 0))
  const lines = sorted.map((d) => `${MARK[d.severity]} ${d.where}  ${d.code}  ${d.message}`)
  const n = (s: Severity) => diags.filter((d) => d.severity === s).length
  lines.push('', `error ${n('error')} · warning ${n('warning')} · info ${n('info')}`)
  return lines.join('\n') + '\n'
}

export async function lint(dir: string, opt: { strict?: boolean; json?: boolean } = {}): Promise<number> {
  const root = resolve(dir)
  const cfg = readConfig(root)
  const strict = opt.strict ?? cfg.strict
  const graph = buildGraph(await loadDirAsync(root, cfg.scan.exclude, cfg.words), { exists: existsIn(root), entry: cfg.entry })
  if (opt.json) process.stdout.write(JSON.stringify(graph, null, 2) + '\n')
  else process.stdout.write(graph.diagnostics.length ? format(graph.diagnostics) : `No problems — ${graph.stats.files} files, ${graph.stats.nodes} nodes, ${graph.stats.edges} edges\n`)
  const errors = graph.diagnostics.some((d) => d.severity === 'error')
  return strict && errors ? 1 : 0
}
