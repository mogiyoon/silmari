// Reads the title, description, heading tree, links, data, and contract from a file. Design document §1 and §2.
// Every marker is a symbol, so the parser never depends on a language: `[ ]( )` call · `{{>}}` send / input contract heading ·
// `{{<}}` receive / output contract heading · `{{+}}` tools · `{{#}}` model · `(( ))` isolation. The words inside them are free.
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Root, RootContent, PhrasingContent, ListItem } from 'mdast'
import { slug as ghSlug } from 'github-slugger'
import { createHash } from 'node:crypto'
import type { Heading, Range, ValueType } from './ir.ts'

// A subagent label is a bracket marker at the end of a heading. The graph reads the brackets as a marker. The text can be in any language: ((서브 에이전트 사용)) ((use a subagent)) ((サブエージェント)).
// The model reads the words as instructions. The graph reads the marker as a label (§1.5): double parentheses at the end of the heading,
// `## 1. Research ((use a subagent))`. Only at the heading end, so parentheses inside titles are left alone. Double parentheses were chosen
// over brackets because Markdown reads `[…]` as a reference link (editors and linters warn) and models followed `((…))` in every run
// (experiment 7-2: 16/16 vs 14/16). The old `[…]` form is still read as a label so existing documents keep their graph, with L-I05; the
// even older `[@…]` also reports L-I04 (models read `@` as a mention, experiment 3)
const SUBAGENT = /\s*\(\(([^()\s][^()]*)\)\)\s*$/
const EMPTY_SUBAGENT = /\(\(\s*\)\)\s*$/
const UNBALANCED_SUBAGENT = /(\(\([^()]*\)|[^(]\([^()]*\)\))\s*$/
const LEGACY_SUBAGENT = /\s*\[(@?)([^\]\s][^\]]*)\]\s*$/
const ANCHOR = /\s*\{#([^}]+)\}\s*$/
// A contract heading is exactly one marker: `## {{>Inputs}}` `## {{<출력}}`. The words inside are the heading text.
const CONTRACT_HEAD = /^\{\{([<>])([^}]*)\}\}$/
const CONTRACT_HEAD_PREFIX = /^\{\{[<>][^}]*\}\}\s*\S/
const MARK = /\{\{([<>*+#])([^}]*)\}\}/g
export const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u // Letters from any language are allowed. Spaces and symbols are not.
const TYPES = new Set<ValueType>(['path', 'text', 'json'])

export interface Link {
  text: string; target: string; line: number; range: Range
  sends: string[]; returns: string[]
  /** `{{+…}}` after the link: the tools the subagent may use, in the author's words. `{{#…}}`: its model. Free text; the orchestrator translates them into its runtime's flags. */
  tools: string[]; model: string | null
  under: string[]; isolated: boolean; refstyle: boolean
}
export interface Diag { code: string; severity: 'error' | 'warning' | 'info'; where: string; message: string; range?: Range }
export interface Doc {
  rel: string; fm: Record<string, string>; title: string | null; desc: string; hash: string
  headings: Heading[]; anchors: Set<string>
  contractIn: string[]; contractOut: string[]
  /** Type hints on contract items (`- marker (path)`), by name. Only items that carry one. */
  contractTypes: Record<string, ValueType>
  links: Link[]; diags: Diag[]
  /** `<!-- sil:ignore L-G01 -->` suppresses that rule when it is on the first line after frontmatter (§1.8). */
  ignores: Set<string>
}

/** Uses github-slugger to match VS Code Markdown anchors exactly (§1.1). The custom slugger merged the double hyphen (`--`) in "G. 점수 게이트 — 사람이 결정한다".
 *  This caused a false L-N09 result in the real corpus. */
export function slug(t: string): string {
  return ghSlug(t.normalize('NFC'))
}
const stripCode = (s: string) => s.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length))

/** Converts a UTF-16 offset to a byte offset (INV-8). */
export const byteOffset = (src: string, u16: number) => Buffer.byteLength(src.slice(0, u16), 'utf8')

const processor = unified().use(remarkParse).use(remarkGfm)

/** The only frontmatter silmari defines is the `sil:` block (`sil:\n  type: task|doc`). Every other key belongs to some other tool and is left alone. */
function frontmatter(src: string): { fm: Record<string, string>; body: string; bodyLineOffset: number } {
  const lines = src.split('\n')
  if (lines[0] !== '---') return { fm: {}, body: src, bodyLineOffset: 0 }
  const end = lines.indexOf('---', 1)
  if (end < 0) return { fm: {}, body: src, bodyLineOffset: 0 }
  const fm: Record<string, string> = {}
  let inSil = false
  for (const ln of lines.slice(1, end)) {
    if (/^sil:\s*$/.test(ln)) { inSil = true; continue }
    const m = inSil && /^\s{2}(\w+):\s*(.*?)\s*$/.exec(ln)
    if (m) { fm[m[1]] = m[2]; continue }
    if (/^\S/.test(ln)) inSil = false
  }
  return { fm, body: lines.slice(end + 1).join('\n'), bodyLineOffset: end + 1 }
}

/** Flattens inline children in document order. Excludes inlineCode (§1.8). */
function* inline(nodes: PhrasingContent[]): Generator<PhrasingContent> {
  for (const n of nodes) {
    if (n.type === 'inlineCode') continue
    if (n.type === 'link' || n.type === 'linkReference') { yield n; continue }
    if ('children' in n) yield* inline(n.children as PhrasingContent[])
    else yield n
  }
}
const textOf = (nodes: PhrasingContent[]): string =>
  nodes.map((n) => n.type === 'inlineCode' ? '' : 'value' in n ? n.value : 'children' in n ? textOf(n.children as PhrasingContent[]) : '').join('')

export function parseDoc(rel: string, src: string): Doc {
  // remark excludes the BOM from offsets. Remove it first, but include it in the byte calculation in fmBytes (T-4).
  const { fm, body, bodyLineOffset } = frontmatter(src.startsWith('\ufeff') ? src.slice(1) : src)
  const tree = processor.parse(body) as Root
  const defs = new Map<string, string>()
  for (const n of tree.children) if (n.type === 'definition') defs.set(n.label ?? n.identifier, n.url)

  const doc: Doc = { rel, fm, hash: createHash('sha1').update(Buffer.from(src, 'utf8')).digest('hex'), title: null, desc: '', headings: [], anchors: new Set(), contractIn: [], contractOut: [], contractTypes: {}, links: [], diags: [], ignores: new Set() }
  const ig = /^<!--\s*sil:ignore\s+([A-Z0-9-]+(?:\s*,\s*[A-Z0-9-]+)*)\s*-->/.exec(body.trimStart())
  if (ig) for (const c of ig[1].split(',')) doc.ignores.add(c.trim())
  const L = (n: { position?: { start: { line: number } } }) => (n.position?.start.line ?? 0) + bodyLineOffset
  const stack: { level: number; text: string; iso: boolean }[] = []
  let curContract: 'in' | 'out' | null = null
  let descDone = false
  let h1s = 0
  const rawLines = body.split('\n')
  // Range must be file-based (INV-8). mdast offsets start at body after the frontmatter, so shift them by that amount.
  const fmBytes = Buffer.byteLength(src, 'utf8') - Buffer.byteLength(body, 'utf8')
  const B = (u16: number) => byteOffset(body, u16) + fmBytes

  const handleBlock = (phrasing: PhrasingContent[], line: number) => {
    const under = stack.map((h) => h.text)
    const iso = stack.length ? stack[stack.length - 1].iso : false
    let last: Link | null = null
    for (const n of inline(phrasing)) {
      if (n.type === 'link' || n.type === 'linkReference') {
        let target: string | undefined
        const text = textOf(n.children as PhrasingContent[])
        if (n.type === 'link') target = n.url
        else {
          const key = n.label ?? n.identifier
          target = defs.get(key)
          if (target === undefined) { doc.diags.push({ code: 'L-N03', severity: 'error', where: `${rel}:${line}`, message: `Reference-style link has no definition: [${key}]`, range: { start: B(n.position!.start.offset!), end: B(n.position!.end.offset!) } }); continue }
        }
        const p = n.position!
        last = { text, target: decodeURIComponent(target), line,
                 range: { start: B(p.start.offset!), end: B(p.end.offset!) },
                 sends: [], returns: [], tools: [], model: null, under, isolated: iso, refstyle: n.type === 'linkReference' }
        doc.links.push(last)
      } else if (n.type === 'text') {
        for (const m of n.value.matchAll(MARK)) {
          const kind = m[1], name = m[2].trim()
          const o = n.position!.start.offset!
          const range = { start: B(o + m.index!), end: B(o + m.index! + m[0].length) }
          if (!name) { doc.diags.push({ code: 'L-N18', severity: 'warning', where: `${rel}:${line}`, message: `Empty marker {{${kind}}}: nothing is read from it`, range }); continue }
          if (!last) { doc.diags.push({ code: 'L-N13', severity: 'error', where: `${rel}:${line}`, message: `{{${kind}${name}}} has no link to attach to. Data attaches to the preceding link in the same block`, range }); continue }
          // Tools and model are free text for the orchestrator; only value names have a syntax
          if (kind === '+') { last.tools.push(name); continue }
          if (kind === '#') { last.model = name; continue }
          if (!NAME.test(name)) { doc.diags.push({ code: 'L-N04', severity: 'error', where: `${rel}:${line}`, message: `Invalid name: {{${kind}${name}}}`, range }); continue }
          // {{*}} for each-item repetition was removed. Express repetition in a heading or sentence. The marker does not affect execution (experiment 2026-09-04). Read it as a send and report it.
          if (kind === '*') doc.diags.push({ code: 'L-N15', severity: 'warning', where: `${rel}:${line}`, message: `{{*${name}}} is retired notation. Write {{>${name}}} and express repetition with a heading (## for each item) or a sentence`, range })
          ;(kind === '<' ? last.returns : last.sends).push(name)
        }
      }
    }
  }

  const walk = (n: RootContent) => {
    if (n.type === 'heading') {
      const raw = rawLines[n.position!.start.line - 1].replace(/^#{1,6}\s+/, '').trim()
      const hrange = { start: B(n.position!.start.offset!), end: B(n.position!.end.offset!) }
      let text = raw
      const a = ANCHOR.exec(text); if (a) { doc.anchors.add(a[1]); text = text.slice(0, a.index).trim() }
      let sub = SUBAGENT.test(text)
      let clean = text.replace(SUBAGENT, '').trim()
      if (!sub) {
        if (EMPTY_SUBAGENT.test(text)) { clean = text.replace(EMPTY_SUBAGENT, '').trim(); doc.diags.push({ code: 'L-N18', severity: 'warning', where: `${rel}:${L(n)}`, message: `Empty (( )) label: the heading is not read as a subagent step. Put the instruction inside, e.g. ((use a subagent))`, range: hrange }) }
        else if (UNBALANCED_SUBAGENT.test(text)) doc.diags.push({ code: 'L-N21', severity: 'warning', where: `${rel}:${L(n)}`, message: `Unbalanced parentheses at the end of the heading. A subagent label is ((…)) with two on each side`, range: hrange })
        const old = LEGACY_SUBAGENT.exec(text)
        if (old) {
          sub = true; clean = text.replace(LEGACY_SUBAGENT, '').trim()
          if (old[1]) doc.diags.push({ code: 'L-I04', severity: 'info', where: `${rel}:${L(n)}`, message: `Drop the @ in the heading label: ((use a subagent)). Models read @ as a mention, not an instruction`, range: hrange })
          doc.diags.push({ code: 'L-I05', severity: 'info', where: `${rel}:${L(n)}`, message: `Write the heading label as ((${old[2].trim()})): Markdown reads [ ] as a reference link`, range: hrange })
        }
      }
      // Contract heading: the whole heading is one marker. `## {{>Inputs}}` / `## {{<출력}}`
      let contract: 'in' | 'out' | undefined
      const ch = CONTRACT_HEAD.exec(clean)
      if (ch) {
        const inner = ch[2].trim()
        if (!inner) doc.diags.push({ code: 'L-N18', severity: 'warning', where: `${rel}:${L(n)}`, message: `Empty marker {{${ch[1]}}} in a heading: write the heading text inside, e.g. {{${ch[1]}Inputs}}`, range: hrange })
        else { contract = ch[1] === '>' ? 'in' : 'out'; clean = inner }
        if (contract && n.depth === 1) doc.diags.push({ code: 'L-N19', severity: 'info', where: `${rel}:${L(n)}`, message: `A contract heading as H1. The H1 is the document title; contracts usually sit under it`, range: hrange })
      } else if (CONTRACT_HEAD_PREFIX.test(clean)) {
        doc.diags.push({ code: 'L-N20', severity: 'warning', where: `${rel}:${L(n)}`, message: `The heading starts with a contract marker but has more text after it, so it is not read as a contract. Make the whole heading the marker: ## {{>…}}`, range: hrange })
      }
      doc.anchors.add(slug(clean))
      while (stack.length && stack[stack.length - 1].level >= n.depth) stack.pop()
      const iso = sub || (stack.length ? stack[stack.length - 1].iso : false)
      stack.push({ level: n.depth, text: clean, iso })
      doc.headings.push({ level: n.depth, text: clean, line: L(n), subagent: sub, body: '', range: { start: 0, end: 0 }, ...(contract ? { contract } : {}) })
      if (n.depth === 1) { h1s++; if (doc.title === null) doc.title = clean }
      if ([...inline(n.children)].some((c) => c.type === 'link' || c.type === 'linkReference'))
        doc.diags.push({ code: 'L-N05', severity: 'info', where: `${rel}:${L(n)}`, message: `A link inside a heading is not an edge: ${clean}` })
      curContract = contract ?? null
      return
    }
    if (n.type === 'code' || n.type === 'definition' || n.type === 'html' || n.type === 'thematicBreak') return
    if (doc.title && !descDone && stack.length && stack[stack.length - 1].level === 1) {
      doc.desc = stripCode(rawLines[n.position!.start.line - 1]).trim(); descDone = true
    }
    if (n.type === 'list') {
      for (const item of n.children as ListItem[]) {
        if (curContract) {
          const first = item.children[0]
          if (first?.type === 'paragraph') {
            // The name is the leading run of name characters. An optional `(path|text|json)` right after it is a type hint. Whatever follows (` — description`, `(note)`, `。…`) is description
            const raw = textOf(first.children).replace(/`/g, '').trim()
            const m = /^([\p{L}\p{N}][\p{L}\p{N}_-]*)(?:\s*\((\w+)\))?/u.exec(raw)
            const name = m?.[1] ?? raw
            ;(curContract === 'in' ? doc.contractIn : doc.contractOut).push(name)
            if (m?.[2] && TYPES.has(m[2].toLowerCase() as ValueType)) doc.contractTypes[name] = m[2].toLowerCase() as ValueType
          }
        }
        for (const c of item.children) walk(c)
      }
      return
    }
    if (n.type === 'paragraph') handleBlock(n.children, L(n))
    else if (n.type === 'blockquote') handleBlock(n.children.flatMap((c) => (c.type === 'paragraph' ? c.children : [])), L(n))
    else if (n.type === 'table') handleBlock(n.children.flatMap((r) => r.children.flatMap((c) => c.children)), L(n))
  }
  for (const n of tree.children) walk(n)
  // A heading body is the source from the next line to the next heading. Remove only blank lines at both ends. Also calculate its byte range (INV-8).
  const idx = (line: number) => line - 1 - bodyLineOffset
  const lineByte: number[] = []
  { let acc = fmBytes; for (const l of rawLines) { lineByte.push(acc); acc += Buffer.byteLength(l, 'utf8') + 1 } }
  doc.headings.forEach((h, i) => {
    const next = doc.headings[i + 1]
    const from = idx(h.line) + 1, to = next ? idx(next.line) : rawLines.length
    let a = from, b = to - 1
    while (a <= b && !rawLines[a].trim()) a++
    while (b >= a && !rawLines[b].trim()) b--
    if (a > b) { const at = lineByte[from] ?? Buffer.byteLength(src, 'utf8'); h.body = ''; h.range = { start: at, end: at }; return }
    let body = rawLines.slice(a, b + 1).join('\n')
    if (body.endsWith('\r')) body = body.slice(0, -1) // Handle the last line of a CRLF file.
    h.body = body
    h.range = { start: lineByte[a], end: lineByte[a] + Buffer.byteLength(body, 'utf8') }
  })
  if (h1s === 0) doc.diags.push({ code: 'L-N06', severity: 'info', where: rel, message: 'No H1. The file name is used as the title' })
  else if (h1s > 1) doc.diags.push({ code: 'L-N06', severity: 'info', where: rel, message: `${h1s} H1 headings. The first is used as the title` })
  return doc
}
