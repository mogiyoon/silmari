// SHA-1 in plain JavaScript. The hex it returns is the hex Node's createHash('sha1') returns for the same bytes.
//
// Why not node:crypto: this file has to run in a browser. Why not WebCrypto: crypto.subtle.digest is asynchronous, and
// parseDoc is synchronous everywhere (the VS Code extension parses on every keystroke). Why not a hash passed in by the
// caller: the value goes into Node.hash, the viewer sends it back with an edit request, and writeRange refuses the write
// when it differs from the file on disk (T-10). One runtime hashing differently from another would turn that check off
// without a word. parse.ts and writer.ts both call this, so there is only one implementation to keep honest.

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n))

export function sha1Hex(bytes: Uint8Array): string {
  const len = bytes.length
  // message · 0x80 · zeros · the length in bits as 8 big-endian bytes, rounded up to whole 64-byte blocks
  const m = new Uint8Array((((len + 8) >> 6) + 1) * 64)
  m.set(bytes)
  m[len] = 0x80
  const dv = new DataView(m.buffer)
  const bits = len * 8
  dv.setUint32(m.length - 8, Math.floor(bits / 0x100000000))
  dv.setUint32(m.length - 4, bits >>> 0)

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0
  const w = new Int32Array(80)
  for (let b = 0; b < m.length; b += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getInt32(b + i * 4)
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    let a = h0, bb = h1, c = h2, d = h3, e = h4
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (bb & c) | (~bb & d) : i < 40 ? bb ^ c ^ d : i < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6
      const t = (rotl(a, 5) + f + e + k + w[i]) | 0
      e = d; d = c; c = rotl(bb, 30); bb = a; a = t
    }
    h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0
  }
  const hex = (x: number) => (x >>> 0).toString(16).padStart(8, '0')
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4)
}
