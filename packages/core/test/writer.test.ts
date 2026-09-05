// Writer. Design document §6. Bytes outside the range stay unchanged (L-W01). Backup, atomic write, and restore (INV-5). Threats T-3~T-8 and T-10.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { parseDoc, buildGraph, writeRange, retargetLink, replaceBody, replaceBodies, WriteError } from '../src/index.ts'

const fresh = () => mkdtempSync(join(tmpdir(), 'sil-w-'))
const linkRange = (root: string, rel: string, to: string) => {
  const g = buildGraph(new Map([[rel, parseDoc(rel, readFileSync(join(root, rel), 'utf8'))]]))
  return g.edges.find((e) => e.to === to)!.range
}
// Git repository for tests. The check (§6.4) uses Git's view.
const gitInit = (root: string) => execSync('git init -q && git config user.email t@t && git config user.name t && git add -A && git ' + 'commit -qm init', { cwd: root })
const numstat = (root: string) => execSync('git -c core.quotepath=off diff --numstat', { cwd: root, encoding: 'utf8' }).trim()

test('retargetLink changes only the target and preserves other bytes, BOM, CRLF, no final newline, and Korean text (T-3 T-4 T-5 T-6)', () => {
  const root = fresh()
  const src = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# 가\r\n\r\n앞 [구현](구현.md)에 {{>계획}}을 넘긴다. 뒤  \r\n끝줄(개행 없음)', 'utf8')])
  writeFileSync(join(root, 'a.md'), src)
  const r = retargetLink(root, 'a.md', linkRange(root, 'a.md', '구현.md'), '구현2.md', { backupDir: null })
  const now = readFileSync(join(root, 'a.md'))
  assert.equal(r.before.toString(), '[구현](구현.md)'); assert.equal(r.after.toString(), '[구현](구현2.md)')
  assert.ok(now.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), 'Keeps the BOM')
  assert.ok(now.includes(Buffer.from('\r\n')), 'Keeps CRLF'); assert.ok(!now.toString().endsWith('\n'), 'Does not add a final newline')
  assert.ok(now.toString().includes('뒤  \r\n'), 'Keeps trailing spaces')
  assert.equal(now.length, src.length + 1)
  rmSync(root, { recursive: true })
})

test('Git diff has at most three lines, the check in §6.4', () => {
  const root = fresh()
  writeFileSync(join(root, '흐름.md'), '# 흐름\n\n## 1. 구현\n\n[구현](구현.md)에 {{>계획}}을 전달해 {{<변경파일}}을 받는다.\n\n## 2. 검토\n\n[검토](검토.md)를 돌린다.\n')
  gitInit(root)
  retargetLink(root, '흐름.md', linkRange(root, '흐름.md', '구현.md'), '구현/index.md', { backupDir: null })
  assert.equal(numstat(root), '1\t1\t흐름.md')
  assert.match(readFileSync(join(root, '흐름.md'), 'utf8'), /\[구현\]\(구현\/index\.md\)에 \{\{>계획\}\}/)
  rmSync(root, { recursive: true })
})

test('A backup remains in .sil/backups and a change after graph creation is rejected as STALE (T-10)', () => {
  const root = fresh()
  writeFileSync(join(root, 'a.md'), '# A\n\n[b](b.md) 를 본다.\n')
  const range = linkRange(root, 'a.md', 'b.md')
  const r = retargetLink(root, 'a.md', range, 'c.md')
  assert.ok(r.backup && readFileSync(r.backup, 'utf8').includes('[b](b.md)'), 'The backup matches the source')
  assert.equal(readdirSync(join(root, '.sil', 'backups')).length, 1)
  assert.throws(() => writeRange(root, 'a.md', range, Buffer.from('x'), { expect: Buffer.from('[b](b.md)'), backupDir: null }), (e: unknown) => (e as WriteError).code === 'STALE')
  assert.equal(readFileSync(join(root, 'a.md'), 'utf8'), '# A\n\n[b](c.md) 를 본다.\n', 'A rejection changes nothing')
  retargetLink(root, 'a.md', linkRange(root, 'a.md', 'c.md'), 'd.md')
  assert.equal(readdirSync(join(root, '.sil', 'backups')).length, 1, 'only the newest backup per file is kept')
  rmSync(root, { recursive: true })
})

