// WebGL layer for very large flows. Nodes are colored rectangles, edges are thin curves, titles come from a 2D canvas overlay
// when zoomed in enough. It is the far view: once the user zooms in, App hands the on-screen nodes to React Flow and the
// normal DOM components (labels, expansion, editing) take over. Everything is drawn from two vertex buffers rebuilt only when
// the node set or positions change. With `view` given, the layer follows React Flow's viewport and takes no input itself.
import { useEffect, useRef, useState } from 'react'
import { routePoints, labelRoute, plainRoute, sameColRoute, returnRoute, readRoute, dropRoute, RT_Y } from './route.ts'

export interface GLNode { id: string; x: number; y: number; w: number; h: number; color: string; title: string; border: string; bw: number; r: number }
/** An edge in the same shape the DOM draws it: right angles with rounded corners through the label point (lx, ly), or one bend
 *  when there is no label, an arrowhead at the target. tRight: the target handle is on the right side (same column) */
export interface GLEdge { from: string; to: string; color: string; dashed: boolean; lx?: number; ly?: number; returnRoute?: { outX: number; inX: number; y: number; r: number }; readRoute?: { outX: number; y: number; drop?: boolean }; tRight?: boolean; s1?: number; t1?: number /* strip x beside the source / target column */; dim?: boolean /* set when a heading box is selected: only its own edges stay lit */ }

// Vertex: position in graph space, an offset vector, its kind, color, then the rectangle it belongs to (width, height, corner radius) and
// the position inside it (0..1). Kind 0 = line: the unit normal times u_hw screen pixels, so lines keep one width at every zoom.
// Kind 1 = border corner: (±w, ±w) graph units, scaled with the zoom but never under u_minb screen pixels.
// The fragment shader rounds rectangle corners: pixels outside the rounded shape are dropped (radius 0 = plain rectangle)
const VS = `attribute vec2 a_pos; attribute vec2 a_norm; attribute float a_kind; attribute vec4 a_color; attribute vec3 a_rect; attribute vec2 a_uv;
uniform vec2 u_res; uniform vec2 u_tr; uniform float u_zoom; uniform float u_hw; uniform float u_minb; varying vec4 v_color; varying vec3 v_rect; varying vec2 v_uv;
void main() { vec2 off = a_kind > 0.5 ? a_norm * max(u_zoom, u_minb / abs(a_norm.x)) : a_norm * u_hw; vec2 p = (a_pos * u_zoom + u_tr + off) / u_res * 2.0 - 1.0; gl_Position = vec4(p.x, -p.y, 0.0, 1.0); v_color = a_color; v_rect = a_rect; v_uv = a_uv; }`
const FS = `precision mediump float; varying vec4 v_color; varying vec3 v_rect; varying vec2 v_uv;
void main() {
  if (v_rect.z > 0.0) { vec2 h = v_rect.xy * 0.5; vec2 q = abs(v_uv * v_rect.xy - h) - (h - vec2(v_rect.z)); float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - v_rect.z; if (d > 0.0) discard; }
  gl_FragColor = v_color;
}`
const FLOATS = 14, STRIDE = FLOATS * 4, LINE_W = 1.6, EDGE_ALPHA = 0.85, ARROW_L = 11, ARROW_W = 5.5, DASH_ON = 6, DASH_OFF = 4, SEG = 12
const NO_RECT = [0, 0, 0, 0, 0] // a_rect + a_uv for vertices that are not part of a rounded rectangle
// Dashes are built only for edges up to this long (graph units): a 60,000-unit reference line would need thousands of pieces, and a
// whole flow of them overran the array limit. Longer dashed edges are drawn only in the paler solid form, at every zoom
const DASH_MAX_LEN = 4000, DASH_MAX_FLOATS = 24_000_000

const hex = (c: string): [number, number, number] => { const n = parseInt(c.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] }

function program(gl: WebGLRenderingContext) {
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s }
  const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p); return p
}

const cubic = (p0: number, p1: number, p2: number, p3: number, t: number) => { const mt = 1 - t; return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3 }

/** Builds the vertex data: node rectangles, and edges as thin quads along the same path the DOM uses (a rounded right-angle route
 *  through the label point), dashed by walking the arc length, with a closed arrowhead at the target. Positions are graph coordinates */
