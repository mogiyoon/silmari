// loadDirAsync parses in worker threads above MIN_PARALLEL pending files. It must return exactly what loadDir returns, in the same order,
// and keep the cache in the same state.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadDir, loadDirAsync, docCache, MIN_PARALLEL } from '../src/index.ts'

const corpus = (n: number) => {
  const d = mkdtempSync(join(tmpdir(), 'sil-load-'))
  mkdirSync(join(d, 'sub'))
  for (let i = 0; i < n; i++) {
    const rel = i % 3 ? `f${i}.md` : `sub/f${i}.md`
    writeFileSync(join(d, rel), `# F${i}\n\nCalls [next](f${i + 1}.md) with {{>x${i}}} and gets {{<y}}.\n\n## Inputs\n- x${i}\n\n## Outputs\n- y\n`)
  }
  writeFileSync(join(d, 'skip.txt'), 'not md')
  return d
}

test('loadDirAsync (workers) returns the same docs, order and cache state as loadDir', async () => {
  const d = corpus(MIN_PARALLEL + 100)
  try {
    const sync = loadDir(d)
    const c = docCache()
    const par = await loadDirAsync(d, [], c, { threads: 3 })
    assert.deepEqual([...par.keys()], [...sync.keys()], 'same files in walk order')
    assert.deepEqual(par, sync, 'identical Doc objects (Sets included)')
    assert.equal(c.entries.size, sync.size); assert.equal(c.changed, true)
    // A second load with nothing changed comes from the cache: no parse, changed = false
    const again = await loadDirAsync(d, [], c, { threads: 3 })
    assert.equal(c.changed, false); assert.equal(again.get('f1.md'), par.get('f1.md'), 'cached object reused')
    // One edited file: only that one is re-parsed (below MIN_PARALLEL, inline), and the cache notices
    writeFileSync(join(d, 'f1.md'), '# Changed\n')
    const third = await loadDirAsync(d, [], c)
    assert.equal(c.changed, true); assert.equal(third.get('f1.md')!.title, 'Changed'); assert.equal(third.get('f2.md'), par.get('f2.md'))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('loadDirAsync below MIN_PARALLEL parses inline and matches loadDir', async () => {
  const d = corpus(20)
  try { assert.deepEqual(await loadDirAsync(d), loadDir(d)) } finally { rmSync(d, { recursive: true, force: true }) }
})
