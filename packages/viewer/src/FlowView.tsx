// The flow views (flows.ts) on the canvas: the SVG in a stage that pans with a drag and zooms with the wheel around the cursor.
// A click on an element with `data-id` selects that document, so the side panel works as it does in the graph view.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Graph } from '@silmari/core'
import { flowModel, spineView, laneView } from './flows.ts'
import { useLang } from './i18n.ts'

export type CanvasView = 'graph' | 'spine' | 'lanes'

export function FlowView({ graph, kind, only, sel, onSelect }: { graph: Graph; kind: 'spine' | 'lanes'; only?: Set<string>; sel: string | null; onSelect: (id: string | null) => void }) {
  const M = useMemo(() => flowModel(graph), [graph])
  const d = useMemo(() => (kind === 'spine' ? spineView(M, only) : laneView(M, only)), [M, kind, only])
  const box = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null)
  const [t, setT] = useState({ x: 20, y: 20, k: 1 })
  // Fit the width on a new picture, never above 100 %: a long flow is read by panning, not shrunk to dots
  useEffect(() => {
    const r = box.current?.getBoundingClientRect(); if (!r) return
    setT({ x: 20, y: 20, k: Math.max(0.35, Math.min(1, (r.width - 40) / d.w)) })
  }, [d])
  // Wheel zooms around the cursor. A native listener: React's wheel listener is passive and cannot stop the page from scrolling
  useEffect(() => {
    const el = box.current; if (!el) return
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const r = el.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top
      setT((p) => { const k = Math.min(2.5, Math.max(0.15, p.k * Math.exp(-ev.deltaY * 0.0015))); return { k, x: mx - ((mx - p.x) * k) / p.k, y: my - ((my - p.y) * k) / p.k } })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  // Drag pans; a press that did not move is a click
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)
  const down = (ev: React.PointerEvent) => { drag.current = { x: ev.clientX, y: ev.clientY, tx: t.x, ty: t.y, moved: false }; (ev.target as Element).setPointerCapture?.(ev.pointerId) }
  const move = (ev: React.PointerEvent) => {
    const g = drag.current; if (!g) return
    const dx = ev.clientX - g.x, dy = ev.clientY - g.y
    if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true
    if (g.moved) setT((p) => ({ ...p, x: g.tx + dx, y: g.ty + dy }))
  }
  const up = (ev: React.PointerEvent) => {
    const g = drag.current; drag.current = null
    if (!g || g.moved) return
    const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-id]')
    onSelect(hit?.getAttribute('data-id') ?? null)
  }
  // The selected document lights up wherever it is drawn
  useEffect(() => {
    const el = stage.current; if (!el) return
    el.querySelectorAll('.fv-sel').forEach((x) => x.classList.remove('fv-sel'))
    if (sel) el.querySelectorAll(`[data-id="${CSS.escape(sel)}"]`).forEach((x) => x.classList.add('fv-sel'))
  }, [sel, d])
  return (
    <div className="fv" ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      <div className="fv-stage" ref={stage} style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})` }} dangerouslySetInnerHTML={{ __html: d.svg }} />
      <FlowLegend kind={kind} />
    </div>
  )
}

/** What each mark means, in the same place and look as the graph's legend */
function FlowLegend({ kind }: { kind: 'spine' | 'lanes' }) {
  const { t } = useLang(), L = t.fvLegend
  const line = (cls: string) => <svg width="34" height="10"><path className={cls} d="M1 5 H33" /></svg>
  const pill = (cls: string) => <svg width="34" height="14"><g className={cls}><rect x="1" y="1" width="32" height="12" rx="6" /></g></svg>
  const box = (cls: string, rx = 3) => <svg width="34" height="14"><g className={cls}><rect x="5" y="1" width="24" height="12" rx={rx} /></g></svg>
  const text = (cls: string, s: string) => <svg width="34" height="12"><text className={cls} x="1" y="10">{s}</text></svg>
  const rows: [ReactNode, string][] = kind === 'spine'
    ? [[line('fv-next'), L.next], [pill('fv-step'), L.step], [pill('fv-step iso'), L.stepIso], [pill('fv-step exec'), L.stepExec],
       [box('fv-leaf'), L.called], [box('fv-file', 7), L.file], [text('fv-carry', 'abc'), L.carry], [line('fv-pick'), L.pick], [line('fv-share'), L.share]]
    : [[box('fv-lanelab own'), L.laneOwn], [box('fv-lanelab'), L.lane], [line('fv-bcall'), L.call], [line('fv-bcall iso'), L.callIso], [line('fv-bret'), L.ret],
       [text('fv-carry', 'abc'), L.sends], [text('fv-ret', 'abc'), L.returns], [line('fv-bracket-l'), L.bracket]]
  return (
    <div className="legend fv-legend" onPointerDown={(ev) => ev.stopPropagation()}>
      {rows.map(([mark, label]) => <div key={label}>{mark}<span>{label}</span></div>)}
    </div>
  )
}
