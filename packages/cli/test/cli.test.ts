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
  assert.match(r.stdout, /error 2 · warning 0 · info 2/)
  assert.match(r.stdout, /L-N01/)
  assert.match(r.stdout, /files 8 · task 6 · doc 2 · file 0 · ghost 1 · call 7 · read 0 · write 0 · ref 5 · mention 2/, 'the kind summary is always printed')
})

test('lint --strict: exits 1 when there is an error', () => {
  assert.equal(run('lint', AFTER, '--strict').status, 1)
})

test('lint --json: graph matches the expected result', () => {
  const g = JSON.parse(run('lint', AFTER, '--json').stdout)
  assert.equal(g.spec, 'v5')
  assert.equal(g.stats.nodes, 9)
})

test('unknown command exits 2', () => { assert.equal(run('nope').status, 2) })

test('lint without a dir finds the project root from a subfolder (nearest .sil/)', () => {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', MAIN, 'lint', '--json'], { encoding: 'utf8', cwd: resolve(AFTER, '.sil') })
  const g = JSON.parse(r.stdout)
  assert.ok(g.nodes.some((n: { id: string }) => n.id === 'flow.md'), 'run from inside .sil/, the graph is the whole fixture')
})

test('--version, --help, and their short forms; `sil version` and `sil help` too', () => {
  const v = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')).version
  for (const a of [['--version'], ['-v'], ['version']]) assert.equal(run(...a).stdout.trim(), v, a.join(' '))
  for (const a of [['--help'], ['-h'], ['help'], []]) { const r = run(...a); assert.match(r.stdout, /sil <command>/); assert.equal(r.status, 0, a.join(' ')) }
})

