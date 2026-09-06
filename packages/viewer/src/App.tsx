// Interface 2. Plan §7.6. One graph + kind filter + node cards + edge labels. Drag links to edit them (S8).
// Expanding a node shows its document headings as boxes inside it. Call edges leave from those heading boxes.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent, type PointerEvent as ReactPointerEvent } from 'react'

/** Edit permission (server mode) and notifications. Use context to avoid passing props deep into the right panel */
type Draft = { doc: string; hash: string; h: { line: number; body: string; range: { start: number; end: number } }; text: string }
const draftKey = (doc: string, line: number) => `${doc}::${line}`
const EditCtx = createContext<{ editable: boolean; editing: boolean; drafts: Map<string, Draft>; setDraft: (key: string, d: Draft) => void; notify: (kind: 'ok' | 'bad', text: string) => void }>(
  { editable: false, editing: false, drafts: new Map(), setDraft: () => {}, notify: () => {} })
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, BaseEdge, EdgeLabelRenderer,
  getBezierPath, MarkerType, useNodesState, useReactFlow, useStoreApi, useNodesInitialized, useStore, type Node, type Edge, type NodeProps, type EdgeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Graph, Node as SilNode, Edge as SilEdge, NodeKind, Diagnostic } from '@silmari/core'
import { useGraph, type Phase } from './data.ts'
import { useLayout } from './useLayout.ts'
import { DICTS, LangCtx, initialLang, saveLang, useLang, type Lang } from './i18n.ts'
import { GLCanvas, glHit, type GLEdge, type GLNode } from './gl.tsx'
import { type Cell, type LabelOrder, cells, skeleton, nodeSize, secPos, secHeight, SEC_W, SIZE, edgeLabelRows } from './layout.ts'
import { loadLocal, saveLocal, loadFile, setFileSink, scheduleFileSave, flushFileSave, serverSink, webviewSink, edgeKey, type Saved } from './store.ts'

const KIND: Record<NodeKind, { color: string }> = {
  task: { color: '#2563eb' }, doc: { color: '#059669' }, ghost: { color: '#dc2626' },
}
// There are three line types. Solid = call with data. Dashed = link only (mention or reference). Red dashed = missing file
const ETYPE: Record<SilEdge['type'], string> = { call: '#cbd5e1', mention: '#94a3b8', ref: '#94a3b8' }

type Hd = SilNode['headings'][number]
/** The right panel's two editing stages: 1 = prompt bodies as textareas, 2 = the whole file as text */
type EditApi = { editing: boolean; dirty: number; start: () => void; save: () => void; cancel: () => void; raw: { doc: string; hash: string; orig: string; text: string } | null; startRaw: (doc: string) => void; saveRaw: () => void; cancelRaw: () => void; setRawText: (text: string) => void }
type NData = { sil: SilNode; hot: boolean; dim: boolean; selected: boolean; isolated: boolean; open: boolean; entry: boolean; toggle: (id: string) => void; kids: number; folded: boolean; fold: (id: string) => void; unfoldDeep: (id: string) => void; onSize: (id: string, h: number) => void }
type SData = { doc: string; h: Hd; sel: boolean; hot: boolean; dim: boolean; calls: number }
type EData = { sil: SilEdge; k: number; hot: boolean; dim: boolean; ghost: boolean; label?: { x: number; y: number }; off: { dx: number; dy: number }; onDrag: (key: string, off: { dx: number; dy: number }) => void; idx: number; onMeasure: (idx: number, w: number, h: number) => void }
type RN = Node<NData, 'sil'>
type SN = Node<SData, 'sec'>
type RE = Edge<EData, 'sil'>
const secId = (doc: string, line: number) => `${doc}::${line}`

/** Measure handle positions as soon as a node enters the DOM. React Flow relies on the first ResizeObserver notice. If the node list changes first
 *  (label measurement → layout), new heading boxes are not measured. Edges from those boxes do not render */
function useMeasureOnMount(id: string) {
  const store = useStoreApi()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current?.closest<HTMLDivElement>('.react-flow__node')
    if (el) store.getState().updateNodeInternals(new Map([[id, { id, nodeElement: el, force: true }]]), { triggerFitView: false })
  }, [id, store])
  return ref
}

