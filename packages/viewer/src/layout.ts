// Left-to-right layout. Set coordinates in call order from the root. Do not change edge order (INV-D4).
// Reserve space between columns for labels (send/receive/condition/anchor). Keep them clear of nodes and other labels.
// (dagre was removed because it changes call order to reduce crossings.)
import type { Graph, Edge as SilEdge, Node as SilNode } from '@silmari/core'

// Base heights fit a button bar plus a one-line title and file name. Titles wrap, so the viewer reports real heights (LayoutOpts.heights)
export const SIZE = {
  task: { w: 200, h: 84 }, doc: { w: 170, h: 76 }, file: { w: 170, h: 56 }, ghost: { w: 170, h: 56 },
} as const
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
  if (!open || n.kind === 'ghost' || n.kind === 'file') return SIZE[n.kind]
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
export interface LabelRow { kind: 'send' | 'ret' | 'tools' | 'model' | 'under' | 'anchor' | 'relation'; tag: string | null; text: string }
const TAG_W = 58
export function edgeLabelRows(e: SilEdge, tags: { send: string; ret: string; tools: string; model: string; write?: string; read?: string } = { send: 'send', ret: 'receive', tools: 'tools', model: 'model' }): LabelRow[] {
  const rows: LabelRow[] = []
  if (e.sends.length) rows.push({ kind: 'send', tag: e.type === 'write' ? (tags.write ?? 'write') : tags.send, text: e.sends.join(', ') })
  if (e.returns.length) rows.push({ kind: 'ret', tag: e.type === 'read' ? (tags.read ?? 'import') : tags.ret, text: e.returns.join(', ') })
  // Tools and model belong to the call, so they sit on the edge label, not on the node (a file may be called with different ones)
  if (e.tools?.length) rows.push({ kind: 'tools', tag: tags.tools, text: e.tools.join(', ') })
  if (e.model) rows.push({ kind: 'model', tag: tags.model, text: e.model })
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
  // Head (source heading → target heading, subagent badge) / body (fixed tag width + value chips)
  const under = rows.find((r) => r.kind === 'under'), anchor = rows.find((r) => r.kind === 'anchor'), relation = rows.find((r) => r.kind === 'relation')
  const head = under || anchor || e.isolated ? 22 : 0
  const headW = (under ? textW('## ' + under.text) + 8 : 0) + (anchor ? textW(' → ## ' + anchor.text) : 0) + (e.isolated ? 92 : 0) + (e.noRules ? 78 : 0)
  // Tools and model: one line of solid chips under the head
  // One row for the model, one for the tools; each row is a label and its chips
  const runRows = (e.model ? 1 : 0) + (e.tools?.length ? 1 : 0)
  const run = runRows ? runRows * (LINE_H + 6) + 4 : 0
  const runW = Math.max(e.model ? TAG_W + 8 + textW(e.model) + 16 : 0, e.tools?.length ? TAG_W + 8 + e.tools.reduce((s, v) => s + textW(v) + 16, 0) : 0)
  // Sections: head / run chips / anchor / body. A divider separates them
  const body = rows.filter((r) => r.kind === 'send' || r.kind === 'ret')
  const bodyW = Math.max(0, ...body.map((r) => TAG_W + 8 + r.text.split(', ').reduce((s, v) => s + textW(v) + 12 + 4, 0)))
  const anchorH = 0, relationH = relation ? 20 : 0 // the anchor sits on the head line now
  const top = relation ? 0 : 21, topW = relation ? 0 : textW(e.from + ' → ' + e.to) // Provenance lines name the relation, not a generated internal id
  const w = Math.max(topW, headW, runW, bodyW, anchor ? textW(anchor.text) : 0, relation ? textW(relation.text) : 0)
  return { w: w + PAD * 2, h: top + head + run + anchorH + relationH + (body.length ? body.length * (LINE_H + 6) + 4 : 0) + PAD }
}

