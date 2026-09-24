// The file-system half of notes.ts: what .sil/ holds right now.
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Diagnostic } from '../ir.ts'
import { CONFIG_PATH, ENTRY_MAIN, type Config } from '../config.ts'
import { compareVersions, UPDATES_DIR } from '../notes.ts'
import { readConfig } from './config.ts'

/**
 * L-I06 when the project's SILMARI.md was written by an older silmari than `installed` (or by one before 0.3.1, which recorded nothing).
 * L-I07 while update notes wait in .sil/updates/. Both are info: they never change the exit code.
 */
export function projectNotes(root: string, installed: string, cfg: Config = readConfig(root)): Diagnostic[] {
  const out: Diagnostic[] = []
  if (existsSync(resolve(root, ENTRY_MAIN)) && (cfg.version === null || compareVersions(cfg.version, installed) < 0))
    out.push({ code: 'L-I06', severity: 'info', where: CONFIG_PATH, message: `${ENTRY_MAIN} was written by silmari ${cfg.version ?? 'before 0.3.1'}; installed is ${installed}. Run sil update` })
  const dir = resolve(root, UPDATES_DIR)
  const notes = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []
  if (notes.length) out.push({ code: 'L-I07', severity: 'info', where: UPDATES_DIR, message: `${notes.length} update note${notes.length > 1 ? 's' : ''} not applied yet: ${notes.join(', ')}. The agent applies them at the start of a session and deletes them` })
  return out
}
