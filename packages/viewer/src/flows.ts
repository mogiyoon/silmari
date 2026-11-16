// Two flow views beside the graph: A (spine) and B (swimlane). Both read the same graph `sil view` hands out and draw it as SVG text;
// the viewer puts the text in a pannable stage and selects a document when an element with `data-id` is clicked.
//   A spine     a flow's steps left → right in the order the document writes them; the documents each step calls hang below it;
//               a called flow nests inside its step; the entry point sits on top with a line into every flow it links; a document
//               called from more than one place is joined across those places
//   B swimlane  one lane per document, time left → right; a call drops from the caller's lane to the callee's, the answer comes back
// Measured on examples/pipeline and a real project (2026-09-26): the graph view shows who calls whom, column by call depth, so the
// order of a flow's steps had to be read from top-to-bottom placement.
// Only what the files say is drawn, with no judgement that could be wrong (2026-09-26):
//  - a flow is a task document that calls something; its steps are its top-level sections (the heading level right under its title,
//    whatever the document uses), all of them, in the order written. Contract sections are the notation's own and are left out.
//    Calls above the first section form an unnamed first step (—). A call under a sub-heading belongs to its section
//  - a called flow nests inside the step that calls it, as deep as the calls go; it stops only where a document would contain itself
//  - titles are shown as written
// A first version guessed more: steps only when a heading called something or was numbered (`3.`, `G.` but not `가.`), branches
// (two steps not using each other's values), loops (a document called again), routers (calls without values), a nesting limit and
// titles cut at ` — `. Each had cases it drew wrong (a hand-over through a file, a side effect, an either-or, a renamed value, a
// Korean numbering), and a drawn guess reads as a fact, so all of them were removed. A document called twice is the same document
// in two places, nothing more
import type { Graph, Edge as SilEdge, Node as SilNode } from '@silmari/core'

type Hd = SilNode['headings'][number]
export interface Step { h: Hd; calls: SilEdge[]; iso: boolean; exec: boolean }
export interface FlowModel {
  byId: Map<string, SilNode>; calls: SilEdge[]; title: (id: string) => string; stepsOf: (id: string) => Step[] | null
  /** flows nobody else's steps call */ roots: string[]; /** root → the configured entry points that link it */ pickers: Map<string, string[]>; entry: string[]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const tw = (s: string, px = 12) => [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e7f ? px : px * 0.58), 0)
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => (m.get(k) ?? m.set(k, []).get(k)!).push(v)

export function flowModel(g: Graph): FlowModel {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const calls = g.edges.filter((e) => (e.type === 'call' || e.type === 'mention') && e.from !== e.to)
  const title = (id: string) => byId.get(id)?.title ?? id.split('/').pop() ?? id
  const memo = new Map<string, Step[] | null>()
  const stepsOf = (id: string): Step[] | null => {
    if (memo.has(id)) return memo.get(id)!
    const n = byId.get(id); let r: Step[] | null = null
    const mine = calls.filter((e) => (e.declaredIn ?? e.from) === id)
    if (n && n.kind === 'task' && mine.length) {
      // The title is the first H1 (as the parser takes it); the sections are the shallowest level below it
      const titleLine = n.headings.find((h) => h.level === 1)?.line
      const below = n.headings.filter((h) => h.line !== titleLine)
      const level = Math.min(...below.map((h) => h.level))
      const secs = below.filter((h) => h.level === level)
      const at = (h: Hd | null, end: number) => {
        const start = h?.line ?? -Infinity
        const subs = n.headings.filter((x) => x.line > start && x.line < end)
        return { calls: mine.filter((e) => e.line > start && e.line < end), iso: !!h?.subagent || subs.some((x) => x.subagent), exec: !!h?.execution }
      }
      r = []
      const first = secs[0]?.line ?? Infinity
      const lead = at(null, first)
      if (lead.calls.length) r.push({ h: { level, text: '—', line: 0, subagent: false, body: '', range: { start: 0, end: 0 } } as Hd, ...lead })
      secs.forEach((h, i) => { if (!h.contract) r!.push({ h, ...at(h, secs[i + 1]?.line ?? Infinity) }) })
      if (!r.length) r = null // every call sits in a contract section: nothing to draw as steps
    }
    memo.set(id, r); return r
  }
  const flows = g.nodes.map((n) => n.id).filter((id) => stepsOf(id))
  const inner = new Set(calls.filter((e) => flows.includes(e.declaredIn ?? e.from)).map((e) => e.to))
  const roots = flows.filter((id) => !inner.has(id))
  // Only the configured entry points pick: their links are in the files and the config says what they are
  const entry = g.entry ?? []
  const pickers = new Map<string, string[]>()
  for (const e of g.edges) if (entry.includes(e.from) && roots.includes(e.to) && e.from !== e.to && !pickers.get(e.to)?.includes(e.from)) push(pickers, e.to, e.from)
  return { byId, calls, title, stepsOf, roots, pickers, entry }
}