function SilNodeView({ id, data }: NodeProps<RN>) {
  const ref = useMeasureOnMount(id)
  const { t } = useLang()
  const lod = useContext(LodCtx)
  const n = data.sil
  const s = nodeSize(n, data.open)
  // Text is never cut: the title and file name wrap, the node grows, and the real height goes back to the layout
  useEffect(() => { const el = ref.current; if (el && !data.open) data.onSize(n.id, el.offsetHeight) })
  const bar = n.kind !== 'ghost' || data.kids > 0
  return (
    <div ref={ref} className={`nd ${n.kind}${data.selected ? ' sel' : ''}${data.hot ? ' hot' : ''}${data.isolated ? ' iso' : ''}${data.open ? ' open' : ''}`}
         style={{ width: s.w, ...(data.open ? { height: s.h } : { minHeight: s.h }), background: data.open ? undefined : KIND[n.kind].color, borderColor: data.open ? KIND[n.kind].color : undefined, opacity: data.dim ? 0.15 : 1 }}>
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Right} id="rt" />
      {/* Buttons sit in their own row above the text so the title keeps the full width. Children are to the right: ▸ opens one level,
          ▸▸ everything below, ◂ closes. ▾ opens the headings */}
      {bar && (
        <div className="bar">
          {data.kids > 0 && (data.folded ? (<>
            <button className="tg fold nodrag" title={t.unfoldOne} onClick={(ev) => { ev.stopPropagation(); data.fold(n.id) }}>▸</button>
            <button className="tg fold nodrag" title={t.unfoldDeep} onClick={(ev) => { ev.stopPropagation(); data.unfoldDeep(n.id) }}>▸▸</button>
          </>) : (
            <button className="tg fold nodrag" title={t.foldOne} onClick={(ev) => { ev.stopPropagation(); data.fold(n.id) }}>◂</button>
          ))}
          {n.kind !== 'ghost' && (
            <button className="tg nodrag" title={data.open ? t.collapse : t.expandTitle}
                    onClick={(ev) => { ev.stopPropagation(); data.toggle(n.id) }}>{data.open ? '▴' : '▾'}</button>
          )}
        </div>
      )}
      <div className="hd" title={`${n.title}\n${n.id}`}>
        <div className="t">{n.title}</div>
        {lod === 'full' && <div className="id">{n.kind === 'ghost' ? t.missingFile : n.id}{data.entry && <span className="entrychip" title={t.entryTitle}>{t.entry}</span>}</div>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

/** Heading box inside an expanded node. Call edges leave from its right side */
function SecNodeView({ id, data }: NodeProps<SN>) {
  const { h, sel, calls, hot, dim } = data
  const ref = useMeasureOnMount(id)
  const { t } = useLang()
  return (
    <div ref={ref} className={`sec l${h.level}${sel ? ' sel' : ''}${hot ? ' hot' : ''}${h.subagent ? ' iso' : ''}`} style={{ width: SEC_W, height: secHeight(h), opacity: dim ? 0.15 : 1 }} title={h.text}>
      {/* Show the title, line number, badge, and call count on one line. Wrap when long */}
      <div className="t">
        <span className="muted">{'#'.repeat(h.level)} </span>{h.text}
        <span className="muted ln"> :{h.line}</span>
        {h.subagent && <span className="badge iso">{t.subagent}</span>}
        {calls > 0 && <span className="calls">{t.calls(calls)}</span>}
      </div>
      <Handle type="source" position={Position.Right} id="r" />
    </div>
  )
}

function SilEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps<RE>) {
  const { sil: e, k, hot, dim, ghost, label, off, onDrag, idx, onMeasure } = data!
  const { t } = useLang()
  const lod = useContext(LodCtx)
  const rows = edgeLabelRows(e, { send: t.tagSend, ret: t.tagReceive })
  const { getZoom } = useReactFlow()
  // Report the rendered label's actual size. Layout uses it instead of an estimate, including the 3px glow
  const elRef = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = elRef.current; if (el) onMeasure(idx, el.offsetWidth + 6, el.offsetHeight + 6) })
  // Dragging a label box bends the curve through it. Inner keeps the offset and saves it in localStorage
  const [drag, setDrag] = useState(off)
  useEffect(() => setDrag(off), [off])
  const onPointerDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    ev.stopPropagation()
    const z = getZoom(), sx = ev.clientX, sy = ev.clientY, start = drag
    let last = start
    const move = (m: PointerEvent) => { last = { dx: start.dx + (m.clientX - sx) / z, dy: start.dy + (m.clientY - sy) / z }; setDrag(last) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); onDrag(edgeKey(e), last) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  // The line passes through the label position plus its drag offset. It bends at right angles. Vertical parts stay in a narrow strip beside the label column.
  // It crosses only its own label, not text in other labels
  let lx: number, ly: number
  if (label) { lx = label.x + drag.dx; ly = label.y + drag.dy }
  else { ;[, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.25 + k * 0.25 }); ly += k * 30; lx += drag.dx; ly += drag.dy }
  const m1 = (sourceX + lx) / 2, m2 = (lx + targetX) / 2
  const path = `M${sourceX},${sourceY} C${m1},${sourceY} ${m1},${ly} ${lx},${ly} C${m2},${ly} ${m2},${targetY} ${targetX},${targetY}`
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd}
                style={{ stroke: ghost ? '#f87171' : hot ? '#fff' : ETYPE[e.type], strokeWidth: hot ? 2.6 : 1.6, strokeDasharray: ghost || e.type !== 'call' ? '6 4' : undefined, opacity: dim ? 0.1 : hot ? 1 : 0.85 }} />
      {!dim && lod === 'full' && (rows.length > 0 || e.isolated) && (
        <EdgeLabelRenderer>
          {/* Subagent calls use a different label box. It has a purple border and top strip. Isolation belongs to the call, so it stays on the edge (§1.5) */}
          <div ref={elRef} className={`el nopan nodrag${e.isolated ? ' iso' : ''}`} onPointerDown={onPointerDown} title={t.dragToMove}
               style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, pointerEvents: 'all', cursor: 'grab' }}>
            {/* Top: show the target md. The label identifies it without tracing the line */}
            <div className="lt" title={t.target(e.to)}>→ {e.to}</div>
            {/* Head: containing heading (condition) + subagent badge / body: send · receive (fixed tag width) / foot: anchor */}
            {(rows.some((r) => r.kind === 'under') || e.isolated) && (
              <div className="lh">
                <span className="lhx" title={t.headingOfCall}>{rows.find((r) => r.kind === 'under')?.text ?? ''}</span>
                {e.isolated && <span className="badge iso">{t.subagent}</span>}
              </div>
            )}
            {/* Second section: anchor (references only) */}
            {rows.filter((r) => r.kind === 'anchor').map((r) => <div key="anchor" className="la anchor">{r.text}</div>)}
            {/* Third section: send → receive */}
            {rows.some((r) => r.tag) && (
              <div className="lb">
                {rows.filter((r) => r.tag).map((r) => (
                  <div key={r.kind} className={`row ${r.kind}`}>
                    <span className={`tag ${r.kind}`}>{r.kind === 'send' ? '→ ' : '← '}{r.tag}</span>
                    <span className="chips">{r.text.split(', ').map((v) => <span key={v} className={`chip ${r.kind}`}>{v}</span>)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

/** Level of detail. Below LOD_ZOOM the text is unreadable anyway, so nodes draw only their title and edges draw no label box. Cuts the DOM a lot when zoomed out */
const LOD_ZOOM = 0.5
const LodCtx = createContext<'full' | 'low'>('full')
type CData = { key: string; title: string; files: number; diags: number; entry: boolean }
type CN = Node<CData, 'cell'>
/** One box per flow in the overview map. Click to open that flow alone */
function CellNodeView({ data }: NodeProps<CN>) {
  const { t } = useLang()
  return (
    <div className={`cellnode${data.entry ? ' entry' : ''}`} style={{ width: CELL_W, height: CELL_H }} title={data.title}>
      <div className="t">{data.title}</div>
      <div className="s">{t.cellStats(data.files, data.diags)}</div>
    </div>
  )
}
const CELL_W = 240, CELL_H = 84
/** Above this many visible nodes the far view switches to the WebGL layer (with the DOM window on top when zoomed in) */
/** Above this many visible nodes the WebGL layer draws the far view. React Flow always holds only the nodes on screen (plus half a
 *  screen around them on each side, at most WIN_CAP nearest the center), so they are mounted and measured before they are needed. They stay hidden
 *  under the layer until a task node is DOM_SHOW_W px wide on screen; then the normal components show and the layer keeps drawing only
 *  the edges that leave that window */
const GL_THRESHOLD = 2000
const DOM_SHOW_W = 70, DOM_SHOW = DOM_SHOW_W / SIZE.task.w, WIN_PAD = 1, WIN_CAP = 400, GL_MIN_ZOOM = 0.02 // 70px = zoom 0.35
type Rect = { x0: number; y0: number; x1: number; y1: number; z: number }

/** The WebGL layer inside React Flow. It follows the viewport and never takes input, so panning and zooming stay React Flow's */
function GLLayer(props: { nodes: GLNode[]; edges: GLEdge[]; hide?: Set<string>; focus: Set<string> | null; selected: string | null; onUnavailable: () => void }) {
  const [tx, ty, zoom] = useStore((s) => s.transform)
  return <GLCanvas {...props} view={{ tx, ty, zoom }} />
}
type View = 'auto' | 'grid' | 'map' | { cell: string }
const nodeTypes = { sil: SilNodeView, sec: SecNodeView, cell: CellNodeView }
const edgeTypes = { sil: SilEdgeView }

export function App() {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const setLang = (l: Lang) => { saveLang(l); setLangState(l) }
  return <LangCtx.Provider value={{ lang, t: DICTS[lang], setLang }}><ReactFlowProvider><Inner /></ReactFlowProvider></LangCtx.Provider>
}

/** Heading that contains the edge's line. It is the last heading before that line */
const secOf = (n: SilNode, line: number): Hd | null => { let s: Hd | null = null; for (const h of n.headings) if (h.line <= line) s = h; return s }

/** Shown until the first graph arrives: a spinner, the phase, and the seconds elapsed (a big corpus takes several seconds to parse) */
function Loading({ phase, error }: { phase: Phase; error: string | null }) {
  const { t } = useLang()
  const [sec, setSec] = useState(0)
  useEffect(() => { const t0 = Date.now(); const id = setInterval(() => setSec(Math.floor((Date.now() - t0) / 1000)), 1000); return () => clearInterval(id) }, [])
  if (error) return <div className="empty"><div className="load"><span className="err">✖</span><span>{t.irError(error)}</span></div></div>
  return (
    <div className="empty">
      <div className="load" role="status" aria-live="polite">
        <span className="spin" />
        <span>{t.loading[phase]}</span>
        {sec > 0 && <span className="muted">{t.elapsed(sec)}</span>}
      </div>
    </div>
  )
}

function Inner() {
  const { t, lang, setLang } = useLang()
  const { graph, live, error, mode, root, phase, text: graphText } = useGraph()
  const [off, setOff] = useState<Set<NodeKind>>(new Set())
  const [sel, setSel] = useState<string | null>(null)
  const [selHead, setSelHead] = useState<{ doc: string; line: number } | null>(null)
  const [hov, setHov] = useState<string | null>(null)
  const wheelAt = useRef({ x: -1, y: -1 }) // where the last wheel event happened; a mouse move at exactly that spot is not the user's
  // Hover highlight ends as soon as the view moves. Otherwise a node the cursor brushed while zooming stays lit:
  // once it leaves the screen (or the DOM window), its mouseleave never comes
  const rfStoreForHov = useStoreApi()
  useEffect(() => { let last = rfStoreForHov.getState().transform; return rfStoreForHov.subscribe((st) => { if (st.transform !== last) { last = st.transform; setHov(null) } }) }, [rfStoreForHov])
  const [toast, setToast] = useState<{ kind: 'ok' | 'bad' | 'warn'; text: string } | null>(null)
  // Turn on edit mode with 'Edit' at the top of the right panel. 'Save' writes all changed bodies once per document
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map())
  const setDraft = (key: string, d: Draft) => setDrafts((prev) => { const m = new Map(prev); m.set(key, d); return m })
  const dirty = [...drafts.values()].filter((d) => d.text !== d.h.body)
  const cancelEdit = () => { setEditing(false); setDrafts(new Map()) }
  // Stage 2: the whole file as text. Headings, markers, links, everything. GET /file → textarea → PUT /file (Writer, hash-checked)
  const [raw, setRaw] = useState<{ doc: string; hash: string; orig: string; text: string } | null>(null)
  const startRaw = async (doc: string) => {
    try {
      const r = await fetch(`/file?path=${encodeURIComponent(doc)}`)
      const j = await r.json() as { text?: string; hash?: string; error?: string }
      if (!r.ok || j.text === undefined || !j.hash) { setToast({ kind: 'bad', text: j.error ?? t.failed }); setTimeout(() => setToast(null), 4000); return }
      cancelEdit(); setRaw({ doc, hash: j.hash, orig: j.text, text: j.text })
    } catch (err) { setToast({ kind: 'bad', text: String(err) }); setTimeout(() => setToast(null), 4000) }
  }
  const saveRaw = async () => {
    if (!raw) return
    try {
      const r = await fetch('/file', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: raw.doc, hash: raw.hash, text: raw.text }) })
      const j = await r.json() as { ok?: boolean; error?: string }
      setToast(r.ok ? { kind: 'ok', text: `${t.saved}${raw.doc}` } : { kind: 'bad', text: j.error ?? t.failed })
      if (r.ok) setRaw(null)
    } catch (err) { setToast({ kind: 'bad', text: String(err) }) }
    setTimeout(() => setToast(null), 6000)
  }
  const saveEdit = async () => {
    const byDoc = new Map<string, Draft[]>()
    for (const d of dirty) (byDoc.get(d.doc) ?? byDoc.set(d.doc, []).get(d.doc)!).push(d)
    const results: string[] = []
    let failed = false
    for (const [doc, ds] of byDoc) {
      try {
        const r = await fetch('/bodies', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: doc, hash: ds[0].hash, edits: ds.map((d) => ({ start: d.h.range.start, end: d.h.range.end, expect: d.h.body, text: d.text })) }) })
        const j = await r.json() as { ok?: boolean; count?: number; error?: string }
        if (r.ok) results.push(`${doc} ×${j.count}`); else { failed = true; results.push(`✖ ${doc}: ${j.error}`) }
      } catch (err) { failed = true; results.push(`✖ ${doc}: ${String(err)}`) }
    }
    setToast({ kind: failed ? 'bad' : 'ok', text: (failed ? t.someFailed : t.saved) + results.join(' · ') })
    setTimeout(() => setToast(null), 6000)
    if (!failed) cancelEdit()
  }
  // Save the right panel's open state in the browser
  const [sideOpen, setSideOpen] = useState(() => { try { return localStorage.getItem('silmari:side') !== 'closed' } catch { return true } })
  // Label order next to a parent's children: 'children' (each label at its child) or 'flow' (the parent's line order). Remembered per browser
  const [labelOrder, setLabelOrder] = useState<LabelOrder>(() => { try { return localStorage.getItem('silmari:labelOrder') === 'flow' ? 'flow' : 'children' } catch { return 'children' } })
  const [glOk, setGlOk] = useState(true) // false once the browser could not create a WebGL context; then everything stays DOM
  const toggleOrder = () => setLabelOrder((m) => { const n = m === 'flow' ? 'children' : 'flow'; try { localStorage.setItem('silmari:labelOrder', n) } catch { /* */ } return n })
  const toggleSide = () => setSideOpen((v) => { try { localStorage.setItem('silmari:side', v ? 'closed' : 'open') } catch { /* */ } return !v })
  const editable = mode === 'poll' // Editing needs a server. --out snapshots and webviews are read-only
  // Dragged node positions, label offsets, and expanded state. Save to localStorage now and .sil/layout.json after 5 seconds, at most 30 seconds later
  const [saved, setSaved] = useState<Saved>(() => loadLocal(root))
  useEffect(() => {
    let alive = true
    setFileSink(mode === 'poll' ? serverSink : mode === 'push' ? webviewSink : null)
    loadFile(mode).then((f) => { if (alive) setSaved(f ?? loadLocal(root)) })
    const flush = () => flushFileSave()
    window.addEventListener('beforeunload', flush)
    return () => { alive = false; window.removeEventListener('beforeunload', flush) }
  }, [root, mode])
  const update = (f: (s: Saved) => Saved) => setSaved((prev) => { const next = f(prev); saveLocal(root, next); scheduleFileSave(next); return next })
  const open = useMemo(() => new Set(saved.open), [saved.open])
  // Open sections and accordions travel with the layout file
  const uiSecs = useMemo(() => new Set(saved.ui?.secs ?? []), [saved.ui?.secs])
  const uiDet = useMemo(() => new Set(saved.ui?.det ?? []), [saved.ui?.det])
  const flipSec = (id: string) => update((s) => { const n = new Set(s.ui?.secs ?? []); n.has(id) ? n.delete(id) : n.add(id); return { ...s, ui: { ...s.ui, secs: [...n] } } })
  const setDet = (k: string, o: boolean) => update((s) => { const n = new Set(s.ui?.det ?? []); o ? n.add(k) : n.delete(k); return { ...s, ui: { ...s.ui, det: [...n] } } })
  const toggle = (id: string) => update((s) => ({ ...s, open: s.open.includes(id) ? s.open.filter((x) => x !== id) : [...s.open, id] }))
  const onLabelDrag = (key: string, o: { dx: number; dy: number }) => update((s) => ({ ...s, labels: { ...s.labels, [key]: o } }))

  const { fitView, setViewport } = useReactFlow()
  const rfStore = useStoreApi()
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RN | SN | CN>([])

  const kindVisible = useMemo(() => new Set((graph?.nodes ?? []).filter((n) => !off.has(n.kind)).map((n) => n.id)), [graph, off])
  // Flows: each connected part is a cell. 'map' draws one box per cell, { cell } draws one flow alone, 'grid' draws everything (only
  // when there is a single flow: unconnected flows are never drawn together)
  const cellList = useMemo<Cell[]>(() => (graph ? cells(graph, kindVisible) : []), [graph, kindVisible])
  const [view, setViewRaw] = useState<View>('auto')
  // Each view change is a history entry, so the browser's back button returns to the map. The canvas also shows a back button
  const setView = (v: View) => { setViewRaw(v); try { history.pushState({ silView: v }, '') } catch { /* webview */ } }
  useEffect(() => {
    try { history.replaceState({ silView: 'auto' }, '') } catch { /* */ }
    const onPop = (ev: PopStateEvent) => setViewRaw((ev.state as { silView?: View } | null)?.silView ?? 'auto')
    window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop)
  }, [])
  const flowMode: Exclude<View, 'auto'> = view === 'auto' ? (cellList.length > 1 ? 'map' : 'grid') : view
  const visibleAll = useMemo(() => {
    if (typeof flowMode === 'object') { const c = cellList.find((x) => x.key === flowMode.cell); return c ? new Set(c.nodes) : kindVisible }
    return kindVisible
  }, [flowMode, cellList, kindVisible])
  // Subtree folding. The call tree of each flow (its BFS parent links) says what hangs below a node. A folded node hides every
  // descendant. Every flow opens with everything below the first level folded; from then on the user's folds and unfolds are kept
  const trees = useMemo(() => cellList.filter((c) => !c.singles).map((c) => ({ cell: c, tree: skeleton(graph!, c.nodes.filter((id) => visibleAll.has(id))) })), [cellList, graph, visibleAll])
  const kidsOf = useMemo(() => { const m = new Map<string, string[]>(); for (const { tree } of trees) for (const [k, v] of tree.kids) m.set(k, v); return m }, [trees])
  const collapsed = useMemo<Set<string>>(() => {
    if (saved.collapsed) return new Set(saved.collapsed)
    const auto = new Set<string>()
    for (const { tree } of trees) for (const [id, r] of tree.rank) if (r >= 1 && tree.kids.has(id)) auto.add(id)
    return auto
  }, [saved.collapsed, trees])
  const hidden = useMemo(() => {
    const h = new Set<string>()
    const drop = (id: string) => { for (const k of kidsOf.get(id) ?? []) if (!h.has(k)) { h.add(k); drop(k) } }
    for (const id of collapsed) if (visibleAll.has(id)) drop(id)
    return h
  }, [collapsed, kidsOf, visibleAll])
  const hiddenBelow = useMemo(() => { const m = new Map<string, number>(); const count = (id: string): number => { let n = 0; for (const k of kidsOf.get(id) ?? []) n += 1 + count(k); return n }; for (const id of collapsed) if (visibleAll.has(id)) m.set(id, count(id)); return m }, [collapsed, kidsOf, visibleAll])
  const visible = useMemo(() => (hidden.size ? new Set([...visibleAll].filter((id) => !hidden.has(id))) : visibleAll), [visibleAll, hidden])
  // ▸ unfolds one level (the children keep their own state). ◂ folds this node and everything below it, so the next ▸ shows only the children
  const fold = (id: string) => update((s) => {
    pin(id)
    const c = new Set(s.collapsed ?? [...collapsed])
    if (c.has(id)) c.delete(id)
    else { const walk = (x: string) => { if (kidsOf.has(x)) c.add(x); for (const k of kidsOf.get(x) ?? []) walk(k) }; walk(id) }
    return { ...s, collapsed: [...c] }
  })
  // Unfold this node and everything below it in one go
  const unfoldDeep = (id: string) => update((s) => { pin(id); const c = new Set(s.collapsed ?? [...collapsed]); const walk = (x: string) => { c.delete(x); for (const k of kidsOf.get(x) ?? []) walk(k) }; walk(id); return { ...s, collapsed: [...c] } })
  // Folding or unfolding everything changes the picture completely, so the view refits (a single node's fold keeps the viewport instead)
  const foldAll = () => { fitKey.current = ''; update((s) => ({ ...s, collapsed: trees.flatMap(({ tree }) => [...tree.rank].filter(([id, r]) => r >= 1 && tree.kids.has(id)).map(([id]) => id)) })) }
  const unfoldAll = () => { fitKey.current = ''; update((s) => ({ ...s, collapsed: [] })) }
  // Measured node heights (titles wrap). Same idea as labels: estimate, render, measure, lay out again
  const [nodeH, setNodeH] = useState<Map<string, number>>(new Map())
  const onSize = (id: string, h: number) => setNodeH((prev) => (prev.get(id) === h ? prev : new Map(prev).set(id, h)))
  useEffect(() => { setNodeH(new Map()) }, [graph])
  // Measure labels. Render with estimates first, then measure and lay out again. Update only for changes over 1px to prevent a loop
  const [measured, setMeasured] = useState<Map<number, { w: number; h: number }>>(new Map())
  const onMeasure = (idx: number, w: number, h: number) => setMeasured((prev) => {
    const cur = prev.get(idx)
    if (cur && Math.abs(cur.w - w) <= 1 && Math.abs(cur.h - h) <= 1) return prev
    const next = new Map(prev); next.set(idx, { w, h }); return next
  })
  useEffect(() => { setMeasured(new Map()) }, [graph])
  // Expansion moves only lower nodes in that column. Expanded width is reserved in advance. Do not refit, so zoom stays unchanged
  // Layout: inline for small views, in a Web Worker for big ones (useLayout). `shown` is the visible set the returned layout belongs to;
  // everything drawn below uses it, so while the worker computes a new picture the old one stays whole instead of half-moving
  const layoutInput = useMemo(() => ({ visible, open, sizes: measured, pinned: saved.nodes, opts: { labelOrder, heights: nodeH } }), [visible, open, measured, saved.nodes, labelOrder, nodeH])
  const { placed, visible: shown, pending: laying } = useLayout(graph, graphText, layoutInput, flowMode !== 'map')
  const useGL = flowMode !== 'map' && glOk && shown.size > GL_THRESHOLD
  // Folding re-lays out the flow (a parent sits centered on its children), so the clicked node would jump. Remember where it was and,
  // once the new layout is in, move the viewport by the same amount so that node stays under the cursor
  const anchor = useRef<{ id: string; x: number; y: number } | null>(null)
  const pin = (id: string) => { const p = saved.nodes[id] ?? placed.nodes.get(id); if (p) anchor.current = { id, x: p.x, y: p.y } }
  const anchorTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    const a = anchor.current; if (!a) return
    const p = saved.nodes[a.id] ?? placed.nodes.get(a.id); if (!p) { anchor.current = null; return }
    const [vx, vy, z] = rfStore.getState().transform
    if (p.x !== a.x || p.y !== a.y) setViewport({ x: vx - (p.x - a.x) * z, y: vy - (p.y - a.y) * z, zoom: z })
    // The layout settles in two steps (estimated label sizes, then measured ones), so keep following the node for a moment
    anchor.current = { id: a.id, x: p.x, y: p.y }
    window.clearTimeout(anchorTimer.current); anchorTimer.current = window.setTimeout(() => { anchor.current = null }, 800)
  }, [placed, saved.nodes, rfStore, setViewport])
  const fitKey = useRef<string>('')
  const pendingFit = useRef<string | null>(null) // id list of the node set that still needs a fitView
  const [fitWanted, setFitWanted] = useState(false)
  // Re-renders only when the zoom crosses the threshold (the selector returns a boolean)
  // In hybrid mode the DOM window is hidden until DOM_SHOW anyway, so it always renders in full: labels get measured while out of sight
  const lod: 'full' | 'low' = useStore((s) => s.transform[2] < LOD_ZOOM) && !useGL ? 'low' : 'full'
  // Hybrid mode: the DOM window. From the first frame, keep a rectangle half a screen larger than the viewport and rebuild it only
  // when the viewport leaves it, so panning does not rebuild the node list every frame
  const domShow = useStore((s) => s.transform[2] >= DOM_SHOW)
  const [win, setWin] = useState<Rect | null>(null)
  useEffect(() => {
    if (!useGL) { setWin(null); return }
    const check = () => {
      const { transform: [tx, ty, z], width: W, height: H } = rfStore.getState()
      if (!W) return
      const r = { x0: -tx / z, y0: -ty / z, x1: (W - tx) / z, y1: (H - ty) / z }
      // Also rebuild when the zoom doubled or halved: a capped far window holds the nodes nearest its center, not the ones being zoomed into
      setWin((prev) => prev && r.x0 >= prev.x0 && r.y0 >= prev.y0 && r.x1 <= prev.x1 && r.y1 <= prev.y1 && z < prev.z * 2 && z > prev.z / 2 ? prev
        : { x0: r.x0 - (r.x1 - r.x0) * WIN_PAD, y0: r.y0 - (r.y1 - r.y0) * WIN_PAD, x1: r.x1 + (r.x1 - r.x0) * WIN_PAD, y1: r.y1 + (r.y1 - r.y0) * WIN_PAD, z })
    }
    check(); return rfStore.subscribe(check)
  }, [useGL, rfStore])
  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph])
  const isolatedTargets = useMemo(() => new Set((graph?.edges ?? []).filter((e) => e.isolated).map((e) => e.to)), [graph])
  // Same look as the DOM node: fill by kind, no border except purple 3px for subagent targets and pink for missing files
  const glNodes: GLNode[] = useMemo(() => !useGL || !graph ? [] : graph.nodes.filter((n) => shown.has(n.id)).map((n) => {
    const p = saved.nodes[n.id] ?? placed.nodes.get(n.id) ?? { x: 0, y: 0 }, s = { w: nodeSize(n, false).w, h: nodeH.get(n.id) ?? nodeSize(n, false).h }, iso = isolatedTargets.has(n.id)
    const fill = n.kind === 'ghost' ? '#7f1d1d' : KIND[n.kind].color
    const folded = hiddenBelow.has(n.id)
    const border = iso ? '#a78bfa' : n.kind === 'ghost' ? '#fca5a5' : folded ? '#e2e8f0' : fill
    return { id: n.id, x: p.x, y: p.y, w: s.w, h: s.h, color: fill, title: n.title, border, bw: iso ? 3 : n.kind === 'ghost' || folded ? 2 : 0, r: n.kind === 'task' ? 8 : 28 } // the DOM's border-radius: 8px, pills for docs
  }), [useGL, graph, shown, placed, saved.nodes, isolatedTargets, hiddenBelow, nodeH])
  // Same path as the DOM edge: through the label position (plus the user's drag offset), or the curve midpoint when there is no label
  const glEdges: GLEdge[] = useMemo(() => {
    if (!useGL || !graph) return []
    const seen = new Map<string, number>(), out: GLEdge[] = []
    graph.edges.forEach((e, i) => {
      if (!shown.has(e.from) || !shown.has(e.to)) return
      const key = `${e.from}>${e.to}`, k = seen.get(key) ?? 0; seen.set(key, k + 1)
      const ghost = byId.get(e.to)?.kind === 'ghost', off = saved.labels[edgeKey(e)] ?? { dx: 0, dy: 0 }
      const lab = placed.labels.get(i)
      let lx: number, ly: number
      if (lab) { lx = lab.x; ly = lab.y }
      else {
        const a = byId.get(e.from)!, b = byId.get(e.to)!, pa = saved.nodes[e.from] ?? placed.nodes.get(e.from) ?? { x: 0, y: 0 }, pb = saved.nodes[e.to] ?? placed.nodes.get(e.to) ?? { x: 0, y: 0 }
        const sa = nodeSize(a, false), sb = nodeSize(b, false)
        lx = (pa.x + sa.w + pb.x) / 2; ly = (pa.y + sa.h / 2 + pb.y + sb.h / 2) / 2 + k * 30
      }
      out.push({ from: e.from, to: e.to, color: ghost ? '#f87171' : ETYPE[e.type], dashed: ghost || e.type !== 'call', lx: lx + off.dx, ly: ly + off.dy, tRight: placed.sameCol.has(i) })
    })
    return out
  }, [useGL, graph, shown, byId, placed, saved.nodes, saved.labels])
  // Nodes React Flow gets in hybrid mode: those inside the window, the WIN_CAP nearest the center when there are more. null means every visible node (DOM only)
  const winIds = useMemo(() => {
    if (!useGL) return null
    if (!win) return new Set<string>()
    let inside = glNodes.filter((n) => n.x + n.w >= win.x0 && n.x <= win.x1 && n.y + n.h >= win.y0 && n.y <= win.y1)
    if (inside.length > WIN_CAP) {
      const cx = (win.x0 + win.x1) / 2, cy = (win.y0 + win.y1) / 2
      const d = (n: GLNode) => (n.x + n.w / 2 - cx) ** 2 + (n.y + n.h / 2 - cy) ** 2
      inside = inside.map((n) => [d(n), n] as const).sort((a, b) => a[0] - b[0]).slice(0, WIN_CAP).map((x) => x[1])
    }
    return new Set(inside.map((n) => n.id))
  }, [useGL, win, glNodes])
  // What the layer draws: everything while the DOM is hidden. Once it shows, the nodes the DOM has (the window) are skipped, every other
  // node (beyond WIN_CAP) still gets a rectangle, and only the edges that are not fully inside the window are drawn. The layer keeps
  // every node's geometry so those edges have both ends
  const layerHide = useMemo(() => (domShow && winIds ? winIds : undefined), [domShow, winIds])
  const layerEdges = useMemo(() => (!domShow || !winIds ? glEdges : glEdges.filter((e) => !(winIds.has(e.from) && winIds.has(e.to)))), [domShow, winIds, glEdges])
  // Fit to every visible node without React Flow's fitView, which only knows the windowed nodes. Waits for the pane to have a size
  const fitAll = useRef<() => void>(() => {})
  fitAll.current = () => {
    if (!glNodes.length) return
    const go = () => {
      const { width: W, height: H } = rfStore.getState(); if (!W) return false
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const n of glNodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h) }
      const zoom = Math.max(GL_MIN_ZOOM, Math.min(2.5, Math.min(W / (x1 - x0 + 80), H / (y1 - y0 + 80))))
      setViewport({ x: (W - (x1 + x0) * zoom) / 2, y: (H - (y1 + y0) * zoom) / 2, zoom }); return true
    }
    if (!go()) { const un = rfStore.subscribe(() => { if (go()) un() }) }
  }
  const nodesInitialized = useNodesInitialized()
  // Fit only when React Flow has measured the nodes. Earlier calls are ignored because unmeasured nodes have no bounds
  useEffect(() => { if (fitWanted && nodesInitialized) { setFitWanted(false); fitView({ padding: 0.15, duration: 200 }) } }, [fitWanted, nodesInitialized, fitView])
  const nb = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const e of graph?.edges ?? []) { (m.get(e.from) ?? m.set(e.from, new Set()).get(e.from)!).add(e.to); (m.get(e.to) ?? m.set(e.to, new Set()).get(e.to)!).add(e.from) }
    return m
  }, [graph])

  useEffect(() => {
    if (!graph) return
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const isOpenId = (id: string) => open.has(id) && byId.get(id)?.kind !== 'ghost'
    // Layout reserves the expanded size, so expansion does not need to move other nodes
    const pos = placed.nodes
    const out: (RN | SN | CN)[] = []
    if (flowMode === 'map') {
      // One box per flow, laid out as a simple grid. No edges: flows are disconnected by definition
      const cols = Math.ceil(Math.sqrt(cellList.length))
      // diagnostics per file once, then summed per flow (filtering the whole list per flow was quadratic: 47k files × 47k diagnostics)
      const diagsOf = new Map<string, number>()
      for (const d of graph.diagnostics) { const f = d.where.split(':')[0]; diagsOf.set(f, (diagsOf.get(f) ?? 0) + 1) }
      cellList.forEach((c, k) => {
        const first = byId.get(c.root)
        let diags = 0; for (const id of c.nodes) diags += diagsOf.get(id) ?? 0
        out.push({ id: `cell:${c.key}`, type: 'cell', position: { x: (k % cols) * (CELL_W + 40), y: Math.floor(k / cols) * (CELL_H + 32) }, width: CELL_W, height: CELL_H, draggable: false,
          data: { key: c.key, title: c.singles ? t.loose : (first?.title ?? c.key), files: c.nodes.length, diags, entry: c.entry } })
      })
    }
    for (const n of flowMode === 'map' ? [] : graph.nodes) {
      if (!shown.has(n.id) || (winIds && !winIds.has(n.id))) continue
      const isOpen = isOpenId(n.id)
      const s = nodeSize(n, isOpen)
      // A user-dragged position takes priority. Collapse and expansion do not reset it
      out.push({ id: n.id, type: 'sil', position: saved.nodes[n.id] ?? pos.get(n.id) ?? { x: 0, y: 0 }, width: s.w, height: isOpen ? s.h : (nodeH.get(n.id) ?? s.h),
        data: { sil: n, hot: false, dim: false, selected: false, isolated: isolatedTargets.has(n.id), open: isOpen, entry: (graph.entry ?? []).includes(n.id), toggle, kids: kidsOf.get(n.id)?.length ?? 0, folded: hiddenBelow.has(n.id), fold, unfoldDeep, onSize } })
      if (!isOpen) continue
      // Heading boxes inside an expanded node. Positions are relative to the parent. They cannot leave it or be dragged alone
      n.headings.forEach((h, i) => out.push({ id: secId(n.id, h.line), type: 'sec', parentId: n.id, extent: 'parent', draggable: false, selectable: false,
        position: secPos(n, i), width: SEC_W, height: secHeight(h),
        data: { doc: n.id, h, sel: false, hot: false, dim: false, calls: graph.edges.filter((e) => e.from === n.id && secOf(n, e.line)?.line === h.line).length } }))
    }
    // Keep earlier measurements. Otherwise React Flow drops handle positions. It does not remeasure same-sized nodes, so edges disappear
    setRfNodes((prev) => { const m = new Map(prev.map((x) => [x.id, x.measured])); return out.map((x) => (m.get(x.id) ? { ...x, measured: m.get(x.id) } : x)) })
    // Fit the view only when the graph or filter changes. This keeps zoom steady during expansion and collapse
    const key = `${graph.stats.files}|${graph.stats.edges}|${typeof flowMode === 'object' ? flowMode.cell : flowMode}|${[...visibleAll].join(',')}` // folding a subtree keeps the viewport
    // Not while the layout worker is still computing: there is nothing to fit yet, and the fit must happen once the positions arrive
    if (!laying && fitKey.current !== key) { fitKey.current = key; if (winIds) { pendingFit.current = null; fitAll.current() } else pendingFit.current = out.map((x) => x.id).join('|') } // fit once exactly these nodes are committed (below)
  }, [graph, shown, visibleAll, open, placed, laying, isolatedTargets, saved.nodes, setRfNodes, fitView, flowMode, cellList, winIds, kidsOf, hiddenBelow, nodeH]) // eslint-disable-line react-hooks/exhaustive-deps

  // Force measurement after unmeasured nodes (new heading boxes) enter the DOM. If the node list changes first (label measurement → layout),
  // React Flow cannot fill in handle positions. Edges for those nodes do not render
  // (useUpdateNodeInternals measures after requestAnimationFrame. The list can change meanwhile, so measure now)
  useEffect(() => {
    const { domNode, updateNodeInternals } = rfStore.getState()
    const updates = new Map<string, { id: string; nodeElement: HTMLDivElement; force: boolean }>()
    for (const x of rfNodes) if (!x.measured?.width) {
      const el = domNode?.querySelector<HTMLDivElement>(`.react-flow__node[data-id="${x.id}"]`)
      if (el) updates.set(x.id, { id: x.id, nodeElement: el, force: true })
    }
    if (updates.size) updateNodeInternals(updates, { triggerFitView: false })
    if (pendingFit.current !== null && rfNodes.map((x) => x.id).join('|') === pendingFit.current) { pendingFit.current = null; setFitWanted(true) }
  }, [rfNodes, rfStore, fitView])

  // Hover: the node under the cursor, its neighbors and its lines get brighter. Nothing dims, so a cursor left on a node after a zoom changes little
  const hi = hov ? new Set([hov, ...(nb.get(hov) ?? [])]) : null
  // Selection: the selected node and its neighbors stay, everything else fades. A click is deliberate, so this cannot be tripped by zooming; a click on empty space clears it
  const focus = useMemo(() => (sel ? new Set([sel, ...(nb.get(sel) ?? [])]) : null), [sel, nb])
  const nodes = rfNodes.map((x) => x.type === 'cell' ? x : x.type === 'sec'
    ? { ...x, data: { ...(x as SN).data, hot: !!hi && hi.has((x as SN).data.doc), dim: !!focus && !focus.has((x as SN).data.doc), sel: selHead?.doc === (x as SN).data.doc && selHead.line === (x as SN).data.h.line } } as SN
    : { ...x, data: { ...(x as RN).data, hot: !!hi && hi.has(x.id), dim: !!focus && !focus.has(x.id), selected: sel === x.id } } as RN)
  const seen = new Map<string, number>()
  const edges: RE[] = (flowMode === 'map' ? [] : graph?.edges ?? []).flatMap((e, i) => {
    if (!shown.has(e.from) || !shown.has(e.to) || (winIds && !(winIds.has(e.from) && winIds.has(e.to)))) return []
    const key = `${e.from}>${e.to}`; const k = seen.get(key) ?? 0; seen.set(key, k + 1)
    const hot = hov !== null && (e.from === hov || e.to === hov) // the hovered node's own lines light up; nothing else changes
    const dim = !!focus && !(focus.has(e.from) && focus.has(e.to))
    // In an expanded node, leave from the heading box that contains the line
    const from = byId.get(e.from)
    const sec = open.has(e.from) && from ? secOf(from, e.line) : null
    return [{ id: `e${i}`, source: sec ? secId(e.from, sec.line) : e.from, sourceHandle: sec ? 'r' : undefined, target: e.to, targetHandle: placed.sameCol.has(i) ? 'rt' : undefined, type: 'sil' as const,
              markerEnd: { type: MarkerType.ArrowClosed, color: byId.get(e.to)?.kind === 'ghost' ? '#f87171' : ETYPE[e.type], width: 14, height: 14 },
              data: { sil: e, k, hot, dim, ghost: byId.get(e.to)?.kind === 'ghost', label: placed.labels.get(i), off: saved.labels[edgeKey(e)] ?? { dx: 0, dy: 0 }, onDrag: onLabelDrag, idx: i, onMeasure } }]
  })

  if (!graph) return <Loading phase={phase} error={error} />

  return (
    <div className="app">
      <div className="canvas" onWheelCapture={(ev) => { wheelAt.current = { x: ev.clientX, y: ev.clientY } }}
           onDoubleClick={(ev) => {
             // Far view: a double click on a rectangle the layer drew folds or unfolds that subtree (DOM nodes handle their own double click)
             if (!useGL || (ev.target as HTMLElement).closest('.react-flow__node')) return
             const { transform: [tx, ty, zoom], domNode } = rfStore.getState(); const r = domNode?.getBoundingClientRect(); if (!r) return
             const n = glHit(glNodes, { tx, ty, zoom }, ev.clientX - r.left, ev.clientY - r.top)
             if (n && !layerHide?.has(n.id) && kidsOf.has(n.id)) fold(n.id) }}>
        {laying && <div className="busy" role="status"><span className="spin" />{t.laying}</div>}
        <LodCtx.Provider value={lod}>
        <ReactFlow className={useGL && !domShow ? 'domhide' : undefined} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange}
                   onNodeClick={(_, x) => { if (x.type === 'cell') { setView({ cell: (x as CN).data.key }); return } if (x.type === 'sec') { const d = (x as SN).data; setSel(d.doc); setSelHead({ doc: d.doc, line: d.h.line }) } else { setSel(x.id); setSelHead(null) } }}
                   onNodeDoubleClick={(_, x) => { if (x.type === 'sil' && (x as RN).data.sil.kind !== 'ghost') toggle(x.id) }}
                   onPaneClick={(ev) => {
                     // A click that reached the pane missed every DOM node, so it may be on a rectangle the layer drew: hit-test those
                     if (useGL) { const { transform: [tx, ty, zoom], domNode } = rfStore.getState(); const r = domNode?.getBoundingClientRect(); if (r) { const n = glHit(glNodes, { tx, ty, zoom }, ev.clientX - r.left, ev.clientY - r.top); setSel(n && !layerHide?.has(n.id) ? n.id : null); setSelHead(null); return } }
                     setSel(null); setSelHead(null) }}
                   onNodeDrag={(_, x) => { if (x.type === 'sil') update((s) => ({ ...s, nodes: { ...s.nodes, [x.id]: { x: x.position.x, y: x.position.y } } })) }}
                   onNodeDragStop={(_, x) => { if (x.type === 'sil') update((s) => ({ ...s, nodes: { ...s.nodes, [x.id]: { x: x.position.x, y: x.position.y } } })) }}
                   // Highlight only on real pointer movement. After a wheel zoom the browser fires a mouse move at the same spot by itself
                   onNodeMouseMove={(ev, x) => { if (ev.clientX === wheelAt.current.x && ev.clientY === wheelAt.current.y) return; setHov(x.type === 'sec' ? (x as SN).data.doc : x.id) }} onNodeMouseLeave={() => setHov(null)}
                   nodesConnectable={false} elementsSelectable={editable}
                   elevateEdgesOnSelect={false} elevateNodesOnSelect={false} onlyRenderVisibleElements={!useGL && rfNodes.length > 300} // in hybrid mode the window is already small; culling would leave margin nodes unmeasured, and their edges undrawn
                   minZoom={useGL ? GL_MIN_ZOOM : 0.2} maxZoom={2.5} zoomOnDoubleClick={!useGL} proOptions={{ hideAttribution: true }} colorMode="dark">
          <Background gap={24} color="#1e293b" />
          {useGL && <GLLayer nodes={glNodes} edges={layerEdges} hide={layerHide} focus={focus} selected={sel} onUnavailable={() => setGlOk(false)} />}
          <Controls showInteractive={false} onFitView={useGL ? () => fitAll.current() : undefined} />
          {!useGL && <MiniMap pannable zoomable nodeColor={(x) => (x.type === 'sec' ? '#334155' : x.type === 'cell' ? '#475569' : KIND[(x as RN).data.sil.kind].color)} maskColor="rgba(15,23,42,.7)" />}
        </ReactFlow>
        </LodCtx.Provider>
        <Legend />
        {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
        <div className="topbar">
          {cellList.length > 1 && flowMode !== 'map' && (<>
            <button className="resetbtn" onClick={() => setView('map')}>◂ {t.viewMap}</button>
            <span className="crumb">{flowMode === 'grid' ? t.viewGrid : (() => { const c = cellList.find((x) => x.key === flowMode.cell); return c?.singles ? t.loose : (byId.get(c?.root ?? '')?.title ?? flowMode.cell) })()}</span>
          </>)}
          {(Object.keys(saved.nodes).length > 0 || Object.keys(saved.labels).length > 0 || saved.collapsed) && (
            <button className="resetbtn" title={t.resetTitle} onClick={() => update((s) => ({ ...s, nodes: {}, labels: {}, collapsed: undefined }))}>{t.reset}</button>
          )}
        </div>
      </div>
      <EditCtx.Provider value={{ editable, editing, drafts, setDraft, notify: (kind, text) => { setToast({ kind, text }); setTimeout(() => setToast(null), 4000) } }}>
        <UiCtx.Provider value={{ secs: uiSecs, flipSec, det: uiDet, setDet }}>
        {sideOpen && <Side graph={graph} live={live} error={error} off={off} setOff={setOff} cellList={cellList} mode={flowMode} setView={setView} visible={visibleAll} sel={sel} setSel={setSel} selHead={selHead} open={open} toggle={toggle} edit={{ editing, dirty: dirty.length, start: () => { setRaw(null); setEditing(true) }, save: saveEdit, cancel: cancelEdit, raw, startRaw, saveRaw, cancelRaw: () => setRaw(null), setRawText: (text) => setRaw((r) => (r ? { ...r, text } : r)) }} />}
        </UiCtx.Provider>
      </EditCtx.Provider>
      {/* Menu rail at the right edge. It toggles the panel and stays visible while the panel is closed */}
      <nav className="rail">
        <button className={`railbtn${sideOpen ? ' on' : ''}`} onClick={toggleSide} title={sideOpen ? t.closeSide : t.openSide} aria-label={sideOpen ? t.closeSide : t.openSide}>
          {sideOpen ? '▸' : '◂'}
        </button>
        <button className="railbtn lang" onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')} title={t.langSwitchTitle} aria-label={t.langSwitchTitle}>{t.langSwitch}</button>
        <button className={`railbtn lang${labelOrder === 'flow' ? ' on' : ''}`} onClick={toggleOrder} title={t.orderTitle(labelOrder)} aria-label={t.orderTitle(labelOrder)}>{labelOrder === 'flow' ? t.orderFlow : t.orderChildren}</button>
        {kidsOf.size > 0 && <button className={`railbtn lang${collapsed.size ? ' on' : ''}`} onClick={collapsed.size ? unfoldAll : foldAll} title={collapsed.size ? t.expandAll : t.collapseAll} aria-label={collapsed.size ? t.expandAll : t.collapseAll}>{collapsed.size ? '▸▸' : '◂◂'}</button>}
      </nav>
    </div>
  )
}

