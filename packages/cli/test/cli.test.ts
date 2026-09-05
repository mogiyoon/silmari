// Run sil lint on the corpus. Check only the exit code and output format.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const MAIN = resolve(import.meta.dirname, '../src/main.ts')
const AFTER = resolve(import.meta.dirname, '../../core/test/fixtures/after')
// A personal migration corpus kept outside the repository (notes/ is ignored). The test that uses it runs only where it exists
const MOGIYOON = resolve(import.meta.dirname, '../../../notes/examples/mogiyoon')
const run = (...args: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', MAIN, ...args], { encoding: 'utf8' })

test('lint: reports the two known corpus issues. It exits 0 by default', () => {
  const r = run('lint', AFTER)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /error 2 · warning 0 · info 0/)
  assert.match(r.stdout, /L-N01/)
})

test('lint --strict: exits 1 when there is an error', () => {
  assert.equal(run('lint', AFTER, '--strict').status, 1)
})

test('lint --json: graph matches the expected result', () => {
  const g = JSON.parse(run('lint', AFTER, '--json').stdout)
  assert.equal(g.spec, 'v4')
  assert.equal(g.stats.nodes, 9)
})

test('unknown command exits 2', () => { assert.equal(run('nope').status, 2) })

test('view --out: one HTML file containing the IR', { skip: !existsSync(resolve(import.meta.dirname, '../../viewer/dist/index.html')) && 'viewer not built' }, () => {
  const out = resolve(tmpdir(), `sil-view-${process.pid}.html`)
  const r = run('view', AFTER, `--out=${out}`)
  assert.equal(r.status, 0)
  const html = readFileSync(out, 'utf8')
  assert.match(html, /window\.__SIL_GRAPH__=\{"spec":"v4"/)
  assert.ok(!html.includes('</script></head>') || html.indexOf('__SIL_GRAPH__') < html.indexOf('</head>'))
  rmSync(out)
})

test('real migration example: registered agents + flow, error 0', { skip: !existsSync(MOGIYOON) && 'private corpus not present' }, () => {
  const g = JSON.parse(run('lint', MOGIYOON, '--json').stdout)
  assert.ok(g.stats.edgesByType.call >= 8, `call ${g.stats.edgesByType.call}`)
  assert.ok(!g.diagnostics.some((d: { severity: string }) => d.severity === 'error'), JSON.stringify(g.diagnostics))
  // Isolate all registered agent calls. Do not isolate calls between orchestrators because the main agent reads that document and continues.
  assert.ok(g.edges.every((e: { isolated: boolean; type: string; to: string }) => e.type !== 'call' || e.isolated === e.to.startsWith('.claude/agents/')), 'only registered agent calls are isolated')
  assert.ok(g.edges.some((e: { type: string; from: string; to: string }) => e.type === 'call' && e.from.includes('job-hunt') && e.to.includes('job-research')), 'call between documents')
  assert.ok(g.stats.nodesByKind.task >= 12)
})

test('view server: GET/PUT /file edits the whole file through Writer. A stale hash returns 409', async () => {
  const { spawn } = await import('node:child_process')
  const { cpSync, mkdtempSync } = await import('node:fs')
  const root = mkdtempSync(resolve(tmpdir(), 'sil-e2e-'))
  cpSync(AFTER, root, { recursive: true })
  const port = 4300 + (process.pid % 500)
  const srv = spawn(process.execPath, ['--experimental-strip-types', MAIN, 'view', root, `--port=${port}`, '--no-open'], { stdio: 'ignore' })
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/graph`); break } catch { await new Promise((r) => setTimeout(r, 100)) } }
    const g1 = await (await fetch(`http://127.0.0.1:${port}/file?path=${encodeURIComponent('flow.md')}`)).json() as { text: string; hash: string }
    assert.equal(g1.text, readFileSync(resolve(AFTER, 'flow.md'), 'utf8'))
    const text = g1.text.replace('[wrap-up](wrap-up.md)', '[wrap-up](wrap-up2.md)')
    const r1 = await fetch(`http://127.0.0.1:${port}/file`, { method: 'PUT', body: JSON.stringify({ file: 'flow.md', hash: g1.hash, text }) })
    assert.equal(r1.status, 200)
    assert.equal(readFileSync(resolve(root, 'flow.md'), 'utf8'), text, 'the file is exactly the text that was sent')
    const r2 = await fetch(`http://127.0.0.1:${port}/file`, { method: 'PUT', body: JSON.stringify({ file: 'flow.md', hash: g1.hash, text }) })
    assert.equal(r2.status, 409, 'rejects a write with the old hash because the file changed')
    const bad = await fetch(`http://127.0.0.1:${port}/file?path=..%2Fx.md`)
    assert.equal(bad.status, 400, 'no paths outside the root')
    const g2 = await (await fetch(`http://127.0.0.1:${port}/graph`)).json() as { nodes: { id: string; kind: string }[] }
    assert.equal(g2.nodes.find((n) => n.id === 'wrap-up2.md')?.kind, 'ghost', 'included in the rebuilt graph')
  } finally { srv.kill(); rmSync(root, { recursive: true, force: true }) }
})

