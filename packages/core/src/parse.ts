// Reads the title, description, heading tree, links, data, and contract from a file. Design document §1 and §2.
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Root, RootContent, PhrasingContent, ListItem } from 'mdast'
import { slug as ghSlug } from 'github-slugger'
import { createHash } from 'node:crypto'
import { DEFAULT_WORDS, type Words } from './config.ts'
import type { Heading, Range, Agent } from './ir.ts'

export const CONTRACT_IN = new Set(DEFAULT_WORDS.inputs)
export const CONTRACT_OUT = new Set(DEFAULT_WORDS.outputs)
export const TASK_HEAD = new Set(DEFAULT_WORDS.task)
// A subagent label is a bracket marker at the end of a heading. The graph reads the brackets as a marker. The text can be in any language: [서브 에이전트 사용] [use a subagent] [サブエージェント]. English uses a verb phrase. A single noun is read as a tag (experiment 4).
// The model reads the words as instructions. The graph reads the marker as a label (§1.5). It reads only markers at the end of headings to avoid brackets inside titles. `@` is legacy notation. Models read it as a mention (experiment 3), so the parser accepts it but reports L-I04.
const SUBAGENT = /\s*\[(@?)([^\]\s][^\]]*)\]\s*$/
const lower = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()))
const ANCHOR = /\s*\{#([^}]+)\}\s*$/
const MARK = /\{\{([<>*])([^}]*)\}\}/g
export const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u // Letters from any language are allowed. Spaces and symbols are not.

