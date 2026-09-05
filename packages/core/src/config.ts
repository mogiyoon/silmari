// Reads only simple YAML from .sil/config.yaml. It works without the file. Every key is optional (§2.4).
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface Config {
  strict: boolean
  scan: { exclude: string[] }
  /** Entry points are graph roots. If none are configured, the layout infers them as nodes with no incoming edges. */
  entry: string[]
  /** Words recognized by the parser. A key in words replaces that key's entire default list. */
  words: Words
  /** The user's language tag (en, ko, ja …). Agents write documents and answers in it. */
  lang: string
}

/** Contract headings for inputs and outputs, and task headings recognized by the parser. English by default. A project adds the words of its language in the config (sil init tells the agent to). Matching is case-insensitive.
 *  Subagent labels are not listed here. They are bracket markers at the end of headings, not words. The graph reads only the marker. Its text can be in any language (§1.5). */
export interface Words { inputs: string[]; outputs: string[]; task: string[] }
export const DEFAULT_WORDS: Words = {
  inputs: ['inputs', 'input'],
  outputs: ['outputs', 'output'],
  task: ['steps', 'procedure'],
}
const WORD_KEYS = ['inputs', 'outputs', 'task'] as const

export const CONFIG_PATH = '.sil/config.yaml'

export function parseConfig(text: string): Config {
  const cfg: Config = { strict: false, scan: { exclude: [] }, entry: [], words: { ...DEFAULT_WORDS }, lang: 'en' }
  let section = ''
  for (const raw of text.split('\n')) {
    const ln = raw.replace(/#.*$/, '').trimEnd()
    if (!ln.trim()) continue
    const top = /^(\w+):\s*(.*)$/.exec(ln)
    if (top) {
      section = top[1]
      const v = top[2].trim()
      if (section === 'strict') cfg.strict = v === 'true'
      if (section === 'lang' && v) cfg.lang = unq(v)
      if (section === 'entry' && v) cfg.entry = list(v)
      continue
    }
    const sub = /^\s+(\w+):\s*(.*)$/.exec(ln)
    if (sub && section === 'scan' && sub[1] === 'exclude') cfg.scan.exclude = list(sub[2])
    if (sub && section === 'words' && (WORD_KEYS as readonly string[]).includes(sub[1])) cfg.words[sub[1] as keyof Words] = list(sub[2])
    if (sub && section === 'contract' && (sub[1] === 'inputs' || sub[1] === 'outputs')) cfg.words[sub[1]] = list(sub[2]) // Legacy key
    const item = /^\s*-\s*(.+)$/.exec(ln)
    if (item && section === 'entry') cfg.entry.push(unq(item[1]))
  }
  return cfg
}
const unq = (s: string) => s.trim().replace(/^["']|["']$/g, '')
const list = (v: string) => (v.startsWith('[') ? v.slice(1, -1).split(',').map(unq).filter(Boolean) : [unq(v)])

export function readConfig(root: string): Config {
  const p = resolve(root, CONFIG_PATH)
  return existsSync(p) ? parseConfig(readFileSync(p, 'utf8')) : parseConfig('')
}

/**
 * The entry point is SILMARI.md. It uses a distinct uppercase name at the root, like README.md and CLAUDE.md. No tool injects it automatically.
 * It is safe to create when missing. Without it, use each tool's convention. The parser does not favor any tool:
 *  Claude Code: CLAUDE.md · .claude/commands/*.md      Codex CLI: AGENTS.md (·.codex/prompts)
 *  Gemini CLI: GEMINI.md                                GitHub Copilot: .github/copilot-instructions.md · .github/prompts/*.prompt.md
 * sil init searches in this order and writes the result to entry in the config. The orphan check (L-G01) also excludes these paths.
 */
export const ENTRY_MAIN = 'SILMARI.md'
export const ENTRY_FILES = [ENTRY_MAIN, 'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md']
export const ENTRY_DIRS = ['.claude/commands/', '.codex/prompts/', '.github/prompts/']
export const isConventionalEntry = (rel: string) => ENTRY_FILES.includes(rel) || ENTRY_DIRS.some((d) => rel.startsWith(d))
