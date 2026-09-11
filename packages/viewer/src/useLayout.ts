// Layout on the main thread for small views, in a Web Worker for big ones. The hook hands back the last finished layout together
// with the visible set it was computed for, so the picture stays consistent while a new one is being computed (nodes that just became
// visible have no position yet and would otherwise flash at the origin). `pending` is true while the worker is busy
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Graph } from '@silmari/core'
import { layout, type LayoutOpts, type Placed } from './layout.ts'
import LayoutWorker from './layout.worker.ts?worker&inline'

/** Below this many visible nodes layout runs inline (about 100 ms at most): no worker round trip, and the label-measure → re-layout loop settles in one render */
export const WORKER_MIN = 2000

export interface LayoutInput { visible: Set<string>; open: Set<string>; sizes: Map<number, { w: number; h: number }>; pinned: Record<string, { x: number; y: number }>; opts: LayoutOpts }
export type WorkerIn = { type: 'graph'; graph: Graph | string } | ({ type: 'layout'; id: number } & LayoutInput)
export type WorkerOut = { type: 'placed'; id: number; placed: Placed }

const EMPTY: Placed = { nodes: new Map(), labels: new Map(), returnRoutes: new Map(), readRoutes: new Map(), right: new Map(), cycles: new Set(), sameCol: new Set() }
const NONE = new Set<string>()
type Shown = { placed: Placed; visible: Set<string> }

export function useLayout(graph: Graph | null, graphText: string | null, input: LayoutInput, enabled: boolean): Shown & { pending: boolean } {
  const big = enabled && !!graph && input.visible.size >= WORKER_MIN
  // Inline path. useMemo on the input object: App builds a new one only when a part changed
  const sync = useMemo<Shown | null>(() => (enabled && graph && !big ? { placed: layout(graph, input.visible, input.open, input.sizes, input.pinned, input.opts), visible: input.visible } : null), [enabled, graph, big, input])

  // Worker path. One worker per mount; the graph goes over once per graph object
  const worker = useRef<Worker | null>(null)
  const sentGraph = useRef<Graph | null>(null)
  const reqId = useRef(0)
  const pendingInput = useRef<LayoutInput | null>(null) // the input the latest request was made for
  const [done, setDone] = useState<{ input: LayoutInput; shown: Shown } | null>(null)
  useEffect(() => () => { worker.current?.terminate(); worker.current = null; sentGraph.current = null }, [])
  useEffect(() => {
    if (!big || !graph) return
    if (!worker.current) {
      worker.current = new LayoutWorker()
      worker.current.onmessage = (ev: MessageEvent<WorkerOut>) => { if (ev.data.id === reqId.current) setDone({ input: pendingInput.current!, shown: { placed: ev.data.placed, visible: pendingInput.current!.visible } }) }
    }
    if (sentGraph.current !== graph) { sentGraph.current = graph; worker.current.postMessage({ type: 'graph', graph: graphText ?? JSON.stringify(graph) } satisfies WorkerIn) }
    pendingInput.current = input
    worker.current.postMessage({ type: 'layout', id: ++reqId.current, ...input } satisfies WorkerIn)
  }, [big, graph, graphText, input])

  // What to show: the inline result, else the worker result for exactly this input, else the last thing shown. Nothing at all after a
  // graph change or while disabled (the map view): a stale set with an empty layout would put every node at the origin, and once a
  // view with no WebGL had 46k nodes handed to the DOM that way
  const last = useRef<Shown>({ placed: EMPTY, visible: NONE })
  const lastGraph = useRef<Graph | null>(null)
  if (lastGraph.current !== graph) { lastGraph.current = graph; last.current = { placed: EMPTY, visible: NONE } }
  if (!enabled || !graph) { last.current = { placed: EMPTY, visible: NONE }; return { ...last.current, pending: false } }
  if (sync) { last.current = sync; return { ...sync, pending: false } }
  if (done && done.input === input) { last.current = done.shown; return { ...done.shown, pending: false } }
  return { ...last.current, pending: true }
}
