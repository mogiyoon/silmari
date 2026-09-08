// Layout works for both corpora. It gives every visible node coordinates. Labels do not overlap nodes or other labels.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { loadDir, existsIn, buildGraph, readConfig } from '@silmari/core'
import { layout, labelBox, SIZE, entryView, skeleton } from '../src/layout.ts'

// The golden corpus lives with core's tests; the personal migration corpus sits outside the repository (notes/ is ignored) and is used only where present
const CORPORA: [string, string][] = [['after', resolve(import.meta.dirname, '../../core/test/fixtures/after')], ['mogiyoon', resolve(import.meta.dirname, '../../../notes/examples/mogiyoon')]]
for (const [dir, root] of CORPORA) {
  test(`layout: ${dir}`, { skip: !existsSync(root) && 'private corpus not present' }, () => {
    const g = buildGraph(loadDir(root, [], readConfig(root).words), { exists: existsIn(root) })
    const visible = new Set(g.nodes.map((n) => n.id))
    const { nodes: pos, labels } = layout(g, visible)
    assert.equal(pos.size, g.nodes.length)
    for (const [id, p] of pos) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), id)

    // Every labeled edge gets a position
    const boxes = [...labels].map(([i, c]) => ({ i, c, b: labelBox(g.edges[i]) }))
    assert.equal(boxes.length, g.edges.filter((e) => e.from !== e.to && labelBox(e).h > 0).length)
    // Labels do not overlap
    for (const a of boxes) for (const b of boxes) if (a.i < b.i) {
      const overlap = Math.abs(a.c.x - b.c.x) < (a.b.w + b.b.w) / 2 && Math.abs(a.c.y - b.c.y) < (a.b.h + b.b.h) / 2
      assert.ok(!overlap, `label overlap ${a.i} ${b.i}`)
    }
    // Labels do not overlap node boxes
    for (const { c, b } of boxes) for (const n of g.nodes) {
      const p = pos.get(n.id)!, s = SIZE[n.kind]
      const inside = c.x + b.w / 2 > p.x && c.x - b.w / 2 < p.x + s.w && c.y + b.h / 2 > p.y && c.y - b.h / 2 < p.y + s.h
      assert.ok(!inside, `label overlaps node ${n.id}`)
    }
  })
}

test('layout: handles multiple parallel edges and stacks labels vertically', () => {
  const g = buildGraph(new Map([
    ['f.md', { rel: 'f.md', fm: {}, title: 'F', desc: '', headings: [], anchors: new Set(), contractIn: [], contractOut: [], contractTypes: {}, ignores: new Set(), diags: [],
      links: [1, 2, 3, 4, 5].map((i) => ({ text: 'c', target: 'c.md', line: i, range: { start: 0, end: 1 }, sends: ['x'], returns: [], tools: [], model: null, under: ['F', String(i)], isolated: false, refstyle: false })) }],
    ['c.md', { rel: 'c.md', fm: { type: 'task' }, title: 'C', desc: '', headings: [], anchors: new Set(), contractIn: [], contractOut: [], contractTypes: {}, ignores: new Set(), diags: [], links: [] }],
  ]))
  assert.equal(g.edges.length, 5)
  const { labels } = layout(g, new Set(['f.md', 'c.md']))
  const ys = [...labels.values()].map((c) => c.y)
  assert.equal(ys.length, 5)
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b), 'top to bottom in edge order')
  assert.equal(new Set([...labels.values()].map((c) => c.x)).size, 1, 'the same pair has the same x')
})

test('layout: in a cycle-only group (planning → implementation → review → planning), the start is planning and the cycle edge is review → planning', async () => {
  const { parseDoc } = await import('@silmari/core')
  const docs = new Map([
    ['기획.md', parseDoc('기획.md', '# 기획\n\n요청을 받아 계획을 세운다.\n\n## 1. 구현\n\n[구현](구현.md)에 {{>계획}}을 전달해 {{<결과}}를 받는다.\n')],
    ['구현.md', parseDoc('구현.md', '# 구현\n\n## 하는 일\n\n[검토](검토.md)에 {{>결과}}를 전달해 {{<지적}}을 받는다.\n')],
    ['검토.md', parseDoc('검토.md', '# 검토\n\n## 하는 일\n\n결과를 본다.\n\n## 지적이 크면\n\n[기획](기획.md)에 {{>지적}}을 전달해 {{<계획}}을 다시 받는다.\n')],
  ])
  const g = buildGraph(docs)
  const { nodes, cycles } = layout(g, new Set(g.nodes.map((n) => n.id)))
  const x = (id: string) => nodes.get(id)!.x
  assert.ok(x('기획.md') < x('구현.md') && x('구현.md') < x('검토.md'), `order planning < implementation < review: ${x('기획.md')} ${x('구현.md')} ${x('검토.md')}`)
  const back = [...cycles].map((i) => `${g.edges[i].from}→${g.edges[i].to}`)
  assert.deepEqual(back, ['검토.md→기획.md'])
})

