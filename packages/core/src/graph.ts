// Builds a graph and diagnostics from documents. Design document §3 and Appendix A.
// Unmarked Markdown files stay quiet. L-G01 runs only when there is a call edge. L-G06 checks only calls. L-N05 and L-N06 check only task nodes.
import { posix as path } from 'node:path'
import type { Graph, Node, Edge, Diagnostic } from './ir.ts'
import type { Doc, Link } from './parse.ts'
import { isConventionalEntry } from './config.ts'

type Resolved = { kind: 'md' | 'self' | 'external' | 'other'; rel: string | null; anchor: string | null }
export function resolve(src: string, target: string): Resolved {
  if (/^[a-z]+:/.test(target)) return { kind: 'external', rel: null, anchor: null }
  if (target.startsWith('#')) return { kind: 'self', rel: null, anchor: target.slice(1) }
  const [p, anchor] = target.split('#', 2)
  // Like imports in code: `./x.md`, `../x.md` and bare `x.md` are relative to the document; a leading `/` means the project root
  // (the folder with .sil/), the way `/src/x` does in bundlers and GitHub resolves `/docs/x.md` from the repository root
  const rel = p.startsWith('/') ? path.normalize(p.slice(1)) : path.normalize(path.join(path.dirname(src), p))
  if (!rel.endsWith('.md')) return { kind: 'other', rel, anchor: anchor ?? null }
  return { kind: 'md', rel, anchor: anchor || null }
}

/** Uses the same form as Python's list repr. Diagnostic messages must match the golden file. */
const fmt = (xs: string[]) => `[${xs.map((x) => `'${x}'`).join(', ')}]`
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const hasData = (l: Link) => l.sends.length + l.returns.length > 0

export interface BuildOptions {
  /** Checks whether a file excluded from the scan, such as by .gitignore, exists on disk. If it exists, it is an empty doc node, not a ghost. */
  exists?: (rel: string) => boolean
  /** Configured entry points. They are added to the graph and excluded from orphan checks. Entry points normally have no incoming links. */
  entry?: string[]
}

