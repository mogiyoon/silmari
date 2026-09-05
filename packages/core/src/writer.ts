// Writer is the only module that writes to source Markdown files (INV-6). Design document §6.
// It works only with byte sequences (INV-3). It does not change any byte outside the given range (INV-1 · L-W01).
// The order is pre-check, backup, atomic write, and post-check. It restores the file on failure (INV-5).
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import type { Range } from './ir.ts'

export type WriteErrorCode = 'OUTSIDE_ROOT' | 'SYMLINK' | 'NOT_FOUND' | 'STALE' | 'VERIFY' | 'RANGE'
export class WriteError extends Error {
  code: WriteErrorCode
  constructor(code: WriteErrorCode, message: string) { super(message); this.code = code }
}

export interface WriteResult { rel: string; range: Range; before: Buffer; after: Buffer; backup: string | null }

/**
 * Replaces bytes [range.start, range.end) in rel with replacement.
 * If expect is given, it must match the current bytes at that location. If the file changed after the graph was built, the result is STALE (T-10).
 */
export function writeRange(root: string, rel: string, range: Range, replacement: Buffer, opt: { expect?: Buffer; expectHash?: string; backupDir?: string | null } = {}): WriteResult {
  root = resolve(root)
  const p = resolve(root, rel)
  if (!p.startsWith(root + sep)) throw new WriteError('OUTSIDE_ROOT', `Path outside the root: ${rel}`)           // T-8
  if (!existsSync(p)) throw new WriteError('NOT_FOUND', `File not found: ${rel}`)
  if (lstatSync(p).isSymbolicLink()) throw new WriteError('SYMLINK', `Refusing to write through a symlink: ${rel}`) // L-W06
  const src = readFileSync(p)                                                                                // Do not decode (INV-3).
  if (range.start < 0 || range.end > src.length || range.start > range.end) throw new WriteError('RANGE', `Range out of bounds: ${range.start}-${range.end} / ${src.length}`)
  // Reject changes made after graph creation by checking the whole-file hash (T-10). A range-only expect check misses text appended later.
  if (opt.expectHash && createHash('sha1').update(src).digest('hex') !== opt.expectHash) throw new WriteError('STALE', `The file changed after the graph was built: ${rel}. Refresh and retry`)
  const before = src.subarray(range.start, range.end)
  if (opt.expect && !before.equals(opt.expect)) throw new WriteError('STALE', `The bytes at that position differ from when the graph was built: ${rel}:${range.start}. Refresh and retry`)

  const out = Buffer.concat([src.subarray(0, range.start), replacement, src.subarray(range.end)])

  // Back up the unchanged source before writing (INV-5). Do not create a backup when this is null, for tests.
  let backup: string | null = null
  const backupDir = opt.backupDir === undefined ? join(root, '.sil', 'backups') : opt.backupDir
  if (backupDir) {
    const stem = rel.replace(/[\\/]/g, '__')
    backup = join(backupDir, `${stem}.${Date.now()}.bak`)
    mkdirSync(dirname(backup), { recursive: true })
    copyFileSync(p, backup)
    // Keep only the newest backup per file. Older ones are deleted so the folder does not grow with every edit
    for (const f of readdirSync(backupDir)) if (f.startsWith(stem + '.') && f.endsWith('.bak') && join(backupDir, f) !== backup) rmSync(join(backupDir, f), { force: true })
  }

  // Create a temporary file in the same directory, then rename it (T-7).
  const tmp = join(dirname(p), `.${rel.split(/[\\/]/).pop()}.sil-tmp-${process.pid}`)
  try {
    writeFileSync(tmp, out)
    renameSync(tmp, p)
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch { /* */ }
    throw e
  }

  // Post-check (L-W01): bytes outside the range must be unchanged. Bytes inside it must equal replacement. Restore and stop on failure.
  const now = readFileSync(p)
  const ok = now.subarray(0, range.start).equals(src.subarray(0, range.start))
    && now.subarray(range.start, range.start + replacement.length).equals(replacement)
    && now.subarray(range.start + replacement.length).equals(src.subarray(range.end))
  if (!ok) {
    if (backup) copyFileSync(backup, p)
    throw new WriteError('VERIFY', `Post-write verification failed — restored from the backup: ${rel}`)
  }
  return { rel, range, before, after: replacement, backup }
}

