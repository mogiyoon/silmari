// sil view. Interface 2. Design §7.5. A local server sends IR at /graph and serves the viewer HTML.
// With --out, it writes one HTML file containing the IR without a server.
import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync, mkdirSync, watch } from 'node:fs'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import { loadDir, existsIn, buildGraph, docCache, replaceBody, replaceBodies, writeRange, WriteError } from '@silmari/core'
import { readConfig } from './lint.ts'

// Look for viewer.html next to the bundle (dist/sil.cjs) first. Otherwise use the workspace build.
const here = typeof __dirname !== 'undefined' ? __dirname : import.meta.dirname // Both the CJS bundle and ESM source
const CANDIDATES = [resolve(here, 'viewer.html'), resolve(here, '../../viewer/dist/index.html')]

function viewerHtml(): string | null {
  const p = CANDIDATES.find((c) => existsSync(c))
  return p ? readFileSync(p, 'utf8') : null
}

/** Put the IR in <script>. Escape '<' in JSON to prevent an early </script> close. With graph undefined (server mode) only the root and
 *  layout go in: the page then polls /graph, which is sent gzipped, instead of carrying tens of MB of JSON inside the HTML */
export function embed(html: string, graph: unknown, root?: string, layoutJson?: string | null): string {
  const lay = layoutJson ? layoutJson.replace(/</g, '\\u003c') : 'null'
  const g = graph === undefined ? '' : `window.__SIL_GRAPH__=${JSON.stringify(graph).replace(/</g, '\\u003c')};`
  return html.replace('</head>', `<script>${g}window.__SIL_ROOT__=${JSON.stringify(root ?? '')};window.__SIL_LAYOUT__=${lay}</script></head>`)
}

/** JSON reply, gzipped when the client accepts it (a 56MB graph becomes ~5MB on the wire; the browser inflates it natively) */
function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}, pre?: { raw: string; gz: Buffer }) {
  const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '') && body.length > 1024
  const out = gzip ? (pre && pre.raw === body ? pre.gz : gzipSync(body, { level: 1 })) : body
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...(gzip ? { 'content-encoding': 'gzip' } : {}), ...headers })
  res.end(out)
}

function openBrowser(url: string) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]]
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref() } catch { /* If it cannot open, only print the URL. */ }
}

/** The graph the server hands out. Rebuilt only when an md file changed: the file watcher marks the folder dirty, then one incremental
 *  load re-parses just the changed files (unchanged ones come from the cache) and the graph is assembled again (fast) */
const cache: { json: string; gz: Buffer; etag: string } = { json: '', gz: Buffer.alloc(0), etag: '' }