test('view server: /layout saves a file only when .sil/ exists', async () => {
  const { spawn } = await import('node:child_process')
  const { cpSync, mkdtempSync, mkdirSync, existsSync } = await import('node:fs')
  const root = mkdtempSync(resolve(tmpdir(), 'sil-lay-'))
  cpSync(AFTER, root, { recursive: true })
  rmSync(resolve(root, '.sil'), { recursive: true, force: true }) // Start this test without it, even if the corpus has run sil init.
  const port = 4800 + (process.pid % 500)
  const srv = spawn(process.execPath, ['--experimental-strip-types', MAIN, 'view', root, `--port=${port}`, '--no-open'], { stdio: 'ignore' })
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/graph`); break } catch { await new Promise((r) => setTimeout(r, 100)) } }
    const body = JSON.stringify({ nodes: { 'flow.md': { x: 1, y: 2 } }, labels: {}, open: [] })
    assert.equal((await fetch(`http://127.0.0.1:${port}/layout`)).status, 404, 'returns 404 when the file is missing')
    assert.equal((await fetch(`http://127.0.0.1:${port}/layout`, { method: 'PUT', body })).status, 404, 'does not write without .sil')
    assert.ok(!existsSync(resolve(root, '.sil')), 'creates nothing in the repo')
    mkdirSync(resolve(root, '.sil'))
    assert.equal((await fetch(`http://127.0.0.1:${port}/layout`, { method: 'PUT', body })).status, 204)
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/layout`)).text(), body)
  } finally { srv.kill(); rmSync(root, { recursive: true, force: true }) }
})

test('view server: PATCH /body changes only the heading body. A viewer body mismatch returns 409', async () => {
  const { spawn } = await import('node:child_process')
  const { cpSync, mkdtempSync } = await import('node:fs')
  const root = mkdtempSync(resolve(tmpdir(), 'sil-body-'))
  cpSync(AFTER, root, { recursive: true })
  const port = 5300 + (process.pid % 500)
  const srv = spawn(process.execPath, ['--experimental-strip-types', MAIN, 'view', root, `--port=${port}`, '--no-open'], { stdio: 'ignore' })
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/graph`); break } catch { await new Promise((r) => setTimeout(r, 100)) } }
    const g = await (await fetch(`http://127.0.0.1:${port}/graph`)).json() as { nodes: { id: string; hash: string; headings: { text: string; body: string; range: { start: number; end: number } }[] }[] }
    const node = g.nodes.find((n) => n.id === 'wrap-up.md')!
    const h = node.headings.find((x) => x.text === 'Steps')!
    const body = { file: 'wrap-up.md', start: h.range.start, end: h.range.end, expect: h.body, text: h.body + '\nOne more line.', hash: node.hash }
    const r1 = await fetch(`http://127.0.0.1:${port}/body`, { method: 'PATCH', body: JSON.stringify(body) })
    assert.equal(r1.status, 200)
    const before = readFileSync(resolve(AFTER, 'wrap-up.md'), 'utf8'), after = readFileSync(resolve(root, 'wrap-up.md'), 'utf8')
    assert.equal(after, before.replace(h.body, h.body + '\nOne more line.'), 'everything outside that section stays unchanged')
    assert.equal((await fetch(`http://127.0.0.1:${port}/body`, { method: 'PATCH', body: JSON.stringify(body) })).status, 409, 'rejects an already changed body')
  } finally { srv.kill(); rmSync(root, { recursive: true, force: true }) }
})