export interface Placed {
  nodes: Map<string, { x: number; y: number }>
  /** Edge index (position in g.edges) → center coordinates of its label */
  labels: Map<number, { x: number; y: number }>
  /** Returned output follows a clear four-bend corridor. Coordinates are in graph space. */
  returnRoutes: Map<number, { outX: number; inX: number; y: number; r: number }>
  /** Imported file data (read edges) comes in from above: out of the file's right side, along the empty row the layout keeps at the
   *  top of the reader's block (y), then down through the stacked import labels into the reader's top */
  readRoutes: Map<number, { outX: number; y: number; drop?: boolean }> // drop: the file stands right above the reader and the line falls straight through the label
  /** Node → x of its right edge at the expanded width its column reserves. Vertical runs start from here, so a collapsed node's
   *  line does not cut through an expanded neighbour */
  right: Map<string, number>
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
    const kind = new Map(g.nodes.map((n) => [n.id, n.kind]))
    const roots = c.filter((id) => !inn.has(id)).sort((a, b) => Number(kind.get(a) === 'file') - Number(kind.get(b) === 'file') || (outs.get(b) ?? 0) - (outs.get(a) ?? 0)) // a file that is only imported is not the flow's name
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
  const out: Placed = { nodes: new Map(), labels: new Map(), returnRoutes: new Map(), readRoutes: new Map(), right: new Map(), cycles: new Set(), sameCol: new Set() }
  comps.forEach((c, k) => {
    const { placed } = layoutOne(g, c, open, sizes, pinned, { x: colX[k % cols], y: rowY[Math.floor(k / cols)] }, opts)
    for (const [id, p] of placed.nodes) out.nodes.set(id, p)
    for (const [i, p] of placed.labels) out.labels.set(i, p)
    for (const [i, p] of placed.returnRoutes) out.returnRoutes.set(i, p)
    for (const [i, p] of placed.readRoutes) out.readRoutes.set(i, p)
    for (const [id, x] of placed.right) out.right.set(id, x)
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
  // Roots: the files that point at the entry point and that nobody calls (agent start files: CLAUDE.md → SILMARI.md) come first, so the
  // entry point sits one column to their right; then the configured entry points in order; then nodes with no incoming edges. Do not hide orphan references
  const entry = (g.entry ?? []).filter((id) => idSet.has(id))
  const loose = ids.filter((id) => !hasIn.has(id) && !entry.includes(id)).sort((a, b) => (outOf.get(b)?.length ?? 0) - (outOf.get(a)?.length ?? 0) || (a < b ? -1 : 1))
  const pre = loose.filter((id) => (outOf.get(id) ?? []).some(({ e }) => entry.includes(e.to)))
  const roots = [...pre, ...entry, ...loose.filter((id) => !pre.includes(id))]
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
  // A file that is only imported (read edges out, nothing in: nobody stores it, nothing else links it) stands above its first
  // reader, in the row the reader keeps for its imports, instead of being a root of its own in the first column
  const incoming = new Set<string>(), nonReadOut = new Set<string>()
  for (const e of g.edges) if (e.from !== e.to && idSet.has(e.from) && idSet.has(e.to)) { incoming.add(e.to); if (e.type !== 'read') nonReadOut.add(e.from) }
  const hostOf = new Map<string, string>() // file → the reader it stands above
  for (const e of g.edges) if (e.type === 'read' && e.from !== e.to && idSet.has(e.from) && idSet.has(e.to) && !incoming.has(e.from) && !nonReadOut.has(e.from) && !hostOf.has(e.from)) hostOf.set(e.from, e.to)
  const core = ids.filter((id) => !hostOf.has(id))
  const { edges, sorted, rank, parent: bfsParent, kids, back, sameCol } = skeleton(g, core)
  const hostedReads = g.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'read' && hostOf.has(e.from) && idSet.has(e.to))

  // 4. Column widths and label widths between columns
  const cols = Math.max(0, ...[...rank.values()]) + 1
  const colW = Array.from({ length: cols }, () => 0)
  for (const id of core) colW[rank.get(id)!] = Math.max(colW[rank.get(id)!], size(id).w)
  const gapW = Array.from({ length: cols }, () => 0) // gapW[r] = between columns r and r+1
  const labelOf = new Map<number, { w: number; h: number }>()
  for (const { e, i } of edges) {
    const b = boxOf(i); if (!b.h) continue
    labelOf.set(i, b)
    if (e.type === 'read') continue // import labels stack above the reader (below), not in a lane
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
  const flow = opts.labelOrder === 'flow'
  // The call a child stands beside is its parent's first labeled call to it (lowest edge index, imports aside): that label sits at
  // the child's height, so the line runs straight from the label into the child. The parent's later calls stack below it in its
  // lane, and none of these move once placed. A call from any other node to that child goes below whatever is already in the lane
  const callsOf = new Map<string, { e: SilEdge; i: number }[]>()
  for (const x of edges) if (x.e.type !== 'read') (callsOf.get(x.e.from) ?? callsOf.set(x.e.from, []).get(x.e.from)!).push(x)
  // A file import (read edge) comes in from above. The reader's block keeps an empty row on top: the import labels stacked in line
  // order plus a gap above them for the line to travel along. The node and its children all start below that row
  for (const { i } of hostedReads) { const b = boxOf(i); if (b.h) labelOf.set(i, b) }
  const readsOf = new Map<string, { e: SilEdge; i: number }[]>()
  for (const x of [...edges, ...hostedReads].sort((a, b) => a.i - b.i)) if (x.e.type === 'read') (readsOf.get(x.e.to) ?? readsOf.set(x.e.to, []).get(x.e.to)!).push(x)
  // The row holds, top to bottom: each hosted file over its own label, then (when some file stands elsewhere) a gap for the line
  // that comes along the row, then the labels of those imports, then the node
  const reserve = (id: string) => {
    const rs = readsOf.get(id); if (!rs) return 0
    let h = 2 * GAP, far = false
    for (const { e, i } of rs) { h += (labelOf.get(i)?.h ?? 0) + GAP; if (hostOf.get(e.from) === id) h += nodeSize(byId.get(e.from)!, false).h + GAP; else far = true }
    return h + (far ? GAP : 0)
  }
  /** The children's slots inside a parent's block, measured from the top of the block's body (below the parent's import row).
   *  A child is placed so that the label of the parent's first labeled call to it sits at the child's height and below every label
   *  placed before it — the block grows instead of the label moving — and each later call takes the next place in the label lane.
   *  'flow': the parent's calls are walked in line order, calls to nodes that are not its children included, so a repeat call to an
   *  earlier child pushes the children after it down. 'children': child by child in discovery order, the repeat calls to a child
   *  right under its first label */
  const slotsOf = (id: string): { tops: Map<string, number>; labs: Map<number, number>; h: number } => {
    const ks = kids.get(id) ?? [], kidSet = new Set(ks), tops = new Map<string, number>(), labs = new Map<number, number>()
    let cur = 0, lab = 0, bottom = 0
    const calls = callsOf.get(id) ?? []
    const labeled = new Set<string>() // children with a labeled call from this parent
    for (const c of calls) if (kidSet.has(c.e.to) && labelOf.has(c.i)) labeled.add(c.e.to)
    const call = ({ e, i }: { e: SilEdge; i: number }) => {
      const h = labelOf.get(i)?.h ?? 0
      if (kidSet.has(e.to) && !tops.has(e.to)) {
        // The child stands beside its first labeled call; a plain link before it takes no room in the lane
        if (!h && labeled.has(e.to)) return
        // The node sits below its own import row, centered in the rest of its block
        const bh = blockH.get(e.to)!, off = (bh + reserve(e.to)) / 2
        const center = Math.max(cur + off, lab + h / 2), top = center - off
        tops.set(e.to, top); cur = top + bh + NODESEP; bottom = Math.max(bottom, top + bh, h ? center + h / 2 : 0)
        if (h) { labs.set(i, center); lab = center + h / 2 + GAP }
      } else if (h) { labs.set(i, lab + h / 2); lab += h + GAP; bottom = Math.max(bottom, lab - GAP) }
    }
    if (flow) { for (const c of calls) if (kidSet.has(c.e.to) || rank.get(c.e.to) === rank.get(id)! + 1) call(c) }
    else {
      const toKid = new Map<string, typeof calls>()
      for (const c of calls) if (kidSet.has(c.e.to)) (toKid.get(c.e.to) ?? toKid.set(c.e.to, []).get(c.e.to)!).push(c)
      for (const k of ks) for (const c of toKid.get(k) ?? []) call(c)
    }
    // A child reached only by an import has no call to stand beside: it follows the others
    for (const k of ks) if (!tops.has(k)) { tops.set(k, cur); cur += blockH.get(k)! + NODESEP; bottom = Math.max(bottom, cur - NODESEP) }
    return { tops, labs, h: bottom }
  }
  const measure = (id: string): number => {
    for (const k of kids.get(id) ?? []) measure(k)
    const h = reserve(id) + Math.max(size(id).h, slotsOf(id).h)
    blockH.set(id, h); return h
  }
  const nodes = new Map<string, { x: number; y: number }>()
  const blockTop = new Map<string, number>()
  const slotY = new Map<number, number>() // edge index → the label center its parent's slots gave it
  const place = (id: string, top: number) => {
    blockTop.set(id, top)
    const t = top + reserve(id)
    nodes.set(id, { x: colX[rank.get(id)!], y: t + (blockH.get(id)! - reserve(id) - size(id).h) / 2 })
    const { tops, labs } = slotsOf(id)
    for (const [i, y] of labs) slotY.set(i, t + y)
    for (const k of kids.get(id) ?? []) place(k, t + tops.get(k)!)
  }
  let top = MARGIN + origin.y
  for (const id of sorted) if (!bfsParent.has(id)) { measure(id); place(id, top); top += blockH.get(id)! + NODESEP }

  // Labels start at the gap's center x. A label the slots placed (a parent's call into its children's block) keeps that height.
  // Every other label starts at its target's height (a call one column to the right) or at the midpoint of both ends (same column)
  // and moves below any label already placed in its lane that it would overlap, so a lane reads top to bottom.
  // Edges of dragged nodes (pinned) follow their actual positions: the label is centered if it fits between the nodes, else put to
  // the right. Returned output is labeled on its lane below, not here
  const at = (id: string) => pinned[id] ?? nodes.get(id)!
  const center = (id: string) => { const p = at(id), s = size(id); return { x: p.x + s.w / 2, y: p.y + s.h / 2 } }
  const want: { i: number; x: number; y: number; b: { w: number; h: number }; fixed: boolean }[] = []
  for (const { e, i } of edges) {
    const b = labelOf.get(i); if (!b || e.type === 'read') continue
    if (!sameCol.has(i) && rank.get(e.to)! < rank.get(e.from)!) continue
    const lo = Math.min(rank.get(e.from)!, rank.get(e.to)!)
    const forward = rank.get(e.to) === rank.get(e.from)! + 1
    const moved = !!(pinned[e.from] || pinned[e.to]), slot = moved ? undefined : slotY.get(i)
    const y = slot ?? (forward ? center(e.to).y : (center(e.from).y + center(e.to).y) / 2)
    let x = colX[lo] + colW[lo] + RANK_MARGIN + gapW[lo] / 2
    if (moved) {
      const fromR = at(e.from).x + size(e.from).w, toL = at(e.to).x, toR = toL + size(e.to).w
      x = toL - fromR >= b.w + 2 * GAP ? (fromR + toL) / 2 : Math.max(fromR, toR) + RANK_MARGIN + b.w / 2
    }
    want.push({ i, x, y, b, fixed: slot !== undefined })
  }
  // 'flow': the parent's line order wins. A label never rises above one from an earlier line of the same document (1·2·3·4·5·6 top to
  // bottom). Only within one label lane: a reference drawn in another lane (a back reference to the caller's caller, say) cannot
  // overlap these labels, so it must not push them down either. The labels the slots placed already follow the line order
  if (flow) {
    const lastOf = new Map<string, number>()
    for (const l of [...want].sort((a, b) => a.i - b.i)) {
      const key = `${g.edges[l.i].from}@${Math.round(l.x)}`, floor = lastOf.get(key)
      if (!l.fixed && floor !== undefined && l.y - l.b.h / 2 < floor) l.y = floor + l.b.h / 2
      lastOf.set(key, l.y + l.b.h / 2 + GAP)
    }
  }
  want.sort((a, b) => a.y - b.y || a.i - b.i)
  const labels = new Map<number, { x: number; y: number }>()
  const put: { x: number; w: number; top: number; bottom: number }[] = []
  const settle = (l: (typeof want)[number]) => {
    let top = l.y - l.b.h / 2
    // Below every placed label it would overlap, again when that lands it on another one
    if (!l.fixed) for (let hit = true; hit;) { hit = false; for (const p of put) if (Math.abs(l.x - p.x) < (l.b.w + p.w) / 2 && top < p.bottom + GAP && top + l.b.h > p.top - GAP) { top = p.bottom + GAP; hit = true } }
    labels.set(l.i, { x: l.x, y: top + l.b.h / 2 }); put.push({ x: l.x, w: l.b.w, top, bottom: top + l.b.h })
  }
  for (const l of want) if (l.fixed) settle(l)
  for (const l of want) if (!l.fixed) settle(l)
  // Import labels stack above the reader, centered on it, in line order top to bottom. The stack fills the row the reserve kept at
  // the top of the reader's block (a dragged reader has no block, so it stacks right above the node). Nearest the node: labels of
  // imports whose file stands elsewhere — their line comes along the row just above them, which the reserve keeps empty across
  // the block's columns. Above that row: each hosted file right over its own label, so its line drops straight through
  const readRoutes = new Map<number, { outX: number; y: number; drop?: boolean }>()
  for (const [id, rs] of readsOf) {
    const p = at(id), x = p.x + nodeSize(byId.get(id)!, open.has(id)).w / 2 // the drawn width: size() reserves the expanded width for the column
    const own = rs.filter(({ e }) => hostOf.get(e.from) === id), far = rs.filter(({ e }) => hostOf.get(e.from) !== id)
    let y = pinned[id] ? p.y - GAP : Math.min(p.y, blockTop.get(id)! + reserve(id)) - GAP
    for (const { i } of [...far].reverse()) { const b = labelOf.get(i); if (b) { labels.set(i, { x, y: y - b.h / 2 }); y -= b.h + GAP } }
    const row = y - GAP / 2
    if (far.length) y -= GAP
    for (const { e, i } of [...own].reverse()) {
      const b = labelOf.get(i); if (b) { labels.set(i, { x, y: y - b.h / 2 }); y -= b.h + GAP }
      const fs = nodeSize(byId.get(e.from)!, false); nodes.set(e.from, { x: x - fs.w / 2, y: y - fs.h }); y -= fs.h + GAP
    }
    for (const { e, i } of far) { const f = at(e.from); readRoutes.set(i, { outX: f.x + size(e.from).w + 20, y: row }) }
    for (const { i } of own) readRoutes.set(i, { outX: 0, y: 0, drop: true })
  }
  const rightEdge = new Map(ids.map((id) => [id, at(id).x + size(id).w]))
  // A link that runs back to an earlier column (a call into an ancestor, a call into a node that a shallower caller placed there,
  // data written back, a reference to an earlier document) cannot leave the source's right side and reach the target's left side
  // without crossing its own column. It takes a return lane: a clear horizontal corridor between nodes, or, when none fits, a lane
  // below the local flow. Imports have their own route from above
  const returns = edges.filter(({ e, i }) => !sameCol.has(i) && e.type !== 'read' && rank.get(e.to)! < rank.get(e.from)!)
  const returnRoutes = new Map<number, { outX: number; inX: number; y: number; r: number }>()
  const rects = ids.map((id) => { const p = at(id), s = size(id); return { id, x: p.x, y: p.y, w: s.w, h: s.h } })
  const used: { y: number; h: number }[] = []
  let returnRail = Math.max(...rects.map((r) => r.y + r.h)) + RANK_MARGIN
  for (const { e, i } of returns) {
    const b = labelOf.get(i), h = Math.max(20, b?.h ?? 0), from = at(e.from), to = at(e.to), fs = size(e.from)
    const outX = from.x + fs.w + 20, inX = to.x - 20, lo = Math.min(outX, inX), hi = Math.max(outX, inX), mid = (center(e.from).y + center(e.to).y) / 2
    // The lane carries the edge's label (h tall, centered on y), so the whole band must miss every node and every label placed so far
    const obs = [...rects, ...[...labels].filter(([j]) => j !== i).map(([j, p]) => { const lb = labelOf.get(j)!; return { id: '', x: p.x - lb.w / 2, y: p.y - lb.h / 2, w: lb.w, h: lb.h } })]
    const candidates = [...new Set([mid, ...obs.flatMap((o) => [o.y - 4 - h / 2, o.y + o.h + 4 + h / 2])])].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))
    const clear = (y: number) => obs.every((o) => o.id === e.from || o.id === e.to || y + h / 2 < o.y - 4 || y - h / 2 > o.y + o.h + 4 || o.x + o.w < lo || o.x > hi)
    let y = candidates.find((v) => clear(v) && used.every((u) => Math.abs(v - u.y) >= (h + u.h) / 2 + NODESEP))
    if (y === undefined) { y = returnRail + h / 2; returnRail += h + NODESEP }
    used.push({ y, h }); returnRoutes.set(i, { outX, inX, y, r: 12 })
    if (b) labels.set(i, { x: (outX + inX) / 2, y })
  }
  // The box this part occupies, measured from the origin (nodes, labels, and return lanes)
  let right = origin.x, bottom = origin.y
  for (const [id, p] of nodes) { const s = size(id); right = Math.max(right, p.x + s.w); bottom = Math.max(bottom, p.y + s.h) }
  for (const [i, p] of labels) { const b = labelOf.get(i)!; right = Math.max(right, p.x + b.w / 2); bottom = Math.max(bottom, p.y + b.h / 2) }
  if (returns.length) bottom = Math.max(bottom, returnRail)
  return { placed: { nodes, labels, returnRoutes, readRoutes, right: rightEdge, cycles: back, sameCol }, box: { w: right - origin.x + MARGIN, h: bottom - origin.y + MARGIN } }
}

