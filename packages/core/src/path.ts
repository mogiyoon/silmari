// The three posix path functions graph.ts needs, so link resolution runs in a browser. Ported from Node's path.posix and
// checked against it in test/path.test.ts: a link that resolved to one node under Node must resolve to the same node in
// the browser, or the two would draw different graphs from the same documents.

/** Drops '.' and empty segments and applies '..'. Leading '..' survive only in a relative path (allowAboveRoot). */
function collapse(p: string, allowAboveRoot: boolean): string {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (allowAboveRoot) out.push('..')
      continue
    }
    out.push(seg)
  }
  return out.join('/')
}

export function normalize(p: string): string {
  if (p.length === 0) return '.'
  const absolute = p.charCodeAt(0) === 47 /* / */
  const trailing = p.charCodeAt(p.length - 1) === 47
  const done = collapse(p, !absolute)
  if (done.length === 0) return absolute ? '/' : trailing ? './' : '.'
  return (absolute ? '/' : '') + done + (trailing ? '/' : '')
}

export function join(...parts: string[]): string {
  const joined = parts.filter((x) => x.length > 0).join('/')
  return joined.length === 0 ? '.' : normalize(joined)
}

export function dirname(p: string): string {
  if (p.length === 0) return '.'
  const root = p.charCodeAt(0) === 47
  let end = -1
  let matchedSlash = true
  for (let i = p.length - 1; i >= 1; i--) {
    if (p.charCodeAt(i) === 47) { if (!matchedSlash) { end = i; break } }
    else matchedSlash = false
  }
  if (end === -1) return root ? '/' : '.'
  if (root && end === 1) return '//'
  return p.slice(0, end)
}