test('Does not write outside the root, through symbolic links, or outside the range (T-8 · L-W06)', () => {
  const root = fresh()
  mkdirSync(join(root, 'in')); writeFileSync(join(root, 'in', 'a.md'), '# A\n[b](b.md)\n'); writeFileSync(join(root, 'outside.md'), '# O\n')
  symlinkSync(join(root, 'in', 'a.md'), join(root, 'in', 'link.md'))
  const code = (f: () => unknown) => { try { f(); return 'none' } catch (e) { return (e as WriteError).code } }
  assert.equal(code(() => writeRange(join(root, 'in'), '../outside.md', { start: 0, end: 1 }, Buffer.from('x'), { backupDir: null })), 'OUTSIDE_ROOT')
  assert.equal(code(() => writeRange(root, 'in/link.md', { start: 0, end: 1 }, Buffer.from('x'), { backupDir: null })), 'SYMLINK')
  assert.equal(code(() => writeRange(root, 'in/a.md', { start: 0, end: 999 }, Buffer.from('x'), { backupDir: null })), 'RANGE')
  assert.equal(readFileSync(join(root, 'in', 'a.md'), 'utf8'), '# A\n[b](b.md)\n')
  assert.equal(readFileSync(join(root, 'outside.md'), 'utf8'), '# O\n')
  rmSync(root, { recursive: true })
})

test('retargetLink rejects reference-style links and paths with parentheses', () => {
  const root = fresh()
  writeFileSync(join(root, 'a.md'), '# A\n\n[b](b.md) 와 [c][ref]\n\n[ref]: c.md\n')
  const g = buildGraph(new Map([['a.md', parseDoc('a.md', readFileSync(join(root, 'a.md'), 'utf8'))]]))
  const ref = g.edges.find((e) => e.to === 'c.md')!
  assert.throws(() => retargetLink(root, 'a.md', ref.range, 'd.md', { backupDir: null }), (e: unknown) => (e as WriteError).code === 'STALE')
  assert.throws(() => retargetLink(root, 'a.md', g.edges.find((e) => e.to === 'b.md')!.range, 'x (1).md', { backupDir: null }), (e: unknown) => (e as WriteError).code === 'RANGE')
  rmSync(root, { recursive: true })
})

test('replaceBody changes only the heading body, adds blank lines around an empty body, and limits Git diff to changed lines', () => {
  const root = fresh()
  const src = '# 흐름\n\n## 1. 조사 [@서브 에이전트]\n\n[조사](조사.md)에 {{*대상파일}}을 전달해 {{<조사결과}}를 받는다.\n\n## 2. 빈 것\n\n## 3. 정리\n\n[정리](정리.md)를 돌린다.\n'
  writeFileSync(join(root, '흐름.md'), src)
  gitInit(root)
  const hs = () => parseDoc('흐름.md', readFileSync(join(root, '흐름.md'), 'utf8')).headings
  const h1 = hs().find((h) => h.text === '1. 조사')!
  replaceBody(root, '흐름.md', h1.range, h1.body, '[조사](조사.md)에 {{*대상파일}}을 하나씩 전달해 {{<조사결과}}를 받는다.\n결과는 파일로 남긴다.', { backupDir: null })
  const h2 = hs().find((h) => h.text === '2. 빈 것')!
  replaceBody(root, '흐름.md', h2.range, '', '여기는 새 본문.', { backupDir: null })
  const now = readFileSync(join(root, '흐름.md'), 'utf8')
  assert.equal(now, '# 흐름\n\n## 1. 조사 [@서브 에이전트]\n\n[조사](조사.md)에 {{*대상파일}}을 하나씩 전달해 {{<조사결과}}를 받는다.\n결과는 파일로 남긴다.\n\n## 2. 빈 것\n\n여기는 새 본문.\n\n## 3. 정리\n\n[정리](정리.md)를 돌린다.\n')
  assert.equal(numstat(root), '4\t1\t흐름.md')
  // Reject if it differs from the body seen by the viewer.
  assert.throws(() => replaceBody(root, '흐름.md', h1.range, h1.body, 'x', { backupDir: null }), (e: unknown) => (e as WriteError).code === 'STALE')
  rmSync(root, { recursive: true })
})