function build(nodes: GLNode[], edges: GLEdge[], hide?: Set<string>, focus?: Set<string> | null) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  // tri: rectangles and arrowheads. lin: solid lines. dash: dashed lines as pieces. flat: the same dashed lines drawn solid and paler,
  // used when a dash would be under ~2 screen pixels (dashes that small alias into a wobble; the SVG blends them to a lighter line)
  const tri: number[] = [], lin: number[] = [], dash: number[] = [], flat: number[] = []
  const CORNERS = [[0, 0], [1, 0], [0, 1], [1, 0], [1, 1], [0, 1]]
  // a rounded rectangle: two triangles, each vertex carrying the rectangle's size and radius so the fragment shader can round it
  const rect = (out: number[], x0: number, y0: number, x1: number, y1: number, r: number, c: number[]) => { for (const [u, v] of CORNERS) out.push(x0 + (x1 - x0) * u, y0 + (y1 - y0) * v, 0, 0, 0, ...c, x1 - x0, y1 - y0, r, u, v) }
  // border: the same rectangle pushed outward by bw at each corner (kind 1), drawn first; the fill on top leaves a ring
  const border = (out: number[], x0: number, y0: number, x1: number, y1: number, bw: number, r: number, c: number[]) => { for (const [u, v] of CORNERS) out.push(x0 + (x1 - x0) * u, y0 + (y1 - y0) * v, (u * 2 - 1) * bw, (v * 2 - 1) * bw, 1, ...c, x1 - x0 + 2 * bw, y1 - y0 + 2 * bw, r + bw, u, v) }
  const fade = (id: string) => (focus && !focus.has(id) ? 0.15 : 1) // selection focus: everything outside the selected node and its neighbors fades, like the DOM
  for (const n of nodes) {
    if (hide?.has(n.id)) continue
    const a = fade(n.id), [r, g, b] = hex(n.color), [br, bg, bb] = hex(n.border)
    if (n.bw > 0) border(tri, n.x, n.y, n.x + n.w, n.y + n.h, n.bw, n.r, [br, bg, bb, a])
    rect(tri, n.x, n.y, n.x + n.w, n.y + n.h, n.r, [r, g, b, a])
  }
  // a line piece from (ax,ay) to (bx,by): two triangles offset by ±normal in the shader
  const piece = (out: number[], ax: number, ay: number, bx: number, by: number, c: number[]) => {
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l
    out.push(ax, ay, nx, ny, 0, ...c, ...NO_RECT, ax, ay, -nx, -ny, 0, ...c, ...NO_RECT, bx, by, nx, ny, 0, ...c, ...NO_RECT, bx, by, nx, ny, 0, ...c, ...NO_RECT, ax, ay, -nx, -ny, 0, ...c, ...NO_RECT, bx, by, -nx, -ny, 0, ...c, ...NO_RECT)
  }
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to); if (!a || !b) continue
    const [r, g, bl] = hex(e.color), c = [r, g, bl, focus && (e.dim ?? !(focus.has(e.from) && focus.has(e.to))) ? 0.1 : EDGE_ALPHA]
    // imports enter the reader's top center; same-column links its right side below the middle; everything else its left side
    const drop = !!e.readRoute?.drop // a hosted file leaves from its bottom center
    const sx = drop ? a.x + a.w / 2 : a.x + a.w, sy = drop ? a.y + a.h : a.y + a.h / 2, tx = e.readRoute ? b.x + b.w / 2 : e.tRight ? b.x + b.w : b.x, ty = e.readRoute ? b.y : b.y + b.h * (e.tRight ? RT_Y : 0.5)
    // Sample each cubic finely enough for its length: a long, nearly vertical reference line drawn with a dozen segments shows its
    // corners as a wobble once dashes and neighbours overlap
    const segs = (ax: number, ay: number, bx: number, by: number) => Math.min(96, Math.max(SEG, Math.ceil(Math.hypot(bx - ax, by - ay) / 12)))
    let pts: number[]
    if (drop) pts = routePoints(dropRoute(sx, sy, tx, ty, e.lx ?? tx, e.ly ?? ty))
    else if (e.readRoute) pts = routePoints(readRoute(sx, sy, tx, ty, e.readRoute, e.lx ?? tx, e.ly ?? ty))
    else if (e.returnRoute) pts = routePoints(returnRoute(sx, sy, tx, ty, e.returnRoute), e.returnRoute.r)
    else if (e.tRight) pts = routePoints(sameColRoute(sx, sy, tx, ty, e.lx ?? sx + 20, e.s1, e.t1))
    else if (e.lx === undefined || e.ly === undefined) pts = routePoints(plainRoute(sx, sy, tx, ty, e.s1))
    // Go through the label point only when it lies between the two ends. For a line that runs back or far up/down (a reference to a
    // document elsewhere) the DOM's detour to the label is hidden under the label box; here there is no box, and the detour would show
    // as a hook at every node. Those lines take one plain curve instead
    else if (e.lx > Math.min(sx, tx) && e.lx < Math.max(sx, tx)) pts = routePoints(labelRoute(sx, sy, tx, ty, e.lx, e.ly, e.s1))
    else {
      pts = [sx, sy]
      const d = Math.max(40, Math.abs(tx - sx) / 4), n = segs(sx, sy, tx, ty)
      for (let i = 1; i <= n; i++) pts.push(cubic(sx, sx + d, tx - d, tx, i / n), cubic(sy, sy, ty, ty, i / n))
    }
    // Dashes follow a pattern fixed in graph space (by x + y), not each line's own start. Reference lines that run side by side in a
    // label column then dash in step and read as one bundle instead of a braided wobble
    const PERIOD = DASH_ON + DASH_OFF, onAt = (x: number, y: number) => (((x + y) % PERIOD) + PERIOD) % PERIOD < DASH_ON
    let total = 0
    if (e.dashed) for (let i = 2; i < pts.length; i += 2) total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1])
    const wantDash = e.dashed && total <= DASH_MAX_LEN && dash.length < DASH_MAX_FLOATS
    for (let i = 2; i < pts.length; i += 2) {
      const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1]
      if (!e.dashed) { piece(lin, ax, ay, bx, by, c); continue }
      piece(flat, ax, ay, bx, by, [c[0], c[1], c[2], c[3] * DASH_ON / PERIOD])
      if (!wantDash) { if (total > DASH_MAX_LEN) piece(lin, ax, ay, bx, by, [c[0], c[1], c[2], c[3] * DASH_ON / PERIOD]); continue } // long: solid-pale in the near buffer too
      const len = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(len / 2))
      let runStart = -1
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, x = ax + (bx - ax) * t, y = ay + (by - ay) * t
        const on = k < steps && onAt(ax + (bx - ax) * ((k + 0.5) / steps), ay + (by - ay) * ((k + 0.5) / steps))
        if (on && runStart < 0) runStart = k
        if (!on && runStart >= 0) { const t0 = runStart / steps; piece(dash, ax + (bx - ax) * t0, ay + (by - ay) * t0, x, y, c); runStart = -1 }
      }
    }
    const px = pts[pts.length - 4], py = pts[pts.length - 3], dx = tx - px, dy = ty - py, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l
    const bxp = tx - ux * ARROW_L, byp = ty - uy * ARROW_L
    for (const [x, y] of [[tx, ty], [bxp - uy * ARROW_W, byp + ux * ARROW_W], [bxp + uy * ARROW_W, byp - ux * ARROW_W]]) tri.push(x, y, 0, 0, 0, ...c, ...NO_RECT)
  }
  return { tri: new Float32Array(tri), lin: new Float32Array(lin), dash: new Float32Array(dash), flat: new Float32Array(flat) }
}

