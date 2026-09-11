// Builds a graph and diagnostics from documents. Design document §3 and Appendix A.
// Unmarked Markdown files stay quiet. L-G01 runs only when there is a call edge. L-G06 checks only calls. L-N05 and L-N06 check only task nodes.
import { posix as path } from 'node:path'
import type { Graph, Node, Edge, Diagnostic, Contract } from './ir.ts'
import type { Doc, Link } from './parse.ts'
import { isConventionalEntry } from './config.ts'

/** template: the target carries `{{>name}}`, so rel is a pattern with the markers kept in place; the file is chosen when the step runs. */
type Resolved = { kind: 'md' | 'self' | 'external' | 'other'; rel: string | null; anchor: string | null; template: boolean }
export function resolve(src: string, target: string): Resolved {
  if (/^[a-z]+:/.test(target)) return { kind: 'external', rel: null, anchor: null, template: false }
  if (target.startsWith('#')) return { kind: 'self', rel: null, anchor: target.slice(1), template: false }
  const [p, anchor] = target.split('#', 2)
  // Like imports in code: `./x.md`, `../x.md` and bare `x.md` are relative to the document; a leading `/` means the project root
  // (the folder with .sil/), the way `/src/x` does in bundlers and GitHub resolves `/docs/x.md` from the repository root
  const rel = p.startsWith('/') ? path.normalize(p.slice(1)) : path.normalize(path.join(path.dirname(src), p))
  const template = /\{\{>/.test(rel)
  if (!rel.endsWith('.md')) return { kind: 'other', rel, anchor: anchor ?? null, template }
  return { kind: 'md', rel, anchor: anchor || null, template }
}
/** A template path as a matcher: every `{{>name}}` stands for one path segment (no `/`), the rest is literal. */
export const templateRegex = (pattern: string): RegExp =>
  new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\\\{>[^}\\]*\\\}\\\}/g, '[^/]+') + '$')

/** Uses the same form as Python's list repr. Diagnostic messages must match the golden file. */
const fmt = (xs: string[]) => `[${xs.map((x) => `'${x}'`).join(', ')}]`
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const hasData = (l: Link) => l.sends.length + l.returns.length > 0
const hasContract = (d: Doc) => d.contractIn.length + d.contractOut.length > 0
const hasExecution = (d: Doc) => d.headings.some((h) => h.execution)
const contractOf = (d: Doc): Contract | null => {
  if (!hasContract(d)) return null
  const c: Contract = { inputs: d.contractIn, outputs: d.contractOut }
  if (Object.keys(d.contractTypes).length) c.types = d.contractTypes
  return c
}

export interface BuildOptions {
  /** Checks whether a file excluded from the scan, such as by .gitignore, exists on disk. If it exists, it is an empty doc node, not a ghost. */
  exists?: (rel: string) => boolean
  /** Configured entry points. They are added to the graph and excluded from orphan checks. Entry points normally have no incoming links. */
  entry?: string[]
  /** Lists the files on disk that a template link (`refs/{{>topic}}.md`) matches, as project-relative paths. Without it, only scanned md files are matched,
   *  and a template that points at other files is taken to exist. */
  glob?: (pattern: string) => string[]
}