/** Right panel section: a heading that folds its body. Every section starts folded; which ones are open is saved with the layout */
function Sec({ id, title, extra, children }: { id: string; title: string; extra?: ReactNode; children: ReactNode }) {
  const { secs, flipSec } = useContext(UiCtx)
  const isOpen = secs.has(id)
  return (
    <section>
      <h2 className={`sech${isOpen ? ' open' : ''}`} onClick={() => flipSec(id)}><span className="tri">{isOpen ? '▾' : '▸'}</span>{title}{extra}</h2>
      {isOpen && children}
    </section>
  )
}

function Side({ graph, live, error, off, setOff, cellList, mode, setView, visible, sel, setSel, selHead, open, toggle, edit }: {
  graph: Graph; live: boolean; error: string | null; off: Set<NodeKind>; setOff: (s: Set<NodeKind>) => void
  cellList: Cell[]; mode: Exclude<View, 'auto'>; setView: (v: View) => void; visible: Set<string>
  sel: string | null; setSel: (id: string | null) => void; selHead: { doc: string; line: number } | null; open: Set<string>; toggle: (id: string) => void
  edit: EditApi
}) {
  const { t } = useLang()
  const node = sel ? graph.nodes.find((n) => n.id === sel) : undefined
  // Stable identity: the list resets its scroll paging only when the diagnostics really change, not on every re-render
  const diags = useMemo(() => (typeof mode === 'object' ? graph.diagnostics.filter((d) => visible.has(d.where.split(':')[0])) : graph.diagnostics), [graph, mode, visible])
  const flip = (k: NodeKind) => { const s = new Set(off); s.has(k) ? s.delete(k) : s.add(k); setOff(s) }
  return (
    <aside className="side">
      <h1>silmari <span className={`badge ${live ? (error ? 'bad' : 'live') : ''}`}>{live ? (error ? t.disconnected : 'live') : t.snapshot}</span></h1>
      <div className="sub">{t.stats(graph.stats)}</div>
      {cellList.length > 1 && (<Sec id="flows" title={t.flows} extra={<span className="cnt">{cellList.length}</span>}>
        <div className={`f${mode === 'map' ? ' on' : ''}`} onClick={() => setView('map')}>{t.viewMap}<span className="cnt">{cellList.length}</span></div>
        {cellList.map((c) => {
          const first = graph.nodes.find((n) => n.id === c.root)
          return <div key={c.key} className={`f${typeof mode === 'object' && mode.cell === c.key ? ' on' : ''}`} onClick={() => setView({ cell: c.key })}>
            <span className="dot" style={{ background: c.singles ? '#64748b' : KIND[first?.kind ?? 'task'].color }} />{c.singles ? t.loose : first?.title ?? c.key}{c.entry && <span className="entrychip">{t.entry}</span>}<span className="cnt">{c.nodes.length}</span>
          </div>
        })}
      </Sec>)}
      <Sec id="kinds" title={t.kinds} extra={off.size ? <span className="cnt">−{off.size}</span> : null}>
        {(Object.keys(KIND) as NodeKind[]).map((k) => (
          <label key={k} className="f">
            <input type="checkbox" checked={!off.has(k)} onChange={() => flip(k)} />
            <span className="dot" style={{ background: KIND[k].color }} />{t.kind[k]} <code>{k}</code>
            <span className="cnt">{graph.stats.nodesByKind[k] ?? 0}</span>
          </label>
        ))}
      </Sec>
      <Sec id="node" title={t.selectedNode} extra={node ? <span className="cnt">{node.title}</span> : null}>
        <div className="det">{node ? <Detail graph={graph} node={node} go={setSel} selHead={selHead} isOpen={open.has(node.id)} toggle={toggle} edit={edit} /> : <span className="muted">{t.clickHint}</span>}</div>
      </Sec>
      <Sec id="diag" title={t.diagnostics} extra={<span className="cnt">{diags.length}</span>}>
        <DiagList ds={diags} go={setSel} />
      </Sec>
    </aside>
  )
}

