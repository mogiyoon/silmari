// Flow views (flows.ts) on the example projects: which documents are flows, and that only what the files say is drawn.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadDir, existsIn, globIn, buildGraph, readConfig } from '@silmari/core/node'
import { flowModel, spineView, laneView } from '../src/flows.ts'

const graphOf = (name: string) => {
  const root = resolve(import.meta.dirname, '../../../examples', name), cfg = readConfig(root)
  return buildGraph(loadDir(root, cfg.scan.exclude), { exists: existsIn(root), glob: globIn(root), entry: cfg.entry })
}

test('flowModel on examples/pipeline: every document with steps is a flow; the roots are those no other flow calls; only the entry point picks', () => {
  const M = flowModel(graphOf('pipeline'))
  assert.deepEqual(M.roots, ['O/a.md'], 'the start document calls flows 1–3 from its steps, so they nest inside it')
  assert.deepEqual(M.pickers.get('O/a.md'), ['SILMARI.md'])
  // every top-level section in the order written, contracts aside: no section is dropped for lacking a number or a call
  assert.deepEqual(M.stepsOf('O/i.md')!.map((s) => s.h.text), ['실행 범위', '0. 재개와 공통 준비', '1. 분석', '2. 선정', '3. A 가 대상이면 조립', '4. B 가 대상이면 조립', '5. 검증과 출력', '6. 흐름 3이 필요하면', '7. 기록과 보고'])
})

test('spineView draws steps in one line, in document order: no inferred branches, loops or routers', () => {
  const a = spineView(flowModel(graphOf('pipeline')))
  assert.ok(!a.svg.includes('fv-loop') && !a.svg.includes('fv-router'))
  // every next-step arrow is a straight horizontal line: nothing forks
  for (const m of a.svg.matchAll(/class="fv-next" d="([^"]+)"/g)) assert.match(m[1], /^M[\d.]+ [\d.]+ H[\d.]+$/)
  // the pipeline calls the 2nd scorer at step 3 and again at step 8: the same document in two places, joined, not looped
  assert.ok((a.svg.match(/class="fv-sharemark"/g) ?? []).length >= 2)
})

test('stepsOf takes the section level the document uses and keeps calls above the first section', () => {
  const g = { spec: 'v5', stats: {} as never, diagnostics: [], entry: [],
    nodes: [{ id: 'f.md', kind: 'task', title: 'F', desc: '', contract: null, hash: '', headings: [
      { level: 1, text: 'F', line: 1, subagent: false, body: '', range: { start: 0, end: 0 } },
      { level: 3, text: '가. 메모하기', line: 5, subagent: false, body: '', range: { start: 0, end: 0 } },
      { level: 3, text: '나. 보내기', line: 8, subagent: false, body: '', range: { start: 0, end: 0 } }] },
      { id: 'a.md', kind: 'task', title: 'A', desc: '', contract: null, hash: '', headings: [] }],
    edges: [{ from: 'f.md', to: 'a.md', type: 'call', line: 3, under: ['F'], sends: ['x'], returns: [], isolated: false, range: { start: 0, end: 0 } },
      { from: 'f.md', to: 'a.md', type: 'call', line: 9, under: ['F', '나. 보내기'], sends: ['x'], returns: [], isolated: false, range: { start: 0, end: 0 } }] }
  const st = flowModel(g as never).stepsOf('f.md')!
  assert.deepEqual(st.map((s) => [s.h.text, s.calls.length]), [['—', 1], ['가. 메모하기', 0], ['나. 보내기', 1]])
})

test('laneView draws every call and its answer', () => {
  const b = laneView(flowModel(graphOf('studio')))
  assert.equal((b.svg.match(/class="fv-bcall/g) ?? []).length, (b.svg.match(/class="fv-bret"/g) ?? []).length)
})
