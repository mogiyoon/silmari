import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDoc } from '../src/parse.ts'

test('escaped URLs and character references do not erase link or marker source positions', () => {
  for (const literal of ['www\\.example.com', 'www&#46;example.com', 'https&#58;//example.com', 'user&#64;example.com']) {
    for (const block of [
      `${literal} [작업](worker.md) {{>입력}} {{<결과}}`,
      `- ${literal} [작업](worker.md) {{>입력}} {{<결과}}`,
      `> ${literal} [작업](worker.md) {{>입력}} {{<결과}}`,
      `| 자료 | 호출 |\n| --- | --- |\n| ${literal} | [작업](worker.md) {{>입력}} {{<결과}} |`,
    ]) {
      const src = '\ufeff---\r\nsil:\r\n  type: task\r\n---\r\n# 흐름\r\n\r\n' + block.replace(/\n/g, '\r\n')
      const doc = parseDoc('flow.md', src)
      assert.equal(doc.links.length, 1, literal)
      const [link] = doc.links
      assert.equal(link.target, 'worker.md')
      assert.deepEqual(link.sends, ['입력'])
      assert.deepEqual(link.returns, ['결과'])
      assert.equal(Buffer.from(src).subarray(link.range.start, link.range.end).toString(), '[작업](worker.md)')
      assert.deepEqual(doc.diags, [])
    }
  }
})

test('ordinary GFM autolinks and explicit links retain their exact source ranges', () => {
  const literals = ['https://example.com', 'www.example.com', 'user@example.com', '<https://example.com>', '[사이트](https://example.com)']
  const src = '# 자료\n\n앞 ' + literals.join(' 뒤\n\n앞 ')
  const doc = parseDoc('links.md', src)
  assert.deepEqual(doc.links.map((link) => Buffer.from(src).subarray(link.range.start, link.range.end).toString()), literals)
  assert.deepEqual(doc.links.map((link) => link.target), ['https://example.com', 'http://www.example.com', 'mailto:user@example.com', 'https://example.com', 'https://example.com'])
})

test('markers in text containing an escaped autolink remain attached to their call', () => {
  const doc = parseDoc('flow.md', '# 흐름\n\n[작업](worker.md) www\\.example.com {{>입력}} {{!검사 명령}}')
  assert.deepEqual(doc.links[0].sends, ['입력'])
  assert.deepEqual(doc.links[0].approvals, ['검사 명령'])
  assert.deepEqual(doc.diags, [])
})
