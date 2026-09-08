// Builds packages/cli/README.md (what npm shows) from the repository README, so the two cannot drift.
//
//   node tools/readme.mjs            write packages/cli/README.md
//   node tools/readme.mjs --check    exit 1 when the committed file differs from what would be written
//
// The repository README is the only source. A section is chosen by the HTML comment on the line after its `## ` heading:
//   <!-- npm -->         the whole section goes to npm
//   <!-- npm: link -->   only the heading and a line that links to the section on GitHub
//   (no comment)         the section stays on GitHub only
// Everything before the first `## ` heading always goes. Relative links and images become absolute GitHub URLs, so they
// work on the npm page; anchors to sections that were not chosen point at GitHub too. Code fences are left as they are.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = 'https://github.com/mogiyoon/silmari'
const BLOB = `${REPO}/blob/main/`
const RAW = 'https://raw.githubusercontent.com/mogiyoon/silmari/main/'
const root = resolve(import.meta.dirname, '..')
const SRC = resolve(root, 'README.md')
const OUT = resolve(root, 'packages/cli/README.md')

/** The slug GitHub gives a heading: lower case, punctuation removed, spaces to hyphens */
const slug = (h) => h.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-')

/** Splits the README into the head and its `## ` sections, each with the marker on the line after the heading */
function sections(text) {
  const lines = text.split('\n')
  const out = []
  let cur = { heading: null, marker: null, lines: [] }
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (/^```/.test(ln)) fence = !fence
    if (!fence && /^## /.test(ln)) {
      out.push(cur)
      const m = /^<!--\s*npm(?::\s*(\w+))?\s*-->\s*$/.exec(lines[i + 1] ?? '')
      cur = { heading: ln.slice(3).trim(), marker: m ? (m[1] ?? 'full') : null, lines: [ln] }
      if (m) i++ // the marker line itself is not copied
      continue
    }
    cur.lines.push(ln)
  }
  out.push(cur)
  return out
}

/** Rewrites relative links and images outside code fences and outside inline code (notation examples such as `[research](research.md)` stay) */
function absolutize(lines, kept) {
  const link = (s) => s
    .replace(/!\[([^\]]*)\]\((?!https?:|#)([^)]+)\)/g, (_, alt, p) => `![${alt}](${RAW}${p})`)
    .replace(/(?<!!)\[([^\]]*)\]\(#([^)]+)\)/g, (_, t, a) => (kept.has(a) ? `[${t}](#${a})` : `[${t}](${REPO}#${a})`))
    .replace(/(?<!!)\[([^\]]*)\]\((?!https?:|#|mailto:)([^)]+)\)/g, (_, t, p) => `[${t}](${BLOB}${p})`)
    .replace(/src="(?!https?:)([^"]+)"/g, (_, p) => `src="${RAW}${p}"`)
  let fence = false
  return lines.map((ln) => {
    if (/^```/.test(ln)) { fence = !fence; return ln }
    if (fence) return ln
    return ln.split(/(`[^`]*`)/).map((part, i) => (i % 2 ? part : link(part))).join('')
  })
}

export function build(text = readFileSync(SRC, 'utf8')) {
  const secs = sections(text)
  const kept = new Set(secs.filter((s) => s.heading && s.marker).map((s) => slug(s.heading)))
  const body = []
  for (const s of secs) {
    if (s.heading === null) { body.push(...s.lines); continue }
    if (s.marker === 'full') body.push(...s.lines)
    else if (s.marker === 'link') body.push(s.lines[0], '', `See [${s.heading}](${REPO}#${slug(s.heading)}) in the repository README.`, '')
  }
  const head = '<!-- Generated from README.md at the repository root by tools/readme.mjs. Edit that file, then run: pnpm readme -->'
  const tail = `Full guide, rule list, and the graph's controls: ${REPO}`
  const text2 = [head, ...absolutize(body, kept), tail].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
  return text2
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const want = build()
  if (process.argv.includes('--check')) {
    let have = ''
    try { have = readFileSync(OUT, 'utf8') } catch { /* missing counts as stale */ }
    if (have !== want) { console.error('packages/cli/README.md is out of date. Run: pnpm readme'); process.exit(1) }
    console.log('packages/cli/README.md is up to date')
  } else {
    writeFileSync(OUT, want)
    console.log(`Wrote ${OUT} (${want.split('\n').length} lines)`)
  }
}
