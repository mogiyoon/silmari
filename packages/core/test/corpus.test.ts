// What the corpus demonstrates. Design document Appendix C.5.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { loadDir, buildGraph, readConfig } from '../src/index.ts'

const root = fileURLToPath(new URL('./fixtures/after/', import.meta.url))
const cfg = readConfig(root)
const docs = loadDir(root, cfg.scan.exclude, cfg.words)
const g = buildGraph(docs, { entry: cfg.entry })
const node = (id: string) => g.nodes.find((n) => n.id === id)!
const flow = g.edges.filter((e) => e.from === 'flow.md')
const count = (code: string) => g.diagnostics.filter((d) => d.code === code).length

test('Distinguishes tasks from reference documents', () => {
  assert.equal(node('flow.md').kind, 'task', 'flow.md is a task because it calls another task')
  assert.equal(node('research.md').kind, 'task', 'research.md is a task because it is called and has a contract')
  assert.equal(node('wrap-up.md').kind, 'task', 'wrap-up.md is a task because it has a task heading')
  assert.equal(node('structure.md').kind, 'doc'); assert.equal(node('coding-rules.md').kind, 'doc')
  assert.ok(g.nodes.some((n) => n.kind === 'ghost'), 'The ghost node remains')
})

test('Sequence: call order in the flow matches document order', () => {
  assert.deepEqual(flow.map((e) => e.to), ['research.md', 'plan.md', 'implement.md', 'review.md', 'implement.md', 'wrap-up.md'])
})

test('Each-item repetition: the research call says "for each file" and sends one value', () => {
  assert.ok(flow.some((e) => e.to === 'research.md' && e.sends.length === 1 && e.sends[0] === 'target'))
})

test('Choice and retry: calls again under a condition heading', () => {
  const loop = flow.filter((e) => e.to === 'implement.md')
  assert.equal(loop.length, 2)
  assert.ok(loop[1].under.at(-1)!.endsWith('If there are comments'))
  assert.ok(flow.some((e) => e.to === 'review.md' && e.under.at(-1) === '4. Review'), 'The review edge has its heading in under')
})

test('A call without data is a mention edge', () => {
  assert.ok(flow.some((e) => e.to === 'wrap-up.md' && e.type === 'mention'))
})

test('Isolation: [subagent] applies only to research and review sections', () => {
  for (const e of flow) {
    if (e.to === 'research.md' || e.to === 'review.md') assert.ok(e.isolated, e.to)
    if (e.to === 'plan.md' || e.to === 'implement.md') assert.ok(!e.isolated, e.to)
  }
})

test('Edges contain sends and returns', () => {
  assert.ok(g.edges.some((e) => e.from === 'flow.md' && e.to === 'review.md' && e.sends[0] === 'changed-files' && e.returns[0] === 'comments'))
})

test('A contract is a list below a heading', () => {
  assert.deepEqual(node('research.md').contract, { inputs: ['target'], outputs: ['findings'] })
})

test('There is no frontmatter, so none is required', () => {
  for (const d of docs.values()) assert.deepEqual(d.fm, {}, d.rel)
})

test('Finds the seeded problems exactly', () => {
  assert.equal(count('L-N01'), 1, 'Missing file review-criteria.md in review')
  assert.equal(count('L-N09'), 1, 'Missing anchor #rollback in wrap-up')
  const codes = new Set(g.diagnostics.map((d) => d.code))
  for (const c of codes) assert.ok(!/^L-N1[0-6]$/.test(c), `No notation error. Actual code: ${c}`)
})

test('Allows receiving the same name again under a different condition', () => {
  const recv = flow.filter((e) => e.returns.includes('changed-files'))
  assert.equal(recv.length, 2)
  assert.equal(count('L-N16'), 0)
})
