// Node positions, label offsets, and expanded state.
//  - Browser localStorage: save after every drag. Stored per project root
//  - File .sil/layout.json: save 5 seconds after movement stops, or at most every 30 seconds during movement. Only for projects with `.sil/`
//    (where sil init ran). Do not create files in other repositories. Server mode uses PUT /layout. The extension saves in webviews. Snapshots cannot save
// When loading, the file takes priority over localStorage.
/** Layout algorithm version. When it changes, discard old node and label positions that conflict with the new layout */
export const LAYOUT_V = 6
export interface Saved {
  v?: number; nodes: Record<string, { x: number; y: number }>; labels: Record<string, { dx: number; dy: number }>; open: string[]
  collapsed?: string[] // subtrees folded by the user; absent = automatic (every flow starts folded below the first level)
  ui?: { secs?: string[]; det?: string[] } // right panel: open sections, and open accordions inside the selected-node panel
}
const empty = (): Saved => ({ v: LAYOUT_V, nodes: {}, labels: {}, open: [] })
const upgrade = (s: Saved): Saved => (s.v === LAYOUT_V ? s : { ...empty(), open: s.open ?? [] })
const key = (root: string) => `silmari:layout:${root || 'default'}`

declare global { interface Window { __SIL_LAYOUT__?: Saved | null; __SIL_SAVE_LAYOUT__?: (s: Saved) => void; __SIL_READ_FILE__?: (path: string) => Promise<{ text?: string; error?: string }> } }

export function loadLocal(root: string): Saved {
  try { const s = localStorage.getItem(key(root)); return s ? upgrade({ ...empty(), ...JSON.parse(s) }) : empty() } catch { return empty() }
}
export function saveLocal(root: string, s: Saved) {
  try { localStorage.setItem(key(root), JSON.stringify(s)) } catch { /* The UI still works if saving fails */ }
}

/** File value. Server mode uses fetch. Webviews use the value from the extension. Returns null if absent */
export async function loadFile(mode: 'poll' | 'push' | 'embedded'): Promise<Saved | null> {
  if (mode === 'poll') {
    try { const r = await fetch('/layout', { cache: 'no-store' }); if (!r.ok) return null; const j = await r.json(); return j && typeof j === 'object' ? upgrade({ ...empty(), ...j }) : null } catch { return null }
  }
  return window.__SIL_LAYOUT__ ? upgrade({ ...empty(), ...window.__SIL_LAYOUT__ }) : null
}

const DEBOUNCE = 5000, MAX_WAIT = 30000
let timer: ReturnType<typeof setTimeout> | null = null, firstPending = 0, pending: Saved | null = null
let sink: ((s: Saved) => void) | null = null
export function setFileSink(f: ((s: Saved) => void) | null) { sink = f }
/** Schedule a file save 5 seconds after the last change, but no later than 30 seconds after the first change */
export function scheduleFileSave(s: Saved) {
  if (!sink) return
  pending = s
  const now = Date.now()
  if (!firstPending) firstPending = now
  if (timer) clearTimeout(timer)
  const wait = Math.min(DEBOUNCE, Math.max(0, firstPending + MAX_WAIT - now))
  timer = setTimeout(() => { timer = null; firstPending = 0; if (pending && sink) sink(pending); pending = null }, wait)
}
export function flushFileSave() { if (timer) { clearTimeout(timer); timer = null; firstPending = 0; if (pending && sink) sink(pending); pending = null } }

export const serverSink = (s: Saved) => { fetch('/layout', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(s) }).catch(() => {}) }
export const webviewSink = (s: Saved) => { window.__SIL_SAVE_LAYOUT__?.(s) }

/** Stable key for an edge from the same line in the same file to the same target */
export const edgeKey = (e: { from: string; to: string; line: number }) => `${e.from}|${e.line}|${e.to}`

/** The text of a file in the project, for the side panel. The extension answers through the webview bridge; `sil view` through GET /file.
 *  A snapshot (--out) has neither, so the panel says so instead of showing nothing */
export const readFileText = async (path: string): Promise<{ text?: string; error?: string }> => {
  if (window.__SIL_READ_FILE__) return window.__SIL_READ_FILE__(path)
  try {
    const r = await fetch(`/file?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
    const j = await r.json() as { text?: string; error?: string }
    return r.ok && j.text !== undefined ? { text: j.text } : { error: j.error ?? `HTTP ${r.status}` }
  } catch { return { error: 'The file is not available in a snapshot. Open it with sil view or the extension' } }
}
