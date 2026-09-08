// Rule unit tests. Cases absent from the corpus are given as strings. Appendix A.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDoc, buildGraph, parseConfig, findProjectRoot } from '../src/index.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const codes = (docs: Record<string, string>) =>
  buildGraph(new Map(Object.entries(docs).map(([rel, src]) => [rel, parseDoc(rel, src)]))).diagnostics.map((d) => d.code)

const diagsOf = (docs: Record<string, string>) =>
  buildGraph(new Map(Object.entries(docs).map(([rel, src]) => [rel, parseDoc(rel, src)]))).diagnostics

const TASK = '\n\n## {{<Outputs}}\n- done\n' // A contract makes it a task node.

test('links resolve like imports: relative to the document, or from the project root with a leading /', () => {
  const g = buildGraph(new Map([
    ['flows/a.md', parseDoc('flows/a.md', '# A\n\nCall [b](../agents/b.md) with {{>x}}. Then [c](/agents/c.md) with {{>x}}. Then [d](./d.md).\n')],
    ['agents/b.md', parseDoc('agents/b.md', '# B\n\n## {{>Inputs}}\n- x\n')],
    ['agents/c.md', parseDoc('agents/c.md', '# C\n\n## {{>Inputs}}\n- x\n')],
    ['flows/d.md', parseDoc('flows/d.md', '---\nsil:\n  type: task\n---\n# D\n\nnothing\n')],
  ]))
  assert.deepEqual(g.edges.map((e) => e.to).sort(), ['agents/b.md', 'agents/c.md', 'flows/d.md'])
  assert.ok(!g.diagnostics.some((d) => d.code === 'L-N01'), 'the root-relative link is found')
})

test('findProjectRoot: the nearest ancestor with .sil/, bounded by stop', () => {
  const d = mkdtempSync(join(tmpdir(), 'sil-root-'))
  mkdirSync(join(d, 'proj', '.sil'), { recursive: true }); mkdirSync(join(d, 'proj', 'a', 'b'), { recursive: true }); mkdirSync(join(d, 'other'), { recursive: true })
  assert.equal(findProjectRoot(join(d, 'proj', 'a', 'b')), join(d, 'proj'))
  assert.equal(findProjectRoot(join(d, 'proj')), join(d, 'proj'))
  assert.equal(findProjectRoot(join(d, 'proj', 'a'), join(d, 'proj', 'a')), null, 'stop below the .sil folder: not found')
  assert.equal(findProjectRoot(join(d, 'other'), d), null)
  rmSync(d, { recursive: true, force: true })
})

test('L-N05: a link in a heading is not an edge, for task nodes only', () => {
  assert.ok(codes({ 'a.md': '# A\n\n## [b](b.md) 를 보라' + TASK, 'b.md': '# B\n\n자료.\n' }).includes('L-N05'))
  assert.ok(!codes({ 'a.md': '# A\n\n## [b](b.md) 를 보라\n\n본문.\n', 'b.md': '# B\n\n자료.\n' }).includes('L-N05'), 'Reference documents stay quiet')
})

test('L-N06: no H1 or multiple H1 headings, for task nodes only', () => {
  assert.ok(codes({ 'a.md': '설명만.' + TASK }).includes('L-N06'))
  assert.ok(codes({ 'a.md': '# 하나\n\n설명.\n\n# 둘' + TASK }).includes('L-N06'))
  assert.ok(!codes({ 'a.md': '# 하나\n\n설명.' + TASK }).includes('L-N06'))
  assert.ok(!codes({ 'a.md': '설명만. H1 없는 자료.\n' }).includes('L-N06'), 'Reference documents stay quiet')
})

test('L-G01: checks orphans only in projects with at least one call edge', () => {
  const orphan = { 'x.md': '# X\n\n아무도 안 부르는 자료.\n' }
  assert.ok(!codes({ ...orphan, 'r.md': '# R\n\n[y](y.md) 를 본다.\n', 'y.md': '# Y\n\n자료.\n' }).includes('L-G01'), 'Projects without notation stay quiet')
  assert.ok(codes({ ...orphan, 'a.md': '# A\n\n[b](b.md) 에 {{>v}} 를 넘긴다.\n', 'b.md': '# B' + TASK }).includes('L-G01'))
})

