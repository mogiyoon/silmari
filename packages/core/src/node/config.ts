// The file-system half of config.ts.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseConfig, CONFIG_PATH, type Config } from '../config.ts'

export function readConfig(root: string): Config {
  const p = resolve(root, CONFIG_PATH)
  return existsSync(p) ? parseConfig(readFileSync(p, 'utf8')) : parseConfig('')
}