export interface Drawn { svg: string; w: number; h: number }
const DEFS = `<defs>
<marker id="fv-an" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 L10 5 L0 10z" class="fv-mk-next"/></marker>
<marker id="fv-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10z" class="fv-mk-hang"/></marker>
<marker id="fv-ap" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10z" class="fv-mk-pick"/></marker>
<marker id="fv-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10z" class="fv-mk-ret"/></marker></defs>`

// ══ A: spine ════════════════════════════════════════════════════════════════════════════════════
const A = { STEP_H: 34, GAP_X: 46, CALL_GAP: 10, LEAF_H: 30, PAD: 10, INDENT: 16, HEAD_H: 40, LANE: 16 }
type Leaf = { kind: 'leaf'; id: string; file: boolean; w: number; h: number; t: string }
/** gap: room before this column, wide enough for the values carried into it (they were covered by the next pill at a fixed gap) */
type Col = { s: Step; kids: { e: SilEdge; b: Block }[]; w: number; h: number; pill: number; carry: string[]; gap: number }
type Spine = { kind: 'spine'; id: string; cols: Col[]; w: number; h: number; depth: number }
type Block = Leaf | Spine
type Box = { x: number; y: number; w: number; h: number }
type Reg = { at: Map<string, (Box & { top: string })[]>; frames: Map<string, Box>; top: string }

function blockA(M: FlowModel, id: string, depth: number, seen: Set<string>): Block {
  if (depth === 0 && !M.stepsOf(id)) { const t = M.title(id); return { kind: 'spine', id, cols: [], w: Math.max(160, tw(t, 14) + 40), h: A.HEAD_H + 6, depth } }
  const steps = !seen.has(id) ? M.stepsOf(id) : null
  if (!steps) { const file = !id.endsWith('.md'); const t = file ? id.split('/').pop() ?? id : M.title(id); return { kind: 'leaf', id, file, w: Math.max(96, tw(t) + 26), h: A.LEAF_H, t } }
  const next = new Set(seen).add(id)
  const col = (s: Step): Col => {
    const kids = s.calls.map((e) => ({ e, b: blockA(M, e.to, depth + 1, next) }))
    const pill = tw(s.h.text) + 24
    return { s, kids, pill, w: Math.max(pill, ...kids.map((k) => k.b.w + A.INDENT)), h: A.STEP_H + kids.reduce((a, k) => a + A.CALL_GAP + k.b.h, 0), carry: [], gap: 0 }
  }
  const received = new Set<string>()
  const cols = steps.map((s, i) => {
    const c = col(s)
    c.carry = [...new Set(s.calls.flatMap((e) => e.sends))].filter((v) => received.has(v))
    c.gap = i === 0 ? 0 : Math.max(A.GAP_X, c.carry.length ? tw(c.carry.join(' '), 10.5) + 28 : 0)
    for (const e of s.calls) for (const v of e.returns) received.add(v)
    return c
  })
  return { kind: 'spine', id, cols, depth, w: cols.reduce((a, c) => a + c.gap + c.w, 0) + A.PAD * 2, h: A.HEAD_H + Math.max(...cols.map((c) => c.h)) + A.PAD * 2 }
}