test('L-G06: checks only calls with data; referring to a document twice is valid', () => {
  assert.ok(!codes({ 'a.md': '# A\n\n[d](d.md) 를 본다.\n\n[d](d.md) 를 또 본다.\n', 'd.md': '# D\n\n자료.\n' }).includes('L-G06'))
})

test('L-N13: {{ }} without a link is an error', () => {
  assert.ok(codes({ 'a.md': '# A\n\n{{>x}} 를 넘긴다.\n' }).includes('L-N13'))
  assert.ok(codes({ 'a.md': '# A\n\n{{>x}} 를 [b](b.md) 에 넘긴다.\n', 'b.md': '# B\n\n## {{>Inputs}}\n- x\n' }).includes('L-N13'), 'It is also an error before the first link')
})

test('L-N04: name syntax', () => {
  assert.ok(codes({ 'a.md': '# A\n\n[b](b.md) 에 {{>왼쪽 값}} 을 넘긴다.\n', 'b.md': '# B\n\n## {{>Inputs}}\n- x\n' }).includes('L-N04'))
})

test('L-N15: retired each-item marker {{*}} gives a warning and is read as a send', () => {
  const ds = diagsOf({ 'a.md': '# A\n\n[b](b.md) 에 {{*x}} 를 넘긴다.\n', 'b.md': '# B\n\n## {{>Inputs}}\n- x\n\n## Steps\n\n일.\n' })
  assert.ok(ds.some((d) => d.code === 'L-N15' && d.severity === 'warning'))
  assert.ok(!ds.some((d) => d.code === 'L-C01'), 'It is read as a send and passes the contract check')
})

test('L-C01 / L-C02: a contract mismatch is a warning', () => {
  const b = '# B\n\n설명.\n\n## {{>Inputs}}\n- 왼쪽값\n\n## {{<Outputs}}\n- 합\n'
  assert.ok(codes({ 'a.md': '# A\n\n[b](b.md) 에 {{>오른쪽값}} 을 넘겨 {{<합}} 을 받는다.\n', 'b.md': b }).includes('L-C01'))
  assert.ok(codes({ 'a.md': '# A\n\n[b](b.md) 에 {{>왼쪽값}} 을 넘겨 {{<곱}} 을 받는다.\n', 'b.md': b }).includes('L-C02'))
  assert.ok(!codes({ 'a.md': '# A\n\n[b](b.md) 에 {{>왼쪽값}} 을 넘겨 {{<합}} 을 받는다.\n', 'b.md': b }).some((x) => x.startsWith('L-C')))
})

test('L-G06: another call without a condition warns; one under a condition heading is valid', () => {
  const b = '# B\n\n## {{>Inputs}}\n- x\n'
  assert.ok(codes({ 'a.md': '# A\n\n[b](b.md) 에 {{>x}} 를 넘긴다.\n\n[b](b.md) 에 {{>x}} 를 또 넘긴다.\n', 'b.md': b }).includes('L-G06'))
  assert.ok(!codes({ 'a.md': '# A\n\n## 1\n[b](b.md) 에 {{>x}} 를 넘긴다.\n\n## 문제가 있으면\n[b](b.md) 에 {{>x}} 를 또 넘긴다.\n', 'b.md': b }).includes('L-G06'))
})

test('External URLs, images, and same-file anchors do not create edges (§1.7)', () => {
  const g = buildGraph(new Map([['a.md', parseDoc('a.md', '# A\n\n[x](https://x.com) ![i](i.png) [목차](#a) [코드](x.ts)\n')]]))
  assert.equal(g.edges.length, 0)
  assert.ok(!g.diagnostics.some((d) => d.code === 'L-N01'))
})

