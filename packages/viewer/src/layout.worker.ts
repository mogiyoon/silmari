// Web Worker that runs layout() off the main thread. On a big corpus (46k nodes unfolded) layout takes ~5 s; in a worker the page
// keeps responding and shows a badge instead of freezing. The graph is sent once (as its JSON text, which copies in a few ms and
// parses here) and kept; each layout request then carries only the sets and maps that changed. Bundled inline (?worker&inline) so the
// single-file viewer and the VS Code webview need no extra file
import type { Graph } from '@silmari/core'
import { layout, type Placed } from './layout.ts'
import type { WorkerIn, WorkerOut } from './useLayout.ts'

let g: Graph | null = null
self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const m = ev.data
  if (m.type === 'graph') { g = typeof m.graph === 'string' ? (JSON.parse(m.graph) as Graph) : m.graph; return }
  const placed: Placed = g ? layout(g, m.visible, m.open, m.sizes, m.pinned, m.opts) : { nodes: new Map(), labels: new Map(), cycles: new Set(), sameCol: new Set() }
  postMessage({ type: 'placed', id: m.id, placed } satisfies WorkerOut)
}
