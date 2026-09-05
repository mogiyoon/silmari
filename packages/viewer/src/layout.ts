// Left-to-right layout. Set coordinates in call order from the root. Do not change edge order (INV-D4).
// Reserve space between columns for labels (send/receive/condition/anchor). Keep them clear of nodes and other labels.
// (dagre was removed because it changes call order to reduce crossings.)
import type { Graph, Edge as SilEdge, Node as SilNode } from '@silmari/core'

// Base heights fit a button bar plus a one-line title and file name. Titles wrap, so the viewer reports real heights (LayoutOpts.heights)
export const SIZE = { task: { w: 200, h: 84 }, doc: { w: 170, h: 76 }, ghost: { w: 170, h: 56 } } as const
/** Heading box inside an expanded node */
export const SEC_W = 260, SEC_H = 66, SEC_GAP = 8, OPEN_HEAD = 70, OPEN_PAD = 12
const LINE_H = 14, PAD = 8, GAP = 6

/** Heading box height. Estimate how many lines the title wraps to (12px font: Korean ≈ 12, ASCII ≈ 6.5). The body appears in the right panel */
const SEC_LINE = 17, SEC_PADV = 14
export function secHeight(h: { text: string; level: number; subagent: boolean }): number {
  const title = [...`${'#'.repeat(h.level)} ${h.text}`].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e7f ? 12 : 6.5), 0)
  const extras = 40 /* :line number · N calls */ + (h.subagent ? 92 : 0) /* badge */
  const lines = Math.max(1, Math.ceil((title + extras) / (SEC_W - 24)))
  return SEC_PADV + lines * SEC_LINE
}
/** Node size. Collapsed size is fixed by kind. Expanded size grows with the heading boxes */
export function nodeSize(n: SilNode, open: boolean): { w: number; h: number } {
  if (!open || n.kind === 'ghost') return SIZE[n.kind]
  const stack = n.headings.length ? n.headings.reduce((s, h) => s + secHeight(h) + SEC_GAP, 0) - SEC_GAP : SEC_PADV + SEC_LINE
  return { w: SEC_W + OPEN_PAD * 2, h: OPEN_HEAD + stack + OPEN_PAD }
}
/** Position of heading box i inside an expanded node, relative to its parent */
export function secPos(n: SilNode, i: number): { x: number; y: number } {
  let y = OPEN_HEAD
  for (let j = 0; j < i; j++) y += secHeight(n.headings[j]) + SEC_GAP
  return { x: OPEN_PAD, y }
}

/** One label row. Send/receive uses a small tagged box. Condition and anchor show text only */
export interface LabelRow { kind: 'send' | 'ret' | 'under' | 'anchor'; tag: string | null; text: string }
const TAG_W = 58
export function edgeLabelRows(e: SilEdge, tags: { send: string; ret: string } = { send: 'send', ret: 'receive' }): LabelRow[] {
  const rows: LabelRow[] = []
  if (e.sends.length) rows.push({ kind: 'send', tag: tags.send, text: e.sends.join(', ') })
  if (e.returns.length) rows.push({ kind: 'ret', tag: tags.ret, text: e.returns.join(', ') })
  if (e.under.length > 1) rows.push({ kind: 'under', tag: null, text: e.under[e.under.length - 1] })
  if (e.anchor) rows.push({ kind: 'anchor', tag: null, text: `#${e.anchor}` })
  return rows
}
export const edgeLabelLines = (e: SilEdge) => edgeLabelRows(e).map((r) => (r.tag ? `${r.tag} ` : '') + r.text)
/** Estimated text width. At 10.5px, Korean ≈ 10.5 and ASCII ≈ 6 */
const textW = (s: string) => [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e7f ? 10.5 : 6), 0)
export function labelBox(e: SilEdge): { w: number; h: number } {
  const rows = edgeLabelRows(e)
  if (!rows.length && !e.isolated) return { w: 0, h: 0 }
  // Head (condition heading + subagent badge) / body (fixed tag width + value chips) / foot (anchor)
  const under = rows.find((r) => r.kind === 'under'), anchor = rows.find((r) => r.kind === 'anchor')
  const head = under || e.isolated ? 22 : 0
  const headW = (under ? textW(under.text) + 8 : 0) + (e.isolated ? 92 : 0)
  // Three sections: head / anchor / body. A divider separates them
  const body = rows.filter((r) => r.tag)
  const bodyW = Math.max(0, ...body.map((r) => TAG_W + 8 + r.text.split(', ').reduce((s, v) => s + textW(v) + 12 + 4, 0)))
  const anchorH = anchor ? 20 : 0
  const top = 21, topW = textW('→ ' + e.to) // Top: target md
  const w = Math.max(topW, headW, bodyW, anchor ? textW(anchor.text) : 0)
  return { w: w + PAD * 2, h: top + head + anchorH + (body.length ? body.length * (LINE_H + 6) + 4 : 0) + PAD }
}