test('layout: the configured entry point is a root, and orphan references stay visible below it', async () => {
  const { parseDoc } = await import('@silmari/core')
  const docs = new Map([
    ['README.md', parseDoc('README.md', '# 읽어줘\n\n고아.\n')],
    ['흐름.md', parseDoc('흐름.md', '# 흐름\n\n[일](일.md)에 {{>x}}를 넘긴다.\n')],
    ['일.md', parseDoc('일.md', '# 일\n\n## 하는 일\n\n한다.\n')],
  ])
  const g = buildGraph(docs, { entry: ['흐름.md'] })
  const { nodes } = layout(g, new Set(g.nodes.map((n) => n.id)))
  const p = (id: string) => nodes.get(id)!
  assert.ok(p('일.md').x > p('흐름.md').x)
  // The orphan is not connected to anything, so it gets its own grid cell to the right of the flow (same row), not a slot under the entry
  assert.ok(p('README.md').x > p('일.md').x, 'orphan cell is right of the flow')
  assert.equal(p('README.md').y, p('흐름.md').y, 'same row')
})

test('layout: disconnected flows go into separate grid cells — A in column 1, B in column 2; a third and fourth start a second row', async () => {
  const { parseDoc } = await import('@silmari/core')
  const flow = (n: string) => [[`${n}.md`, parseDoc(`${n}.md`, `# ${n}\n\n[${n}일](${n}일.md)에 {{>x}}를 넘긴다.\n`)], [`${n}일.md`, parseDoc(`${n}일.md`, `# ${n}일\n\n## 하는 일\n\n한다.\n`)]] as [string, ReturnType<typeof parseDoc>][]
  const two = buildGraph(new Map([...flow('a'), ...flow('b')]))
  const l2 = layout(two, new Set(two.nodes.map((n) => n.id)))
  const right = (id: string) => l2.nodes.get(id)!.x + SIZE.task.w
  assert.ok(l2.nodes.get('b.md')!.x > Math.max(right('a.md'), right('a일.md')), 'B starts right of everything in A')
  assert.equal(l2.nodes.get('a.md')!.y, l2.nodes.get('b.md')!.y, 'A and B share row 1')
  const four = buildGraph(new Map([...flow('a'), ...flow('b'), ...flow('c'), ...flow('d')]))
  const l4 = layout(four, new Set(four.nodes.map((n) => n.id)))
  assert.equal(l4.nodes.get('a.md')!.x, l4.nodes.get('c.md')!.x, 'C sits under A (2 columns for 4 cells)')
  assert.ok(l4.nodes.get('c.md')!.y > l4.nodes.get('a일.md')!.y, 'row 2 is below row 1')
})

test('layout: columns use the shortest path from a root; directly called review stays in the first column when implementation also calls it', async () => {
  const root = resolve(import.meta.dirname, '../../core/test/fixtures/after')
  const g = buildGraph(loadDir(root, [], readConfig(root).words), { exists: existsIn(root) })
  const { nodes, sameCol } = layout(g, new Set(g.nodes.map((n) => n.id)))
  const x = (id: string) => nodes.get(id)!.x
  assert.equal(x('review.md'), x('research.md'), 'review is in the same column as research, planning, implementation, and summary')
  assert.ok(x('structure.md') > x('research.md'))
  const same = [...sameCol].map((i) => `${g.edges[i].from}→${g.edges[i].to}`)
  assert.ok(same.includes('implement.md→review.md') && same.includes('review.md→implement.md'), `same-column edges: ${same.join(', ')}`)
})

