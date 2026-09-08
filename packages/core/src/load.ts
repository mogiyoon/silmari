// Reads documents from a directory. This is the only I/O in core. Move it to an io package if one is added.
// Follows .gitignore. This was added after self-use included the entire Unity Library and .claude/worktrees directories.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpus } from 'node:os'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import ignore from 'ignore'
import { parseDoc, type Doc } from './parse.ts'
import { templateRegex } from './graph.ts'

/** Always excluded. The config cannot include these paths. They are not documents for the graph. */
export const ALWAYS_EXCLUDE = ['.git', 'node_modules', '.sil', '.claude/worktrees']

/** The silmari project a path belongs to: the nearest directory, from `start` upwards, that has a `.sil/` folder. `stop` bounds the walk
 *  (the editor's workspace folder, say); the walk never leaves it. Null when no ancestor has `.sil/`, so callers fall back to their default */
export function findProjectRoot(start: string, stop?: string): string | null {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, '.sil'))) return dir
    if (stop !== undefined && dir === stop) return null
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

/** Used with loadDir. Checks whether files outside the scan exist for buildGraph(docs, { exists }). */
export const existsIn = (root: string) => (rel: string) => existsSync(join(root, rel))

/** Used with loadDir. Lists the files a template link matches for buildGraph(docs, { glob }): each `{{>name}}` stands for one path segment.
 *  Walks the pattern segment by segment, so only the folders it names are read. Returns project-relative paths in name order. */
export const globIn = (root: string) => (pattern: string): string[] => {
  let cur = ['']
  for (const seg of pattern.split('/')) {
    const next: string[] = []
    if (!/\{\{>/.test(seg)) { for (const c of cur) { const p = c ? `${c}/${seg}` : seg; if (existsSync(join(root, p))) next.push(p) } }
    else {
      const re = templateRegex(seg)
      for (const c of cur) {
        const dir = join(root, c)
        if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
        for (const f of readdirSync(dir).sort()) if (re.test(f)) next.push(c ? `${c}/${f}` : f)
      }
    }
    cur = next
    if (!cur.length) break
  }
  return cur
}

/** Parsed documents kept between loads, keyed by path. A file whose mtime and size are unchanged is not read or parsed again.
 *  After loadDir, `changed` says whether anything differed from the previous load (a file parsed, added or removed) */
export interface DocCache { entries: Map<string, { mtimeMs: number; size: number; doc: Doc }>; changed: boolean }
export const docCache = (): DocCache => ({ entries: new Map(), changed: true })

/** One md file found by the walk, in walk order. `doc` is set when the cache had it; otherwise the file still has to be parsed */
interface Entry { rel: string; abs: string; mtimeMs: number; size: number; doc?: Doc }

/** Walks the tree once: gitignore, exclusions, cache lookups. Parsing is left to the caller so it can run inline or in workers */
function scan(root: string, exclude: string[], cache?: DocCache): Entry[] {
  const ig = ignore().add(ALWAYS_EXCLUDE).add(exclude)
  const gi = join(root, '.gitignore')
  if (existsSync(gi)) ig.add(readFileSync(gi, 'utf8'))
  const out: Entry[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(dir).sort()) {
      const p = join(dir, f)
      const rel = relative(root, p).split(sep).join('/')
      const st = statSync(p)
      const isDir = st.isDirectory()
      if (ig.ignores(isDir ? rel + '/' : rel)) continue
      if (isDir) { walk(p); continue }
      if (!f.endsWith('.md')) continue
      const hit = cache?.entries.get(rel)
      out.push({ rel, abs: p, mtimeMs: st.mtimeMs, size: st.size, doc: hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size ? hit.doc : undefined })
    }
  }
  walk(root)
  return out
}

/** Puts the parsed entries into the cache and builds the result map in walk order (buildGraph output follows this order) */
function collect(entries: Entry[], cache?: DocCache): Map<string, Doc> {
  const docs = new Map<string, Doc>()
  let changed = false
  for (const e of entries) {
    docs.set(e.rel, e.doc!)
    if (cache && cache.entries.get(e.rel)?.doc !== e.doc) { cache.entries.set(e.rel, { mtimeMs: e.mtimeMs, size: e.size, doc: e.doc! }); changed = true }
  }
  if (cache) {
    for (const rel of [...cache.entries.keys()]) if (!docs.has(rel)) { cache.entries.delete(rel); changed = true }
    cache.changed = changed
  }
  return docs
}

export function loadDir(root: string, exclude: string[] = [], cache?: DocCache): Map<string, Doc> {
  const entries = scan(root, exclude, cache)
  for (const e of entries) if (!e.doc) e.doc = parseDoc(e.rel, readFileSync(e.abs, 'utf8'))
  return collect(entries, cache)
}

// ── Parallel parsing ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// remark takes ~0.2 ms per file, so a corpus of tens of thousands of files spends 10+ s in parseDoc on one thread. loadDirAsync
// spreads the files that are not in the cache over worker threads. Each worker runs this very file (source, dist, or the CLI
// bundle: all three work, because the worker is told what to do through workerData rather than by a separate script), reads and
// parses its share, and posts the docs back. Below MIN_PARALLEL pending files the workers would cost more than they save
// (each one loads remark), so the parse stays inline: incremental reloads in `sil view` always take that path.

/** Fewer pending files than this are parsed inline */
export const MIN_PARALLEL = 500
const FILES_PER_WORKER = 500
const WORKER_TAG = 'silmari:parse'

/** The file the worker should run: this module (source or dist ESM) or the CJS bundle that inlined it */
const selfFile = (): string => (typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url))