test('loadDir excludes .gitignore matches and .claude/worktrees', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { loadDir } = await import('../src/load.ts')
  const d = mkdtempSync(join(tmpdir(), 'sil-'))
  for (const p of ['a.md', 'Library/x.md', '.claude/worktrees/w/b.md', 'docs/c.md']) { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), '# T\n') }
  writeFileSync(join(d, '.gitignore'), 'Library/\n')
  assert.deepEqual([...loadDir(d).keys()], ['a.md', 'docs/c.md'])
  rmSync(d, { recursive: true })
})

test('A file outside the scan but present on disk is not a ghost', () => {
  const docs = new Map([['a.md', parseDoc('a.md', '# A\n\n[n](novel/x.md) 를 본다.\n')]])
  const g = buildGraph(docs, { exists: (rel) => rel === 'novel/x.md' })
  assert.equal(g.nodes.find((n) => n.id === 'novel/x.md')?.kind, 'doc')
  assert.ok(!g.diagnostics.some((d) => d.code === 'L-N01'))
  assert.ok(buildGraph(docs).diagnostics.some((d) => d.code === 'L-N01'), 'Without exists, it remains a ghost')
})

test('Frontmatter: only the sil block is read. Other tools\' keys (name, tools, model) are ignored; sil: type overrides the guess', () => {
  const src = '---\nname: verify\ndescription: 검증\ntools: Read, Grep\nmodel: haiku\nsil:\n  type: task\n---\n\n# 검증\n\n본다.\n'
  const g = buildGraph(new Map([['.claude/agents/verify.md', parseDoc('.claude/agents/verify.md', src)]]))
  assert.equal(g.nodes[0].kind, 'task')
  assert.ok(!('agent' in g.nodes[0]), 'no agent field on the node')
  assert.equal(buildGraph(new Map([['a.md', parseDoc('a.md', '---\ntools: Read\n---\n# A\n\n자료.\n')]])).nodes[0].kind, 'doc', 'tools in frontmatter do not make a task')
})

test('Contract headings are symbols at any level and in any language; the words inside become the heading text', () => {
  const d = parseDoc('b.md', '# B\n\n## {{>입력}}\n- posting — 공고\n- prefs (json) — 설정\n\n### {{<出力}}\n- analysis\n')
  assert.deepEqual(d.contractIn, ['posting', 'prefs']); assert.deepEqual(d.contractOut, ['analysis'])
  assert.deepEqual(d.contractTypes, { prefs: 'json' })
  assert.deepEqual(d.headings.map((h) => [h.text, h.contract]), [['B', undefined], ['입력', 'in'], ['出力', 'out']])
  assert.ok(!parseDoc('c.md', '# C\n\n## Inputs\n- x\n').contractIn.length, 'a plain word is no longer a contract heading')
  const g = buildGraph(new Map([['b.md', d]]))
  assert.deepEqual(g.nodes[0].contract, { inputs: ['posting', 'prefs'], outputs: ['analysis'], types: { prefs: 'json' } })
})

test('L-N18 / L-N19 / L-N20 / L-N21: empty markers, a contract heading as H1, trailing text, unbalanced (( ))', () => {
  const ds = diagsOf({ 'a.md': '# A\n\n## {{>}}\n- x\n\n## {{>Inputs}} (optional)\n- y\n\n## 1. Go (())\n\n## 2. Go ((use a subagent)\n\n[b](b.md) 에 {{>x}} {{+}} 를 넘긴다.\n', 'b.md': '# B\n\n## {{>Inputs}}\n- x\n' })
  assert.equal(ds.filter((d) => d.code === 'L-N18').length, 3, 'empty {{>}} heading, empty (()), empty {{+}}')
  assert.ok(ds.some((d) => d.code === 'L-N20'))
  assert.ok(ds.some((d) => d.code === 'L-N21'))
  assert.ok(diagsOf({ 'a.md': '# {{>Inputs}}\n- x\n' }).some((d) => d.code === 'L-N19'))
})