export interface Placed {
  nodes: Map<string, { x: number; y: number }>
  /** Edge index (position in g.edges) → center coordinates of its label */
  labels: Map<number, { x: number; y: number }>
  /** Index of an edge that creates a cycle (a back edge). The second edge in document A → B → A */
  cycles: Set<number>
  /** Index of an edge within one column. It loops in from the right */
  sameCol: Set<number>
}

const NODESEP = 18, RANK_MARGIN = 34, MARGIN = 20

/**
 * Lay out calls from the root in call order. dagre changes the order to reduce crossings, but call order matters here.
 *  1. Starting at roots (nodes with no incoming edges), run depth-first search in edge order (= line order, INV-D4). This gives discovery order
 *  2. Column (rank) = shortest path depth from a root (minimum deps). A direct child of a root stays in the first column even if another child calls it
 *  3. Within a column, place nodes from top to bottom in discovery order. Start at the height of the first caller (steps)
 *  4. Reserve enough space between columns for the widest label crossing that gap. Center labels in the gap and push them down to prevent overlap
 */
/**
 * @param sizes Actual rendered label sizes by edge index. Measure after the first render and pass them in to prevent overlap instead of using estimates
 */
/**
 * @param pinned Positions where the user dragged nodes. Labels on their edges follow the nodes instead of staying between columns.
 *   If a label stays in its old position, the line takes a long detour. One label between two nodes that call each other also becomes hidden
 */
const GRID_GAP = 120

/** How labels are ordered next to a parent's children. 'children': each label at its child's height (repeat calls grouped on that child). 'flow': strictly in the parent's line order, top to bottom */
export type LabelOrder = 'flow' | 'children'
export interface LayoutOpts { labelOrder?: LabelOrder; heights?: Map<string, number> /* measured heights of collapsed nodes (titles wrap) */ }

/**
 * Disconnected graphs go into separate grid cells. Two unrelated flows A and B become row 1 column 1 and row 1 column 2.
 * Anything connected by at least one edge shares a cell. Single nodes with no edges (orphan references) are gathered into one last cell.
 * The cell that holds the configured entry point comes first, then bigger components. Columns = ceil(sqrt(cells)), row-major.
 */