interface WorkerIn { tag: string; files: { rel: string; abs: string }[] }
interface WorkerOut { docs: [string, Doc][] }

if (!isMainThread && (workerData as WorkerIn | null)?.tag === WORKER_TAG) {
  const { files } = workerData as WorkerIn
  const docs: [string, Doc][] = files.map((f) => [f.rel, parseDoc(f.rel, readFileSync(f.abs, 'utf8'))])
  parentPort!.postMessage({ docs } satisfies WorkerOut)
}

function parseInWorker(file: string, files: { rel: string; abs: string }[]): Promise<Map<string, Doc>> {
  return new Promise((resolve, reject) => {
    const w = new Worker(file, { workerData: { tag: WORKER_TAG, files } satisfies WorkerIn })
    let done = false
    w.once('message', (m: WorkerOut) => { done = true; resolve(new Map(m.docs)); void w.terminate() })
    w.once('error', (e) => { done = true; reject(e) })
    w.once('exit', (code) => { if (!done) reject(new Error(`parse worker exited with code ${code}`)) })
  })
}

/** Default worker count: half the logical CPUs. Measured on an M2 (4 performance + 4 efficiency cores) with 14k files: 1 worker 3.5 s,
 *  2 → 1.9 s, 4 → 1.3 s, 7 → 1.6 s. Beyond the performance cores (or beyond physical cores with hyperthreading) extra workers only contend */
export const defaultThreads = (): number => Math.max(1, Math.ceil(cpus().length / 2))

/** loadDir with the parsing spread over worker threads. Same result as loadDir (same docs, same order, same cache updates).
 *  `threads` caps the number of workers (default: defaultThreads()). If a worker fails, the remaining files are parsed inline
 *  so the load still completes */
export async function loadDirAsync(root: string, exclude: string[] = [], cache?: DocCache, opt: { threads?: number } = {}): Promise<Map<string, Doc>> {
  const entries = scan(root, exclude, cache)
  const pending = entries.filter((e) => !e.doc)
  const threads = Math.max(1, Math.min(opt.threads ?? defaultThreads(), Math.ceil(pending.length / FILES_PER_WORKER)))
  if (pending.length >= MIN_PARALLEL && threads > 1) {
    const per = Math.ceil(pending.length / threads)
    const file = selfFile()
    const chunks = Array.from({ length: threads }, (_, i) => pending.slice(i * per, (i + 1) * per).map((e) => ({ rel: e.rel, abs: e.abs })))
    const results = await Promise.allSettled(chunks.map((c) => parseInWorker(file, c)))
    const byRel = new Map<string, Doc>()
    for (const r of results) if (r.status === 'fulfilled') for (const [rel, doc] of r.value) byRel.set(rel, doc)
    for (const e of pending) e.doc = byRel.get(e.rel)
  }
  for (const e of pending) if (!e.doc) e.doc = parseDoc(e.rel, readFileSync(e.abs, 'utf8'))
  return collect(entries, cache)
}