test('layout: labels on dragged nodes follow them; labels for two nodes that call each other stay beside them without overlap', async () => {
  const root = resolve(import.meta.dirname, '../../core/test/fixtures/after')
  const g = buildGraph(loadDir(root, [], readConfig(root).words), { exists: existsIn(root) })
  const all = new Set(g.nodes.map((n) => n.id))
  const pinned = { 'implement.md': { x: 1000, y: 800 }, 'review.md': { x: 1000, y: 900 } }
  const { labels } = layout(g, all, new Set(), undefined, pinned)
  const idx = (a: string, b: string) => g.edges.findIndex((e) => e.from === a && e.to === b)
  const l1 = labels.get(idx('implement.md', 'review.md'))!, l2 = labels.get(idx('review.md', 'implement.md'))!
  const w = SIZE.task.w
  assert.ok(l1.x > 1000 + w && l2.x > 1000 + w, `both labels right of nodes: ${l1.x}, ${l2.x}`)
  assert.ok(Math.abs(l1.y - 850) < 160 && Math.abs(l2.y - 850) < 160, `both labels at node height: ${l1.y}, ${l2.y}`)
  const b1 = labelBox(g.edges[idx('implement.md', 'review.md')]), b2 = labelBox(g.edges[idx('review.md', 'implement.md')])
  assert.ok(Math.abs(l1.y - l2.y) >= (b1.h + b2.h) / 2, 'labels for nodes that call each other do not overlap')
  // Labels on nodes that were not dragged stay between columns
  const base = layout(g, all)
  const i3 = idx('flow.md', 'research.md')
  assert.deepEqual(labels.get(i3), base.labels.get(i3))
})

test('layout: a label sits at the height of the node it goes to, in child order; a repeated call stacks under the first label for that child', async () => {
  const root = resolve(import.meta.dirname, '../../core/test/fixtures/after')
  const g = buildGraph(loadDir(root, [], readConfig(root).words), { exists: existsIn(root) })
  const { nodes, labels } = layout(g, new Set(g.nodes.map((n) => n.id)))
  const idx = (to: string, nth = 0) => g.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.from === 'flow.md' && e.to === to)[nth].i
  const center = (id: string) => nodes.get(id)!.y + SIZE.task.h / 2
  for (const to of ['research.md', 'plan.md', 'review.md', 'wrap-up.md']) assert.ok(Math.abs(labels.get(idx(to))!.y - center(to)) < 1, `label to ${to} at its height`)
  const first = labels.get(idx('implement.md', 0))!, again = labels.get(idx('implement.md', 1))!
  assert.ok(again.y > first.y && Math.abs((first.y + again.y) / 2 - center('implement.md')) < 1, 'the two calls to implement are one group centered on implement, first above')
})

test('layout: a parent sits at the vertical center of its children block, and the next parent block starts below — A/a1..a4 then B/b1..b3', async () => {
  const { parseDoc } = await import('@silmari/core')
  const task = (n: string) => [`${n}.md`, parseDoc(`${n}.md`, `# ${n}\n\n## 하는 일\n\n한다.\n`)] as const
  const calls = (n: string, ks: string[]) => [`${n}.md`, parseDoc(`${n}.md`, `# ${n}\n\n${ks.map((k) => `[${k}](${k}.md)에 {{>x}}를 넘긴다.`).join('\n\n')}\n`)] as const
  const docs = new Map<string, ReturnType<typeof parseDoc>>([calls('root', ['A', 'B']), calls('A', ['a1', 'a2', 'a3', 'a4']), calls('B', ['b1', 'b2', 'b3']), ...['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3'].map(task)])
  const g = buildGraph(docs, { entry: ['root.md'] })
  const { nodes } = layout(g, new Set(g.nodes.map((n) => n.id)))
  const y = (id: string) => nodes.get(`${id}.md`)!.y, h = SIZE.task.h
  const mid = (id: string) => y(id) + h / 2
  assert.ok(y('a1') < y('a2') && y('a2') < y('a3') && y('a3') < y('a4') && y('a4') < y('b1') && y('b1') < y('b2') && y('b2') < y('b3'), 'children keep call order, B group below A group')
  assert.ok(Math.abs(mid('A') - (y('a1') + (y('a4') + h)) / 2) < 1, 'A is centered on a1..a4')
  assert.ok(Math.abs(mid('B') - (y('b1') + (y('b3') + h)) / 2) < 1, 'B is centered on b1..b3')
  assert.ok(y('B') > y('A') && Math.abs(mid('root') - (y('a1') + (y('b3') + h)) / 2) < 1, 'root is centered on the whole')
})

