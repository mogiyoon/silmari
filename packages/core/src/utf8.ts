// UTF-8 byte lengths without Buffer, so parse.ts runs in a browser. Byte ranges are the contract between the graph and
// Writer (INV-8), so these have to agree with Buffer.byteLength to the byte, lone surrogates included (3 bytes, the
// replacement character, same as Node).

const encoder = new TextEncoder()

/** The UTF-8 bytes of a string. Used where the whole text is needed as bytes, such as hashing a document. */
export const utf8Encode = (s: string): Uint8Array => encoder.encode(s)

/** The number of UTF-8 bytes in s, or in its first `end` UTF-16 units. Counts without allocating: on a 40k-file corpus this
 *  runs once per line of every file. */
export function utf8Length(s: string, end: number = s.length): number {
  if (end > s.length) end = s.length
  let n = 0
  for (let i = 0; i < end; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < end && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++ }
    else n += 3
  }
  return n
}
