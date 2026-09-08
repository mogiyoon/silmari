// Code independent of VS Code. Checks a document set by file. Tests cover only this file.
import { buildGraph, parseDoc, loadDir, existsIn, globIn, readConfig, type Diagnostic, type Graph, type Doc } from '@silmari/core'

export interface FileDiag { code: string; severity: Diagnostic['severity']; line: number; message: string; range?: { start: number; end: number } }

/** Convert a file byte offset to a zero-based line and column (UTF-16). Korean characters use 3 bytes but 1 UTF-16 unit, so conversion is needed. */
export function toLineCol(text: string, byte: number): { line: number; col: number } {
  const u16 = Buffer.from(text, 'utf8').subarray(0, byte).toString('utf8').length
  const before = text.slice(0, u16)
  const nl = before.lastIndexOf('\n')
  return { line: (before.match(/\n/g) ?? []).length, col: u16 - nl - 1 }
}

/** If VS Code validation is on and the file is open, let VS Code handle missing files and anchors. It is more precise for open files. */
export function yieldToVscode(ds: FileDiag[], opt: { fileLinks: boolean; fragmentLinks: boolean }): FileDiag[] {
  return ds.filter((x) => !((x.code === 'L-N01' && opt.fileLinks) || (x.code === 'L-N09' && opt.fragmentLinks)))
}

/** where = "rel" | "rel:line" */
export function splitWhere(where: string): { rel: string; line: number | null } {
  const m = /^(.*?):(\d+)$/.exec(where)
  return m ? { rel: m[1], line: Number(m[2]) } : { rel: where, line: null }
}

/** Replace only that document with the unsaved body of an open file (S12: appears while editing without saving). */
export function graphWithOverride(root: string, exclude: string[], override?: { rel: string; text: string }): Graph {
  const cfg = readConfig(root)
  const docs: Map<string, Doc> = loadDir(root, [...exclude, ...cfg.scan.exclude])
  if (override) docs.set(override.rel, parseDoc(override.rel, override.text))
  return buildGraph(docs, { exists: existsIn(root), glob: globIn(root), entry: cfg.entry })
}

export function byFile(g: Graph): Map<string, FileDiag[]> {
  const out = new Map<string, FileDiag[]>()
  for (const d of g.diagnostics) {
    const { rel, line } = splitWhere(d.where)
    ;(out.get(rel) ?? out.set(rel, []).get(rel)!).push({ code: d.code, severity: d.severity, line: line ?? 1, message: d.message, ...(d.range ? { range: d.range } : {}) })
  }
  return out
}