/** A cell of the grid: one connected part of the graph (or all single unlinked nodes gathered as the last cell). Same order as the grid */
export interface Cell { key: string; nodes: string[]; entry: boolean; singles: boolean; /** the flow's root: the entry point, else the node nobody calls that calls the most */ root: string }
export function cells(g: Graph, visible: Set<string>): Cell[] {
  const ids = g.nodes.filter((n) => visible.has(n.id)).map((n) => n.id)
  const parent = new Map(ids.map((id) => [id, id])), size = new Map(ids.map((id) => [id, 1]))
  // union-find with full path compression and union by size: 50k edges stay linear (a plain chain walk took seconds on 47k files)
  const find = (a: string): string => { let r = a; while (parent.get(r) !== r) r = parent.get(r)!; let x = a; while (x !== r) { const nx = parent.get(x)!; parent.set(x, r); x = nx } return r }
  const union = (a: string, b: string) => { let ra = find(a), rb = find(b); if (ra === rb) return; if (size.get(ra)! < size.get(rb)!) [ra, rb] = [rb, ra]; parent.set(rb, ra); size.set(ra, size.get(ra)! + size.get(rb)!) }
  for (const e of g.edges) if (visible.has(e.from) && visible.has(e.to) && e.from !== e.to) union(e.from, e.to)
  const groups = new Map<string, string[]>()
  for (const id of ids) (groups.get(find(id)) ?? groups.set(find(id), []).get(find(id))!).push(id)
  const singles = [...groups.values()].filter((c) => c.length === 1).flat()
  const entry = g.entry?.find((id) => visible.has(id))
  const rootOf = (c: string[]) => {
    if (entry && c.includes(entry)) return entry
    const set = new Set(c), inn = new Set<string>(), outs = new Map<string, number>()
    for (const e of g.edges) if (set.has(e.from) && set.has(e.to) && e.from !== e.to) { inn.add(e.to); outs.set(e.from, (outs.get(e.from) ?? 0) + 1) }
    const roots = c.filter((id) => !inn.has(id)).sort((a, b) => (outs.get(b) ?? 0) - (outs.get(a) ?? 0))
    return roots[0] ?? c[0]
  }
  const titleOf = (c: string[]) => { const r = rootOf(c); return g.nodes.find((n) => n.id === r)?.title ?? r }
  // Entry flow first, then bigger flows, then by name with numbers read as numbers (Flow 2 before Flow 10)
  const comps = [...groups.values()].filter((c) => c.length > 1).sort((a, b) => Number(b.includes(entry ?? '')) - Number(a.includes(entry ?? '')) || b.length - a.length || titleOf(a).localeCompare(titleOf(b), undefined, { numeric: true }))
  const out: Cell[] = comps.map((c) => { const root = rootOf(c); return { key: root, nodes: c, entry: !!entry && c.includes(entry), singles: false, root } })
  if (singles.length) out.push({ key: 'singles', nodes: singles, entry: false, singles: true, root: singles[0] })
  return out
}

export function layout(g: Graph, visible: Set<string>, open: Set<string> = new Set(), sizes?: Map<number, { w: number; h: number }>, pinned: Record<string, { x: number; y: number }> = {}, opts: LayoutOpts = {}): Placed {
  const ids = g.nodes.filter((n) => visible.has(n.id)).map((n) => n.id)
  const comps = cells(g, visible).map((c) => c.nodes)
  if (comps.length <= 1) return layoutOne(g, ids, open, sizes, pinned, { x: 0, y: 0 }, opts).placed
  // Pass 1: size each cell. Pass 2: place each cell at its grid origin (dragged nodes only matter for labels, so pass 1 ignores them)
  const boxes = comps.map((c) => layoutOne(g, c, open, sizes, {}, { x: 0, y: 0 }, opts).box)
  const cols = Math.ceil(Math.sqrt(comps.length))
  const colW: number[] = [], rowH: number[] = []
  boxes.forEach((b, k) => { const c = k % cols, r = Math.floor(k / cols); colW[c] = Math.max(colW[c] ?? 0, b.w); rowH[r] = Math.max(rowH[r] ?? 0, b.h) })
  const colX = colW.map((_, c) => colW.slice(0, c).reduce((a, w) => a + w + GRID_GAP, 0))
  const rowY = rowH.map((_, r) => rowH.slice(0, r).reduce((a, h) => a + h + GRID_GAP, 0))
  const out: Placed = { nodes: new Map(), labels: new Map(), cycles: new Set(), sameCol: new Set() }
  comps.forEach((c, k) => {
    const { placed } = layoutOne(g, c, open, sizes, pinned, { x: colX[k % cols], y: rowY[Math.floor(k / cols)] }, opts)
    for (const [id, p] of placed.nodes) out.nodes.set(id, p)
    for (const [i, p] of placed.labels) out.labels.set(i, p)
    for (const i of placed.cycles) out.cycles.add(i)
    for (const i of placed.sameCol) out.sameCol.add(i)
  })
  return out
}

/** Lays out one connected part (the node ids given) starting at `origin`. Returns absolute positions and the box the part occupies */
/** The call tree of one part: discovery order, roots, back edges, column (BFS depth from a root) and the BFS parent that gave each
 *  node its column. Layout, and collapsing subtrees in the viewer, both work from this */