/**
 * The entry view. The entry document (SILMARI.md) registers flows by linking them; those links are the only starting points here.
 * `starters` are the task documents the entry document links, in link order. `startFiles` are the documents that link the entry
 * document and that nobody calls (the agent start files). `downstream(s)` is everything reachable from a starter without passing
 * through the entry document again. null when there is no visible entry document or it links no task, so the viewer falls back
 * to the connectivity view. The graph itself is untouched: this is a visibility filter over it.
 */
export interface EntryView { entry: string; starters: string[]; startFiles: string[]; downstream: (root: string) => Set<string> }
export function entryView(g: Graph, visible: Set<string>): EntryView | null {
  const entry = (g.entry ?? []).find((id) => visible.has(id))
  if (!entry) return null
  const kind = new Map(g.nodes.map((n) => [n.id, n.kind]))
  // A registration is a plain link (`[Feature work](flow.md)` in SILMARI.md's Flow section). A link that carries values is a call: the
  // entry document is then itself a flow, its steps are not flows of their own, and the connectivity view shows the whole thing
  const starters: string[] = []
  for (const e of g.edges) if (e.from === entry && e.to !== entry && e.type !== 'call' && visible.has(e.to) && kind.get(e.to) === 'task' && !starters.includes(e.to)) starters.push(e.to)
  if (!starters.length) return null
  const called = new Set(g.edges.filter((e) => e.from !== e.to && visible.has(e.from)).map((e) => e.to))
  const startFiles = [...new Set(g.edges.filter((e) => e.to === entry && e.from !== entry && visible.has(e.from) && !called.has(e.from)).map((e) => e.from))]
  const outOf = new Map<string, string[]>()
  for (const e of g.edges) if (e.from !== e.to) (outOf.get(e.from) ?? outOf.set(e.from, []).get(e.from)!).push(e.to)
  const downstream = (root: string) => {
    const seen = new Set<string>([root]); const queue = [root]
    while (queue.length) { const x = queue.shift()!; for (const y of outOf.get(x) ?? []) if (y !== entry && visible.has(y) && !seen.has(y)) { seen.add(y); queue.push(y) } }
    return seen
  }
  return { entry, starters, startFiles, downstream }
}
