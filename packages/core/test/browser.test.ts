// @silmari/core has to load in a browser: a site, the silmari demo page and the web build of the VS Code extension all
// import it. That only holds as long as nothing outside src/node/ reaches for the file system, so the line is checked
// here rather than trusted. Two checks: no `node:` import in the browser half, and an actual browser bundle of the entry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { parseDoc, buildGraph, format, summary } from '../src/index.ts'

const src = fileURLToPath(new URL('../src/', import.meta.url))
const browserFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.name === 'node' ? [] : e.isDirectory() ? browserFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [])

test('no file outside src/node imports a node: module', () => {
  const offenders = browserFiles(src).filter((f) => /from '\s*node:/.test(readFileSync(f, 'utf8'))).map((f) => relative(src, f))
  assert.deepEqual(offenders, [], 'these belong in src/node/ and behind the @silmari/core/node entry')
})

test('no file outside src/node uses Buffer, process or __dirname', () => {
  const offenders = browserFiles(src)
    .map((f) => [relative(src, f), readFileSync(f, 'utf8')] as const)
    .filter(([, text]) => /(?<![\w.])(Buffer|process|__dirname|__filename)(?![\w])/.test(text.replace(/\/\/.*$/gm, '')))
    .map(([rel]) => rel)
  assert.deepEqual(offenders, [], 'Node globals are not there in a browser')
})

test('esbuild bundles the entry for the browser with no Node built-in pulled in', async () => {
  const out = await build({
    entryPoints: [join(src, 'index.ts')], bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
    write: false, logLevel: 'silent',
  })
  assert.deepEqual(out.errors, [])
  const js = out.outputFiles[0].text
  for (const m of ['node:fs', 'node:path', 'node:crypto', 'node:os', 'node:worker_threads', 'node:url'])
    assert.ok(!js.includes(m), `the browser bundle still reaches for ${m}`)
})

test('the browser path works end to end: a set of files in, the lint text and a Graph out', () => {
  // The README example. If this changes, change it there too.
  const files: Record<string, string> = {
    'flow.md': '# Review\n\n## 1. Read it ((use a subagent))\n\nCall [read-file](read-file.md) with {{>target}} and receive {{<findings}}.\n\n## {{>Inputs}}\n- target (path)\n\n## {{<Outputs}}\n- findings\n',
    'read-file.md': '# Read file\n\n## {{>Inputs}}\n- target (path)\n\n## {{<Outputs}}\n- findings\n',
  }
  const graph = buildGraph(new Map(Object.entries(files).map(([rel, text]) => [rel, parseDoc(rel, text)])))
  assert.equal(graph.spec, 'v5')
  assert.deepEqual(graph.edges.map((e) => `${e.from} → ${e.to}`), ['flow.md → read-file.md'])
  assert.equal(summary(graph), 'files 2 · task 2 · doc 0 · file 0 · ghost 0 · call 1 · read 0 · write 0 · ref 0 · mention 0')
  assert.match(format(graph.diagnostics), /error 0 · warning 0 · info \d+\n$/)
})
