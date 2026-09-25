// Reads only simple YAML from .sil/config.yaml. It works without the file. Every key is optional (§2.4).
// Reading the file is node/config.ts; this half only turns text into a Config, so it runs in a browser too.

export interface Config {
  strict: boolean
  scan: { exclude: string[] }
  /** Entry points are graph roots. If none are configured, the layout infers them as nodes with no incoming edges. */
  entry: string[]
  /** The user's language tag (en, ko, ja …). Agents write documents and answers in it. The parser never depends on it: every marker is a symbol. */
  lang: string
  /** The silmari version that wrote SILMARI.md and this file. `sil update` refreshes both and records the new one. Null when never recorded (before 0.3.1). */
  version: string | null
  /** sil run. keepSession: let the runtime save each step as a session (claude: no --no-session-persistence). --keep-session /
   *  --no-keep-session on the command line win over it */
  run: { keepSession: boolean }
}

export const CONFIG_PATH = '.sil/config.yaml'

export function parseConfig(text: string): Config {
  const cfg: Config = { strict: false, scan: { exclude: [] }, entry: [], lang: 'en', version: null, run: { keepSession: false } }
  let section = ''
  for (const raw of text.split('\n')) {
    // \r first: `.` stops at it, so in a CRLF file `#.*$` never matched and the comment became part of the value
    const ln = raw.replace(/\r$/, '').replace(/#.*$/, '').trimEnd()
    if (!ln.trim()) continue
    const top = /^(\w+):\s*(.*)$/.exec(ln)
    if (top) {
      section = top[1]
      const v = top[2].trim()
      if (section === 'strict') cfg.strict = v === 'true'
      if (section === 'lang' && v) cfg.lang = unq(v)
      if (section === 'version' && v) cfg.version = unq(v)
      if (section === 'entry' && v) cfg.entry = list(v)
      continue
    }
    const sub = /^\s+(\w+):\s*(.*)$/.exec(ln)
    if (sub && section === 'scan' && sub[1] === 'exclude') cfg.scan.exclude = list(sub[2])
    if (sub && section === 'run' && sub[1] === 'keep_session') cfg.run.keepSession = sub[2].trim() === 'true'
    // `words:` and `contract:` from 0.1.x are ignored: contract headings are now the symbols `## {{>…}}` / `## {{<…}}` in any language
    const item = /^\s*-\s*(.+)$/.exec(ln)
    if (item && section === 'entry') cfg.entry.push(unq(item[1]))
  }
  return cfg
}
const unq = (s: string) => s.trim().replace(/^["']|["']$/g, '')
const list = (v: string) => (v.startsWith('[') ? v.slice(1, -1).split(',').map(unq).filter(Boolean) : [unq(v)])

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
