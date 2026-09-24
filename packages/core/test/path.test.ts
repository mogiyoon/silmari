// Link resolution runs both in Node and in a browser, so src/path.ts has to answer exactly like node:path.posix.
// A difference here would put the same link on two different nodes depending on where the graph was built.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { posix } from 'node:path'
import { normalize, join, dirname } from '../src/path.ts'

const PATHS = ['', '.', '..', '/', '//', '///', 'a', 'a.md', './a.md', '../a.md', '../../a.md', 'a/b.md', 'a/./b.md',
  'a/../b.md', 'a//b.md', 'a/b/../../c.md', 'a/b/../../../c.md', '/a/b.md', '/a/../../b.md', '/..', 'a/', 'a/b/', './',
  '../', 'a/..', 'docs/refs/{{>topic}}.md', '한글/문서.md', 'a/b/c/d/../../e.md', 'out/run.log', '.sil/config.yaml']

test('normalize matches path.posix.normalize', () => {
  for (const p of PATHS) assert.equal(normalize(p), posix.normalize(p), `normalize(${JSON.stringify(p)})`)
})

test('dirname matches path.posix.dirname', () => {
  for (const p of PATHS) assert.equal(dirname(p), posix.dirname(p), `dirname(${JSON.stringify(p)})`)
})

test('join matches path.posix.join, including the pairs resolve() actually builds', () => {
  for (const a of PATHS) for (const b of PATHS) assert.equal(join(a, b), posix.join(a, b), `join(${JSON.stringify(a)}, ${JSON.stringify(b)})`)
  assert.equal(join(), posix.join())
  assert.equal(join('a'), posix.join('a'))
  assert.equal(join('a', 'b', 'c'), posix.join('a', 'b', 'c'))
})

test('resolve() builds the same rel as the node:path version did', () => {
  const rel = (src: string, p: string) => (p.startsWith('/') ? normalize(p.slice(1)) : normalize(join(dirname(src), p)))
  const ref = (src: string, p: string) => (p.startsWith('/') ? posix.normalize(p.slice(1)) : posix.normalize(posix.join(posix.dirname(src), p)))
  for (const src of ['a.md', 'flows/a.md', 'flows/deep/a.md', '한글/흐름.md'])
    for (const p of PATHS) assert.equal(rel(src, p), ref(src, p), `${src} + ${p}`)
})
