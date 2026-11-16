// The canvas graph (view.ts): which lines and nodes stay for each set of line switches. Uses examples/studio, the tangled example project.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadDir, existsIn, globIn, buildGraph, readConfig } from '@silmari/core/node'
import { viewGraph, focusOf, groupOf } from '../src/view.ts'
import { entryView } from '../src/layout.ts'

const root = resolve(import.meta.dirname, '../../../examples/studio')
const cfg = readConfig(root)
const g = buildGraph(loadDir(root, cfg.scan.exclude), { exists: existsIn(root), glob: globIn(root), entry: cfg.entry })
const kind = new Map(g.nodes.map((n) => [n.id, n.kind]))

test('viewGraph: calls only keeps every call, every task, the entry registrations and the broken links; drops references and file data', () => {
  const v = viewGraph(g, { lines: ['call'] })
  assert.equal(v.edges.filter((e) => e.type === 'call').length, g.edges.filter((e) => e.type === 'call').length)
  for (const e of v.edges) if (e.type !== 'call') assert.ok(kind.get(e.to) === 'ghost' || e.to === 'SILMARI.md' || e.from === 'SILMARI.md', `${e.type} ${e.from} → ${e.to}`)
  assert.ok(!v.nodes.some((n) => n.id === 'rules/writing.md'), 'a hub rule document goes with its references')
  assert.ok(!v.nodes.some((n) => n.id === 'templates/profile.json'), 'a data file goes with its file data')
  assert.ok(v.nodes.some((n) => n.id === 'docs/old-guide.md') && v.edges.some((e) => e.to === 'docs/old-guide.md'), 'a broken link stays, with the document that has it')
  for (const n of g.nodes) if (n.kind === 'task') assert.ok(v.nodes.some((x) => x.id === n.id), n.id)
  const ev = entryView(v, new Set(v.nodes.map((n) => n.id)))
  assert.deepEqual(ev?.starters, ['flows/hiring.md', 'flows/research.md', 'flows/content.md', 'flows/release.md', 'flows/audit.md'], 'the entry view survives: registrations are references')
  assert.deepEqual(ev?.startFiles.sort(), ['AGENTS.md', 'CLAUDE.md'])
})

test('viewGraph: every group on is the graph itself; each switch adds its own lines', () => {
  assert.equal(viewGraph(g, { lines: ['call', 'ref', 'data'] }), g)
  const withData = viewGraph(g, { lines: ['call', 'data'] })
  assert.ok(withData.edges.some((e) => groupOf(e.type) === 'data'))
  assert.ok(!withData.edges.some((e) => groupOf(e.type) === 'ref' && kind.get(e.to) !== 'ghost' && e.to !== 'SILMARI.md' && e.from !== 'SILMARI.md'))
  assert.ok(viewGraph(g, { lines: ['call', 'ref'] }).nodes.some((n) => n.id === 'rules/writing.md'))
})

test('viewGraph: the focused document shows its own file data; a document without any is not a focus', () => {
  const intake = 'agents/hiring/intake.md'
  assert.equal(focusOf(g, intake), intake)
  assert.equal(focusOf(g, 'agents/research/scout-hook.md'), null, 'no file data: clicking it must not rebuild the picture')
  const v = viewGraph(g, { lines: ['call'], focus: intake })
  const data = v.edges.filter((e) => groupOf(e.type) === 'data')
  assert.ok(data.length > 0 && data.every((e) => e.from === intake || e.to === intake || e.declaredIn === intake))
  assert.ok(!v.edges.some((e) => groupOf(e.type) === 'data' && e.declaredIn === 'flows/hiring.md'), 'other documents keep their file data hidden')
})

test('viewGraph: a router keeps its flows together — mentions are drawn with calls, and the entry point keeps its link to the router', () => {
  const root = resolve(import.meta.dirname, '../../../examples/pipeline')
  const cfg = readConfig(root)
  const p = buildGraph(loadDir(root, cfg.scan.exclude), { exists: existsIn(root), glob: globIn(root), entry: cfg.entry })
  const v = viewGraph(p, { lines: ['call'] })
  const has = (from: string, to: string) => v.edges.some((e) => e.from === from && e.to === to)
  assert.ok(has('SILMARI.md', 'O/a.md'), 'entry → router')
  for (const f of ['O/b.md', 'O/i.md', 'J/M/t.md']) assert.ok(has('O/a.md', f), `router → ${f}`)
  assert.ok(has('O/i.md', 'J/M/t.md'), 'a flow that hands over to another without values')
  assert.ok(p.nodes.some((n) => n.id === 'J/M/r1.md') && !v.nodes.some((n) => n.id === 'J/M/r1.md'), 'rule documents still go with their references')
})
