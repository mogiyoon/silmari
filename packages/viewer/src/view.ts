// The graph the canvas draws: the full graph with some kinds of lines left out. Measured on a real project (62 md, 7 flows), calls
// were 34 of 201 lines and references 126; files and folders were 46 of 99 nodes. Drawn together, the calls that make up the flows
// were lost among lines to shared rule documents and data files (2026-09-26). So the canvas starts with calls only; references and
// file data are switched on from the legend. The right panel keeps the full graph: the selected document's references and files are
// all listed there.
import type { Graph, Edge as SilEdge, EdgeType, NodeKind } from '@silmari/core'

/** The line groups the legend switches: calls; references; file data (write · import). A mention is a plain link to a task: a router
 *  choosing a flow (`## 경우 2` → `[흐름 2](i.md)`), a flow that hands over to another. That is a call without values, so it is drawn
 *  with the calls; filed with the references, a router project fell apart into loose flows (examples/pipeline, 2026-09-26) */
export type LineGroup = 'call' | 'ref' | 'data'
export const LINE_GROUPS: LineGroup[] = ['call', 'ref', 'data']
export const groupOf = (t: EdgeType): LineGroup => (t === 'call' || t === 'mention' ? 'call' : t === 'read' || t === 'write' ? 'data' : 'ref')

export interface ViewOpts {
  lines: LineGroup[]
  /** A node whose file data is shown even while that group is off: the selected document's reads and writes open beside it */
  focus?: string | null
}

/** Edges kept whatever the switches say:
 *  - a line to or from a missing target, so a broken link never disappears from the picture (the diagnostics point at it)
 *  - the entry view's registrations: a document that links the entry point (the agent start files), and the entry point's links to
 *    the flows it registers, or to a router that picks them. Those are plain links, so they are references, but the entry view is
 *    built from them
 *  - the focused node's file data */
export function viewGraph(g: Graph, v: ViewOpts): Graph {
  const on = new Set(v.lines)
  if (LINE_GROUPS.every((x) => on.has(x))) return g
  const kind = new Map<string, NodeKind>(g.nodes.map((n) => [n.id, n.kind]))
  const entry = new Set(g.entry ?? [])
  const keep = (e: SilEdge) => on.has(groupOf(e.type))
    || kind.get(e.to) === 'ghost' || kind.get(e.from) === 'ghost'
    || entry.has(e.to) || (entry.has(e.from) && kind.get(e.to) === 'task')
    || (!!v.focus && groupOf(e.type) === 'data' && (e.from === v.focus || e.to === v.focus || e.declaredIn === v.focus))
  const kept = new Set(g.edges.filter(keep))
  const touched = new Set<string>()
  for (const e of kept) { touched.add(e.from); touched.add(e.to) }
  // The entry point's link to a router document (a reference with no contract whose own links pick the flows) stays while the router does
  for (const e of g.edges) if (!kept.has(e) && entry.has(e.from) && touched.has(e.to) && e.from !== e.to) kept.add(e)
  const edges = g.edges.filter((e) => kept.has(e))
  // A task is a step of some flow and always stays. A reference document or a file stays only while a line still reaches it
  const nodes = g.nodes.filter((n) => n.kind === 'task' || touched.has(n.id) || entry.has(n.id))
  return { ...g, nodes, edges }
}

/** The node a selection focuses: only one with file data of its own, so clicking any other node does not rebuild the picture */
export const focusOf = (g: Graph, sel: string | null): string | null =>
  sel && g.edges.some((e) => groupOf(e.type) === 'data' && (e.from === sel || e.to === sel || e.declaredIn === sel)) ? sel : null