export function buildGraph(docs: Map<string, Doc>, opts: BuildOptions = {}): Graph {
  const calledWithData = new Set<string>()
  for (const d of docs.values()) for (const l of d.links) {
    const r = resolve(d.rel, l.target)
    if (r.kind === 'md' && hasData(l)) calledWithData.add(r.rel!)
  }
  const isTask = (d: Doc) => {
    const t = d.fm['type']
    if (t === 'task' || t === 'doc') return t === 'task'
    return d.links.some(hasData) || calledWithData.has(d.rel) || d.contractIn.length + d.contractOut.length > 0 || d.hasTaskHead
  }

  const nodes = new Map<string, Node>()
  const edges: Edge[] = []
  const diags: Diagnostic[] = []
  for (const d of docs.values()) {
    nodes.set(d.rel, { id: d.rel, kind: isTask(d) ? 'task' : 'doc', title: d.title ?? d.rel, desc: d.desc, headings: d.headings,
      contract: d.contractIn.length + d.contractOut.length ? { inputs: d.contractIn, outputs: d.contractOut } : null,
      hash: d.hash, ...(d.agent ? { agent: d.agent } : {}) })
    const task = nodes.get(d.rel)!.kind === 'task'
    diags.push(...d.diags.filter((x) => task || !(x.code === 'L-N05' || x.code === 'L-N06')))
  }
  for (const d of docs.values()) for (const l of d.links) {
    const r = resolve(d.rel, l.target)
    if (r.kind !== 'md') continue
    const rel = r.rel!, where = `${d.rel}:${l.line}`, data = hasData(l), range = l.range
    if (!nodes.has(rel)) {
      if (opts.exists?.(rel)) nodes.set(rel, { id: rel, kind: 'doc', title: rel, desc: 'excluded from scan — the file exists', headings: [], contract: null, hash: '' })
      else {
        nodes.set(rel, { id: rel, kind: 'ghost', title: rel, desc: '', headings: [], contract: null, hash: '' })
        diags.push({ code: 'L-N01', severity: 'error', where, message: `Linked file not found: ${l.target}`, range })
      }
    }
    const tgt = nodes.get(rel)!
    const tdoc = docs.get(rel)
    if (r.anchor && tdoc && !tdoc.anchors.has(r.anchor))
      diags.push({ code: 'L-N09', severity: 'error', where, message: `Anchor not found in the target document: ${l.target}`, range })
    const type: Edge['type'] = tgt.kind === 'task' && data ? 'call' : tgt.kind === 'doc' ? 'ref' : data ? 'call' : 'mention'
    if (tgt.kind === 'doc' && data) diags.push({ code: 'L-N14', severity: 'warning', where, message: `Data attached to a reference document: ${l.target}`, range })
    const e: Edge = { from: d.rel, to: rel, type, line: l.line, under: l.under, sends: l.sends, returns: l.returns, isolated: l.isolated, range: l.range }
    if (r.anchor) e.anchor = r.anchor
    edges.push(e)
    const c = docs.get(rel)
    if (tgt.kind === 'task' && c && c.contractIn.length + c.contractOut.length) {
      const sent = [...new Set(l.sends)]
      const notIn = sent.filter((x) => !c.contractIn.includes(x)).sort(cmp)
      if (c.contractIn.length && sent.length && notIn.length)
        diags.push({ code: 'L-C01', severity: 'warning', where, message: `Sends values that are not in the inputs ${fmt(c.contractIn)} of ${rel}: ${fmt(notIn)}`, range })
      const notOut = [...new Set(l.returns.filter((x) => !c.contractOut.includes(x)))].sort(cmp)
      if (c.contractOut.length && l.returns.length && notOut.length)
        diags.push({ code: 'L-C02', severity: 'warning', where, message: `Receives values that are not in the outputs ${fmt(c.contractOut)} of ${rel}: ${fmt(notOut)}`, range })
    }
  }
  for (const d of docs.values()) {
    const recv = new Map<string, string[]>()
    const sentNames = new Set<string>()
    const calls = new Map<string, Link[]>()
    for (const l of d.links) {
      for (const n of l.returns) recv.set(n, [...(recv.get(n) ?? []), l.under.join('\0') /* A separator that cannot appear in a heading. Used to compare conditions. */])
      for (const n of l.sends) sentNames.add(n)
      const r = resolve(d.rel, l.target)
      if (r.kind === 'md' && hasData(l)) calls.set(r.rel!, [...(calls.get(r.rel!) ?? []), l])
    }
    for (const [n, unders] of recv) {
      if (new Set(unders).size !== unders.length) diags.push({ code: 'L-N16', severity: 'error', where: d.rel, message: `The same name is received twice under the same condition: ${n}` })
      // A received value is used if it is sent to the next call or returned by this document as an output.
      else if (!sentNames.has(n) && !d.contractOut.includes(n)) diags.push({ code: 'L-N17', severity: 'info', where: d.rel, message: `A received value is never used: ${n}` })
    }
    for (const [rel, ls] of calls) if (ls.length > 1 && ls.slice(1).some((l) => l.under.length <= 1))
      diags.push({ code: 'L-G06', severity: 'warning', where: d.rel, message: `${rel} is called again without a condition. There is no way out` })
  }
  const incoming = new Map<string, number>()
  for (const e of edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1)
  const structured = edges.some((e) => e.type === 'call')
  // Configured entry points and conventional ones such as CLAUDE.md, AGENTS.md, and slash commands normally have no incoming links.
  const entrySet = new Set(opts.entry ?? [])
  for (const n of nodes.values()) if (structured && n.kind === 'doc' && !incoming.get(n.id) && !isConventionalEntry(n.id) && !entrySet.has(n.id))
    diags.push({ code: 'L-G01', severity: 'warning', where: n.id, message: 'Reference document that nobody links to. A cleanup candidate; never deleted' })

  // Remove a diagnostic when its file, the file part of where, uses sil:ignore for that rule.
  const kept = diags.filter((x) => !docs.get(x.where.replace(/:\d+$/, ''))?.ignores.has(x.code))
  diags.length = 0; diags.push(...kept)
  edges.sort((a, b) => cmp(a.from, b.from) || a.line - b.line || cmp(a.to, b.to))
  diags.sort((a, b) => cmp(a.code, b.code) || cmp(a.where, b.where))
  const sortedNodes = [...nodes.values()].sort((a, b) => cmp(a.id, b.id))
  // Insert sorted keys. Output must be deterministic at the byte level (INV-D1).
  const count = <T extends string>(xs: T[]) => {
    const o: Partial<Record<T, number>> = {}
    for (const x of [...xs].sort(cmp)) o[x] = (o[x] ?? 0) + 1
    return o
  }
  return {
    spec: 'v4',
    ...(opts.entry?.length ? { entry: opts.entry } : {}),
    stats: { files: docs.size, nodes: nodes.size, edges: edges.length, diagnostics: diags.length,
      nodesByKind: count(sortedNodes.map((n) => n.kind)), edgesByType: count(edges.map((e) => e.type)), diagnosticsBySeverity: count(diags.map((x) => x.severity)) },
    nodes: sortedNodes, edges, diagnostics: diags,
  }
}