test('{{+tools}} and {{#model}} attach to the call; free text; L-N25 when a subagent call has none, L-N26 when a plain call has them', () => {
  const b = '# B\n\n## {{>Inputs}}\n- x\n'
  const g = buildGraph(new Map([
    ['a.md', parseDoc('a.md', '# A\n\n## 1. 분석 ((서브에이전트))\n[b](b.md) 에 {{>x}} 를 넘긴다. {{#가장 작은 모델}} 로 {{+파일 읽기}} {{+shell}} 만.\n\n## 2. 다시 ((서브에이전트))\n[b](b.md) 에 {{>x}} 를 넘긴다.\n\n## 3. 인라인\n[b](b.md) 에 {{>x}} 를 넘긴다. {{#fast}}\n')],
    ['b.md', parseDoc('b.md', b)],
  ]))
  assert.deepEqual(g.edges[0].tools, ['파일 읽기', 'shell']); assert.equal(g.edges[0].model, '가장 작은 모델')
  assert.ok(!('tools' in g.edges[1]) && !('model' in g.edges[1]), 'absent when not written')
  const codes = g.diagnostics.map((d) => d.code)
  assert.ok(codes.includes('L-N25')); assert.ok(codes.includes('L-N26'))
})

test('L-N22 / L-N23 / L-N24: call to a file without a contract, a sent value from nowhere, different tool sets for one file', () => {
  const ds = diagsOf({
    'a.md': '# A\n\n## 1 ((sub))\n[b](b.md) 에 {{>x}} 를 넘긴다. {{+read}}\n\n## 2 ((sub))\n[b](b.md) 에 {{>x}} 를 넘긴다. {{+read}} {{+shell}}\n\n## 3 ((sub))\n[c](c.md) 에 {{>y}} 를 넘겨 {{<z}} 를 받는다. {{+read}}\n',
    'b.md': '# B\n\n계약 없음.\n', 'c.md': '# C\n\n## {{>Inputs}}\n- y\n\n## {{<Outputs}}\n- z\n',
  })
  assert.ok(ds.some((d) => d.code === 'L-N22' && d.where.startsWith('a.md')))
  assert.ok(ds.some((d) => d.code === 'L-N23' && d.message.endsWith(': x')), 'x is sent but never received or declared')
  assert.ok(ds.some((d) => d.code === 'L-N24' && d.where === 'b.md'))
})

test('<!-- sil:ignore L-G01 --> on the first line suppresses only that rule for that file (§1.8)', () => {
  const base = { 'a.md': '# A\n\n[b](b.md) 에 {{>v}} 를 넘긴다.\n', 'b.md': '# B' + TASK }
  assert.ok(codes({ ...base, 'x.md': '# X\n\n고아.\n' }).includes('L-G01'))
  assert.ok(!codes({ ...base, 'x.md': '<!-- sil:ignore L-G01 -->\n# X\n\n고아.\n' }).includes('L-G01'))
  assert.ok(!codes({ ...base, 'x.md': '---\nsil:\n  type: doc\n---\n<!-- sil:ignore L-G01, L-N06 -->\n# X\n' }).includes('L-G01'), 'The line after frontmatter also works')
  assert.ok(codes({ ...base, 'x.md': '# X\n\n<!-- sil:ignore L-G01 -->\n' }).includes('L-G01'), 'It is ignored when it is not the first line')
})

test('L-N17: a received value is used when returned as an output', () => {
  const b = '# B\n\n## {{>Inputs}}\n- x\n\n## {{<Outputs}}\n- r\n'
  assert.ok(codes({ 'a.md': '# A\n\n[b](b.md) 에 {{>x}} 를 넘겨 {{<r}} 을 받는다.\n', 'b.md': b }).includes('L-N17'))
  assert.ok(!codes({ 'a.md': '# A\n\n[b](b.md) 에 {{>x}} 를 넘겨 {{<r}} 을 받는다.\n\n## {{<Outputs}}\n- r\n', 'b.md': b }).includes('L-N17'))
})