test('init: creates SILMARI.md and makes all four agent start files refer to it; records the user language; asks about migration when md files exist', () => {
  const AGENTS = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md']
  const a = resolve(tmpdir(), `sil-init-a-${process.pid}`); rmSync(a, { recursive: true, force: true }); mkdirSync(a)
  writeFileSync(resolve(a, 'CLAUDE.md'), '# Rules\n- answer briefly\n')
  const outA = run('init', a, '--lang=ko').stdout
  assert.match(outA, /Entry: SILMARI\.md/); assert.match(outA, /Appended: CLAUDE\.md \(SILMARI\.md call · language ko\)/); assert.match(outA, /Created: AGENTS\.md/)
  assert.match(readFileSync(resolve(a, 'CLAUDE.md'), 'utf8'), /^# Rules\n- answer briefly\n\nSILMARI\.md is the entry point of everything in this project\..*follow SILMARI\.md\. Read SILMARI\.md first, before any work\.\nThe user's language is "ko"\./, 'existing content kept; call + language line appended')
  for (const f of AGENTS) assert.ok(existsSync(resolve(a, f)), `${f} exists`)
  assert.match(readFileSync(resolve(a, 'GEMINI.md'), 'utf8'), /^# GEMINI\n\nSILMARI\.md is the entry point of everything in this project/, 'every tool gets the same plain line')
  assert.match(readFileSync(resolve(a, '.github/copilot-instructions.md'), 'utf8'), /follow SILMARI\.md/, 'other tools get a follow line')
  assert.ok(!readFileSync(resolve(a, 'AGENTS.md'), 'utf8').includes('migration'), 'no migration line without md files')
  assert.match(readFileSync(resolve(a, 'SILMARI.md'), 'utf8'), /## Notation[\s\S]*\[use a subagent\]/, 'skeleton is English regardless of language')
  const cfg = readFileSync(resolve(a, '.sil/config.yaml'), 'utf8')
  assert.match(cfg, /^entry: \[SILMARI\.md\]/m); assert.match(cfg, /^lang: ko/m)
  const b = resolve(tmpdir(), `sil-init-b-${process.pid}`); rmSync(b, { recursive: true, force: true }); mkdirSync(b)
  assert.match(run('init', b, '--lang=en').stdout, /Created: CLAUDE\.md \(agent start file/)
  assert.equal(readFileSync(resolve(b, 'CLAUDE.md'), 'utf8'), '# CLAUDE\n\nSILMARI.md is the entry point of everything in this project. The notation and flow of every md document follow SILMARI.md. Read SILMARI.md first, before any work.\n')
  const d = resolve(tmpdir(), `sil-init-d-${process.pid}`); rmSync(d, { recursive: true, force: true }); mkdirSync(d)
  writeFileSync(resolve(d, 'AGENTS.md'), '# Codex\n'); writeFileSync(resolve(d, 'flow.md'), '# Flow\n\nWork.\n')
  assert.match(run('init', d, '--lang=ja').stdout, /Appended: AGENTS\.md \(SILMARI\.md call · language ja · migration prompt\)/)
  const ag = readFileSync(resolve(d, 'AGENTS.md'), 'utf8')
  assert.match(ag, /follow SILMARI\.md/); assert.match(ag, /language is "ja"/); assert.match(ag, /Start the silmari migration\?/)
  assert.match(readFileSync(resolve(d, 'CLAUDE.md'), 'utf8'), /follow SILMARI\.md.*\n.*"ja".*\n.*migration/, 'new files get the same lines')
  run('init', d, '--lang=ja'); assert.equal(readFileSync(resolve(d, 'AGENTS.md'), 'utf8'), ag, 'a second init appends nothing')
  const e = resolve(tmpdir(), `sil-init-e-${process.pid}`); rmSync(e, { recursive: true, force: true }); mkdirSync(e)
  writeFileSync(resolve(e, 'SILMARI.md'), '# Start\n'); writeFileSync(resolve(e, 'CLAUDE.md'), '# Rules\nRead SILMARI.md first.\n')
  assert.match(run('init', e).stdout, /Unchanged: CLAUDE\.md/)
  assert.equal(readFileSync(resolve(e, 'SILMARI.md'), 'utf8'), '# Start\n')
  const c = resolve(tmpdir(), `sil-init-c-${process.pid}`); rmSync(c, { recursive: true, force: true }); mkdirSync(c)
  assert.match(run('init', c, '--entry=flow.md').stdout, /entry skeleton/)
  assert.match(readFileSync(resolve(c, '.sil/config.yaml'), 'utf8'), /^entry: \[flow\.md\]/m)
  for (const x of [a, b, c, d, e]) rmSync(x, { recursive: true, force: true })
})
