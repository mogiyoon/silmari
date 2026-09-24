// The hash goes into Node.hash, the viewer sends it back with an edit, and writeRange refuses the write when it differs
// from the file on disk (T-10). A document hashed in a browser and the same document hashed in the CLI must therefore give
// the same hex as Node's crypto, or that check would reject good writes and accept stale ones.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { sha1Hex } from '../src/sha1.ts'
import { utf8Encode } from '../src/utf8.ts'
import { parseDoc } from '../src/index.ts'

const node = (b: Uint8Array) => createHash('sha1').update(b).digest('hex')

test('sha1Hex matches node:crypto on text: empty, ASCII, Korean, emoji, combining marks, CRLF, BOM', () => {
  const texts = ['', 'a', 'abc', '# 제목\n\n본문입니다.\n', '🙂🇰🇷👩‍👩‍👦‍👦', 'é 가ㅣ', '# 가\r\n\r\n끝', '﻿# BOM\n',
    'The quick brown fox jumps over the lazy dog', '- 항목 (path) — 설명\n']
  for (const t of texts) {
    const b = utf8Encode(t)
    assert.equal(sha1Hex(b), node(b), JSON.stringify(t))
  }
})

test('sha1Hex matches node:crypto around every padding boundary (55/56/63/64/119/120 bytes) and past it', () => {
  for (let n = 0; n <= 200; n++) {
    const b = new Uint8Array(n)
    for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff
    assert.equal(sha1Hex(b), node(b), `length ${n}`)
  }
})

test('sha1Hex matches node:crypto on a large file (4 MB of bytes, and 1 MB of Korean text)', () => {
  const big = new Uint8Array(4 << 20)
  for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) & 0xff
  assert.equal(sha1Hex(big), node(big))
  const text = utf8Encode('가나다라마바사 ABC 🙂\n'.repeat(50_000))
  assert.ok(text.length > 1 << 20, 'over a megabyte of UTF-8')
  assert.equal(sha1Hex(text), node(text))
})

test('a lone surrogate hashes like Node: the replacement character, not a dropped code unit', () => {
  const b = utf8Encode('a\ud800b')
  assert.equal(sha1Hex(b), node(b))
  assert.deepEqual([...b], [...Buffer.from('a\ud800b', 'utf8')], 'TextEncoder and Buffer agree on the bytes')
})

test('Doc.hash is the SHA-1 of the file bytes, BOM included', () => {
  const src = '﻿# 가\r\n\r\n[나](나.md)에 {{>값}}\n'
  assert.equal(parseDoc('a.md', src).hash, createHash('sha1').update(Buffer.from(src, 'utf8')).digest('hex'))
})