test('Anchor slugs match github-slugger and preserve double hyphens', async () => {
  const { slug } = await import('../src/parse.ts')
  assert.equal(slug('G. 점수 게이트 — 사람이 결정한다'), 'g-점수-게이트--사람이-결정한다')
  assert.equal(slug('8. 개인정보 주입 + 인쇄'), '8-개인정보-주입--인쇄')
  assert.equal(slug('2. 검색 조건 확정'), '2-검색-조건-확정')
  assert.equal(slug('되돌리기 {#x}'.replace(/\s*\{#.*$/, '')), '되돌리기')
})

test('L-G01: a .claude/commands/ entry point is not an orphan', () => {
  const base = { 'a.md': '# A\n\n[b](b.md) 에 {{>v}} 를 넘긴다.\n', 'b.md': '# B' + TASK }
  assert.ok(!codes({ ...base, '.claude/commands/go.md': '# Go\n\n[a](../../a.md) 를 읽는다.\n' }).includes('L-G01'))
  assert.ok(codes({ ...base, 'docs/x.md': '# X\n\n고아.\n' }).includes('L-G01'))
})

test('Diagnostic range uses file-based bytes and points to the link with frontmatter (INV-8)', () => {
  const src = '---\nsil:\n  type: task\n---\n# 가\n\n한글 앞말 [없음](없음.md) 뒤.\n'
  const g = buildGraph(new Map([['a.md', parseDoc('a.md', src)]]))
  const d = g.diagnostics.find((x) => x.code === 'L-N01')!
  const buf = Buffer.from(src, 'utf8')
  assert.equal(buf.subarray(d.range!.start, d.range!.end).toString('utf8'), '[없음](없음.md)')
  const n13 = buildGraph(new Map([['b.md', parseDoc('b.md', '# 나\n\n앞 {{>값}} 뒤.\n')]])).diagnostics.find((x) => x.code === 'L-N13')!
  assert.equal(Buffer.from('# 나\n\n앞 {{>값}} 뒤.\n').subarray(n13.range!.start, n13.range!.end).toString(), '{{>값}}')
})

test('Heading body keeps source text up to the next heading and lines match with frontmatter', () => {
  const src = '---\nsil:\n  type: task\n---\n# 제목\n\n설명 한 줄.\n\n## Steps\n\n첫 문단.\n\n- 목록\n\n### 세부\n\n세부 본문.\n\n## {{<Outputs}}\n- 값\n'
  const hs = parseDoc('a.md', src).headings
  assert.deepEqual(hs.map((h) => [h.text, h.body]), [
    ['제목', '설명 한 줄.'], ['Steps', '첫 문단.\n\n- 목록'], ['세부', '세부 본문.'], ['Outputs', '- 값'],
  ])
})

test('Heading body range matches file-based body bytes with frontmatter, BOM, CRLF, and an empty body', () => {
  const check = (src: string) => {
    const buf = Buffer.from(src, 'utf8')
    for (const h of parseDoc('a.md', src).headings) {
      assert.equal(buf.subarray(h.range.start, h.range.end).toString('utf8'), h.body, `${h.text}: ${JSON.stringify(h.body)}`)
    }
  }
  check('---\nsil:\n  type: task\n---\n# 가\n\n설명.\n\n## Steps\n\n첫 줄.\n둘째 줄.\n\n## 빈 것\n\n## {{<Outputs}}\n- 값\n')
  check('﻿# 가\r\n\r\n한글 본문.\r\n\r\n## 둘\r\n본문 둘\r\n')
  const src = '# 가\n\n## 빈 것\n\n## 다음\n본문\n'
  const empty = parseDoc('a.md', src).headings.find((h) => h.text === '빈 것')!
  assert.equal(empty.body, ''); assert.equal(empty.range.start, empty.range.end)
  assert.equal(Buffer.from(src).subarray(0, empty.range.start).toString(), '# 가\n\n## 빈 것\n', 'The insertion point is right after the heading line')
})

test('Config reads entry, scan.exclude, lang and strict; words is ignored; entry points are not orphans', async () => {
  const { parseConfig, isConventionalEntry } = await import('../src/config.ts')
  const c = parseConfig('entry: [CLAUDE.md, .claude/commands/go.md]\nscan:\n  exclude: [".sil/backups/**", "tmp/**"]\nstrict: true\n')
  assert.deepEqual(c, { strict: true, scan: { exclude: ['.sil/backups/**', 'tmp/**'] }, entry: ['CLAUDE.md', '.claude/commands/go.md'], lang: 'en' })
  assert.deepEqual(parseConfig('entry:\n  - AGENTS.md\n  - 흐름.md\n').entry, ['AGENTS.md', '흐름.md'])
  assert.equal(parseConfig('lang: ja\n').lang, 'ja')
  assert.deepEqual(parseConfig('words:\n  inputs: [입력]\n'), { strict: false, scan: { exclude: [] }, entry: [], lang: 'en' }, 'a 0.1.x words section is ignored without error')
  assert.ok(isConventionalEntry('SILMARI.md') && isConventionalEntry('AGENTS.md') && isConventionalEntry('.github/prompts/x.prompt.md') && !isConventionalEntry('docs/x.md'))
  const base = { 'a.md': '# A\n\n[b](b.md) 에 {{>v}} 를 넘긴다.\n', 'b.md': '# B' + TASK }
  const g = buildGraph(new Map(Object.entries({ ...base, '흐름.md': '# 흐름\n\n설명.\n', 'AGENTS.md': '# 규칙\n' }).map(([r, s]) => [r, parseDoc(r, s)])), { entry: ['흐름.md'] })
  assert.deepEqual(g.entry, ['흐름.md'])
  assert.ok(!g.diagnostics.some((d) => d.code === 'L-G01'), 'Neither configured entry 흐름 nor conventional entry AGENTS.md is an orphan')
})

test('L-I04: @ in a heading label is info; legacy notation still enables isolation', () => {
  const g = buildGraph(new Map([['a.md', parseDoc('a.md', '# A\n\n## 1. 일 [@서브 에이전트]\n\n[b](b.md) 에 {{>x}} 를 넘긴다.\n')], ['b.md', parseDoc('b.md', '# B' + TASK)]]))
  assert.ok(g.diagnostics.some((d) => d.code === 'L-I04' && d.severity === 'info'))
  assert.ok(g.edges.some((e) => e.to === 'b.md' && e.isolated))
  const g2 = buildGraph(new Map([['a.md', parseDoc('a.md', '# A\n\n## 1. 일 [서브 에이전트]\n\n[b](b.md) 에 {{>x}} 를 넘긴다.\n')], ['b.md', parseDoc('b.md', '# B' + TASK)]]))
  assert.ok(!g2.diagnostics.some((d) => d.code === 'L-I04') && g2.edges.some((e) => e.to === 'b.md' && e.isolated))
})

test('Isolation label: ((…)) at the heading end in any language; the old [ ] form still isolates but reports L-I05', () => {
  const iso = (h: string) => parseDoc('a.md', `# A\n\n${h}\n\n[b](b.md)\n`).headings.find((x) => x.level === 2)!.subagent
  assert.ok(iso('## 1. Research ((use a subagent))'))
  assert.ok(iso('## 1. 조사 ((서브 에이전트 사용))  '))
  assert.ok(iso('## 1. 調査 ((サブエージェント))'))
  assert.ok(iso('## 1. 检查 ((子代理))'), 'one or two characters are a full instruction in some languages')
  assert.ok(!iso('## 1. Review (at most 2 times)'), 'single parentheses are ordinary text')
  assert.ok(!iso('## ((use a subagent)) list'), 'only at the end')
  assert.ok(!iso('## 1. 조사 (())'), 'empty label is not a label')
  const old = parseDoc('a.md', '# A\n\n## 1. 일 [서브 에이전트 사용]\n\n[b](b.md)\n')
  assert.ok(old.headings.find((x) => x.level === 2)!.subagent, 'legacy brackets still isolate')
  assert.ok(old.diags.some((d) => d.code === 'L-I05' && d.message.includes('((서브 에이전트 사용))')), 'and suggest the new form')
  assert.ok(!parseDoc('a.md', '# A\n\n## 1. Research ((use a subagent))\n\n[b](b.md)\n').diags.some((d) => d.code === 'L-I05'))
  assert.ok(!parseDoc('a.md', '# A\n\n## [서브 에이전트] 목록\n\n[b](b.md)\n').headings.find((x) => x.level === 2)!.subagent, '[subagent] inside a title is not a label')
})