export interface GLView { tx: number; ty: number; zoom: number }

/** Node under a screen point, given the viewport. Last drawn wins, like the DOM */
export function glHit(nodes: GLNode[], v: GLView, cx: number, cy: number): GLNode | null {
  const x = (cx - v.tx) / v.zoom, y = (cy - v.ty) / v.zoom
  for (let i = nodes.length - 1; i >= 0; i--) { const n = nodes[i]; if (x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) return n }
  return null
}

export function GLCanvas({ nodes, edges, hide, focus = null, selected, onSelect, onDouble, onUnavailable, textFrom = 0.35, view: ctrl }: {
  /** Every node's geometry (edges need all of it). `hide` lists the ones the DOM draws itself, so the layer skips their rectangles and titles.
   *  `focus` is the selected node with its neighbors; everything else fades */
  nodes: GLNode[]; edges: GLEdge[]; hide?: Set<string>; focus?: Set<string> | null; selected: string | null; onSelect?: (id: string | null) => void; onDouble?: (id: string) => void
  /** Called once when the browser cannot create a WebGL context (no GPU, blocked). The caller falls back to the DOM renderer */
  onUnavailable?: () => void; textFrom?: number
  /** Viewport owned by someone else (React Flow). The layer then draws only: no wheel, no drag, no clicks */
  view?: GLView
}) {
  const wrap = useRef<HTMLDivElement>(null), glRef = useRef<HTMLCanvasElement>(null), txtRef = useRef<HTMLCanvasElement>(null)
  const own = useRef({ tx: 0, ty: 0, zoom: 1 })
  const view = ctrl ? { current: ctrl } : own
  const [, bump] = useState(0)
  const nodesRef = useRef(nodes); nodesRef.current = nodes
  const hideRef = useRef(hide); hideRef.current = hide
  const selRef = useRef(selected); selRef.current = selected
  const glState = useRef<{ gl: WebGLRenderingContext; prog: WebGLProgram; triBuf: WebGLBuffer; linBuf: WebGLBuffer; dashBuf: WebGLBuffer; flatBuf: WebGLBuffer; triN: number; linN: number; dashN: number; flatN: number; selBuf: WebGLBuffer } | null>(null)

  // Fit when the node set changes
  const sig = nodes.map((n) => n.id).join('|')
  useEffect(() => {
    const el = wrap.current; if (!el || !nodes.length || ctrl) return
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h) }
    const W = el.clientWidth, H = el.clientHeight
    const zoom = Math.max(0.02, Math.min(2.5, Math.min(W / (x1 - x0 + 80), H / (y1 - y0 + 80))))
    view.current = { zoom, tx: (W - (x1 + x0) * zoom) / 2, ty: (H - (y1 + y0) * zoom) / 2 }
    bump((v) => v + 1)
  }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps

  // Buffers
  useEffect(() => {
    const c = glRef.current; if (!c) return
    if (!glState.current) {
      const gl = c.getContext('webgl', { antialias: true }); if (!gl) { onUnavailable?.(); return }
      const prog = program(gl)
      glState.current = { gl, prog, triBuf: gl.createBuffer()!, linBuf: gl.createBuffer()!, dashBuf: gl.createBuffer()!, flatBuf: gl.createBuffer()!, selBuf: gl.createBuffer()!, triN: 0, linN: 0, dashN: 0, flatN: 0 }
    }
    const st = glState.current, { gl } = st
    const { tri, lin, dash, flat } = build(nodes, edges, hide, focus)
    const up = (buf: WebGLBuffer, data: Float32Array) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return data.length / FLOATS }
    st.triN = up(st.triBuf, tri); st.linN = up(st.linBuf, lin); st.dashN = up(st.dashBuf, dash); st.flatN = up(st.flatBuf, flat)
    bump((v) => v + 1)
  }, [nodes, edges, hide, focus])

  // Draw on every state bump and on resize
  useEffect(() => {
    const el = wrap.current, c = glRef.current, tc = txtRef.current, st = glState.current; if (!el || !c || !tc || !st) return
    const draw = () => {
      const dpr = window.devicePixelRatio || 1, W = el.clientWidth, H = el.clientHeight
      if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; tc.width = W * dpr; tc.height = H * dpr }
      const { gl, prog } = st, { tx, ty, zoom } = view.current
      gl.viewport(0, 0, c.width, c.height); gl.clearColor(0.043, 0.067, 0.11, 1); gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.useProgram(prog)
      gl.uniform2f(gl.getUniformLocation(prog, 'u_res'), W, H); gl.uniform2f(gl.getUniformLocation(prog, 'u_tr'), tx, ty); gl.uniform1f(gl.getUniformLocation(prog, 'u_zoom'), zoom)
      gl.uniform1f(gl.getUniformLocation(prog, 'u_hw'), Math.max(LINE_W * zoom, 0.75)) // the DOM line scales with zoom; keep at least 1.5px so far lines do not shimmer
      gl.uniform1f(gl.getUniformLocation(prog, 'u_minb'), 1) // borders never thinner than 1px
      const attrs: [string, number, number][] = [['a_pos', 2, 0], ['a_norm', 2, 8], ['a_kind', 1, 16], ['a_color', 4, 20], ['a_rect', 3, 36], ['a_uv', 2, 48]]
      const locs = attrs.map(([name, size, off]) => [gl.getAttribLocation(prog, name), size, off] as const)
      const bind = (buf: WebGLBuffer) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); for (const [loc, size, off] of locs) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, off) } }
      bind(st.linBuf); gl.drawArrays(gl.TRIANGLES, 0, st.linN)
      if (zoom * DASH_ON >= 2) { bind(st.dashBuf); gl.drawArrays(gl.TRIANGLES, 0, st.dashN) } else { bind(st.flatBuf); gl.drawArrays(gl.TRIANGLES, 0, st.flatN) }
      // selection: the same look as the DOM node — a 2px white border with a soft 3px glow outside it. Drawn as two rectangles behind
      // the node (the node's own fill covers the middle). Sizes are screen pixels so they stay the same at every zoom
      const sel = selRef.current && nodesRef.current.find((n) => n.id === selRef.current)
      if (sel) {
        const ring = (m: number, col: number[]) => { const x0 = sel.x - m, y0 = sel.y - m, x1 = sel.x + sel.w + m, y1 = sel.y + sel.h + m; return [[0, 0], [1, 0], [0, 1], [1, 0], [1, 1], [0, 1]].flatMap(([u, v]) => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * v, 0, 0, 0, ...col, x1 - x0, y1 - y0, sel.r + m, u, v]) }
        const q = new Float32Array([...ring(5 / zoom, [1, 1, 1, 0.25]), ...ring(2 / zoom, [1, 1, 1, 1])])
        gl.bindBuffer(gl.ARRAY_BUFFER, st.selBuf); gl.bufferData(gl.ARRAY_BUFFER, q, gl.DYNAMIC_DRAW); bind(st.selBuf); gl.drawArrays(gl.TRIANGLES, 0, 12)
      }
      bind(st.triBuf); gl.drawArrays(gl.TRIANGLES, 0, st.triN)
      // titles: 2D overlay, only for nodes on screen and only when readable
      const ctx = tc.getContext('2d')!; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, tc.width, tc.height)
      if (zoom >= textFrom) {
        ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, tx * dpr, ty * dpr)
        ctx.font = '600 13px -apple-system, "Apple SD Gothic Neo", sans-serif'; ctx.fillStyle = '#f8fafc'; ctx.textBaseline = 'middle'
        const vx0 = -tx / zoom, vy0 = -ty / zoom, vx1 = (W - tx) / zoom, vy1 = (H - ty) / zoom
        for (const n of nodesRef.current) {
          if (hideRef.current?.has(n.id) || n.x + n.w < vx0 || n.x > vx1 || n.y + n.h < vy0 || n.y > vy1) continue
          ctx.save(); ctx.beginPath(); ctx.rect(n.x + 6, n.y, n.w - 12, n.h); ctx.clip(); ctx.fillText(n.title, n.x + 10, n.y + n.h / 2); ctx.restore()
        }
      }
    }
    draw()
    const ro = new ResizeObserver(draw); ro.observe(el)
    return () => ro.disconnect()
  })

  // Pan, zoom, click
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const toGraph = (cx: number, cy: number) => { const r = wrap.current!.getBoundingClientRect(); const { tx, ty, zoom } = view.current; return { x: (cx - r.left - tx) / zoom, y: (cy - r.top - ty) / zoom } }
  const hit = (cx: number, cy: number) => { const p = toGraph(cx, cy); return glHit(nodesRef.current, { tx: 0, ty: 0, zoom: 1 }, p.x, p.y) }
  if (ctrl) return (
    <div ref={wrap} className="glwrap layer">
      <canvas ref={glRef} className="gl" />
      <canvas ref={txtRef} className="gl gltext" />
    </div>
  )
  return (
    <div ref={wrap} className="glwrap"
         onWheel={(e) => { const r = wrap.current!.getBoundingClientRect(); const cx = e.clientX - r.left, cy = e.clientY - r.top; const v = view.current; const z = Math.max(0.02, Math.min(2.5, v.zoom * Math.exp(-e.deltaY * 0.0015))); view.current = { zoom: z, tx: cx - (cx - v.tx) * (z / v.zoom), ty: cy - (cy - v.ty) * (z / v.zoom) }; bump((x) => x + 1) }}
         onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }}
         onPointerMove={(e) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true; view.current = { ...view.current, tx: view.current.tx + dx, ty: view.current.ty + dy }; d.x = e.clientX; d.y = e.clientY; bump((x) => x + 1) }}
         onPointerUp={(e) => { const d = drag.current; drag.current = null; if (d && !d.moved) onSelect?.(hit(e.clientX, e.clientY)?.id ?? null) }}
         onDoubleClick={(e) => { const n = hit(e.clientX, e.clientY); if (n && onDouble) onDouble(n.id) }}>
      <canvas ref={glRef} className="gl" />
      <canvas ref={txtRef} className="gl gltext" />
    </div>
  )
}
