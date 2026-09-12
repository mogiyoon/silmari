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

test('layout: data imported from a generated file comes in from above along the import row, not through the return lane', () => {
  const node = (id: string, kind: 'task' | 'file') => ({ id, kind, title: id, desc: '', headings: [], contract: null, ...(kind === 'file' ? { file: { exists: false, planned: true } } : {}) })
  const edge = (from: string, to: string, type: 'call' | 'read' | 'write') => ({ from, to, type, line: 1, under: [], sends: [], returns: [], tools: [], model: null, isolated: false, range: { start: 0, end: 0 } })
  const g = {
    nodes: [node('flow.md', 'task'), node('build.md', 'task'), node('wrap.md', 'task'), node('builder.mjs', 'file'), node('out/report.json', 'file')],
    edges: [edge('flow.md', 'build.md', 'call'), edge('flow.md', 'wrap.md', 'call'), edge('build.md', 'builder.mjs', 'call'), edge('builder.mjs', 'out/report.json', 'write'), edge('out/report.json', 'wrap.md', 'read')],
    diagnostics: [], stats: { files: 5, nodes: 5, edges: 5, nodesByKind: { task: 3, doc: 0, file: 2, ghost: 0 }, edgesByType: { call: 3, read: 1, write: 1, ref: 0, mention: 0 } }, entry: [],
  } as any
  const placed = layout(g, new Set(g.nodes.map((n: { id: string }) => n.id)))
  assert.ok(placed.readRoutes.has(4), 'out/report.json → wrap.md uses the import row')
  assert.ok(!placed.returnRoutes.has(4), 'an import is not returned output')
})

test('layout: an import label stacks above the reader, and the reader, its children and the row above all keep clear of it', async () => {
  const { parseDoc } = await import('@silmari/core')
  const docs = new Map([
    ['흐름.md', parseDoc('흐름.md', '# 흐름\n\n[만들기](만들기.md)에 {{>x}}를 넘긴다.\n\n[일](일.md)에 {{>x}}를 넘긴다.\n')],
    ['만들기.md', parseDoc('만들기.md', '# 만들기\n\n[보고서](out/report.json)에 {{>report}}를 저장한다.\n')],
    ['일.md', parseDoc('일.md', '# 일\n\n[보고서](out/report.json)를 {{<report}}로 불러온다.\n\n[하위](하위.md)에 {{>x}}를 넘긴다.\n')],
    ['하위.md', parseDoc('하위.md', '# 하위\n\n## 하는 일\n\n한다.\n')],
  ])
  const g = buildGraph(docs, { entry: ['흐름.md'], exists: () => true })
  const ri = g.edges.findIndex((e) => e.type === 'read')
  assert.ok(ri >= 0 && g.edges[ri].from === 'out/report.json' && g.edges[ri].to === '일.md', 'the read edge runs from the file to the reader')
  const { nodes, labels, readRoutes } = layout(g, new Set(g.nodes.map((n) => n.id)))
  const p = (id: string) => nodes.get(id)!, lab = labels.get(ri)!, box = labelBox(g.edges[ri]), route = readRoutes.get(ri)!
  // label centered above the reader
  assert.equal(lab.x, p('일.md').x + SIZE.task.w / 2)
  assert.ok(lab.y + box.h / 2 < p('일.md').y, 'label sits above the reader')
  // the row the line travels along is above the label, and below everything the earlier sibling block placed (the file included)
  assert.ok(route.y < lab.y - box.h / 2, 'row above the label stack')
  assert.ok(route.y > p('out/report.json').y + SIZE.file.h, 'row below the writer block')
  assert.ok(route.y > p('만들기.md').y + SIZE.task.h)
  // the reader's child starts below the row, so the row is empty across the block
  assert.ok(p('하위.md').y > route.y, 'children start below the import row')
  assert.equal(route.outX, p('out/report.json').x + SIZE.file.w + 20)
})

test('layout: in a cycle-only group (planning → implementation → review → planning), the start is planning and the cycle edge is review → planning', async () => {
  const { parseDoc } = await import('@silmari/core')
  const docs = new Map([
    ['기획.md', parseDoc('기획.md', '# 기획\n\n요청을 받아 계획을 세운다.\n\n## 1. 구현\n\n[구현](구현.md)에 {{>계획}}을 전달해 {{<결과}}를 받는다.\n')],
    ['구현.md', parseDoc('구현.md', '# 구현\n\n## 하는 일\n\n[검토](검토.md)에 {{>결과}}를 전달해 {{<지적}}을 받는다.\n')],
    ['검토.md', parseDoc('검토.md', '# 검토\n\n## 하는 일\n\n결과를 본다.\n\n## 지적이 크면\n\n[기획](기획.md)에 {{>지적}}을 전달해 {{<계획}}을 다시 받는다.\n')],
  ])
  const g = buildGraph(docs)
  const { nodes, cycles, returnRoutes } = layout(g, new Set(g.nodes.map((n) => n.id)))
  const x = (id: string) => nodes.get(id)!.x
  assert.ok(x('기획.md') < x('구현.md') && x('구현.md') < x('검토.md'), `order planning < implementation < review: ${x('기획.md')} ${x('구현.md')} ${x('검토.md')}`)
  const back = [...cycles].map((i) => `${g.edges[i].from}→${g.edges[i].to}`)
  assert.deepEqual(back, ['검토.md→기획.md'])
  assert.ok(returnRoutes.has(g.edges.findIndex((e) => e.from === '검토.md' && e.to === '기획.md')), 'child → ancestor call uses a four-bend return route')
})

