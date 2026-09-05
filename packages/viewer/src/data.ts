// There are three IR paths. Use the value for sil view --out. For null, receive postMessage in a VS Code webview. Otherwise, poll /graph every 2 seconds.
import type { Graph } from '@silmari/core'
import { useEffect, useState } from 'react'

declare global { interface Window { __SIL_GRAPH__?: Graph | null; __SIL_SET__?: (g: Graph) => void; __SIL_LAST__?: Graph; __SIL_ROOT__?: string } }

export type Mode = 'poll' | 'push' | 'embedded'
export function useGraph(): { graph: Graph | null; live: boolean; error: string | null; mode: Mode; root: string } {
  const mode = window.__SIL_GRAPH__ === undefined ? 'poll' : window.__SIL_GRAPH__ === null ? 'push' : 'embedded'
  const [graph, setGraph] = useState<Graph | null>(mode === 'embedded' ? window.__SIL_GRAPH__! : null)
  const [error, setError] = useState<string | null>(null)
  const [root, setRoot] = useState<string>(window.__SIL_ROOT__ ?? '')
  useEffect(() => {
    if (mode === 'embedded') return
    if (mode === 'push') {
      // Use any IR that arrived before mounting first
      window.__SIL_SET__ = setGraph
      if (window.__SIL_LAST__) setGraph(window.__SIL_LAST__)
      return () => { delete window.__SIL_SET__ }
    }
    let last = ''
    let etag: string | null = null
    let stop = false
    const tick = async () => {
      try {
        const r = await fetch('/graph', { cache: 'no-store', headers: etag ? { 'if-none-match': etag } : {} })
        if (r.status === 304) return // unchanged: skip parsing (big corpora send tens of MB)
        etag = r.headers.get('etag')
        const txt = await r.text()
        const h = r.headers.get('x-sil-root'); if (h) setRoot(decodeURIComponent(h))
        if (!stop && txt !== last) { last = txt; setGraph(JSON.parse(txt)); setError(null) }
      } catch (e) { if (!stop) setError(String(e)) }
    }
    tick()
    const id = setInterval(tick, 2000)
    return () => { stop = true; clearInterval(id) }
  }, [mode])
  return { graph, live: mode !== 'embedded', error, mode, root }
}