/** Legend. Three line types, three node colors, and subagents */
function Legend() {
  const { t } = useLang()
  const line = (dash: string | undefined, color: string) => (
    <svg width="34" height="10"><line x1="1" y1="5" x2="33" y2="5" stroke={color} strokeWidth="1.6" strokeDasharray={dash} /></svg>
  )
  return (
    <div className="legend">
      <div>{line(undefined, '#cbd5e1')}<span>{t.legendCall}</span></div>
      <div>{line('6 4', '#94a3b8')}<span>{t.legendRef}</span></div>
      <div>{line('6 4', '#f87171')}<span>{t.legendMissing}</span></div>
      <div><i style={{ background: KIND.task.color }} /><span>{t.legendTask}</span><i style={{ background: KIND.doc.color }} /><span>{t.legendDoc}</span><i style={{ background: KIND.ghost.color }} /><span>{t.legendGhost}</span></div>
      <div><i className="isoi" /><span>{t.legendSubagent}</span></div>
    </div>
  )
}

/** Diagnostics list with infinite scroll. Tens of thousands of entries would freeze the panel, so it renders a page and adds one more
 *  each time the sentinel at the end scrolls into view */
const DIAG_PAGE = 100
function DiagList({ ds, go }: { ds: Diagnostic[]; go: (id: string) => void }) {
  const { t } = useLang()
  const [shown, setShown] = useState(DIAG_PAGE)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { setShown(DIAG_PAGE) }, [ds])
  useEffect(() => {
    const el = end.current; if (!el || shown >= ds.length) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setShown((n) => Math.min(ds.length, n + DIAG_PAGE)) })
    io.observe(el); return () => io.disconnect()
  }, [shown, ds])
  return (
    <>
      <div>{ds.length === 0 ? <span className="muted">{t.none}</span> : ds.slice(0, shown).map((d, i) => <Diag key={i} d={d} go={go} />)}</div>
      {ds.length > shown && <div ref={end} className="more muted">{t.shownOf(shown, ds.length)} …</div>}
    </>
  )
}