test('layout: a file that is only imported stands above its first reader and drops its line straight through the label', async () => {
  const { parseDoc } = await import('@silmari/core')
  const docs = new Map([
    ['흐름.md', parseDoc('흐름.md', '# 흐름\n\n[일](일.md)에 {{>x}}를 넘긴다.\n\n[둘](둘.md)에 {{>x}}를 넘긴다.\n')],
    ['일.md', parseDoc('일.md', '# 일\n\n[규칙](rules.json)을 {{<rules}}로 불러온다.\n')],
    ['둘.md', parseDoc('둘.md', '# 둘\n\n[규칙](rules.json)을 {{<rules}}로 불러온다.\n')],
  ])
  const g = buildGraph(docs, { entry: ['흐름.md'], exists: () => true })
  const reads = g.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'read')
  assert.equal(reads.length, 2)
  const { nodes, labels, readRoutes } = layout(g, new Set(g.nodes.map((n) => n.id)))
  const p = (id: string) => nodes.get(id)!, first = reads[0], second = reads[1], host = first.e.to, other = second.e.to
  // hosted by the first reader (edge order): centered above it, over its own label, not a root in the first column
  assert.equal(p('rules.json').x + SIZE.file.w / 2, p(host).x + SIZE.task.w / 2)
  assert.ok(p('rules.json').x > p('흐름.md').x + SIZE.task.w, 'the file is not in the root column')
  const lab = labels.get(first.i)!, box = labelBox(first.e)
  assert.ok(p('rules.json').y + SIZE.file.h < lab.y - box.h / 2 && lab.y + box.h / 2 < p(host).y, 'file, then label, then reader')
  assert.equal(readRoutes.get(first.i)!.drop, true)
  // the other reader gets a label above itself and a line along its row from where the file stands
  assert.equal(readRoutes.get(second.i)!.drop, undefined)
  assert.ok(labels.get(second.i)!.y < p(other).y)
})

test('layout: a call that runs back to an earlier column takes the return lane even when the target is not the caller\'s ancestor', async () => {
  const { parseDoc } = await import('@silmari/core')
  const docs = new Map([
    ['흐름.md', parseDoc('흐름.md', '# 흐름\n\n[가](가.md)에 {{>x}}를 넘긴다.\n\n[다](다.md)에 {{>x}}를 넘긴다.\n')],
    ['가.md', parseDoc('가.md', '# 가\n\n[나](나.md)에 {{>x}}를 넘긴다.\n')],
    ['나.md', parseDoc('나.md', '# 나\n\n[다](다.md)에 {{>x}}를 넘긴다.\n')],
    ['다.md', parseDoc('다.md', '# 다\n\n## 하는 일\n\n한다.\n')],
  ])
  const g = buildGraph(docs, { entry: ['흐름.md'] })
  const i = g.edges.findIndex((e) => e.from === '나.md' && e.to === '다.md')
  const { returnRoutes, nodes } = layout(g, new Set(g.nodes.map((n) => n.id)))
  assert.ok(nodes.get('다.md')!.x < nodes.get('나.md')!.x, '다 stays in the shallow column 흐름 gave it')
  assert.ok(returnRoutes.has(i), '나 → 다 runs back through the return lane instead of across its own node')
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
  // The first call's label sits at implement's height, so its line runs straight from the label into implement; the repeat call
  // stacks right under it and the children after it move down instead of the labels
  const first = labels.get(idx('implement.md', 0))!, again = labels.get(idx('implement.md', 1))!, b1 = labelBox(g.edges[idx('implement.md', 0)])
  assert.ok(Math.abs(first.y - center('implement.md')) < 1, 'the first call to implement sits at its height')
  assert.ok(again.y > first.y && again.y - labelBox(g.edges[idx('implement.md', 1)]).h / 2 >= first.y + b1.h / 2, 'the repeat call sits below the first')
  assert.ok(center('review.md') > again.y, 'review moved below the repeat label')
})

