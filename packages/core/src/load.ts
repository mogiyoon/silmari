// Reads documents from a directory. This is the only I/O in core. Move it to an io package if one is added.
// Follows .gitignore. This was added after self-use included the entire Unity Library and .claude/worktrees directories.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import ignore from 'ignore'
import { parseDoc, type Doc } from './parse.ts'
import type { Words } from './config.ts'

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

/** Parsed documents kept between loads, keyed by path. A file whose mtime and size are unchanged is not read or parsed again.
 *  After loadDir, `changed` says whether anything differed from the previous load (a file parsed, added or removed) */
export interface DocCache { entries: Map<string, { mtimeMs: number; size: number; doc: Doc }>; changed: boolean }
export const docCache = (): DocCache => ({ entries: new Map(), changed: true })

export function loadDir(root: string, exclude: string[] = [], words?: Words, cache?: DocCache): Map<string, Doc> {
  const ig = ignore().add(ALWAYS_EXCLUDE).add(exclude)
  const gi = join(root, '.gitignore')
  if (existsSync(gi)) ig.add(readFileSync(gi, 'utf8'))
  const docs = new Map<string, Doc>()
  let changed = false
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
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) { docs.set(rel, hit.doc); continue }
      const doc = parseDoc(rel, readFileSync(p, 'utf8'), words)
      docs.set(rel, doc); changed = true
      cache?.entries.set(rel, { mtimeMs: st.mtimeMs, size: st.size, doc })
    }
  }
  walk(root)
  if (cache) {
    for (const rel of [...cache.entries.keys()]) if (!docs.has(rel)) { cache.entries.delete(rel); changed = true }
    cache.changed = changed
  }
  return docs
}