export interface Link {
  text: string; target: string; line: number; range: Range
  sends: string[]; returns: string[]
  under: string[]; isolated: boolean; refstyle: boolean
}
export interface Diag { code: string; severity: 'error' | 'warning' | 'info'; where: string; message: string; range?: Range }
export interface Doc {
  rel: string; fm: Record<string, string>; agent: Agent | null; title: string | null; desc: string; hash: string
  headings: Heading[]; anchors: Set<string>
  contractIn: string[]; contractOut: string[]; hasTaskHead: boolean
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

function frontmatter(src: string): { fm: Record<string, string>; agent: Agent | null; body: string; bodyLineOffset: number } {
  const lines = src.split('\n')
  if (lines[0] !== '---') return { fm: {}, agent: null, body: src, bodyLineOffset: 0 }
  const end = lines.indexOf('---', 1)
  if (end < 0) return { fm: {}, agent: null, body: src, bodyLineOffset: 0 }
  const fm: Record<string, string> = {}
  const agent: Agent = {}
  let inSil = false
  for (const ln of lines.slice(1, end)) {
    if (/^sil:\s*$/.test(ln)) { inSil = true; continue }
    const m = inSil && /^\s{2}(\w+):\s*(.*?)\s*$/.exec(ln)
    if (m) { fm[m[1]] = m[2]; continue }
    if (/^\S/.test(ln)) inSil = false
    // Only reads top-level keys from Claude Code registration files (§1.10).
    const a = /^(name|description|model|tools):\s*(.*?)\s*$/.exec(ln)
    if (a) {
      if (a[1] === 'tools') agent.tools = a[2].replace(/^\[|\]$/g, '').split(',').map((t) => t.trim()).filter(Boolean)
      else agent[a[1] as 'name' | 'description' | 'model'] = a[2]
    }
  }
  return { fm, agent: Object.keys(agent).length ? agent : null, body: lines.slice(end + 1).join('\n'), bodyLineOffset: end + 1 }
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

export function parseDoc(rel: string, src: string, words: Words = DEFAULT_WORDS): Doc {
  const IN = lower(words.inputs), OUT = lower(words.outputs), TASK = lower(words.task)
  // remark excludes the BOM from offsets. Remove it first, but include it in the byte calculation in fmBytes (T-4).
  const { fm, agent, body, bodyLineOffset } = frontmatter(src.startsWith('\ufeff') ? src.slice(1) : src)
  const tree = processor.parse(body) as Root
  const defs = new Map<string, string>()
  for (const n of tree.children) if (n.type === 'definition') defs.set(n.label ?? n.identifier, n.url)

  const doc: Doc = { rel, fm, agent, hash: createHash('sha1').update(Buffer.from(src, 'utf8')).digest('hex'), title: null, desc: '', headings: [], anchors: new Set(), contractIn: [], contractOut: [], hasTaskHead: false, links: [], diags: [], ignores: new Set() }
  const ig = /^<!--\s*sil:ignore\s+([A-Z0-9-]+(?:\s*,\s*[A-Z0-9-]+)*)\s*-->/.exec(body.trimStart())
  if (ig) for (const c of ig[1].split(',')) doc.ignores.add(c.trim())
  const L = (n: { position?: { start: { line: number } } }) => (n.position?.start.line ?? 0) + bodyLineOffset
  const stack: { level: number; text: string; iso: boolean }[] = []
  let curHead: string | null = null
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
                 sends: [], returns: [], under, isolated: iso, refstyle: n.type === 'linkReference' }
        doc.links.push(last)
      } else if (n.type === 'text') {
        for (const m of n.value.matchAll(MARK)) {
          const kind = m[1], name = m[2].trim()
          const o = n.position!.start.offset!
          const range = { start: B(o + m.index!), end: B(o + m.index! + m[0].length) }
          if (!NAME.test(name)) { doc.diags.push({ code: 'L-N04', severity: 'error', where: `${rel}:${line}`, message: `Invalid name: {{${kind}${name}}}`, range }); continue }
          if (!last) { doc.diags.push({ code: 'L-N13', severity: 'error', where: `${rel}:${line}`, message: `{{${kind}${name}}} has no link to attach to. Data attaches to the preceding link in the same block`, range }); continue }
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
      let text = raw
      const a = ANCHOR.exec(text); if (a) { doc.anchors.add(a[1]); text = text.slice(0, a.index).trim() }
      const subm = SUBAGENT.exec(text), sub = !!subm
      if (subm?.[1]) doc.diags.push({ code: 'L-I04', severity: 'info', where: `${rel}:${L(n)}`, message: `Drop the @ in the heading label: [use a subagent]. Models read @ as a mention, not an instruction`, range: { start: B(n.position!.start.offset!), end: B(n.position!.end.offset!) } })
      const clean = text.replace(SUBAGENT, '').trim()
      doc.anchors.add(slug(clean))
      while (stack.length && stack[stack.length - 1].level >= n.depth) stack.pop()
      const iso = sub || (stack.length ? stack[stack.length - 1].iso : false)
      stack.push({ level: n.depth, text: clean, iso })
      doc.headings.push({ level: n.depth, text: clean, line: L(n), subagent: sub, body: '', range: { start: 0, end: 0 } })
      if (n.depth === 1) { h1s++; if (doc.title === null) doc.title = clean }
      if ([...inline(n.children)].some((c) => c.type === 'link' || c.type === 'linkReference'))
        doc.diags.push({ code: 'L-N05', severity: 'info', where: `${rel}:${L(n)}`, message: `A link inside a heading is not an edge: ${clean}` })
      curHead = clean.toLowerCase()
      if (TASK.has(curHead)) doc.hasTaskHead = true
      return
    }
    if (n.type === 'code' || n.type === 'definition' || n.type === 'html' || n.type === 'thematicBreak') return
    if (doc.title && !descDone && stack.length && stack[stack.length - 1].level === 1) {
      doc.desc = stripCode(rawLines[n.position!.start.line - 1]).trim(); descDone = true
    }
    if (n.type === 'list') {
      for (const item of n.children as ListItem[]) {
        if (curHead && (IN.has(curHead) || OUT.has(curHead))) {
          const first = item.children[0]
          if (first?.type === 'paragraph') {
            // The name is the leading run of name characters. Whatever follows (` — description`, `(note)`, `。…`) is description
            const raw = textOf(first.children).replace(/`/g, '').trim()
            const name = /^[\p{L}\p{N}][\p{L}\p{N}_-]*/u.exec(raw)?.[0] ?? raw
            ;(IN.has(curHead) ? doc.contractIn : doc.contractOut).push(name)
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