// A child stands beside the label of its parent's first call, and that line never bends after the label. Nothing else in the
// lane may take that height: not a call from another node with a lower edge index, not a same-column link's label, not the
// parent's own repeat call. Those go below. Checked for every child in every corpus, in both label orders
for (const [dir, root] of CORPORA) for (const labelOrder of ['children', 'flow'] as const) {
  test(`layout: every first call's label sits at its child's height — ${dir}, ${labelOrder}`, { skip: !existsSync(root) && 'private corpus not present' }, () => {
    const g = buildGraph(loadDir(root, [], readConfig(root).words), { exists: existsIn(root) })
    const visible = new Set(g.nodes.map((n) => n.id))
    const { nodes, labels } = layout(g, visible, new Set(), undefined, {}, { labelOrder })
    const { parent } = skeleton(g, [...visible])
    const kind = new Map(g.nodes.map((n) => [n.id, n.kind]))
    let checked = 0
    for (const [child, p] of parent) {
      const i = g.edges.findIndex((e, j) => e.from === p && e.to === child && e.type !== 'read' && labels.has(j))
      if (i < 0) continue
      checked += 1
      const c = nodes.get(child)!.y + SIZE[kind.get(child)!].h / 2
      assert.ok(Math.abs(labels.get(i)!.y - c) < 1, `${p} → ${child}: label at ${labels.get(i)!.y}, child center ${c}`)
    }
    assert.ok(checked > 0)
  })
}

test('layout: the first caller keeps the child at its label even when another caller has a lower edge index or a same-column label sits in the lane', async () => {
  const root = resolve(import.meta.dirname, '../../core/test/fixtures/after')
  const g = buildGraph(loadDir(root, [], readConfig(root).words), { exists: existsIn(root) })
  const { nodes, labels } = layout(g, new Set(g.nodes.map((n) => n.id)))
  const idx = (from: string, to: string) => g.edges.findIndex((e) => e.from === from && e.to === to)
  const center = (id: string) => nodes.get(id)!.y + SIZE[g.nodes.find((n) => n.id === id)!.kind].h / 2
  // plan.md's reference to structure.md comes first in edge order (plan < research), but research called it first
  assert.ok(idx('plan.md', 'structure.md') < idx('research.md', 'structure.md'))
  assert.ok(Math.abs(labels.get(idx('research.md', 'structure.md'))!.y - center('structure.md')) < 1, 'research → structure at structure')
  assert.ok(labels.get(idx('plan.md', 'structure.md'))!.y > center('structure.md'), 'plan → structure below it')
  // implement ↔ review share the lane with review → review-criteria; their labels go below, the first call stays straight
  assert.ok(Math.abs(labels.get(idx('review.md', 'review-criteria.md'))!.y - center('review-criteria.md')) < 1, 'review → review-criteria at review-criteria')
  assert.ok(labels.get(idx('implement.md', 'review.md'))!.y > center('review-criteria.md'))
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
  const { labels, nodes } = layout(g, new Set(g.nodes.map((n) => n.id)), new Set(), undefined, {}, { labelOrder: 'flow' })
  const calls = g.edges.map((e, i) => ({ e, i })).filter(({ e, i }) => e.from === 'flow.md' && labels.has(i))
  const ys = calls.map(({ i }) => labels.get(i)!.y)
  for (let k = 1; k < ys.length; k++) assert.ok(ys[k] > ys[k - 1], `label ${k} below label ${k - 1}`)
  // The first call to each child still sits at the child's height: the children move down to make room for the repeat call's label,
  // so a later first call (6. wrap-up after the repeat 5. implement) is not pushed off its child
  const seen = new Set<string>()
  for (const { e, i } of calls) {
    if (seen.has(e.to)) continue; seen.add(e.to)
    const p = nodes.get(e.to)!, n = g.nodes.find((x) => x.id === e.to)!
    assert.ok(Math.abs(labels.get(i)!.y - (p.y + SIZE[n.kind].h / 2)) < 1, `first call to ${e.to} sits at its height`)
  }
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
  // A registration is a plain link. When the entry document calls its tasks with values it is itself a flow, not an index of flows:
  // no entry view, and the connectivity view shows the whole flow (so its steps never become separate flow boxes)
  const asFlow = buildGraph(new Map([['flow.md', docs.get('a.md')!], ['c.md', docs.get('c.md')!]]), { entry: ['a.md'] })
  assert.equal(entryView(asFlow, new Set(asFlow.nodes.map((n) => n.id))), null)
  // The start file is placed before the entry point, and the entry point one column to its right
  const sk = skeleton(g, [...all])
  assert.equal(sk.rank.get('CLAUDE.md'), 0); assert.equal(sk.rank.get('SILMARI.md'), 1); assert.equal(sk.rank.get('a.md'), 2)
})
