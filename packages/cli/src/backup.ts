// sil backup. Copies every md file the scan sees (the same set sil lint reads: .gitignore and scan.exclude respected) to
// .sil/backups/<time>-<kind>/, keeping paths. It runs on its own, and init · migrate · update run it before handing documents to an
// agent, so what the agent changes can always be put back by copying the folder over. Nothing is ever deleted here; the user prunes.
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { loadDir, readConfig, findProjectRoot } from '@silmari/core'

export const BACKUPS_DIR = '.sil/backups'

/** Copies the project's md files into a new folder under .sil/backups/. Returns the folder, relative to the root, and the file count. */
export function backupDocs(root: string, kind: string): { dir: string; files: number } {
  const cfg = readConfig(root)
  const rels = [...loadDir(root, cfg.scan.exclude).keys()]
  const dir = `${BACKUPS_DIR}/${new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')}-${kind}`
  for (const rel of rels) { const to = join(root, dir, rel); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(root, rel), to) }
  return { dir, files: rels.length }
}

export function backup(dir: string): number {
  const root = findProjectRoot(resolve(dir))
  if (!root || !existsSync(root)) { process.stderr.write(`sil backup: no .sil/ found above ${resolve(dir)}. Run sil init first.\n`); return 1 }
  const r = backupDocs(root, 'manual')
  process.stdout.write(`Backup: ${r.dir} (${r.files} md files)\n`)
  return 0
}