test('view --out: one HTML file containing the IR', { skip: !existsSync(resolve(import.meta.dirname, '../../viewer/dist/index.html')) && 'viewer not built' }, () => {
  const out = resolve(tmpdir(), `sil-view-${process.pid}.html`)
  const r = run('view', AFTER, `--out=${out}`)
  assert.equal(r.status, 0)
  const html = readFileSync(out, 'utf8')
  assert.match(html, /window\.__SIL_GRAPH__=\{"spec":"v5"/)
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
  assert.match(readFileSync(resolve(a, 'CLAUDE.md'), 'utf8'), /^# Rules\n- answer briefly\n\n\[SILMARI\.md\]\(SILMARI\.md\) is the entry point of everything in this project\..*follow SILMARI\.md\. Read SILMARI\.md first, before any work\.\nThe user's language is "ko"\./, 'existing content kept; call (a real link, so the graph has the edge) + language line appended')
  for (const f of AGENTS) assert.ok(existsSync(resolve(a, f)), `${f} exists`)
  assert.match(readFileSync(resolve(a, 'GEMINI.md'), 'utf8'), /^# GEMINI\n\n\[SILMARI\.md\]\(SILMARI\.md\) is the entry point of everything in this project/, 'every tool gets the same plain line')
  assert.match(readFileSync(resolve(a, '.github/copilot-instructions.md'), 'utf8'), /^# copilot-instructions\n\n\[SILMARI\.md\]\(\.\.\/SILMARI\.md\) is the entry point/, 'a start file in a subfolder links the entry point relative to itself')
  assert.ok(!readFileSync(resolve(a, 'AGENTS.md'), 'utf8').includes('migration'), 'no migration line without md files')
  const sk = readFileSync(resolve(a, 'SILMARI.md'), 'utf8')
  assert.match(sk, /## Notation[\s\S]*\(\(use a subagent via sil run\)\)[\s\S]*## Running a call[\s\S]*## Subagents/, 'skeleton is English regardless of language and carries the running and subagent rules')
  assert.ok(!sk.includes('## Migration'), 'the migration rules are a one-time job: they live in .sil/migration.md, not in the file every session reads')
  assert.ok(!existsSync(resolve(a, '.sil/migration.md')), 'no migration document without md files')
  const cfg = readFileSync(resolve(a, '.sil/config.yaml'), 'utf8')
  assert.match(cfg, /^entry: \[SILMARI\.md\]/m); assert.match(cfg, /^lang: ko/m); assert.match(cfg, /^version: \d+\.\d+\.\d+/m, 'the version that wrote the files is recorded')
  const b = resolve(tmpdir(), `sil-init-b-${process.pid}`); rmSync(b, { recursive: true, force: true }); mkdirSync(b)
  assert.match(run('init', b, '--lang=en').stdout, /Created: CLAUDE\.md \(agent start file/)
  assert.equal(readFileSync(resolve(b, 'CLAUDE.md'), 'utf8'), '# CLAUDE\n\n[SILMARI.md](SILMARI.md) is the entry point of everything in this project. The notation and flow of every md document follow SILMARI.md. Read SILMARI.md first, before any work.\n')
  const d = resolve(tmpdir(), `sil-init-d-${process.pid}`); rmSync(d, { recursive: true, force: true }); mkdirSync(d)
  writeFileSync(resolve(d, 'AGENTS.md'), '# Codex\n'); writeFileSync(resolve(d, 'flow.md'), '# Flow\n\nWork.\n')
  const initD = run('init', d, '--lang=ja').stdout
  assert.match(initD, /Appended: AGENTS\.md \(SILMARI\.md call · language ja · migration prompt\)/)
  assert.match(initD, /Backup: \.sil\/backups\/[0-9T-]+-migration \(3 md files/, 'documents, start files included, are copied before the agent is asked to move them')
  assert.match(readFileSync(resolve(d, '.sil/migration.md'), 'utf8'), /0\. \*\*Back up first\.\*\* Run `sil backup`/)
  const ag = readFileSync(resolve(d, 'AGENTS.md'), 'utf8')
  assert.match(ag, /follow SILMARI\.md/); assert.match(ag, /language is "ja"/); assert.match(ag, /Start the silmari migration\?/)
  assert.match(ag, /Start the silmari migration\?[^\n]*follow \.sil\/migration\.md rule by rule[^\n]*then delete that file and this line from every agent start file/, 'the question line points at the migration document and says the agent removes both when done — silmari never does')
  assert.match(readFileSync(resolve(d, '.sil/migration.md'), 'utf8'), /^# Moving this project's documents[\s\S]*One agent, one file[\s\S]*Finish with `sil lint`[\s\S]*delete this file/, 'the migration rules, ending with the deletion of the file itself')
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

test('update: refreshes the generated sections of SILMARI.md, moves Migration to .sil/migration.md, writes the update notes with a prompt line, records the version; a second run changes nothing; lint points at it', () => {
  const d = resolve(tmpdir(), `sil-update-${process.pid}`); rmSync(d, { recursive: true, force: true }); mkdirSync(resolve(d, '.sil'), { recursive: true })
  // A project as sil init 0.3.0 left it: no version in the config, a Migration section (with fenced examples) in SILMARI.md, the old question line
  writeFileSync(resolve(d, '.sil/config.yaml'), 'entry: [SILMARI.md]\nlang: ko\n')
  writeFileSync(resolve(d, 'flow.md'), '# Flow\n\nWork.\n')
  writeFileSync(resolve(d, 'SILMARI.md'), '# SILMARI\n\nIntro kept.\n\n## Notation\n\nold notation text\n\n## Running a call\n\nold\n\n## Subagents\n\nold\n\n## Flow\n\n- [Feature work](flow.md)\n\n## My rules\n\nBe brief.\n\n## Migration\n\nold rules\n\n```markdown\n## Agents\n### 1. Analyst\n```\n\n- [Late link](flow.md)\n')
  writeFileSync(resolve(d, 'CLAUDE.md'), '# CLAUDE\n\n[SILMARI.md](SILMARI.md) is the entry point.\nWhen starting work, if this project\'s md files do not yet follow the SILMARI.md notation, first ask: "Start the silmari migration?" If yes, follow the "Migration" section of SILMARI.md rule by rule, finish with `sil lint` at error 0, then delete this line from every agent start file.\n')
  const before = run('lint', d).stdout
  assert.match(before, /L-I06 +SILMARI\.md was written by silmari before 0\.3\.1; installed is \d+\.\d+\.\d+\. Run sil update/)
  const out = run('update', d).stdout
  assert.match(out, /Updated: SILMARI\.md \(Notation · Running a call · Subagents refreshed · Migration moved to \.sil\/migration\.md\)/)
  assert.match(out, /Updated: CLAUDE\.md \(migration line points at \.sil\/migration\.md\)/); assert.match(out, /Created: \.sil\/migration\.md/)
  assert.match(out, /Backup: \.sil\/backups\/[0-9T-]+-update \(3 md files/); assert.match(out, /Created: \.sil\/updates\/0\.3\.0\.md/); assert.match(out, /Created: \.sil\/updates\/0\.4\.0\.md/); assert.match(out, /Created: \.sil\/updates\/0\.5\.0\.md/); assert.match(out, /Appended: CLAUDE\.md \(update notes prompt\)/); assert.match(out, /Recorded: \.sil\/config\.yaml version \d+\.\d+\.\d+ \(was 0\.2\.0, inferred from what sil init wrote\)\n/)
  assert.ok(!out.includes('0.2.0.md'), 'a 0.2.0 project (SILMARI.md has the Running section) does not get the 0.2.0 note')
  const sk = readFileSync(resolve(d, 'SILMARI.md'), 'utf8')
  assert.match(sk, /^# SILMARI\n\nIntro kept\.\n\n## Notation\n\nEight symbols/, 'head kept, generated section replaced')
  assert.match(sk, /## Running a call\n\n1\. If the calling heading/); assert.match(sk, /## Subagents\n\nA step whose heading/)
  assert.match(sk, /## Flow\n\n- \[Feature work\]\(flow\.md\)\n\n## My rules\n\nBe brief\.\n\n- \[Late link\]\(flow\.md\)\n$/, 'user sections in their order; the line added after the old Migration section survives')
  assert.ok(!sk.includes('## Migration') && !sk.includes('## Agents'), 'Migration gone, and a heading inside its fenced example is not mistaken for a section')
  const cl = readFileSync(resolve(d, 'CLAUDE.md'), 'utf8')
  assert.match(cl, /follow \.sil\/migration\.md rule by rule/); assert.ok(!cl.includes('"Migration" section'))
  assert.match(cl, /apply the update notes in \.sil\/updates\/: first tell the user[^\n]*then ask: "Start the silmari update\?"[^\n]*delete those files and this line/)
  assert.match(readFileSync(resolve(d, '.sil/updates/0.3.0.md'), 'utf8'), /^# silmari 0\.3\.0[\s\S]*## 1\. Tell the user first[\s\S]*Before: only md documents[\s\S]*## 2\. If yes/)
  assert.match(readFileSync(resolve(d, '.sil/config.yaml'), 'utf8'), /^entry: \[SILMARI\.md\]\nlang: ko\nversion: \d+\.\d+\.\d+/, 'the version line is added, the rest untouched')
  assert.match(run('lint', d).stdout, /L-I07 +3 update notes not applied yet: 0\.3\.0\.md, 0\.4\.0\.md, 0\.5\.0\.md/)
  assert.match(readFileSync(resolve(d, '.sil/updates/0.4.0.md'), 'utf8'), /project start files[\s\S]*\{\{-…\}\}/, 'the 0.4.0 note explains the flipped default and the new marker')
  assert.match(readFileSync(resolve(d, '.sil/updates/0.5.0.md'), 'utf8'), /Files as outputs and inputs[\s\S]*\{\{>report\}\}[\s\S]*\{\{<report\}\}[\s\S]*\{\{=Build the report\}\}/, 'the 0.5.0 note carries the file write/import values and {{=…}} sections that 0.4.0 shipped unannounced')
  const again = run('update', d).stdout
  assert.match(again, /Unchanged: SILMARI\.md\nUp to date: \d+\.\d+\.\d+\n$/)
  assert.equal(readFileSync(resolve(d, 'CLAUDE.md'), 'utf8'), cl, 'no second prompt line')
  // migrate: writes the document again and the question line where it is missing
  rmSync(resolve(d, '.sil/migration.md')); writeFileSync(resolve(d, 'AGENTS.md'), '# Codex\n')
  const mig = run('migrate', d).stdout
  assert.match(mig, /Created: \.sil\/migration\.md\nAppended: AGENTS\.md \(migration prompt\)\n$/, 'CLAUDE.md already has the line')
  assert.match(run('update', resolve(tmpdir())).stderr, /no \.sil\/ found above/)
  // backup on its own: the same files, under a manual folder; the backups folder itself is never scanned
  const bk = run('backup', d).stdout; const bdir = /Backup: (\S+) \((\d+) md files\)/.exec(bk)!
  assert.equal(bdir[2], '4', 'SILMARI.md · flow.md · CLAUDE.md · AGENTS.md'); assert.ok(existsSync(resolve(d, bdir[1], 'SILMARI.md')) && existsSync(resolve(d, bdir[1], 'flow.md')) && existsSync(resolve(d, bdir[1], 'AGENTS.md')))
  assert.match(run('backup', d).stdout, /\(4 md files\)/, 'earlier backups are not counted as documents')
  // A 0.1.x project: a words block in the config, no Running section. It gets every note since, in order
  const e = resolve(tmpdir(), `sil-update-old-${process.pid}`); rmSync(e, { recursive: true, force: true }); mkdirSync(resolve(e, '.sil'), { recursive: true })
  writeFileSync(resolve(e, '.sil/config.yaml'), 'entry: [SILMARI.md]\nlang: ko\nwords:\n  inputs: [입력]\n')
  writeFileSync(resolve(e, 'SILMARI.md'), '# SILMARI\n\n## Notation\n\n- old\n\n## Flow\n\n- [a](a.md)\n'); writeFileSync(resolve(e, 'a.md'), '# A\n'); writeFileSync(resolve(e, 'CLAUDE.md'), '# C\n')
  const outE = run('update', e).stdout
  assert.match(outE, /Created: \.sil\/updates\/0\.1\.1\.md\nCreated: \.sil\/updates\/0\.2\.0\.md\nCreated: \.sil\/updates\/0\.3\.0\.md\n/); assert.match(outE, /was 0\.1\.0, inferred/)
  assert.match(readFileSync(resolve(e, '.sil/updates/0.1.1.md'), 'utf8'), /Labels `\[…\]` → `\(\(…\)\)`/)
  assert.match(readFileSync(resolve(e, '.sil/updates/0.2.0.md'), 'utf8'), /Contract headings[\s\S]*## \{\{>Inputs\}\}/)
  assert.ok(!readFileSync(resolve(e, '.sil/updates/0.2.0.md'), 'utf8').includes('Labels `[…]`'), 'the label change is the 0.1.1 note, not repeated')
  // A 0.1.1 project already has the double-parenthesis label: it starts at 0.2.0
  writeFileSync(resolve(e, 'SILMARI.md'), '# SILMARI\n\n## Notation\n\n- put a double-parenthesis label at the end\n\n## Flow\n'); rmSync(resolve(e, '.sil/updates'), { recursive: true }); writeFileSync(resolve(e, '.sil/config.yaml'), 'entry: [SILMARI.md]\nwords:\n  inputs: [입력]\n')
  const outE2 = run('update', e).stdout
  assert.match(outE2, /was 0\.1\.1, inferred/); assert.ok(!outE2.includes('0.1.1.md') && outE2.includes('0.2.0.md'))
  assert.match(readFileSync(resolve(e, 'SILMARI.md'), 'utf8'), /## Running a call/, 'the generated sections a 0.1.x file never had are added')
  rmSync(e, { recursive: true, force: true })
  rmSync(d, { recursive: true, force: true })
})

test('run: checks the call line before anything starts — (( )) label, --send names, tools/model flags, rejected flags, (path) values; --dry-run shows the command', () => {
  const d = resolve(tmpdir(), `sil-run-${process.pid}`); rmSync(d, { recursive: true, force: true }); mkdirSync(resolve(d, 'agents'), { recursive: true })
  writeFileSync(resolve(d, 'flow.md'), '# 흐름\n\n## 1. 점검 ((서브에이전트로, sil run))\n[점검기](agents/checker.md) 를 {{>marker}} 와 {{>prefs}} 와 함께 부르고 {{<report}} 를 받는다. {{#하이쿠}} 에서 {{+읽기 도구}} 만을 사용한다.\n\n## 2. 마무리\n[점검기](agents/checker.md) 를 {{>marker}} 와 함께 부르고 {{<report2}} 를 받는다.\n\n## 3. 격리 점검 ((서브에이전트로, sil run))\n[점검기](agents/checker.md) 를 {{>marker}} 와 {{>prefs}} 와 함께 부르고 {{<report}} 를 받는다. {{#하이쿠}} 에서 {{+읽기 도구}} 만을, {{-프로젝트 규칙 없이}} 사용한다.\n')
  writeFileSync(resolve(d, 'agents/checker.md'), '# 점검기\n\n## {{>입력}}\n- marker (path) — 읽을 파일\n- prefs (json) — 설정\n\n## {{<출력}}\n- report\n')
  writeFileSync(resolve(d, 'marker.txt'), 'MARKER-42\n')
  const r = (...a: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', MAIN, 'run', ...a], { encoding: 'utf8', cwd: d })
  const ok = ['claude', '--step', 'flow.md#1', '--send', 'marker=marker.txt', '--send', 'prefs={"a":1}', '--model', 'haiku', '--tools', 'Read']
  const dry = r(...ok, '--dry-run')
  assert.equal(dry.status, 0); assert.equal(dry.stdout.trim(), 'claude -p --output-format stream-json --verbose --no-session-persistence --model haiku --tools Read < <prompt>','no {{-…}} on the call line: the project start files reach the subagent, as people expect; sil keeps its own record, so claude saves no session')
  assert.equal(r(...ok, '--keep-session', '--dry-run').stdout.trim(), 'claude -p --output-format stream-json --verbose --model haiku --tools Read < <prompt>', '--keep-session lets claude save the session')
  const p = r(...ok, '--prompt-only').stdout
  assert.match(p, /^This session runs one step of a flow as a subagent[\s\S]*the project rules you were started with still apply/, 'the prompt says the start files still apply'); assert.match(p, /## Values for this run\n- marker:\nmarker\.txt\n- prefs:\n\{"a":1\}/); assert.match(p, /keys are: report/)
  const refused = (args: string[], re: RegExp) => { const x = r(...args); assert.equal(x.status, 1, args.join(' ')); assert.match(x.stderr, re) }
  refused(['claude', '--step', 'flow.md#2', '--send', 'marker=marker.txt'], /not a subagent step: its heading has no \(\( \)\) label/)
  refused(['claude', '--step', 'flow.md#1', '--send', 'markr=marker.txt', '--send', 'prefs={}', '--model', 'haiku', '--tools', 'Read'], /expects --send for: marker prefs\. Got: markr prefs/)
  refused(['claude', '--step', 'flow.md#1', '--send', 'marker=marker.txt', '--send', 'prefs={}', '--model', 'haiku'], /declares tools \{\{\+읽기 도구\}\} but no tools flag/)
  refused(['claude', '--step', 'flow.md#1', '--send', 'marker=marker.txt', '--send', 'prefs={}', '--tools', 'Read'], /declares a model \{\{#하이쿠\}\} but no model flag/)
  refused(['claude', '--step', 'flow.md#1', '--send', 'marker=marker.txt', '--send', 'prefs={}', '--model', 'haiku', '--allowedTools', 'Read'], /--allowedTools does not restrict tools/)
  refused(['claude', '--step', 'flow.md#1', '--send', 'marker=nope.txt', '--send', 'prefs={}', '--model', 'haiku', '--tools', 'Read'], /\(path\) input but no file or folder exists/)
  refused(['claude', '--step', 'flow.md#1', '--send', 'marker=@marker.txt', '--send', 'prefs={}', '--model', 'haiku', '--tools', 'Read'], /pass the path itself/)
  refused(['claude', '--step', 'flow.md#1', '--send', 'marker=marker.txt', '--send', 'prefs=nope', '--model', 'haiku', '--tools', 'Read'], /\(json\) input but the value is not valid JSON/)
  refused(['claude', '--step', 'flow.md#1', '--send', 'marker', 'marker.txt'], /--send expects name=value/)
  refused(['gemini', '--step', 'flow.md#1'], /unknown runtime "gemini"\. Known: claude, codex/)
  refused(['claude', '--step', 'flow.md#9', '--send', 'x=1'], /no heading numbered 9/)
  const help = r('--help'); assert.equal(help.status, 0); assert.match(help.stdout, /sil run claude --step flow\.md#1/); assert.match(help.stdout, /enforcement: os-sandbox/); assert.match(help.stdout, /--keep-session/)
  const codex = r('codex', ...ok.slice(1, 7), '-m', 'gpt-5.4-mini', '-s', 'read-only', '--dry-run')
  assert.equal(codex.stdout.trim(), 'codex exec --json --skip-git-repo-check - -m gpt-5.4-mini -s read-only < <prompt>')
  // {{-…}} on the call line: sil adds the runtime's own switch for its project start files, and says so in the prompt
  const cut = ['--step', 'flow.md#3', '--send', 'marker=marker.txt', '--send', 'prefs={"a":1}']
  assert.equal(r('claude', ...cut, '--model', 'haiku', '--tools', 'Read', '--dry-run').stdout.trim(),
    'claude -p --output-format stream-json --verbose --setting-sources user --no-session-persistence --model haiku --tools Read < <prompt>')
  assert.equal(r('codex', ...cut, '-m', 'gpt-5.4-mini', '-s', 'read-only', '--dry-run').stdout.trim(),
    'codex exec --json --skip-git-repo-check -c project_doc_max_bytes=0 - -m gpt-5.4-mini -s read-only < <prompt>')
  assert.match(r('claude', ...cut, '--model', 'haiku', '--tools', 'Read', '--prompt-only').stdout,
    /^This session runs one isolated step of a flow\. The project start files are switched off for it/, 'the prompt tells the subagent it is on its own')
  rmSync(d, { recursive: true, force: true })
})

test('run: the subagent starts in the project root — links in the called document and (path) values are rewritten to it; {{>name}} in a target is filled from --send and must exist', () => {
  const d = resolve(tmpdir(), `sil-run-root-${process.pid}`); rmSync(d, { recursive: true, force: true })
  for (const sub of ['.sil', 'flows/agents', 'flows/references', 'docs']) mkdirSync(resolve(d, sub), { recursive: true })
  writeFileSync(resolve(d, 'flows/flow.md'), '# 흐름\n\n## 1. 전문가 ((서브에이전트로, sil run))\n[전문가](agents/expert.md) 를 {{>topic}} 와 {{>spec}} 와 함께 부르고 {{<notes}} 를 받는다. {{#하이쿠}} 에서 {{+읽기}} 만 쓴다.\n')
  writeFileSync(resolve(d, 'flows/agents/expert.md'), '# 전문가\n\n[규칙](../../docs/rules.md#톤) 을 따른다. [색인](../references/README.md) 과 [주제 문서](../references/{{>topic}}.md) 를 읽고 [자료](../references/{{>later}}.json) 는 나중에 정해진다. [밖](https://x.com) 은 그대로.\n\n[정의][def] 도 있다.\n\n[def]: ../references/README.md\n\n## {{>입력}}\n- topic — 주제\n- spec (path) — 규격 파일\n\n## {{<출력}}\n- notes\n')
  writeFileSync(resolve(d, 'flows/references/README.md'), '# 색인\n'); writeFileSync(resolve(d, 'flows/references/hook.md'), '# 훅\n'); writeFileSync(resolve(d, 'docs/rules.md'), '# 규칙\n\n## 톤\n'); writeFileSync(resolve(d, 'docs/spec.json'), '{}\n')
  const r = (...a: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', MAIN, 'run', 'claude', '--step', 'flows/flow.md#1', ...a, '--model', 'haiku', '--tools', 'Read'], { encoding: 'utf8', cwd: d })
  const p = r('--send', 'topic=hook', '--send', 'spec=../docs/spec.json', '--prompt-only')
  assert.equal(p.status, 0, p.stderr)
  assert.match(p.stdout, /File paths are relative to the current working directory/)
  assert.match(p.stdout, /\[규칙\]\(docs\/rules\.md#톤\)/, 'a link above the flow folder resolves from the root and keeps its anchor')
  assert.match(p.stdout, /\[색인\]\(flows\/references\/README\.md\)/, 'a sibling folder of the agent is written from the root')
  assert.match(p.stdout, /\[주제 문서\]\(flows\/references\/hook\.md\)/, '{{>topic}} is filled from --send')
  assert.match(p.stdout, /\[자료\]\(flows\/references\/\{\{>later\}\}\.json\)/, 'a value that is not sent stays a marker, root-relative')
  assert.match(p.stdout, /\[밖\]\(https:\/\/x\.com\)/, 'external links are untouched')
  assert.match(p.stdout, /\[def\]: flows\/references\/README\.md/, 'reference-style definitions are rewritten too')
  assert.match(p.stdout, /- spec:\ndocs\/spec\.json/, 'a (path) value given relative to the flow file is shown from the root')
  assert.doesNotMatch(p.stdout, /\.\.\//, 'nothing in the prompt climbs out of the root')
  const bad = r('--send', 'topic=nope', '--send', 'spec=../docs/spec.json', '--prompt-only')
  assert.equal(bad.status, 1); assert.match(bad.stderr, /links \.\.\/references\/\{\{>topic\}\}\.md, which becomes flows\/references\/nope\.md with the values sent, but no file exists there/)
  rmSync(d, { recursive: true, force: true })
})

test('run: starts the runtime found on PATH with the prompt on stdin, decodes UTF-8 across chunks, caches only a clean run, and misses the cache when a pointed-at file changes', { skip: process.platform === 'win32' && 'the fake runtime is a POSIX script' }, async () => {
  const { delimiter } = await import('node:path')
  const d = resolve(tmpdir(), `sil-run-fake-${process.pid}`); rmSync(d, { recursive: true, force: true })
  for (const sub of ['.sil', 'agents', 'bin']) mkdirSync(resolve(d, sub), { recursive: true })
  writeFileSync(resolve(d, 'flow.md'), '# Flow\n\n## 1. Check ((use a subagent via sil run))\nCall [Checker](agents/checker.md) with {{>spec}} and receive {{<report}}. Use {{+read}} on {{#fast}}.\n')
  // The called document is a CRLF checkout with frontmatter
  writeFileSync(resolve(d, 'agents/checker.md'), '---\r\nsil:\r\n  type: task\r\n---\r\n# Checker\r\n\r\nRead [the rules](../rules.md).\r\n\r\n## {{>Inputs}}\r\n- spec (path) — the file\r\n\r\n## {{<Outputs}}\r\n- report\r\n')
  writeFileSync(resolve(d, 'rules.md'), '# Rules\n'); writeFileSync(resolve(d, 'spec.txt'), 'v1\n')
  // A fake claude: --version exits 0; a run records its arguments and stdin, then streams its events one byte per write, so a multi-byte
  // character is split between chunks. FAKE_MODE=error ends with an error result that carries no text, and exit code 1
  writeFileSync(resolve(d, 'bin/claude'), `#!${process.execPath}
const fs = require('node:fs')
if (process.argv[2] === '--version') { console.log('0.0.0 (fake)'); process.exit(0) }
let input = ''
process.stdin.setEncoding('utf8').on('data', (c) => { input += c }).on('end', async () => {
  fs.writeFileSync('.sil/fake-call.json', JSON.stringify({ args: process.argv.slice(2), stdin: input }))
  const error = process.env.FAKE_MODE === 'error'
  const events = [{ type: 'system', subtype: 'init', tools: ['Read'] }, { type: 'assistant', message: { model: 'fake-haiku', content: [] } },
    error ? { type: 'result', subtype: 'error_max_turns', is_error: true } : { type: 'result', subtype: 'success', is_error: false, result: '{"report": "한글 보고서 ✓"}' }]
  for (const b of Buffer.from(events.map((e) => JSON.stringify(e)).join('\\n') + '\\n')) { process.stdout.write(Buffer.from([b])); await new Promise((r) => setTimeout(r, 0)) }
  process.exitCode = error ? 1 : 0
})
`, { mode: 0o755 })
  const sil = (mode: string) => spawnSync(process.execPath, ['--experimental-strip-types', MAIN, 'run', 'claude', '--step', 'flow.md#1', '--send', 'spec=spec.txt', '--model', 'haiku', '--tools', 'Read'],
    { encoding: 'utf8', cwd: d, env: { ...process.env, PATH: `${resolve(d, 'bin')}${delimiter}${process.env.PATH}`, FAKE_MODE: mode } })
  try {
    const failed = sil('error')
    assert.equal(failed.status, 1, failed.stderr)
    assert.match(failed.stderr, /claude reported an error \(error_max_turns\)\. Not cached; record \.sil\/run\//)
    const call = JSON.parse(readFileSync(resolve(d, '.sil/fake-call.json'), 'utf8')) as { args: string[]; stdin: string }
    assert.deepEqual(call.args, ['-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--model', 'haiku', '--tools', 'Read'], 'the prompt is not on the command line')
    assert.match(call.stdin, /^This session runs one step of a flow[\s\S]*\n# Checker\n\nRead \[the rules\]\(rules\.md\)\.\n[\s\S]*- spec:\nspec\.txt\n/, 'the prompt arrives on stdin')
    assert.doesNotMatch(call.stdin, /sil:|type: task|\r/, 'the CRLF frontmatter does not leak into the prompt, and the body is LF')
    const ok = sil('ok')
    assert.equal(ok.status, 0, ok.stderr)
    assert.deepEqual(JSON.parse(ok.stdout), { report: '한글 보고서 ✓' }, 'characters split across chunks are decoded whole')
    assert.match(ok.stderr, /ran as fake-haiku · tools given \[Read\]/)
    const cached = sil('error')
    assert.equal(cached.status, 0, 'the failed run left no cache entry; the clean one did, so the failing fake does not run'); assert.match(cached.stderr, /cached from .*; nothing ran/)
    writeFileSync(resolve(d, 'spec.txt'), 'v2\n')
    assert.equal(sil('error').status, 1, 'the (path) file changed: the cache misses and the runtime runs')
    writeFileSync(resolve(d, 'spec.txt'), 'v1\n')
    assert.equal(sil('error').status, 0, 'the content that was cached is back: a hit again')
    writeFileSync(resolve(d, 'rules.md'), '# Rules\n\nOne more rule.\n')
    assert.equal(sil('error').status, 1, 'a linked document changed: the cache misses')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('update and migrate on CRLF files (a Windows checkout): a current project stays unchanged, endings stay CRLF, an appended line starts on its own line', () => {
  const d = resolve(tmpdir(), `sil-crlf-${process.pid}`); rmSync(d, { recursive: true, force: true }); mkdirSync(d)
  writeFileSync(resolve(d, 'flow.md'), '# Flow\n\nWork.\n')
  run('init', d, '--lang=ko')
  const onlyCRLF = (f: string) => !/(^|[^\r])\n/.test(readFileSync(resolve(d, f), 'utf8'))
  for (const f of ['SILMARI.md', 'CLAUDE.md', '.sil/config.yaml']) writeFileSync(resolve(d, f), readFileSync(resolve(d, f), 'utf8').replace(/\n/g, '\r\n'))
  // The migration question as an older sil wrote it
  writeFileSync(resolve(d, 'CLAUDE.md'), readFileSync(resolve(d, 'CLAUDE.md'), 'utf8').replace(/When starting work, if this project's md files do not yet follow[^\r]*/, "When starting work, if this project's md files do not yet follow the SILMARI.md notation, ask the old way."))
  const first = run('update', d).stdout
  assert.match(first, /Updated: CLAUDE\.md \(migration line points at \.sil\/migration\.md\)/)
  assert.doesNotMatch(first, /Updated: SILMARI\.md|Recorded:/, 'a current CRLF entry document is not rewritten, and the CRLF config is read with its version')
  for (const f of ['SILMARI.md', 'CLAUDE.md', '.sil/config.yaml']) assert.ok(onlyCRLF(f), `${f} keeps CRLF only`)
  assert.match(run('update', d).stdout, /Unchanged: SILMARI\.md\nUp to date: \d+\.\d+\.\d+\n$/)
  writeFileSync(resolve(d, 'AGENTS.md'), '# Codex\r\nno newline at the end')
  run('migrate', d)
  assert.match(readFileSync(resolve(d, 'AGENTS.md'), 'utf8'), /^# Codex\r\nno newline at the end\r\nWhen starting work, if this project's md files do not yet follow[^\r\n]*\r\n$/)
  rmSync(d, { recursive: true, force: true })
})

test('pickLang: --lang first, then LC_ALL and LANG; C and POSIX name no language, so the system locale decides, as on Windows where LANG is unset', async () => {
  const { pickLang } = await import('../src/init.ts')
  assert.equal(pickLang('ko', { LANG: 'ja_JP.UTF-8' }), 'ko')
  assert.equal(pickLang(undefined, { LC_ALL: 'de_DE.UTF-8', LANG: 'ja_JP.UTF-8' }), 'de')
  assert.equal(pickLang(undefined, { LANG: 'ko_KR.UTF-8' }), 'ko')
  const system = /^([a-z]{2,3})/i.exec(Intl.DateTimeFormat().resolvedOptions().locale)?.[1].toLowerCase() ?? 'en'
  for (const env of [{ LANG: 'C.UTF-8' }, { LANG: 'POSIX' }, {}]) assert.equal(pickLang(undefined, env), system, JSON.stringify(env))
})

test('README.md for npm is generated from the repository README and is current (tools/readme.mjs --check)', () => {
  const r = spawnSync(process.execPath, [resolve(import.meta.dirname, '../../../tools/readme.mjs'), '--check'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})