export function buildGraph(docs: Map<string, Doc>, opts: BuildOptions = {}): Graph {
  // One execution section has one target: its first link. A later linked file with a sent value is written by that target.
  const executionTargets = new Map<string, string>()
  const executionKey = (d: Doc, l: Link) => `${d.rel}:${l.execution?.section ?? 0}`
  for (const d of docs.values()) for (const l of d.links) if (l.execution?.target) {
    const r = resolve(d.rel, l.target)
    if (r.rel) executionTargets.set(executionKey(d, l), r.rel)
  }
  const plannedFiles = new Set<string>()
  for (const d of docs.values()) for (const l of d.links) {
    if (l.execution?.target || !l.sends.length) continue
    const r = resolve(d.rel, l.target)
    if (r.rel && (r.kind === 'other' || !!l.execution)) plannedFiles.add(r.rel)
  }

  const calledWithData = new Set<string>()
  for (const d of docs.values()) for (const l of plannedFiles.has(d.rel) ? [] : d.links) {
    const r = resolve(d.rel, l.target)
    if (r.kind === 'md' && (hasData(l) || l.execution?.target)) calledWithData.add(r.rel!)
  }
  // A task: it calls with values, is called with values, or declares a contract. `sil: type` in the frontmatter overrides the guess.
  const isTask = (d: Doc) => {
    const t = d.fm['type']
    if (t === 'task' || t === 'doc') return t === 'task'
    return d.links.some((l) => hasData(l) || !!l.execution?.target) || calledWithData.has(d.rel) || hasContract(d) || hasExecution(d)
  }

  const nodes = new Map<string, Node>()
  const edges: Edge[] = []
  const diags: Diagnostic[] = []
  for (const d of docs.values()) {
    if (plannedFiles.has(d.rel)) {
      nodes.set(d.rel, { id: d.rel, kind: 'file', title: d.rel, desc: '', headings: [], contract: null, hash: d.hash, file: { exists: true, planned: true } })
      continue
    }
    nodes.set(d.rel, { id: d.rel, kind: isTask(d) ? 'task' : 'doc', title: d.title ?? d.rel, desc: d.desc, headings: d.headings, contract: contractOf(d), hash: d.hash })
    const task = nodes.get(d.rel)!.kind === 'task'
    for (const x of d.diags) if (task || !(x.code === 'L-N05' || x.code === 'L-N06')) diags.push(x)
  }
  // One execution section has one target: its first link. Other linked files in that section can be declared outputs.
  // The target remains its ordinary file node; no synthetic run or artifact nodes are created.
  for (const d of docs.values()) for (const h of d.headings) if (h.execution && !executionTargets.has(`${d.rel}:${h.line}`))
    diags.push({ code: 'L-N31', severity: 'warning', where: `${d.rel}:${h.line}`, message: 'An {{=…}} execution section has no target link' })

  // A declared write is allowed to point at a file that does not exist yet. It is a planned file, not a broken link.
  // Tool sets per called file, to spot a file that is called with different tools from different places (L-N24)
  const toolSets = new Map<string, Map<string, string>>()
  const viaTemplate = new Set<string>() // files a template link can match: reached at run time, so not orphans (L-G01)
  const ghost = (rel: string) => nodes.set(rel, { id: rel, kind: 'ghost', title: rel, desc: '', headings: [], contract: null, hash: '' })
  const plain = (rel: string, kind: 'doc' | 'file', desc: string, file?: Node['file']) => nodes.set(rel, { id: rel, kind, title: rel, desc, headings: [], contract: null, hash: '', ...(file ? { file } : {}) })
  for (const d of docs.values()) for (const l of plannedFiles.has(d.rel) ? [] : d.links) {
    const r = resolve(d.rel, l.target)
    if (r.kind === 'self' || r.kind === 'external') continue
    const rel = r.rel!, where = `${d.rel}:${l.line}`, data = hasData(l), range = l.range
    // A subagent starts in the project root and receives only what is under it
    if (rel.startsWith('../')) diags.push({ code: 'L-N30', severity: 'warning', where, message: `Link points outside the project root: ${l.target}. A subagent starts in the project root and only files under it reach it`, range })
    if (!nodes.has(rel)) {
      if (r.template) {
        // The file is chosen at run time. The node stands for every file the pattern can match; it must match at least one now
        const re = templateRegex(rel)
        const matches = [...new Set([...[...docs.keys()].filter((k) => re.test(k)), ...(opts.glob?.(rel) ?? [])])].sort(cmp)
        const checkable = r.kind === 'md' || opts.glob !== undefined
        for (const m of matches) viaTemplate.add(m)
        if (matches.length || !checkable || plannedFiles.has(rel)) nodes.set(rel, { id: rel, kind: plannedFiles.has(rel) ? 'file' : r.kind === 'md' ? (data ? 'task' : 'doc') : 'file', title: rel,
          desc: matches.length ? `matches ${matches.length}: ${matches.slice(0, 5).join(', ')}${matches.length > 5 ? ', …' : ''}` : plannedFiles.has(rel) ? 'planned output pattern — resolved at runtime' : '',
          headings: [], contract: null, hash: '', ...((r.kind === 'other' || plannedFiles.has(rel)) ? { file: { exists: matches.length > 0, planned: plannedFiles.has(rel), template: true, matches: matches.length } } : {}) })
        else { ghost(rel); diags.push({ code: 'L-N28', severity: 'error', where, message: `No file matches the template link: ${l.target}`, range }) }
      } else if (r.kind === 'other' || plannedFiles.has(rel)) {
        // Any file can be linked (json, log, a folder …). It is shown and checked, never parsed. Without an exists callback it is taken to exist
        const exists = opts.exists === undefined || opts.exists(rel)
        if (exists || plannedFiles.has(rel)) plain(rel, 'file', !exists ? 'planned output — created at runtime' : '', { exists, planned: plannedFiles.has(rel) })
        else { ghost(rel); diags.push({ code: 'L-N01', severity: 'error', where, message: `Linked file not found: ${l.target}`, range }) }
      } else if (opts.exists?.(rel)) plain(rel, 'doc', 'excluded from scan — the file exists')
      else { ghost(rel); diags.push({ code: 'L-N01', severity: 'error', where, message: `Linked file not found: ${l.target}`, range }) }
    }
    const tgt = nodes.get(rel)!
    const tdoc = docs.get(rel)
    if (r.anchor && tdoc && !tdoc.anchors.has(r.anchor))
      diags.push({ code: 'L-N09', severity: 'error', where, message: `Anchor not found in the target document: ${l.target}`, range })
    const fileTarget = r.kind === 'other' || plannedFiles.has(rel)
    const executionTarget = !!l.execution?.target
    const writesFile = fileTarget && !executionTarget && l.sends.length > 0
    const readsFile = fileTarget && !executionTarget && !writesFile && l.returns.length > 0
    const reference = tgt.kind === 'doc' || tgt.kind === 'file'
    const type: Edge['type'] = executionTarget ? 'call' : writesFile ? 'write' : readsFile ? 'read' : tgt.kind === 'task' && data ? 'call' : reference ? 'ref' : data ? 'call' : 'mention'
    if (reference && data && !fileTarget) diags.push({ code: 'L-N14', severity: 'warning', where, message: `Data attached to a reference document: ${l.target}`, range })
    const producer = l.execution ? executionTargets.get(executionKey(d, l)) : d.rel
    const from = writesFile ? (producer ?? d.rel) : readsFile ? rel : d.rel
    const to = writesFile ? rel : readsFile ? d.rel : rel
    const e: Edge = { from, to, type, line: l.line, under: l.under, sends: l.sends, returns: l.returns, isolated: l.isolated, range: l.range,
      ...((writesFile || readsFile) ? { declaredIn: d.rel } : {}) }
    if (r.anchor) e.anchor = r.anchor
    if (l.tools.length) e.tools = l.tools
    if (l.model) e.model = l.model
    if (l.noRules) e.noRules = l.noRules
    edges.push(e)
    const c = docs.get(rel)
    if (type === 'call' && tgt.kind === 'task' && c && hasContract(c)) {
      const sent = [...new Set(l.sends)]
      const notIn = sent.filter((x) => !c.contractIn.includes(x)).sort(cmp)
      if (c.contractIn.length && sent.length && notIn.length)
        diags.push({ code: 'L-C01', severity: 'warning', where, message: `Sends values that are not in the inputs ${fmt(c.contractIn)} of ${rel}: ${fmt(notIn)}`, range })
      const notOut = [...new Set(l.returns.filter((x) => !c.contractOut.includes(x)))].sort(cmp)
      if (c.contractOut.length && l.returns.length && notOut.length)
        diags.push({ code: 'L-C02', severity: 'warning', where, message: `Receives values that are not in the outputs ${fmt(c.contractOut)} of ${rel}: ${fmt(notOut)}`, range })
    }
    // A file that is called with values but declares nothing cannot be checked. The contract belongs in the called file (Migration rule 2)
    if (type === 'call' && c && !hasContract(c) && data)
      diags.push({ code: 'L-N22', severity: 'info', where, message: `${rel} is called with values but declares no {{>…}} / {{<…}} contract, so the names cannot be checked`, range })
    // Tools, model and the start-file switch apply to subagent runs only
    if (type === 'call' && !l.isolated && (l.tools.length || l.model || l.noRules))
      diags.push({ code: 'L-N26', severity: 'warning', where, message: `{{+…}} / {{#…}} / {{-…}} on a call that is not a subagent step have no effect. Add a (( )) label to the heading, or remove them`, range })
    if (type === 'call' && l.isolated && !l.tools.length && !l.model)
      diags.push({ code: 'L-N25', severity: 'info', where, message: `Subagent call names no {{+tools}} or {{#model}}; it runs with whatever the caller passes`, range })
    if (type === 'call' && l.tools.length) {
      const sets = toolSets.get(rel) ?? toolSets.set(rel, new Map()).get(rel)!
      sets.set([...l.tools].sort(cmp).join(', '), where)
    }
  }
  for (const [rel, sets] of toolSets) if (sets.size > 1)
    diags.push({ code: 'L-N24', severity: 'info', where: rel, message: `Called with different tool sets: ${[...sets.keys()].map((s) => `[${s}]`).join(' vs ')}` })
  for (const d of docs.values()) {
    if (plannedFiles.has(d.rel)) continue
    const recv = new Map<string, string[]>()
    const imported = new Set<string>()
    const sentNames = new Set<string>()
    const calls = new Map<string, Link[]>()
    for (const l of d.links) {
      const r = resolve(d.rel, l.target)
      const fileTarget = r.kind === 'other' || (!!r.rel && plannedFiles.has(r.rel))
      const fileWrite = fileTarget && !l.execution?.target && l.sends.length > 0
      const fileRead = fileTarget && !l.execution?.target && !fileWrite && l.returns.length > 0
      if (fileRead) for (const n of l.returns) imported.add(n)
      if (!fileWrite) for (const n of l.returns) recv.set(n, [...(recv.get(n) ?? []), l.under.join('\0') /* A separator that cannot appear in a heading. Used to compare conditions. */])
      if (!fileWrite && !fileRead) for (const n of l.sends) sentNames.add(n)
      if (r.rel && (l.execution?.target || (r.kind === 'md' && hasData(l)))) calls.set(r.rel, [...(calls.get(r.rel) ?? []), l])
    }
    for (const [n, unders] of recv) {
      if (new Set(unders).size !== unders.length) diags.push({ code: 'L-N16', severity: 'error', where: d.rel, message: `The same name is received twice under the same condition: ${n}` })
      // A received value is used if it is sent to the next call or returned by this document as an output.
      else if (!imported.has(n) && !sentNames.has(n) && !d.contractOut.includes(n)) diags.push({ code: 'L-N17', severity: 'info', where: d.rel, message: `A received value is never used: ${n}` })
    }
    // The mirror of L-N17: a sent value that this document neither receives from a call nor declares in its own contract. Legitimate when the document makes the value itself, so info
    for (const n of [...sentNames].sort(cmp)) if (!recv.has(n) && !d.contractIn.includes(n) && !d.contractOut.includes(n))
      diags.push({ code: 'L-N23', severity: 'info', where: d.rel, message: `A sent value is neither received from a call nor declared in this document's contract: ${n}` })
    for (const [rel, ls] of calls) if (ls.length > 1 && ls.slice(1).some((l) => l.under.length <= 1))
      diags.push({ code: 'L-G06', severity: 'warning', where: d.rel, message: `${rel} is called again without a condition. There is no way out` })
    // A value inside a link target is filled from this document's own values: an input, or something received from a call
    for (const l of d.links) for (const n of [...new Set(l.params ?? [])]) if (!recv.has(n) && !d.contractIn.includes(n))
      diags.push({ code: 'L-N29', severity: 'warning', where: `${d.rel}:${l.line}`, message: `{{>${n}}} in the link target ${l.target} is neither an input of this document nor received from a call, so it cannot be filled`, range: l.range })
  }
  const incoming = new Map<string, number>()
  for (const e of edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1)
  const structured = edges.some((e) => e.type === 'call')
  // Configured entry points and conventional ones such as CLAUDE.md, AGENTS.md, and slash commands normally have no incoming links.
  const entrySet = new Set(opts.entry ?? [])
  for (const n of nodes.values()) if (structured && n.kind === 'doc' && !incoming.get(n.id) && !viaTemplate.has(n.id) && !isConventionalEntry(n.id) && !entrySet.has(n.id))
    diags.push({ code: 'L-G01', severity: 'warning', where: n.id, message: 'Reference document that nobody links to. A cleanup candidate; never deleted' })

  // Remove a diagnostic when its file, the file part of where, uses sil:ignore for that rule.
  // No spread here: a corpus of tens of thousands of files has more diagnostics than the call stack takes as arguments
  const kept = diags.filter((x) => !docs.get(x.where.replace(/:\d+$/, ''))?.ignores.has(x.code))
  diags.length = 0; for (const x of kept) diags.push(x)
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
    spec: 'v5',
    ...(opts.entry?.length ? { entry: opts.entry } : {}),
    stats: { files: docs.size, nodes: nodes.size, edges: edges.length, diagnostics: diags.length,
      nodesByKind: count(sortedNodes.map((n) => n.kind)), edgesByType: count(edges.map((e) => e.type)), diagnosticsBySeverity: count(diags.map((x) => x.severity)) },
    nodes: sortedNodes, edges, diagnostics: diags,
  }
}
