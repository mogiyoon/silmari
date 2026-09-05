import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { splitWhere, graphWithOverride, byFile } from '../src/diagnose.ts'

const AFTER = resolve(import.meta.dirname, '../../core/test/fixtures/after')

test('split where', () => {
  assert.deepEqual(splitWhere('a/b.md:12'), { rel: 'a/b.md', line: 12 })
  assert.deepEqual(splitWhere('b.md'), { rel: 'b.md', line: null })
})

test('replacing with an unsaved body updates its diagnostics at once (S12)', () => {
  const before = byFile(graphWithOverride(AFTER, ['node_modules']))
  assert.ok(before.get('검토.md')?.some((d) => d.code === 'L-N01'))
  // Body with the 검토기준.md link removed from 검토.md
  const fixed = graphWithOverride(AFTER, ['node_modules'], { rel: '검토.md', text: '# 검토\n\n설명.\n\n## 하는 일\n\n[코딩규칙](코딩규칙.md)을 본다.\n' })
  assert.ok(!byFile(fixed).get('검토.md')?.some((d) => d.code === 'L-N01'))
})

test('toLineCol: Korean byte offset → line and column', async () => {
  const { toLineCol, yieldToVscode } = await import('../src/diagnose.ts')
  const text = '# 가\n\n한글 앞말 [없음](없음.md)\n'
  const byte = Buffer.from(text, 'utf8').indexOf(Buffer.from('[없음]'))
  assert.deepEqual(toLineCol(text, byte), { line: 2, col: 6 })
  const ds = [{ code: 'L-N01', severity: 'error' as const, line: 1, message: '' }, { code: 'L-N09', severity: 'error' as const, line: 1, message: '' }, { code: 'L-N13', severity: 'error' as const, line: 1, message: '' }]
  assert.deepEqual(yieldToVscode(ds, { fileLinks: true, fragmentLinks: false }).map((d) => d.code), ['L-N09', 'L-N13'])
})