test("layout option labelOrder 'flow': labels follow the parent's line order top to bottom (1·2·3·4·5·6), the repeat call below the later one", async () => {
  const root = resolve(import.meta.dirname, '../../core/test/fixtures/after')
  const g = buildGraph(loadDir(root, [], readConfig(root).words), { exists: existsIn(root) })
  const { labels } = layout(g, new Set(g.nodes.map((n) => n.id)), new Set(), undefined, {}, { labelOrder: 'flow' })
  const ys = g.edges.map((e, i) => ({ e, i })).filter(({ e, i }) => e.from === 'flow.md' && labels.has(i)).map(({ i }) => labels.get(i)!.y)
  for (let k = 1; k < ys.length; k++) assert.ok(ys[k] > ys[k - 1], `label ${k} below label ${k - 1}`)
})

test('entry view: the entry document registers flows by linking them; start files sit before it; downstream stops at the entry; shared documents belong to both', async () => {
  const { parseDoc } = await import('@silmari/core')
  const docs = new Map([
    ['CLAUDE.md', parseDoc('CLAUDE.md', '# CLAUDE\n\n[SILMARI.md](SILMARI.md) is the entry point. Read it first.\n')],
    ['SILMARI.md', parseDoc('SILMARI.md', '# SILMARI\n\nFollow the [rules](RULES.md).\n\n## Flow\n\n- [Feature](a.md)\n- [Release](b.md)\n')],
    ['RULES.md', parseDoc('RULES.md', '# Rules\n\nBe brief.\n')],
    ['a.md', parseDoc('a.md', '# A\n\nCall [c](c.md) with {{>x}} and receive {{<y}}. See [SILMARI.md](SILMARI.md).\n')],
    ['b.md', parseDoc('b.md', '# B\n\nCall [c](c.md) with {{>x}} and receive {{<y}}. Then [d](d.md) with {{>y}}.\n')],
    ['c.md', parseDoc('c.md', '# C\n\n## {{>Inputs}}\n- x\n## {{<Outputs}}\n- y\n')],
    ['d.md', parseDoc('d.md', '# D\n\n## {{>Inputs}}\n- y\n')],
    ['loose.md', parseDoc('loose.md', '# Loose\n\nCall [c](c.md) with {{>x}}.\n')],
  ])
  const g = buildGraph(docs, { entry: ['SILMARI.md'] })
  const all = new Set(g.nodes.map((n) => n.id))
  const v = entryView(g, all)!
  assert.ok(v, 'the entry document links tasks, so the entry view exists')
  assert.equal(v.entry, 'SILMARI.md')
  assert.deepEqual(v.starters, ['a.md', 'b.md'], 'task links from the entry document, in link order; the rules document (a reference) is not a starter')
  assert.deepEqual(v.startFiles, ['CLAUDE.md'], 'links the entry point and nobody calls it')
  assert.deepEqual([...v.downstream('a.md')].sort(), ['a.md', 'c.md'], 'a links back to SILMARI.md, but downstream never re-enters the entry document')
  assert.deepEqual([...v.downstream('b.md')].sort(), ['b.md', 'c.md', 'd.md'])
  // No registration: the viewer falls back to the connectivity view
  const noReg = buildGraph(new Map([['SILMARI.md', docs.get('SILMARI.md')!], ['RULES.md', docs.get('RULES.md')!]]), { entry: ['SILMARI.md'] })
  assert.equal(entryView(noReg, new Set(noReg.nodes.map((n) => n.id))), null)
  // A hidden kind drops its starters: with tasks off there is nothing to start from
  assert.equal(entryView(g, new Set([...all].filter((id) => g.nodes.find((n) => n.id === id)!.kind !== 'task'))), null)
  // The start file is placed before the entry point, and the entry point one column to its right
  const sk = skeleton(g, [...all])
  assert.equal(sk.rank.get('CLAUDE.md'), 0); assert.equal(sk.rank.get('SILMARI.md'), 1); assert.equal(sk.rank.get('a.md'), 2)
})
