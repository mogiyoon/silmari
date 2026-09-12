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
  assert.ok(before.get('review.md')?.some((d) => d.code === 'L-N01'))
  // Body with the review-criteria.md link removed from review.md
  const fixed = graphWithOverride(AFTER, ['node_modules'], { rel: 'review.md', text: '# Review\n\nDescription.\n\n## Steps\n\nRead the [coding rules](coding-rules.md).\n' })
  assert.ok(!byFile(fixed).get('review.md')?.some((d) => d.code === 'L-N01'))
})

test('toLineCol: Korean byte offset → line and column', async () => {
  const { toLineCol, yieldToVscode } = await import('../src/diagnose.ts')
  const text = '# 가\n\n한글 앞말 [없음](없음.md)\n'
  const byte = Buffer.from(text, 'utf8').indexOf(Buffer.from('[없음]'))
  assert.deepEqual(toLineCol(text, byte), { line: 2, col: 6 })
  const ds = [{ code: 'L-N01', severity: 'error' as const, line: 1, message: '' }, { code: 'L-N09', severity: 'error' as const, line: 1, message: '' }, { code: 'L-N13', severity: 'error' as const, line: 1, message: '' }]
  assert.deepEqual(yieldToVscode(ds, { fileLinks: true, fragmentLinks: false }).map((d) => d.code), ['L-N09', 'L-N13'])
})

test('with an installed version, the project notes sil lint prints land on .sil/config.yaml and .sil/updates', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const d = mkdtempSync(join(tmpdir(), 'sil-vscode-'))
  mkdirSync(join(d, '.sil/updates'), { recursive: true })
  writeFileSync(join(d, 'SILMARI.md'), '# a\n'); writeFileSync(join(d, '.sil/config.yaml'), 'version: 0.5.0\n'); writeFileSync(join(d, '.sil/updates/0.6.0.md'), 'x')
  assert.ok(!byFile(graphWithOverride(d, ['node_modules'])).has('.sil/config.yaml'), 'without a version the extension does not judge')
  const by = byFile(graphWithOverride(d, ['node_modules'], undefined, '0.6.0'))
  assert.deepEqual(by.get('.sil/config.yaml')?.map((x) => [x.code, x.severity, x.line]), [['L-I06', 'info', 1]])
  assert.deepEqual(by.get('.sil/updates')?.map((x) => x.code), ['L-I07'])
  rmSync(d, { recursive: true })
})