export interface Skeleton { edges: { e: SilEdge; i: number }[]; sorted: string[]; rank: Map<string, number>; parent: Map<string, string>; kids: Map<string, string[]>; back: Set<number>; sameCol: Set<number> }
export function skeleton(g: Graph, ids: string[]): Skeleton {
  const idSet = new Set(ids)
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const edges = g.edges.map((e, i) => ({ e, i })).filter(({ e }) => idSet.has(e.from) && idSet.has(e.to) && e.from !== e.to)
  const outOf = new Map<string, typeof edges>()
  for (const x of edges) (outOf.get(x.e.from) ?? outOf.set(x.e.from, []).get(x.e.from)!).push(x)
  const hasIn = new Set(edges.map((x) => x.e.to))

  // 1. Discovery order and first caller
  const order = new Map<string, number>(), firstCaller = new Map<string, string>()
  const back = new Set<number>() // Back edge indexes
  const onStack = new Set<string>()
  const visit = (id: string) => {
    order.set(id, order.size); onStack.add(id)
    for (const { e, i } of outOf.get(id) ?? []) {
      if (onStack.has(e.to)) { back.add(i); continue }
      if (!order.has(e.to)) { firstCaller.set(e.to, id); visit(e.to) }
    }
    onStack.delete(id)
  }
  // Roots: place configured entry points in order, then nodes with no incoming edges. Do not hide orphan references
  const entry = (g.entry ?? []).filter((id) => idSet.has(id))
  const roots = [...entry, ...ids.filter((id) => !hasIn.has(id) && !entry.includes(id)).sort((a, b) => (outOf.get(b)?.length ?? 0) - (outOf.get(a)?.length ?? 0) || (a < b ? -1 : 1))]
  for (const r of roots) if (!order.has(r)) visit(r)
  // A cycle-only group (A → B → C → A) has no node without incoming edges. Start with the node called from the caller's latest section:
  // A return call is usually under a later condition heading (`## 지적이 크면`). A forward call is in an earlier section
  const secIndex = (e: SilEdge) => {
    const hs = byId.get(e.from)!.headings.filter((h) => h.level > 1)
    let i = -1; hs.forEach((h, k) => { if (h.line <= e.line) i = k }); return i
  }
  const lateness = (id: string) => Math.min(...edges.filter(({ e }) => e.to === id).map(({ e }) => secIndex(e)))
  const rest = ids.filter((id) => !order.has(id)).sort((a, b) => lateness(b) - lateness(a) || (outOf.get(b)?.length ?? 0) - (outOf.get(a)?.length ?? 0) || (a < b ? -1 : 1))
  for (const id of rest) if (!order.has(id)) visit(id)

  // 2. Column = shortest path from a root (BFS). Keep direct children of a root in the first column even if their child calls them again
  const rank = new Map<string, number>()
  const parent = new Map<string, string>() // The caller that gave a node its column. Always one column to the left
  const sorted = [...ids].sort((a, b) => order.get(a)! - order.get(b)!)
  // Process starting points one at a time. A later start does not move nodes reached from an earlier start back to column 0 (cycle group: planning → implementation → review)
  const starts = [...roots, ...rest].filter((id) => ids.includes(id))
  for (const s of starts) {
    if (rank.has(s)) continue
    rank.set(s, 0)
    const queue = [s]
    while (queue.length) {
      const id = queue.shift()!
      for (const { e } of outOf.get(id) ?? []) if (!rank.has(e.to)) { rank.set(e.to, rank.get(id)! + 1); parent.set(e.to, id); queue.push(e.to) }
    }
  }
  for (const id of sorted) if (!rank.has(id)) rank.set(id, 0)
  // Edges within one column loop in from the right. The viewer uses the target node's right handle
  const sameCol = new Set(edges.filter(({ e }) => rank.get(e.from) === rank.get(e.to)).map(({ i }) => i))
  const kids = new Map<string, string[]>()
  for (const id of sorted) { const p = parent.get(id); if (p) (kids.get(p) ?? kids.set(p, []).get(p)!).push(id) }
  return { edges, sorted, rank, parent, kids, back, sameCol }
}

