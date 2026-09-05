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
const flow = g.edges.filter((e) => e.from === '흐름.md')
const count = (code: string) => g.diagnostics.filter((d) => d.code === code).length

test('Distinguishes tasks from reference documents', () => {
  assert.equal(node('흐름.md').kind, 'task', '흐름.md is a task because it calls another task')
  assert.equal(node('조사.md').kind, 'task', '조사.md is a task because it is called and has a contract')
  assert.equal(node('정리.md').kind, 'task', '정리.md is a task because it has a task heading')
  assert.equal(node('구조.md').kind, 'doc'); assert.equal(node('코딩규칙.md').kind, 'doc')
  assert.ok(g.nodes.some((n) => n.kind === 'ghost'), 'The ghost node remains')
})

test('Sequence: call order in the flow matches document order', () => {
  assert.deepEqual(flow.map((e) => e.to), ['조사.md', '계획.md', '구현.md', '검토.md', '구현.md', '정리.md'])
})

test('Each-item repetition: the research call says "for each file" and sends one value', () => {
  assert.ok(flow.some((e) => e.to === '조사.md' && e.sends.length === 1 && e.sends[0] === '대상파일'))
})

test('Choice and retry: calls again under a condition heading', () => {
  const loop = flow.filter((e) => e.to === '구현.md')
  assert.equal(loop.length, 2)
  assert.ok(loop[1].under.at(-1)!.endsWith('지적이 있으면'))
  assert.ok(flow.some((e) => e.to === '검토.md' && e.under.at(-1) === '4. 검토'), 'The review edge has its heading in under')
})

test('A call without data is a mention edge', () => {
  assert.ok(flow.some((e) => e.to === '정리.md' && e.type === 'mention'))
})

test('Isolation: [subagent] applies only to research and review sections', () => {
  for (const e of flow) {
    if (e.to === '조사.md' || e.to === '검토.md') assert.ok(e.isolated, e.to)
    if (e.to === '계획.md' || e.to === '구현.md') assert.ok(!e.isolated, e.to)
  }
})

test('Edges contain sends and returns', () => {
  assert.ok(g.edges.some((e) => e.from === '흐름.md' && e.to === '검토.md' && e.sends[0] === '변경파일' && e.returns[0] === '지적사항'))
})

test('A contract is a list below a heading', () => {
  assert.deepEqual(node('조사.md').contract, { inputs: ['대상파일'], outputs: ['조사결과'] })
})

test('There is no frontmatter, so none is required', () => {
  for (const d of docs.values()) assert.deepEqual(d.fm, {}, d.rel)
})

test('Finds the seeded problems exactly', () => {
  assert.equal(count('L-N01'), 1, 'Missing file 검토기준.md in review')
  assert.equal(count('L-N09'), 1, 'Missing anchor #되돌리기 in cleanup')
  const codes = new Set(g.diagnostics.map((d) => d.code))
  for (const c of codes) assert.ok(!/^L-N1[0-6]$/.test(c), `No notation error. Actual code: ${c}`)
})

test('Allows receiving the same name again under a different condition', () => {
  const recv = flow.filter((e) => e.returns.includes('변경파일'))
  assert.equal(recv.length, 2)
  assert.equal(count('L-N16'), 0)
})
