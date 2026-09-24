// How `sil lint` prints. It lives in core, not in the CLI, so a terminal, the VS Code extension and a browser page can
// print the same words for the same documents. Changing the shape here changes what every one of them shows.
import type { Diagnostic, Severity } from './ir.ts'

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
const MARK: Record<Severity, string> = { error: '✖', warning: '▲', info: '·' }

/** The diagnostic list, severest first, then the counts. Ends with a newline. */
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