function layoutOne(g: Graph, ids: string[], open: Set<string>, sizes: Map<number, { w: number; h: number }> | undefined, pinned: Record<string, { x: number; y: number }>, origin: { x: number; y: number }, opts: LayoutOpts = {}): { placed: Placed; box: { w: number; h: number } } {
  const boxOf = (i: number) => sizes?.get(i) ?? labelBox(g.edges[i])
  const idSet = new Set(ids)
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  // Always use expanded width so expansion does not move nearby columns. Use current height. Expansion moves only lower nodes
  const size = (id: string) => ({ w: nodeSize(byId.get(id)!, true).w, h: open.has(id) ? nodeSize(byId.get(id)!, true).h : (opts.heights?.get(id) ?? nodeSize(byId.get(id)!, false).h) })
  const { edges, sorted, rank, parent: bfsParent, kids, back, sameCol } = skeleton(g, ids)

  // 4. Column widths and label widths between columns
  const cols = Math.max(0, ...[...rank.values()]) + 1
  const colW = Array.from({ length: cols }, () => 0)
  for (const id of ids) colW[rank.get(id)!] = Math.max(colW[rank.get(id)!], size(id).w)
  const gapW = Array.from({ length: cols }, () => 0) // gapW[r] = between columns r and r+1
  const labelOf = new Map<number, { w: number; h: number }>()
  for (const { e, i } of edges) {
    const b = boxOf(i); if (!b.h) continue
    labelOf.set(i, b)
    const lo = Math.min(rank.get(e.from)!, rank.get(e.to)!), hi = Math.max(rank.get(e.from)!, rank.get(e.to)!)
    const gi = lo // For one-column edges, use the gap to that column's right (hi === lo)
    void hi
    gapW[gi] = Math.max(gapW[gi], b.w)
  }
  const colX: number[] = []
  let x = MARGIN + origin.x
  for (let r = 0; r < cols; r++) { colX[r] = x; x += colW[r] + RANK_MARGIN + (gapW[r] ? gapW[r] + RANK_MARGIN : RANK_MARGIN) }

  // 3. Vertical layout: a parent sits at the vertical center of the block its children occupy, and the children keep call order.
  //    A with a1..a4 forms one rectangle (A centered on the left, a1..a4 top-down on the right); B with b1..b3 forms the next one below.
  //    The tree is the BFS parent (the caller that gave the node its column). A node called by two parents stays under the first one.
  const blockH = new Map<string, number>()
  // A child's slot is also tall enough for the labels of the calls from its parent, so each label can sit at its child's height.
  // In 'flow' order only the first call's label sits at the child (later calls line up below in line order), so the slot holds one label
  // and the parent's block instead grows to fit the whole label column
  const flow = opts.labelOrder === 'flow'
  const labelsH = (id: string) => { const p = bfsParent.get(id); let h = -GAP; for (const { e, i } of edges) if (e.from === p && e.to === id && labelOf.has(i)) { h += labelOf.get(i)!.h + GAP; if (flow) break } return h }
  const labelStack = (id: string) => { const ks = new Set(kids.get(id) ?? []); let h = -GAP; for (const { e, i } of edges) if (e.from === id && ks.has(e.to) && labelOf.has(i)) h += labelOf.get(i)!.h + GAP; return h }
  const measure = (id: string): number => {
    const ks = kids.get(id) ?? []
    const h = Math.max(size(id).h, labelsH(id), ks.reduce((a, k) => a + measure(k), 0) + Math.max(0, ks.length - 1) * NODESEP, flow ? labelStack(id) : 0)
    blockH.set(id, h); return h
  }
  const nodes = new Map<string, { x: number; y: number }>()
  const place = (id: string, top: number) => {
    nodes.set(id, { x: colX[rank.get(id)!], y: top + (blockH.get(id)! - size(id).h) / 2 })
    let cur = top
    for (const k of kids.get(id) ?? []) { place(k, cur); cur += blockH.get(k)! + NODESEP }
  }
  let top = MARGIN + origin.y
  for (const id of sorted) if (!bfsParent.has(id)) { measure(id); place(id, top); top += blockH.get(id)! + NODESEP }

  // Start labels at the gap's center x and the average center y of both nodes. Push down on overlap.
  // Edges of dragged nodes (pinned) follow their actual positions. Center the label if it fits between the nodes. Otherwise, put it to the right.
  // Resolve remaining overlaps with one rule. Place from the top. On horizontal overlap, push below the earlier label
  const at = (id: string) => pinned[id] ?? nodes.get(id)!
  const center = (id: string) => { const p = at(id), s = size(id); return { x: p.x + s.w / 2, y: p.y + s.h / 2 } }
  const want: { i: number; sy: number; x: number; y: number; b: { w: number; h: number } }[] = []
  for (const { e, i } of edges) {
    const b = labelOf.get(i); if (!b) continue
    const lo = Math.min(rank.get(e.from)!, rank.get(e.to)!)
    // A label for a call one column to the right sits at the height of the node it goes to, so a parent's labels line up with its children
    // inside the same rectangle, in call order. Other edges (same column, back edges) sit at the midpoint of both ends
    const forward = rank.get(e.to) === rank.get(e.from)! + 1
    const y = forward ? center(e.to).y : (center(e.from).y + center(e.to).y) / 2
    let x = colX[lo] + colW[lo] + RANK_MARGIN + gapW[lo] / 2
    if (pinned[e.from] || pinned[e.to]) {
      const fromR = at(e.from).x + size(e.from).w, toL = at(e.to).x, toR = toL + size(e.to).w
      x = toL - fromR >= b.w + 2 * GAP ? (fromR + toL) / 2 : Math.max(fromR, toR) + RANK_MARGIN + b.w / 2
    }
    want.push({ i, sy: center(e.from).y, x, y, b })
  }
  // Labels follow the child order (their target's height). Several calls from the same parent to the same child are stacked as one
  // group centered on that child, in line order, so they stay inside the child's slot instead of pushing the next label down
  const groups = new Map<string, typeof want>()
  for (const l of want) { const e = g.edges[l.i]; if (rank.get(e.to) === rank.get(e.from)! + 1 && !pinned[e.from] && !pinned[e.to]) (groups.get(`${e.from}>${e.to}`) ?? groups.set(`${e.from}>${e.to}`, []).get(`${e.from}>${e.to}`)!).push(l) }
  if (opts.labelOrder !== 'flow') for (const ls of groups.values()) {
    if (ls.length < 2) continue
    ls.sort((a, b) => a.i - b.i)
    const total = ls.reduce((a, l) => a + l.b.h, 0) + (ls.length - 1) * GAP
    let cur = ls[0].y - total / 2
    for (const l of ls) { l.y = cur + l.b.h / 2; cur += l.b.h + GAP }
  }
  // 'flow': the parent's line order wins. A label never rises above one from an earlier line of the same document (1·2·3·4·5·6 top to
  // bottom). Only within one label column: a reference drawn in another column (a back reference to the caller's caller, say) cannot
  // overlap these labels, so it must not push them down either
  if (opts.labelOrder === 'flow') {
    const lastOf = new Map<string, number>()
    for (const l of [...want].sort((a, b) => a.i - b.i)) {
      const key = `${g.edges[l.i].from}@${Math.round(l.x)}`, floor = lastOf.get(key)
      if (floor !== undefined && l.y - l.b.h / 2 < floor) l.y = floor + l.b.h / 2
      lastOf.set(key, l.y + l.b.h / 2 + GAP)
    }
  }
  want.sort((a, b) => a.y - b.y || a.i - b.i)
  const labels = new Map<number, { x: number; y: number }>()
  const put: { x: number; w: number; bottom: number }[] = []
  for (const l of want) {
    let top = l.y - l.b.h / 2
    for (const p of put) if (Math.abs(l.x - p.x) < (l.b.w + p.w) / 2) top = Math.max(top, p.bottom + GAP)
    labels.set(l.i, { x: l.x, y: top + l.b.h / 2 })
    put.push({ x: l.x, w: l.b.w, bottom: top + l.b.h })
  }
  // The box this part occupies, measured from the origin (nodes and labels)
  let right = origin.x, bottom = origin.y
  for (const [id, p] of nodes) { const s = size(id); right = Math.max(right, p.x + s.w); bottom = Math.max(bottom, p.y + s.h) }
  for (const [i, p] of labels) { const b = labelOf.get(i)!; right = Math.max(right, p.x + b.w / 2); bottom = Math.max(bottom, p.y + b.h / 2) }
  return { placed: { nodes, labels, cycles: back, sameCol }, box: { w: right - origin.x + MARGIN, h: bottom - origin.y + MARGIN } }
}
