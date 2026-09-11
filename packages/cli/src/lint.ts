// sil lint. Interface 1. Design §4.1 · §4.2.
import { resolve } from 'node:path'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { loadDirAsync, existsIn, globIn, buildGraph, readConfig, ENTRY_MAIN, CONFIG_PATH, type Diagnostic, type Severity } from '@silmari/core'
import { silVersion, compareVersions } from './version.ts'
import { UPDATES_DIR } from './init.ts'
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

/** Always printed: whether the graph is structured shows here. A migration that changed nothing leaves task 0 · call 0 */
export const summary = (g: { stats: { files: number; nodesByKind: Partial<Record<string, number>>; edgesByType: Partial<Record<string, number>> } }): string => {
  const k = g.stats.nodesByKind, e = g.stats.edgesByType
  return `files ${g.stats.files} · task ${k.task ?? 0} · doc ${k.doc ?? 0} · file ${k.file ?? 0} · ghost ${k.ghost ?? 0} · call ${e.call ?? 0} · read ${e.read ?? 0} · write ${e.write ?? 0} · ref ${e.ref ?? 0} · mention ${e.mention ?? 0}`
}

export async function lint(dir: string, opt: { strict?: boolean; json?: boolean } = {}): Promise<number> {
  const root = resolve(dir)
  const cfg = readConfig(root)
  const strict = opt.strict ?? cfg.strict
  const graph = buildGraph(await loadDirAsync(root, cfg.scan.exclude), { exists: existsIn(root), glob: globIn(root), entry: cfg.entry })
  // Project-level notes only the CLI can know: the SILMARI.md this project has was written by an older sil, or update notes wait in .sil/updates/
  const extra: Diagnostic[] = []
  const installed = silVersion()
  if (existsSync(resolve(root, ENTRY_MAIN)) && (cfg.version === null || compareVersions(cfg.version, installed) < 0))
    extra.push({ code: 'L-I06', severity: 'info', where: CONFIG_PATH, message: `${ENTRY_MAIN} was written by silmari ${cfg.version ?? 'before 0.3.1'}; installed is ${installed}. Run sil update` })
  const notes = existsSync(resolve(root, UPDATES_DIR)) ? readdirSync(resolve(root, UPDATES_DIR)).filter((f) => f.endsWith('.md')).sort() : []
  if (notes.length) extra.push({ code: 'L-I07', severity: 'info', where: UPDATES_DIR, message: `${notes.length} update note${notes.length > 1 ? 's' : ''} not applied yet: ${notes.join(', ')}. The agent applies them at the start of a session and deletes them` })
  for (const x of extra) { graph.diagnostics.push(x); graph.stats.diagnostics++; graph.stats.diagnosticsBySeverity.info = (graph.stats.diagnosticsBySeverity.info ?? 0) + 1 }
  if (opt.json) process.stdout.write(JSON.stringify(graph, null, 2) + '\n')
  else process.stdout.write((graph.diagnostics.length ? format(graph.diagnostics) : 'No problems\n') + summary(graph) + '\n')
  const errors = graph.diagnostics.some((d) => d.severity === 'error')
  return strict && errors ? 1 : 0
}
