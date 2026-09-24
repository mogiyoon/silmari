// Project-level notes that need more than the documents: the installed silmari version and what waits under .sil/.
// `sil lint` and the VS Code extension both add them to the graph, so the terminal and the Problems panel say the same thing.
// The part that reads .sil/ is node/notes.ts; what is left here needs no file system.
import type { Diagnostic, Graph } from './ir.ts'

/** Where `sil update` leaves the notes an agent applies and deletes */
export const UPDATES_DIR = '.sil/updates'

/** Compares two dotted versions numerically: negative when a < b, 0 when equal, positive when a > b. */
export const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0), pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d }
  return 0
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
