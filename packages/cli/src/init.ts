// sil init. Creates .sil/config.yaml and SILMARI.md (entry point and notation summary). Makes agent start files refer to SILMARI.md. Design §2.4 · §7.7.
// Agent start files (CLAUDE.md · AGENTS.md · GEMINI.md · copilot-instructions.md): create missing files without favoring a tool. Append to existing files.
//  ① One line that says to follow SILMARI.md and read it before working. The same line for every tool; no tool-specific import syntax
//  ② If md files already exist, add one line asking whether to start the silmari migration when work begins.
// Models do not know our notation. The rules must be where models read them. SILMARI.md alone scored 0/3; a plain 'read SILMARI.md before working' line in CLAUDE.md scored 4/4 (experiment 5).
import { resolve, dirname } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { ENTRY_MAIN, CONFIG_PATH, loadDir } from '@silmari/core'
/** .sil/config.yaml. The parser drops everything after #. */
const template = (entry: string[], lang: string) => `# silmari settings. Everything works without this file. Every key is optional.
entry: [${entry.join(', ')}]   # entry point: the root of the graph. Documents called from here form the flow
lang: ${lang}              # the user's language. Agents write documents and answers in it
scan:
  exclude: [".sil/backups/**"]   # .gitignore is always respected
words:                 # heading words the parser recognizes. Add the words of your language here (a key you set replaces the default list)
  inputs:   [inputs, input]
  outputs:  [outputs, output]
  task:     [steps, procedure]
strict: false          # true: exit code 1 when there is an error
`

/** The user's language as a short tag (en, ko, ja …). From --lang, else the environment (LC_ALL, LANG), else en. */
export const pickLang = (flag?: string): string => {
  const raw = flag || process.env.LC_ALL || process.env.LANG || 'en'
  const m = /^([a-z]{2,3})/i.exec(raw.trim())
  return m ? m[1].toLowerCase() : 'en'
}

/** Generated text is English only. When the user's language is not English, a line tells the agent to write in that language. */
const skeleton = (name: string) => `# ${name.replace(/\.md$/, '')}

This document is the entry point. The graph starts here, and the documents called from here become the flow. Other md files can stay as they are.

## Notation

- Calling another document is a markdown link \`[name](file.md)\`. Put values after the link as \`{{>send}}\` \`{{<receive}}\`.
- A condition is a heading. Calls under \`## If the review is major\` happen under that condition. A heading that calls an earlier document again must state when it ends.
- To run a call as a subagent (isolated), put a bracket label at the end of the calling heading: \`## 1. Research [use a subagent]\`. The brackets are the marker; the words inside are free. Use a verb phrase in English.
- In the called document, the lists under \`## Inputs\` / \`## Steps\` / \`## Outputs\` are the contract. Write these three headings in your language, and add the words you use under \`words\` in \`.sil/config.yaml\`.

## Flow

Link the flow documents here. Example: \`[Feature work](flow.md)\`
`
// One plain sentence for every tool. Import syntax such as @SILMARI.md is Claude-specific; the plain line made Claude read the file 4/4 (experiment 5)
const CALL = `${ENTRY_MAIN} is the entry point of everything in this project. The notation and flow of every md document follow ${ENTRY_MAIN}. Read ${ENTRY_MAIN} first, before any work.`
const LANG_LINE = (lang: string) => `The user's language is "${lang}". Write documents and answers in that language. Keep the notation from ${ENTRY_MAIN} as it is.`
const MIGRATE = `When starting work, if this project's md files do not yet follow the ${ENTRY_MAIN} notation, first ask: "Start the silmari migration?" If yes, migrate the md files to the ${ENTRY_MAIN} notation.`
const AGENT_HEAD = (f: string) => `# ${f.replace(/^.*\//, '').replace(/\.md$/, '')}`

/** Agent start files. Tools read them automatically each session. */
const AGENT_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md']

/** Add a SILMARI.md call to four agent start files. If md files exist, also add the migration question. Create missing files. Do not change files that already mention SILMARI.md. */
function linkAgentFiles(root: string, lang: string) {
  const skip = new Set([ENTRY_MAIN, ...AGENT_FILES])
  const hasDocs = [...loadDir(root).keys()].some((rel) => !skip.has(rel))
  const lines = [CALL, ...(lang !== 'en' ? [LANG_LINE(lang)] : []), ...(hasDocs ? [MIGRATE] : [])]
  const what = `${ENTRY_MAIN} call${lang !== 'en' ? ` · language ${lang}` : ''}${hasDocs ? ' · migration prompt' : ''}`
  for (const f of AGENT_FILES) {
    const p = resolve(root, f)
    if (!existsSync(p)) {
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, `${AGENT_HEAD(f)}\n\n${lines.join('\n')}\n`)
      process.stdout.write(`Created: ${f} (agent start file — ${what})\n`)
      continue
    }
    if (readFileSync(p, 'utf8').includes(ENTRY_MAIN)) { process.stdout.write(`Unchanged: ${f} (already mentions ${ENTRY_MAIN})\n`); continue }
    appendFileSync(p, `\n${lines.join('\n')}\n`)
    process.stdout.write(`Appended: ${f} (${what})\n`)
  }
}

export function init(dir: string, opt: { entry?: string; lang?: string } = {}): number {
  const lang = pickLang(opt.lang)
  const root = resolve(dir)
  const p = resolve(root, CONFIG_PATH)
  if (existsSync(p)) { process.stdout.write(`Already exists: ${p}\n`); return 0 }
  let entry: string[] = []
  if (opt.entry) {
    const f = resolve(root, opt.entry)
    if (!existsSync(f)) { writeFileSync(f, skeleton(opt.entry)); process.stdout.write(`Created: ${f} (entry skeleton)\n`) }
    entry = [opt.entry]
  } else {
    // SILMARI.md is the entry point. If missing, create a skeleton with a notation summary. Agent start files load it.
    const f = resolve(root, ENTRY_MAIN)
    if (!existsSync(f)) { writeFileSync(f, skeleton(ENTRY_MAIN)); process.stdout.write(`Created: ${f} (entry skeleton with a notation summary)\n`) }
    entry = [ENTRY_MAIN]
    linkAgentFiles(root, lang)
  }
  mkdirSync(resolve(root, '.sil'), { recursive: true })
  writeFileSync(p, template(entry, lang))
  process.stdout.write(`Created: ${p}\n`)
  process.stdout.write(`Entry: ${entry.join(', ')}\n`)
  return 0
}
