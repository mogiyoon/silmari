// Edge routes. Every edge is a right-angle path with rounded corners, built as a list of corner points here so the DOM (an SVG
// path) and the GL layer (a sampled polyline) draw the same line. Only the corner list differs per edge kind.
export interface Pt { x: number; y: number }
export const CORNER_R = 12
/** Vertical runs sit this far from the node they belong to: inside the margin the layout keeps between a node column and the
 *  label lane (RANK_MARGIN), so a line never runs under a label, its own or a neighbour's. Callers pass `s1`/`t1` measured from the
 *  column's edge (Placed.right), so a collapsed node's line clears an expanded neighbour that fills the column's reserved width */
export const STRIP = 20
/** Where a same-column link enters on the target's right side (fraction of its height). Below the middle, so the arrowhead
 *  does not sit on the source handle when the two nodes call each other */
export const RT_Y = 0.7

/** An ordinary call: out of the source's right side, down the strip beside it to the label's height, across the lane through the
 *  label, down the strip before the target to its height, in. Lines that run backwards or to a dragged node have no strips to
 *  use and bend halfway to the label instead */
export function labelRoute(sx: number, sy: number, tx: number, ty: number, lx: number, ly: number, s1 = sx + STRIP): Pt[] {
  const forward = sx < lx && lx < tx && s1 < tx - STRIP
  const m1 = forward ? s1 : (sx + lx) / 2, m2 = forward ? tx - STRIP : (lx + tx) / 2
  return [{ x: sx, y: sy }, { x: m1, y: sy }, { x: m1, y: ly }, { x: m2, y: ly }, { x: m2, y: ty }, { x: tx, y: ty }]
}

/** A link with nothing to label (a plain reference): one bend, in the strip beside the source, then straight into the target */
export function plainRoute(sx: number, sy: number, tx: number, ty: number, s1 = sx + STRIP): Pt[] {
  const m = s1 < tx - STRIP ? s1 : (sx + tx) / 2
  return [{ x: sx, y: sy }, { x: m, y: sy }, { x: m, y: ty }, { x: tx, y: ty }]
}

/** Same column: both handles are on the right. The line leaves right, runs down the label strip and comes back into the target's
 *  right side. The strip stays clear of both nodes even after the label is dragged left. A link that goes up takes a strip 20px
 *  further out, so two nodes that call each other draw two parallel lines instead of one on top of the other */
export function sameColRoute(sx: number, sy: number, tx: number, ty: number, lx: number, s1 = sx + STRIP, t1 = tx + STRIP): Pt[] {
  const x = Math.max(lx, s1, t1) + (ty < sy ? 20 : 0)
  return [{ x: sx, y: sy }, { x, y: sy }, { x, y: ty }, { x: tx, y: ty }]
}

/** Returned output: the four-bend corridor the layout reserved (out of the source's right side, along a clear lane, into the
 *  target's left side) */
export function returnRoute(sx: number, sy: number, tx: number, ty: number, q: { outX: number; inX: number; y: number }): Pt[] {
  return [{ x: sx, y: sy }, { x: q.outX, y: sy }, { x: q.outX, y: q.y }, { x: q.inX, y: q.y }, { x: q.inX, y: ty }, { x: tx, y: ty }]
}

/** Imported file data: out of the file's right side, up or down to the empty row the layout kept above the reader, along that
 *  row to the label, down through it, then into the reader's top. With the label where the layout put it (lx = tx) that is one
 *  straight drop; a dragged label pulls the drop sideways and the line jogs back over the reader, or, dragged above the row,
 *  brings the row up to the label's height */
export function readRoute(sx: number, sy: number, tx: number, ty: number, q: { outX: number; y: number }, lx: number, ly: number): Pt[] {
  const row = Math.min(q.y, ly), mid = (ly + ty) / 2
  return [{ x: sx, y: sy }, { x: q.outX, y: sy }, { x: q.outX, y: row }, { x: lx, y: row }, { x: lx, y: ly }, { x: lx, y: mid }, { x: tx, y: mid }, { x: tx, y: ty }]
}

/** A file standing right above its reader: out of the file's bottom, through the label, into the reader's top. One straight drop
 *  unless the label or the file was dragged, then it jogs sideways between them */
export function dropRoute(sx: number, sy: number, tx: number, ty: number, lx: number, ly: number): Pt[] {
  const m0 = (sy + ly) / 2, m1 = (ly + ty) / 2
  return [{ x: sx, y: sy }, { x: sx, y: m0 }, { x: lx, y: m0 }, { x: lx, y: ly }, { x: lx, y: m1 }, { x: tx, y: m1 }, { x: tx, y: ty }]
}

interface Bend { from: Pt; at: Pt; to: Pt }
/** Drops repeated points, then rounds every bend. The radius never exceeds half of either neighbouring run, so short segments
 *  bend tightly instead of overshooting; a point the line runs straight through keeps no corner */
function prep(pts: Pt[], r: number): { p: Pt[]; b: (Bend | null)[] } {
  const p: Pt[] = []
  for (const q of pts) { const last = p[p.length - 1]; if (!last || Math.hypot(q.x - last.x, q.y - last.y) > 0.5) p.push(q) }
  const b: (Bend | null)[] = p.map(() => null)
  for (let i = 1; i < p.length - 1; i++) {
    const l1 = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y), l2 = Math.hypot(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y)
    if (l1 < 1e-6 || l2 < 1e-6) continue
    const ux = (p[i].x - p[i - 1].x) / l1, uy = (p[i].y - p[i - 1].y) / l1, vx = (p[i + 1].x - p[i].x) / l2, vy = (p[i + 1].y - p[i].y) / l2
    if (Math.abs(ux * vy - uy * vx) < 1e-6) continue
    const rr = Math.min(r, l1 / 2, l2 / 2)
    if (rr < 0.5) continue
    b[i] = { from: { x: p[i].x - ux * rr, y: p[i].y - uy * rr }, at: p[i], to: { x: p[i].x + vx * rr, y: p[i].y + vy * rr } }
  }
  return { p, b }
}

/** SVG path for the route, each bend a quadratic corner */
export function routePath(pts: Pt[], r = CORNER_R): string {
  const { p, b } = prep(pts, r)
  if (p.length < 2) return ''
  let d = `M${p[0].x},${p[0].y}`
  for (let i = 1; i < p.length; i++) {
    const k = b[i]
    d += k ? ` L${k.from.x},${k.from.y} Q${k.at.x},${k.at.y} ${k.to.x},${k.to.y}` : ` L${p[i].x},${p[i].y}`
  }
  return d
}

/** The same route as a flat [x, y, …] polyline for the GL layer. Each corner becomes `seg` samples of its quadratic */
export function routePoints(pts: Pt[], r = CORNER_R, seg = 4): number[] {
  const { p, b } = prep(pts, r), out: number[] = []
  if (!p.length) return out
  out.push(p[0].x, p[0].y)
  for (let i = 1; i < p.length; i++) {
    const k = b[i]
    if (!k) { out.push(p[i].x, p[i].y); continue }
    out.push(k.from.x, k.from.y)
    for (let j = 1; j <= seg; j++) {
      const t = j / seg, u = 1 - t
      out.push(u * u * k.from.x + 2 * u * t * k.at.x + t * t * k.to.x, u * u * k.from.y + 2 * u * t * k.at.y + t * t * k.to.y)
    }
  }
  return out
}