function drawA(M: FlowModel, b: Block, x: number, y: number, o: string[], reg: Reg) {
  const at = (id: string, box: Box) => push(reg.at, id, { ...box, top: reg.top })
  if (b.kind === 'leaf') {
    const cls = b.file ? 'fv-file' : M.byId.get(b.id)?.kind === 'ghost' ? 'fv-ghost' : 'fv-leaf'
    o.push(`<g class="${cls}" data-id="${esc(b.id)}"><title>${esc(b.id)}</title><rect x="${x}" y="${y}" width="${b.w}" height="${b.h}" rx="${b.file ? 15 : 6}"/><text x="${x + 12}" y="${y + 19}">${esc(b.t)}</text></g>`)
    at(b.id, { x, y, w: b.w, h: b.h }); return
  }
  o.push(`<g class="fv-spine fv-d${b.depth}"><rect class="fv-frame" x="${x}" y="${y}" width="${b.w}" height="${b.h}" rx="10"/><text class="fv-title" data-id="${esc(b.id)}" x="${x + A.PAD + 2}" y="${y + 24}">${esc(M.title(b.id))}<title>${esc(b.id)}</title></text>`)
  if (b.depth === 0) reg.frames.set(b.id, { x, y, w: b.w, h: b.h })
  at(b.id, { x, y, w: b.w, h: A.HEAD_H })
  const sy = y + A.HEAD_H, my = sy + A.STEP_H / 2
  let cx = x + A.PAD
  let prev: Box | null = null
  for (const c of b.cols) {
    cx += c.gap
    if (prev) {
      o.push(`<path class="fv-next" d="M${prev.x + prev.w + 2} ${my} H${cx - 3}" marker-end="url(#fv-an)"/>`)
      if (c.carry.length) o.push(`<text class="fv-carry" x="${prev.x + prev.w + 10}" y="${my - 6}">${esc(c.carry.join(' '))}</text>`)
    }
    const quiet = !c.s.calls.length && !c.s.exec
    o.push(`<g class="fv-step${c.s.iso ? ' iso' : ''}${c.s.exec ? ' exec' : ''}${quiet ? ' quiet' : ''}" data-id="${esc(b.id)}"><title>${esc(c.s.h.text)}</title><rect x="${cx}" y="${sy}" width="${c.pill}" height="${A.STEP_H}" rx="17"/><text x="${cx + 12}" y="${sy + 21}">${esc(c.s.h.text)}</text></g>`)
    let ky = sy + A.STEP_H
    for (const k of c.kids) {
      ky += A.CALL_GAP
      o.push(`<path class="fv-hang" d="M${cx + 8} ${sy + A.STEP_H} V${ky + Math.min(k.b.h, A.LEAF_H) / 2} H${cx + A.INDENT - 2}" marker-end="url(#fv-ah)"/>`)
      drawA(M, k.b, cx + A.INDENT, ky, o, reg)
      ky += k.b.h
    }
    prev = { x: cx, y: sy, w: c.pill, h: A.STEP_H }
    cx += c.w
  }
  o.push('</g>')
}