function Diag({ d, go }: { d: Diagnostic; go: (id: string) => void }) {
  const file = d.where.split(':')[0]
  return (
    <div className={`d ${d.severity}`} onClick={() => go(file)}>
      <code>{d.code}</code> {d.message}<span className="w">{d.where}</span>
    </div>
  )
}

function Detail({ graph, node: n, go, selHead, isOpen, toggle, edit }: { graph: Graph; node: SilNode; go: (id: string) => void; selHead: { doc: string; line: number } | null; isOpen: boolean; toggle: (id: string) => void; edit: EditApi }) {
  const { editable } = useContext(EditCtx)
  const { t } = useLang()
  const rawHere = edit.raw?.doc === n.id ? edit.raw : null
  const out = graph.edges.filter((e) => e.from === n.id), inn = graph.edges.filter((e) => e.to === n.id)
  const head = selHead?.doc === n.id ? n.headings.find((h) => h.line === selHead.line) : undefined
  const row = (e: SilEdge, other: string) => (
    <div key={`${e.from}${e.to}${e.line}`} className="er">
      <span className="et">{e.type}</span> <a onClick={() => go(other)}>{other}</a>
      {e.sends.length > 0 && <span> {t.send} {e.sends.join(', ')}</span>}
      {e.returns.length > 0 && <span> {t.receive} {e.returns.join(', ')}</span>}
      {e.anchor && <span> #{e.anchor}</span>}
      <span className="muted"> :{e.line}</span>
    </div>
  )
  return (
    <>
      <div className="t">{n.title} <code className="muted">{n.kind}</code>
        {n.kind !== 'ghost' && <button className="detailbtn" onClick={() => toggle(n.id)}>{isOpen ? t.collapseBtn : t.expandBtn}</button>}
        {/* Stage 1: prompt bodies as textareas; Save writes every changed body, including bodies in called documents. Stage 2: the whole file as text */}
        {n.kind !== 'ghost' && editable && !edit.editing && !rawHere && <button className="detailbtn edit" title={t.editTitle} onClick={edit.start}>{t.edit}</button>}
        {n.kind !== 'ghost' && editable && !edit.editing && !rawHere && <button className="detailbtn edit raw" title={t.rawTitle} onClick={() => edit.startRaw(n.id)}>{t.rawEdit}</button>}
        {edit.editing && <button className="detailbtn ghost" onClick={edit.cancel}>{t.cancel}</button>}
        {edit.editing && <button className="detailbtn save" disabled={!edit.dirty} onClick={edit.save}>{t.save}{edit.dirty ? ` ${edit.dirty}` : ''}</button>}
        {rawHere && <button className="detailbtn ghost" onClick={edit.cancelRaw}>{t.cancel}</button>}
        {rawHere && <button className="detailbtn save" disabled={rawHere.text === rawHere.orig} onClick={edit.saveRaw}>{t.save}</button>}
      </div>
      {rawHere && (
        <textarea className="rawedit" value={rawHere.text} spellCheck={false} rows={Math.min(60, Math.max(12, rawHere.text.split('\n').length + 2))}
                  onChange={(ev) => edit.setRawText(ev.target.value)} />
      )}
      {n.desc && <div className="desc">{n.desc}</div>}
      {/* Keep metadata (registration · contract · edges) collapsed and focus on the prompt */}
      <Det k="m" className="meta-d" summary={<span className="muted">{t.summary(out.length + inn.length)}</span>}>
        {n.agent && (
          <div className="ct"><b>{t.registeredAgent}</b>
            {n.agent.name && <span>{n.agent.name} </span>}{n.agent.model && <span className="muted">· {n.agent.model}</span>}
            {n.agent.tools && <div>tools: {n.agent.tools.join(', ')}</div>}
          </div>
        )}
        {n.contract && (
          <div className="ct"><b>{t.inputs}</b> {n.contract.inputs.join(', ') || '—'}<br /><b>{t.outputs}</b> {n.contract.outputs.join(', ') || '—'}</div>
        )}
        <div className="ct"><b>{t.out}</b>{out.length ? out.map((e) => row(e, e.to)) : <span className="muted"> {t.none}</span>}</div>
        <div className="ct"><b>{t.in}</b>{inn.length ? inn.map((e) => row(e, e.from)) : <span className="muted"> {t.none}</span>}</div>
      </Det>
      {/* Prompt. If a heading is selected, show it, its subheadings, and documents called in that section. Otherwise, show the whole document and all called documents.
          Do not show parent or sibling headings */}
      {rawHere ? null : head ? (() => {
        const hs = n.headings, i = hs.indexOf(head)
        let j = i + 1; while (j < hs.length && hs[j].level > head.level) j++
        const endLine = j < hs.length ? hs[j].line : Infinity
        return (
          <>
            <div className="prompt-of"><span className="muted">{t.prompt}</span> <b>{'#'.repeat(head.level)} {head.text}</b> <span className="muted">{t.thisSectionOnly}</span></div>
            <HeadingTree key={`${n.id}:${head.line}`} doc={n.id} hash={n.hash} hs={hs.slice(i, j)} />
            <Descendants graph={graph} id={n.id} go={go} within={(e) => e.line >= head.line && e.line < endLine} />
          </>
        )
      })() : (
        <>
          <div className="prompt-of"><span className="muted">{t.prompt}</span> <b>{n.title}</b></div>
          <HeadingTree key={n.id} doc={n.id} hash={n.hash} hs={n.headings} />
          <Descendants graph={graph} id={n.id} go={go} />
        </>
      )}
    </>
  )
}

/** Prompts of documents called by this node. In call order, also show their called documents (for a → b → c, selecting a shows a·b·c; selecting b shows b·c) */
function Descendants({ graph, id, go, within }: { graph: Graph; id: string; go: (id: string) => void; within?: (e: SilEdge) => boolean }) {
  const { t } = useLang()
  const byId = new Map(graph.nodes.map((x) => [x.id, x]))
  const chain: { node: SilNode; depth: number; via: SilEdge }[] = []
  const seen = new Set<string>([id])
  const walk = (from: string, depth: number) => {
    for (const e of graph.edges) {
      if (e.from !== from || seen.has(e.to)) continue
      if (depth === 0 && within && !within(e)) continue // Exclude calls outside the heading section
      const t = byId.get(e.to); if (!t || t.kind === 'ghost') continue
      seen.add(e.to); chain.push({ node: t, depth, via: e }); walk(e.to, depth + 1)
    }
  }
  walk(id, 0)
  if (!chain.length) return null
  return (
    <div className="desc-chain">
      {chain.map(({ node: c, depth, via }) => (
        <Det key={c.id} k={`c:${c.id}`} className="child" style={{ marginLeft: depth * 12 }} summary={<>
            <span className="muted">{t.promptOf}</span><a onClick={(ev) => { ev.preventDefault(); go(c.id) }}>{c.title}</a> <code className="muted">{c.id}</code>
            {via.isolated && <span className="badge iso">{t.subagent}</span>}
            {via.sends.length > 0 && <span className="muted"> {t.send} {via.sends.join(', ')}</span>}
            {via.returns.length > 0 && <span className="muted"> {t.receive} {via.returns.join(', ')}</span>}
          </>}>
          {c.desc && <div className="desc">{c.desc}</div>}
          <HeadingTree doc={c.id} hash={c.hash} hs={c.headings} />
        </Det>
      ))}
    </div>
  )
}

/** Which accordions are open, saved with the layout (browser + .sil/layout.json) so they follow the project: right-panel sections by id,
 *  and inside the selected-node panel 'm' = the metadata block, 'c:<doc>' = a called document's prompt, 'h:<doc>:<line>' = a heading.
 *  Everything starts closed */
const UiCtx = createContext<{ secs: Set<string>; flipSec: (id: string) => void; det: Set<string>; setDet: (k: string, open: boolean) => void }>(
  { secs: new Set(), flipSec: () => {}, det: new Set(), setDet: () => {} })
/** A <details> whose open state is remembered under key k */
function Det({ k, className, style, summary, children }: { k: string; className?: string; style?: CSSProperties; summary: ReactNode; children: ReactNode }) {
  const { det, setDet } = useContext(UiCtx)
  return <details className={className} style={style} open={det.has(k)} onToggle={(ev) => { const o = ev.currentTarget.open; if (o !== det.has(k)) setDet(k, o) }}><summary>{summary}</summary>{children}</details>
}

/** Heading body. It is a textarea in edit mode. Inner collects drafts. One 'Save' writes them once per document (PATCH /bodies) */
function BodyEditor({ doc, hash, h }: { doc: string; hash: string; h: Hd }) {
  const { editing, drafts, setDraft } = useContext(EditCtx)
  const { t } = useLang()
  const key = draftKey(doc, h.line)
  const text = drafts.get(key)?.text ?? h.body
  if (!editing) return h.body ? <pre className="body">{h.body}</pre> : <div className="leaf muted">{t.empty}</div>
  return (
    <textarea className={`bodyedit${text !== h.body ? ' dirty' : ''}`} value={text} spellCheck={false}
              rows={Math.min(24, Math.max(3, text.split('\n').length + 1))}
              onChange={(ev) => setDraft(key, { doc, hash, h, text: ev.target.value })} />
  )
}

function HeadingTree({ doc, hash, hs }: { doc: string; hash: string; hs: SilNode['headings'] }) {
  const { t: tt } = useLang()
  // Heading array → nested <details>. A deeper level is a child (# contains ##, ## contains ###). The same or a higher level is a sibling.
  // Keep open/closed state in React. With <details open> alone, every render such as hover forced it open and the accordion would not close.
  // Everything starts closed; the user opens the headings they want to read
  type T = { h: SilNode['headings'][number]; kids: T[] }
  const roots: T[] = []; const st: T[] = []
  for (const h of hs) {
    const t: T = { h, kids: [] }
    while (st.length && st[st.length - 1].h.level >= h.level) st.pop()
    ;(st.length ? st[st.length - 1].kids : roots).push(t); st.push(t)
  }
  const { det, setDet } = useContext(UiCtx)
  const onToggle = (line: number) => (ev: SyntheticEvent<HTMLDetailsElement>) => { const o = ev.currentTarget.open; if (o !== det.has(`h:${doc}:${line}`)) setDet(`h:${doc}:${line}`, o) }
  const render = (t: T) => (
    <details key={t.h.line} open={det.has(`h:${doc}:${t.h.line}`)} onToggle={onToggle(t.h.line)}>
      <summary>
        <span className="muted">{'#'.repeat(t.h.level)} </span>{t.h.text}
        {t.h.subagent && <span className="badge iso">{tt.subagent}</span>}<span className="muted"> :{t.h.line}</span>
      </summary>
      <BodyEditor doc={doc} hash={hash} h={t.h} />
      {t.kids.map(render)}
    </details>
  )
  return <div className="tree">{roots.map(render)}</div>
}