export function view(dir: string, opt: { port?: number; out?: string; open?: boolean } = {}): number {
  const root = resolve(dir)
  const cfg = readConfig(root)
  const html = viewerHtml()
  if (!html) { process.stderr.write('The viewer is not built: pnpm --filter @silmari/viewer build\n'); return 2 }
  const docs = docCache()
  const build = () => buildGraph(loadDir(root, cfg.scan.exclude, cfg.words, docs), { exists: existsIn(root), entry: cfg.entry })

  if (opt.out) {
    const out = resolve(opt.out)
    const lay = resolve(root, '.sil/layout.json')
    writeFileSync(out, embed(html, build(), root, existsSync(lay) ? readFileSync(lay, 'utf8') : null))
    process.stdout.write(`Wrote: ${out}\n`)
    return 0
  }

  // dirty: something under root changed since the last load. Set by the watcher (ignoring .git/.sil/backups etc.), also every 30 s as a
  // fallback in case the watcher missed an event. A load with nothing changed keeps the cached JSON and ETag.
  // (The watcher keeps the process alive, so it is only started in server mode)
  let dirty = true, lastScan = 0
  const skip = /(^|\/)(\.git|\.sil|node_modules)(\/|$)/
  try { watch(root, { recursive: true }, (_ev, name) => { if (!name || !skip.test(String(name))) dirty = true }) } catch { /* no recursive watch here: the 30 s fallback covers it */ }
  const refresh = () => {
    if (!dirty && Date.now() - lastScan < 30_000) return
    dirty = false; lastScan = Date.now()
    const g = build()
    if (docs.changed || !cache.json) { cache.json = JSON.stringify(g); cache.gz = gzipSync(cache.json, { level: 1 }); cache.etag = `"${createHash('sha1').update(cache.json).digest('hex')}"` }
  }

  const port = opt.port ?? 4141
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/layout') {
      // Save the layout (node positions, labels, and expanded state) only in projects with .sil/. Do not create it in other repos.
      const dir = resolve(root, '.sil'), file = resolve(dir, 'layout.json')
      if (req.method === 'GET') {
        if (!existsSync(file)) { res.writeHead(404); res.end(); return }
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(readFileSync(file, 'utf8')); return
      }
      if (req.method === 'PUT') {
        let body = ''; req.on('data', (c) => { body += c })
        req.on('end', () => {
          if (!existsSync(dir)) { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'No .sil/ directory. Run sil init to save the layout to a file' })); return }
          try { JSON.parse(body); mkdirSync(dir, { recursive: true }); writeFileSync(file, body); res.writeHead(204); res.end() }
          catch (e) { res.writeHead(400); res.end(String(e)) }
        })
        return
      }
      res.writeHead(405); res.end(); return
    }
    if (req.method === 'PATCH' && url.pathname === '/bodies') {
      // Save several body sections in one file at once (the right pane's Save). If rejected, write none of them.
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        try {
          const { file, hash, edits } = JSON.parse(body) as { file: string; hash?: string; edits: { start: number; end: number; expect: string; text: string }[] }
          const rs = replaceBodies(root, file, edits.map((e) => ({ range: { start: e.start, end: e.end }, expect: e.expect, text: e.text })), { expectHash: hash })
          process.stdout.write(`Edited  ${file}  ${rs.length} body section(s)\n`); dirty = true
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, count: rs.length }))
        } catch (e) {
          const code = e instanceof WriteError ? e.code : 'ERROR'
          res.writeHead(code === 'STALE' ? 409 : 400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: (e as Error).message, code }))
        }
      })
      return
    }
    if (req.method === 'PATCH' && url.pathname === '/body') {
      // Edit only the heading section of the prompt body. Keep entered text in place (INV-1, 'body section entered by the user').
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        try {
          const { file, start, end, expect, text, hash } = JSON.parse(body) as { file: string; start: number; end: number; expect: string; text: string; hash?: string }
          const r = replaceBody(root, file, { start, end }, expect, text, { expectHash: hash })
          process.stdout.write(`Edited  ${file}:${start}-${end}  body ${r.before.length}B → ${r.after.length}B\n`); dirty = true
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          const code = e instanceof WriteError ? e.code : 'ERROR'
          res.writeHead(code === 'STALE' ? 409 : 400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: (e as Error).message, code }))
        }
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/file') {
      // Stage-2 editing: the whole file as text. GET returns it with its hash, PUT replaces it through Writer (hash-checked, backed up)
      const rel = url.searchParams.get('path') ?? ''
      const abs = resolve(root, rel)
      if (!rel || !abs.startsWith(resolve(root) + '/') || !rel.endsWith('.md')) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'path must be an .md file inside the root' })); return }
      if (!existsSync(abs)) { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: `File not found: ${rel}` })); return }
      const buf = readFileSync(abs)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ text: buf.toString('utf8'), hash: createHash('sha1').update(buf).digest('hex') })); return
    }
    if (req.method === 'PUT' && url.pathname === '/file') {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        try {
          const { file, hash, text } = JSON.parse(body) as { file: string; hash?: string; text: string }
          const abs = resolve(root, file)
          const len = existsSync(abs) ? readFileSync(abs).length : 0
          const r = writeRange(root, file, { start: 0, end: len }, Buffer.from(text, 'utf8'), { expectHash: hash })
          process.stdout.write(`Edited  ${file}  whole file ${r.before.length}B → ${r.after.length}B\n`); dirty = true // our own write: do not wait for the watcher
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          const code = e instanceof WriteError ? e.code : 'ERROR'
          res.writeHead(code === 'STALE' ? 409 : 400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: (e as Error).message, code }))
        }
      })
    } else if (url.pathname === '/graph') {
      // Rebuild only when the watcher saw a change (or every 30 s), and let the viewer skip unchanged bodies with an ETag.
      // On big corpora (tens of thousands of files) the JSON is tens of MB, so it goes out gzipped and polling every 2 s stays cheap
      refresh()
      if (req.headers['if-none-match'] === cache.etag) { res.writeHead(304, { etag: cache.etag, 'x-sil-root': encodeURIComponent(root) }); res.end(); return }
      sendJson(req, res, 200, cache.json, { 'cache-control': 'no-store', etag: cache.etag, 'x-sil-root': encodeURIComponent(root) }, { raw: cache.json, gz: cache.gz })
    } else if (url.pathname === '/') {
      // The page carries only the root and saved layout; the graph comes from /graph right after load
      const lay = resolve(root, '.sil/layout.json')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(embed(html, undefined, root, existsSync(lay) ? readFileSync(lay, 'utf8') : null))
    } else { res.writeHead(404); res.end() }
  })
  // If the port is taken (another sil view still running), walk up to the next free one instead of crashing
  // (a listen callback stays registered even when that listen fails, so 'listening' is wired once, outside the retry)
  let p = port
  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE' && p < port + 20) { p += 1; server.listen(p, '127.0.0.1'); return }
    process.stderr.write(`sil view: cannot listen on 127.0.0.1:${p} (${e.code ?? e.message})\n`)
    process.exit(1)
  })
  server.once('listening', () => {
    const url = `http://127.0.0.1:${p}/`
    process.stdout.write(`sil view  ${url}  (${root})${p !== port ? `  [port ${port} was in use]` : ''}\n`)
    if (opt.open !== false) openBrowser(url)
  })
  server.listen(p, '127.0.0.1')
  return 0
}
