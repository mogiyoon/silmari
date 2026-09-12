// Project-level notes that need more than the documents: the installed silmari version and what waits under .sil/.
// `sil lint` and the VS Code extension both add them to the graph, so the terminal and the Problems panel say the same thing.
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Diagnostic, Graph } from './ir.ts'
import { readConfig, CONFIG_PATH, ENTRY_MAIN, type Config } from './config.ts'

/** Where `sil update` leaves the notes an agent applies and deletes */
export const UPDATES_DIR = '.sil/updates'

/** Compares two dotted versions numerically: negative when a < b, 0 when equal, positive when a > b. */
export const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0), pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d }
  return 0
}

/**
 * L-I06 when the project's SILMARI.md was written by an older silmari than `installed` (or by one before 0.3.1, which recorded nothing).
 * L-I07 while update notes wait in .sil/updates/. Both are info: they never change the exit code.
 */
export function projectNotes(root: string, installed: string, cfg: Config = readConfig(root)): Diagnostic[] {
  const out: Diagnostic[] = []
  if (existsSync(resolve(root, ENTRY_MAIN)) && (cfg.version === null || compareVersions(cfg.version, installed) < 0))
    out.push({ code: 'L-I06', severity: 'info', where: CONFIG_PATH, message: `${ENTRY_MAIN} was written by silmari ${cfg.version ?? 'before 0.3.1'}; installed is ${installed}. Run sil update` })
  const dir = resolve(root, UPDATES_DIR)
  const notes = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []
  if (notes.length) out.push({ code: 'L-I07', severity: 'info', where: UPDATES_DIR, message: `${notes.length} update note${notes.length > 1 ? 's' : ''} not applied yet: ${notes.join(', ')}. The agent applies them at the start of a session and deletes them` })
  return out
}

/** Appends diagnostics to a graph and keeps its counts in step. Returns the same graph. */
export function addDiagnostics(graph: Graph, extra: Diagnostic[]): Graph {
  for (const d of extra) {
    graph.diagnostics.push(d)
    graph.stats.diagnostics++
    graph.stats.diagnosticsBySeverity[d.severity] = (graph.stats.diagnosticsBySeverity[d.severity] ?? 0) + 1
  }
  return graph
}