/** Reads the text and path in an inline link range: `[글자](경로)`. */
export function readLink(root: string, rel: string, range: Range): { text: string; url: string } | null {
  const m = INLINE_LINK.exec(readRange(root, rel, range).toString('utf8'))
  return m ? { text: m[1].replace(/^!?\[/, '').replace(/\]\($/, ''), url: m[2] } : null
}

/** Current content in a file-based byte range. The viewer uses it as expect before editing. */
export function readRange(root: string, rel: string, range: Range): Buffer {
  return readFileSync(resolve(root, rel)).subarray(range.start, range.end)
}

const INLINE_LINK = /^(!?\[[^\]]*\]\()([^)]*)(\)\s*)$/s

/**
 * Changes only the target of one link: `[텍스트](옛경로)` → `[텍스트](새경로)`. Leaves the text unchanged.
 * Reference-style links (`[x][ref]`) are not supported yet because their definitions are elsewhere.
 */
export function retargetLink(root: string, rel: string, range: Range, newUrl: string, opt: { backupDir?: string | null; expectHash?: string; text?: string } = {}): WriteResult {
  const cur = readRange(root, rel, range)
  const m = INLINE_LINK.exec(cur.toString('utf8'))
  if (!m) throw new WriteError('STALE', `Not an inline link at that position: ${JSON.stringify(cur.toString('utf8').slice(0, 40))}`)
  if (/[()\s]/.test(newUrl)) throw new WriteError('RANGE', `A link path cannot contain parentheses or whitespace: ${newUrl}`)
  // If text is given, also change the link text. The server passes the new title when the text matched the old target title. The range stays within the link (INV-1).
  const open = opt.text !== undefined ? m[1].replace(/^(!?\[)[^\]]*(\]\()$/, `$1${opt.text.replace(/[\]\\]/g, '')}$2`) : m[1]
  const replacement = Buffer.from(open + newUrl + m[3], 'utf8')
  return writeRange(root, rel, range, replacement, { expect: cur, expectHash: opt.expectHash, backupDir: opt.backupDir })
}

/**
 * Replaces a whole heading body. Inserts the given text unchanged in that range. expect is the current body seen by the viewer. A mismatch is STALE.
 * When inserting at an empty body with length 0, adds one blank line before and after it.
 */
export function replaceBody(root: string, rel: string, range: Range, expect: string, text: string, opt: { backupDir?: string | null; expectHash?: string } = {}): WriteResult {
  const empty = range.start === range.end
  const replacement = Buffer.from(empty && text ? `\n${text}\n` : text, 'utf8')
  return writeRange(root, rel, range, replacement, { expect: Buffer.from(expect, 'utf8'), expectHash: opt.expectHash, backupDir: opt.backupDir })
}

/**
 * Replaces several heading bodies in one file at once. Works from the end to preserve earlier offsets. Checks the hash only on the first write because later changes are ours.
 * If any replacement is rejected, rolls back earlier writes when a backup exists.
 */
export function replaceBodies(root: string, rel: string, edits: { range: Range; expect: string; text: string }[], opt: { backupDir?: string | null; expectHash?: string } = {}): WriteResult[] {
  const sorted = [...edits].sort((a, b) => b.range.start - a.range.start)
  const done: WriteResult[] = []
  try {
    for (const [i, ed] of sorted.entries()) done.push(replaceBody(root, rel, ed.range, ed.expect, ed.text, { backupDir: opt.backupDir, expectHash: i === 0 ? opt.expectHash : undefined }))
  } catch (e) {
    const first = done[0]
    if (first?.backup) copyFileSync(first.backup, resolve(root, rel))
    throw e
  }
  return done
}