test('expectHash rejects any change after graph creation; a range-only check misses appended text', () => {
  const root = fresh()
  writeFileSync(join(root, 'a.md'), '# A\n\n## 하는 일\n\n본문.\n')
  const doc = () => parseDoc('a.md', readFileSync(join(root, 'a.md'), 'utf8'))
  const d0 = doc(), h0 = d0.headings[1]
  replaceBody(root, 'a.md', h0.range, h0.body, '본문.\n한 줄 더.', { backupDir: null, expectHash: d0.hash })
  // Write again with the range, body, and hash from the old graph d0. expect passes because the bytes in the range are still '본문.'. The hash blocks it.
  assert.throws(() => replaceBody(root, 'a.md', h0.range, h0.body, 'x', { backupDir: null, expectHash: d0.hash }), (e: unknown) => (e as WriteError).code === 'STALE')
  assert.equal(readFileSync(join(root, 'a.md'), 'utf8'), '# A\n\n## 하는 일\n\n본문.\n한 줄 더.\n')
  rmSync(root, { recursive: true })
})

test('retargetLink also changes link text when text is given after the server matches the old title', () => {
  const root = fresh()
  writeFileSync(join(root, 'a.md'), '# A\n\n[조사](조사.md)에 {{*대상파일}}을 넘긴다.\n')
  const r = retargetLink(root, 'a.md', linkRange(root, 'a.md', '조사.md'), '계획.md', { backupDir: null, text: '계획' })
  assert.equal(r.after.toString(), '[계획](계획.md)')
  assert.equal(readFileSync(join(root, 'a.md'), 'utf8'), '# A\n\n[계획](계획.md)에 {{*대상파일}}을 넘긴다.\n')
  rmSync(root, { recursive: true })
})

test('replaceBodies changes bodies from the end to preserve offsets and rolls all changes back if one is rejected', () => {
  const root = fresh()
  writeFileSync(join(root, 'a.md'), '# A\n\n## 하나\n\n첫 본문.\n\n## 둘\n\n둘째 본문.\n\n## 셋\n\n셋째.\n')
  const d = parseDoc('a.md', readFileSync(join(root, 'a.md'), 'utf8'))
  const [h1, h2, h3] = d.headings.slice(1)
  replaceBodies(root, 'a.md', [
    { range: h1.range, expect: h1.body, text: '첫 본문을 길게 늘였다.\n두 줄.' },
    { range: h3.range, expect: h3.body, text: '셋째 고침.' },
  ], { backupDir: null, expectHash: d.hash })
  assert.equal(readFileSync(join(root, 'a.md'), 'utf8'), '# A\n\n## 하나\n\n첫 본문을 길게 늘였다.\n두 줄.\n\n## 둘\n\n둘째 본문.\n\n## 셋\n\n셋째 고침.\n')
  // The wrong expect rejects the second item. The first change, written in the third range, is also rolled back when a backup exists.
  const d2 = parseDoc('a.md', readFileSync(join(root, 'a.md'), 'utf8'))
  const [g1, g2] = d2.headings.slice(1)
  const before = readFileSync(join(root, 'a.md'), 'utf8')
  assert.throws(() => replaceBodies(root, 'a.md', [
    { range: g1.range, expect: '틀린 기대값', text: 'x' },
    { range: g2.range, expect: g2.body, text: 'y' },
  ], { expectHash: d2.hash }), (e: unknown) => (e as WriteError).code === 'STALE')
  assert.equal(readFileSync(join(root, 'a.md'), 'utf8'), before, 'All changes are rolled back')
  rmSync(root, { recursive: true })
})
