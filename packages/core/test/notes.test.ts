import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectNotes, addDiagnostics, compareVersions, UPDATES_DIR, parseConfig, buildGraph, loadDir, existsIn, globIn } from '../src/index.ts'

const fresh = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), 'sil-notes-'))
  for (const [f, body] of Object.entries(files)) { mkdirSync(join(d, f, '..'), { recursive: true }); writeFileSync(join(d, f), body) }
  return d
}
const codes = (d: string, installed: string) => projectNotes(d, installed).map((x) => x.code)

test('compareVersions: numeric per part, missing parts are 0', () => {
  assert.ok(compareVersions('0.3.1', '0.10.0') < 0, 'not a string compare')
  assert.equal(compareVersions('1.0', '1.0.0'), 0)
  assert.ok(compareVersions('0.6.0', '0.5.9') > 0)
})

test('L-I06: SILMARI.md older than the installed silmari, or written before 0.3.1 (no version recorded)', () => {
  const none = fresh({ 'SILMARI.md': '# a\n' })
  const [d] = projectNotes(none, '0.6.0')
  assert.equal(d.code, 'L-I06'); assert.equal(d.severity, 'info'); assert.equal(d.where, '.sil/config.yaml')
  assert.match(d.message, /written by silmari before 0\.3\.1; installed is 0\.6\.0\. Run sil update/)
  const old = fresh({ 'SILMARI.md': '# a\n', '.sil/config.yaml': 'version: 0.5.0\n' })
  assert.match(projectNotes(old, '0.6.0')[0].message, /written by silmari 0\.5\.0; installed is 0\.6\.0/)
  assert.deepEqual(codes(fresh({ 'SILMARI.md': '# a\n', '.sil/config.yaml': 'version: 0.6.0\n' }), '0.6.0'), [], 'same version: nothing')
  assert.deepEqual(codes(fresh({ 'SILMARI.md': '# a\n', '.sil/config.yaml': 'version: 0.7.0\n' }), '0.6.0'), [], 'project newer than the tool: nothing')
  assert.deepEqual(codes(fresh({ 'CLAUDE.md': '# a\n' }), '0.6.0'), [], 'no SILMARI.md: nothing to update')
  assert.deepEqual(projectNotes(old, '0.6.0', parseConfig('version: 0.6.0\n')).map((x) => x.code), [], 'a config passed in wins over the file')
  for (const d of [none, old]) rmSync(d, { recursive: true })
})

test('L-I07: md notes waiting in .sil/updates/, sorted; other files do not count', () => {
  const d = fresh({ 'SILMARI.md': '# a\n', '.sil/config.yaml': 'version: 0.6.0\n', [`${UPDATES_DIR}/0.5.0.md`]: 'x', [`${UPDATES_DIR}/0.4.0.md`]: 'x', [`${UPDATES_DIR}/.DS_Store`]: '' })
  const [n] = projectNotes(d, '0.6.0')
  assert.equal(n.code, 'L-I07'); assert.equal(n.where, UPDATES_DIR)
  assert.match(n.message, /^2 update notes not applied yet: 0\.4\.0\.md, 0\.5\.0\.md\./)
  rmSync(join(d, UPDATES_DIR, '0.5.0.md'))
  assert.match(projectNotes(d, '0.6.0')[0].message, /^1 update note not applied yet: 0\.4\.0\.md\./)
  rmSync(d, { recursive: true })
})

test('addDiagnostics keeps the counts in step', () => {
  const d = fresh({ 'SILMARI.md': '# a\n' })
  const g = buildGraph(loadDir(d, []), { exists: existsIn(d), glob: globIn(d), entry: [] })
  const before = g.stats.diagnostics
  const out = addDiagnostics(g, projectNotes(d, '0.6.0'))
  assert.equal(out, g)
  assert.equal(g.stats.diagnostics, before + 1)
  assert.equal(g.stats.diagnosticsBySeverity.info, (g.diagnostics.filter((x) => x.severity === 'info')).length)
  assert.equal(g.diagnostics.at(-1)?.code, 'L-I06')
  rmSync(d, { recursive: true })
})