export function spineView(M: FlowModel, only?: Set<string>): Drawn {
  const roots = only ? M.roots.filter((r) => only.has(r)) : M.roots
  const blocks = (roots.length ? roots : M.roots).map((r) => blockA(M, r, 0, new Set()))
  const drawn = new Set(blocks.map((b) => b.id))
  const pickers = new Map([...M.pickers].filter(([t]) => drawn.has(t)))
  const pickerIds = [...new Set([...pickers.values()].flat())]
  // A document drawn in more than one place (called twice, or by two flows): measured first, since its lane widens the gutter
  const probe: Reg = { at: new Map(), frames: new Map(), top: '' }
  for (const b of blocks) { probe.top = b.id; drawA(M, b, 0, 0, [], probe) }
  const shared = [...probe.at].filter(([id, xs]) => id.endsWith('.md') && xs.length > 1).map(([id]) => id)
  const gx = 40 + (pickerIds.length + shared.length) * A.LANE
  const reg: Reg = { at: new Map(), frames: new Map(), top: '' }
  const o: string[] = []
  let y = pickerIds.length ? 70 : 20
  for (const b of blocks) { reg.top = b.id; drawA(M, b, gx, y, o, reg); y += b.h + 26 }
  const lines: string[] = []
  let px = gx
  const pickerBox = new Map<string, Box & { lane: number }>()
  pickerIds.forEach((id, k) => {
    const t = M.title(id), w = tw(t) + 26
    o.push(`<g class="fv-entry" data-id="${esc(id)}"><title>${esc(id)}</title><rect x="${px}" y="20" width="${w}" height="30" rx="15"/><text x="${px + 13}" y="39">${esc(t)}</text></g>`)
    pickerBox.set(id, { x: px, y: 20, w, h: 30, lane: 20 + k * A.LANE }); px += w + 30
  })
  for (const [target, ps] of pickers) for (const p of ps) {
    const pb = pickerBox.get(p); if (!pb) continue
    const tb = pickerBox.get(target)
    if (tb) { if (tb.x > pb.x) lines.push(`<path class="fv-pick" d="M${pb.x + pb.w} 35 H${tb.x - 3}" marker-end="url(#fv-ap)"/>`); continue }
    const frame = reg.frames.get(target), occ = reg.at.get(target)?.[0]
    const tgt = frame ? { x: frame.x, y: frame.y + 22 } : occ ? { x: reg.frames.get(occ.top)?.x ?? occ.x, y: occ.y + A.LEAF_H / 2 } : null
    if (!tgt) continue
    const lx = pb.lane
    lines.push(`<path class="fv-pick" d="M${pb.x + 14} 50 V58 Q${pb.x + 14} 62 ${pb.x + 10} 62 H${lx + 6} Q${lx} 62 ${lx} 68 V${tgt.y - 6} Q${lx} ${tgt.y} ${lx + 6} ${tgt.y} H${tgt.x - 3}" marker-end="url(#fv-ap)"/>`)
    if (!frame && occ) lines.push(`<rect class="fv-pickmark" x="${occ.x - 3}" y="${occ.y - 3}" width="${occ.w + 6}" height="${occ.h + 6}" rx="8"/>`)
  }
  shared.forEach((id, k) => {
    const lx = 20 + (pickerIds.length + k) * A.LANE, at = reg.at.get(id) ?? []
    if (at.length < 2) return
    const ys = at.map((p) => p.y + A.LEAF_H / 2)
    // no text label: it ran into the flows beside the narrow lane. The name shows on hover, and the joined boxes carry it
    lines.push(`<g><title>${esc(M.title(id))}</title><path class="fv-share fv-sharelane" d="M${lx} ${Math.min(...ys)} V${Math.max(...ys)}"/></g>`)
    for (const p of at) { const fx = reg.frames.get(p.top)?.x ?? p.x; lines.push(`<path class="fv-share" d="M${lx} ${p.y + A.LEAF_H / 2} H${fx - 2}"/><circle class="fv-sharedot" cx="${fx - 2}" cy="${p.y + A.LEAF_H / 2}" r="3"/><rect class="fv-sharemark" x="${p.x - 3}" y="${p.y - 3}" width="${p.w + 6}" height="${Math.min(p.h, A.LEAF_H) + 6}" rx="8"/>`) }
  })
  const w = Math.max(400, ...blocks.map((b) => b.w)) + gx + 40, h = y + 20
  return { w, h, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${DEFS}${o.join('')}${lines.join('')}</svg>` }
}

// ══ B: swimlane ═════════════════════════════════════════════════════════════════════════════════
type Ev = { kind: 'call'; from: string; to: string; sends: string[]; iso: boolean } | { kind: 'ret'; from: string; to: string; returns: string[] } | { kind: 'quiet' }
export function laneView(M: FlowModel, only?: Set<string>): Drawn {
  const COL = 92, LANE_H = 36, LABEL_W = 190, TOP = 56
  const roots = (only ? M.roots.filter((r) => only.has(r)) : M.roots).filter((r) => M.stepsOf(r))
  const o: string[] = []
  let y0 = 20, W = 400
  for (const root of roots.length ? roots : M.roots.filter((r) => M.stepsOf(r))) {
    const lanes = [root], events: Ev[] = [], marks: { at: number; text: string; quiet: boolean }[] = []
    const lane = (id: string) => { if (!lanes.includes(id)) lanes.push(id) }
    const walk = (id: string, depth: number, seen: Set<string>) => {
      for (const s of M.stepsOf(id) ?? []) {
        if (depth === 0) marks.push({ at: events.length, text: s.h.text, quiet: !s.calls.length })
        // a section that calls nothing still takes a column: without one, consecutive such sections stacked their names on one spot
        if (depth === 0 && !s.calls.length) events.push({ kind: 'quiet' })
        for (const e of s.calls) {
          lane(e.to)
          events.push({ kind: 'call', from: id, to: e.to, sends: e.sends, iso: s.iso })
          if (!seen.has(e.to) && M.stepsOf(e.to)) walk(e.to, depth + 1, new Set(seen).add(e.to))
          events.push({ kind: 'ret', from: e.to, to: id, returns: e.returns })
        }
      }
    }
    walk(root, 0, new Set([root]))
    // a return right after its own call shares the call's column
    const cols: number[] = []; let c = -1
    events.forEach((ev, i) => { const p = events[i - 1]; cols.push(ev.kind === 'ret' && p?.kind === 'call' && ev.from === p.to ? c : ++c) })
    const w = LABEL_W + (c + 1) * COL + 40, h = TOP + lanes.length * LANE_H + 20
    W = Math.max(W, w)
    const ly = (i: number) => y0 + TOP + i * LANE_H + LANE_H / 2
    const cx = (i: number) => LABEL_W + 20 + cols[i] * COL + COL / 2
    o.push(`<rect class="fv-frame" x="10" y="${y0}" width="${w - 20}" height="${h}" rx="10"/><text class="fv-title" data-id="${esc(root)}" x="24" y="${y0 + 24}">${esc(M.title(root))}</text>`)
    lanes.forEach((id, i) => {
      const file = !id.endsWith('.md'), t = file ? id.split('/').pop() ?? id : M.title(id)
      o.push(`<path class="fv-lane${i ? '' : ' own'}" d="M${LABEL_W + 14} ${ly(i)} H${w - 24}"/>`)
      o.push(`<g class="fv-lanelab${i ? '' : ' own'}${file ? ' file' : ''}" data-id="${esc(id)}"><title>${esc(id)}</title><rect x="24" y="${ly(i) - 12}" width="${LABEL_W - 16}" height="24" rx="${file ? 12 : 5}"/><text x="34" y="${ly(i) + 4}">${esc(t.length > 22 ? t.slice(0, 21) + '…' : t)}</text></g>`)
    })
    marks.forEach((m, k) => {
      const from = cols[m.at] ?? c + 1, to = k + 1 < marks.length ? (cols[marks[k + 1].at] ?? c + 1) - 1 : c
      const x0 = LABEL_W + 20 + from * COL + 4, x1 = LABEL_W + 20 + (Math.max(from, to) + 1) * COL - 4
      // cut by the width the text takes (Korean is about twice as wide as Latin), so a name never runs into the next one
      let label = m.text
      while (label.length > 1 && tw(label + (label === m.text ? '' : '…'), 11) > x1 - x0 - 6) label = label.slice(0, -1)
      if (label !== m.text) label += '…'
      o.push(`<g class="fv-bracket${m.quiet ? ' quiet' : ''}"><title>${esc(m.text)}</title><path d="M${x0} ${y0 + TOP - 8} V${y0 + TOP - 14} H${x1} V${y0 + TOP - 8}"/><text x="${x0 + 2}" y="${y0 + TOP - 18}">${esc(label)}</text></g>`)
    })
    events.forEach((ev, i) => {
      if (ev.kind === 'quiet') return
      const a = ly(lanes.indexOf(ev.from)), b = ly(lanes.indexOf(ev.to)), x = cx(i) + (ev.kind === 'ret' && cols[i] === cols[i - 1] ? 18 : -22)
      const more = (xs: string[]) => esc(xs.slice(0, 3).join(' ') + (xs.length > 3 ? '…' : ''))
      if (ev.kind === 'call') {
        o.push(`<path class="fv-bcall${ev.iso ? ' iso' : ''}" d="M${x} ${a + 6} V${b - (b > a ? 8 : -8)}" marker-end="url(#fv-an)"/><circle class="fv-dot" cx="${x}" cy="${a}" r="3.5"/>`)
        if (ev.sends.length) o.push(`<text class="fv-carry" x="${x + 4}" y="${a + 16}">${more(ev.sends)}</text>`)
      } else {
        o.push(`<path class="fv-bret" d="M${x} ${a - (b > a ? -6 : 6)} V${b + (b > a ? -8 : 8)}" marker-end="url(#fv-ar)"/>`)
        if (ev.returns.length) o.push(`<text class="fv-ret" x="${x + 4}" y="${b - 5}">${more(ev.returns)}</text>`)
      }
    })
    y0 += h + 26
  }
  return { w: W, h: y0, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y0}" viewBox="0 0 ${W} ${y0}">${DEFS}${o.join('')}</svg>` }
}
