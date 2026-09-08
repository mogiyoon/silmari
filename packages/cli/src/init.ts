// sil init. Creates .sil/config.yaml and SILMARI.md (entry point and notation summary). Makes agent start files refer to SILMARI.md. Design §2.4 · §7.7.
// Agent start files (CLAUDE.md · AGENTS.md · GEMINI.md · copilot-instructions.md): create missing files without favoring a tool. Append to existing files.
//  ① One line that says to follow SILMARI.md and read it before working. The same line for every tool; no tool-specific import syntax
//  ② If md files already exist, add one line asking whether to start the silmari migration when work begins. The line points at the
//     "Migration" section of SILMARI.md: the notation summary alone tells the model what the symbols are, not how to move an
//     orchestrator with inline agent sections, mermaid and pseudocode into them. Given only "migrate to the notation", the model added
//     three contract headings and one {{ }} to a 400-line orchestrator and stopped (2026-09-06). The section lists the rules that the
//     hand migration in notes/examples/mogiyoon/README.md settled on, and ends with "run sil lint until error 0".
// Models do not know our notation. The rules must be where models read them. SILMARI.md alone scored 0/3; a plain 'read SILMARI.md before working' line in CLAUDE.md scored 4/4 (experiment 5).
import { resolve, dirname } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { ENTRY_MAIN, CONFIG_PATH, loadDir, readConfig, findProjectRoot } from '@silmari/core'
import { silVersion, compareVersions } from './version.ts'
import { UPDATE_NOTES } from './updates.ts'
/** .sil/config.yaml. The parser drops everything after #. */
const template = (entry: string[], lang: string, version: string) => `# silmari settings. Everything works without this file. Every key is optional.
entry: [${entry.join(', ')}]   # entry point: the root of the graph. Documents called from here form the flow
lang: ${lang}              # the user's language. Agents write documents and answers in it. The notation itself has no language
version: ${version}        # the silmari that wrote SILMARI.md and this file. \`sil update\` refreshes them and records the new version
scan:
  exclude: [".sil/backups/**"]   # .gitignore is always respected
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

Two principles hold everywhere: **the notation has no language** (every marker is a symbol; the words inside are yours) and **it belongs to no AI tool** (any agent reads it; what differs between runtimes is handled by \`sil run\`).

## Notation

Six symbols. The words inside them are free, in any language.

| Symbol | Meaning |
|---|---|
| \`[name](file.md)\` | A call to another document. Values follow the link in the same paragraph |
| \`{{>name}}\` | Send this value to the call |
| \`{{<name}}\` | Receive this value from the call |
| \`{{+…}}\` | The tools the subagent may use, in your words: \`{{+read}}\` \`{{+파일 읽기}}\` |
| \`{{#…}}\` | The model the subagent runs on, in your words: \`{{#fast}}\` \`{{#가장 작은 모델}}\` |
| \`## … ((…))\` | A double-parenthesis label at the end of a heading: the calls under it run as a subagent (isolated). \`((use a subagent via sil run))\` |

- A link can point at any file: \`[spec](../spec.json)\`, \`[log](out/run.log)\`, a folder. The graph shows it and lint checks that it exists; nothing but md is parsed. Every file an agent reads is a link. A file name in backticks is not a link: it makes no edge and never reaches a subagent. A file the step creates is an output value (\`- report (path)\` under \`## {{<Outputs}}\`), not a link.
- A link target may hold a value: \`[the reference](../references/{{>topic}}.md)\`. The value is one of this document's inputs, or a value received from an earlier call, and is filled in when the step runs. Lint checks that at least one file matches the pattern.
- A condition is a heading. Calls under \`## If the review is major\` happen under that condition. A heading that calls an earlier document again must state when it ends.
- In the called document, the contract is a list under a heading that is exactly one marker: \`## {{>Inputs}}\` for inputs, \`## {{<Outputs}}\` for outputs. Any heading level, any words: \`### {{>입력}}\`. The item name is the first word; an optional \`(path)\`, \`(text)\` or \`(json)\` after it says what kind of value it is (\`- posting (path) — the file to read\`). Say whether a value is a path or the content itself; agents confuse the two.
- A document is a task when it sends or receives values, is called with values, or has a contract. Otherwise it is a reference. To override the guess, the only frontmatter silmari reads: \`sil:\` then \`  type: task\` (or \`doc\`).
- The condition of a call is every heading above it, the H1 included. Value names are one word; the label inside \`(( ))\` is written like an instruction to the model.

## Running a call

1. If the calling heading ends with a \`(( ))\` label, do not start the subagent yourself. Run with your shell:
   \`sil run <runtime> --step <flow file>#<heading number> --send <name>=<value> … <runtime flags>\`
   where \`<runtime>\` is the CLI you are running in, and \`<runtime flags>\` are that CLI's own flags that apply the model named by \`{{#…}}\` and restrict the tools to those named by \`{{+…}}\`. For claude: \`--model <name> --tools <Tool,Tool>\`. For codex: \`-m <name> -s <sandbox>\`. Example:
   \`sil run claude --step flow.md#1 --send posting=@posting.md --model haiku --tools Read\`
   Use the JSON it prints as the received values. \`sil run --help\` lists the runtimes and their flags.
2. If the heading has no \`(( ))\` label, read the called file and follow its steps yourself. Tools and model do not apply; you keep your own.
3. Values on the call line (\`{{>name}}\`) exist only for this run. Fill them in and pass each one with \`--send name=…\`. The hint on that name in the called document's \`{{>…}}\` list says what to send, and \`sil run\` checks it before anything starts:
   - No hint, or \`(text)\`: the value itself. \`--send tone=formal\`, or \`--send note=@memo.md\` to send a file's content. Nothing is checked. The subagent sees the text either way and cannot tell the two apart.
   - \`(json)\`: a JSON string, typed or from a file. \`--send options='{"depth": 2}'\` or \`--send options=@options.json\`. Refused when it does not parse.
   - \`(path)\`: the path itself, relative to the flow file's folder. \`--send spec=docs/design.md\`, never \`@\`. Refused when nothing exists there. Only the path reaches the prompt; the subagent opens it with its own tools, so the call line needs \`{{+read}}\` or wider.
   Every value lands in the prompt as it is, under \`## Values for this run\`. Send content (\`@file\`) for short values; send a \`(path)\` when the value is large or is several files, so the prompt stays small and the subagent reads only what it needs.
4. If \`sil\` is not installed, start the subagent with your tool's own feature and apply the model and tools as far as it allows. Tool limits are then a request, not a guarantee.

## Subagents

A step whose heading ends with a \`(( ))\` label runs as a subagent: a fresh session that sees only what this section describes.

1. **What a subagent knows.** The called document (its body is the prompt), the values sent on the call line, and every file the called document links to. Nothing else. It does not see the caller's conversation or the flow document. It starts in the project root (the folder with \`.sil/\`); \`sil run\` rewrites every link in the document and every \`(path)\` value to that root, so the paths it opens are the ones the document meant.
2. **Rules travel by link.** If the subagent must follow project rules (style, language, safety), the called document links them: \`Follow the [writing rules](../RULES.md).\` The graph shows the link; lint checks that the file exists. Rules that are not linked do not reach the subagent.
3. **Start-file rules are not inherited.** \`sil run\` starts the subagent with the runtime's project start files switched off (Claude Code: \`--setting-sources user\`; Codex: \`-c project_doc_max_bytes=0\`), so a subagent's rules come only from links in its own document. Explicit reads still work. Where a runtime has no such switch, the start files are inherited; this document is written so that changes nothing for a single isolated step.
4. **Tools and model.** \`{{+…}}\` and \`{{#…}}\` describe them in any words. The orchestrator translates them into its runtime's flags on the \`sil run\` line; \`sil run\` applies them and, where the runtime reports it, verifies what the subagent actually received. How strongly a runtime enforces them differs and is printed on the first line of every run.
5. **What comes back.** Only the values named by \`{{<…}}\`, as JSON. The subagent's reasoning and other output stay in the run record under \`.sil/run/\`.

## Flow

Link the flow documents here. Example: \`[Feature work](flow.md)\`
`
/** .sil/migration.md: how to move existing documents to the notation. Written by init when md files exist, and by `sil migrate`; the agent
 *  deletes it when the migration is done (rule 10). It is not part of SILMARI.md, which every session reads, because it is a one-time job */
export const MIGRATION_PATH = '.sil/migration.md'
const migrationDoc = () => `# Moving this project's documents to the silmari notation

Moving an existing document to the notation means putting the flow where the parser can read it. Adding a few headings or one \`{{ }}\` is not a migration. Follow these rules for every document that calls other agents.

1. **One agent, one file.** An agent defined as a section inside an orchestrator (\`### 1. Analyst — role, tools, model …\`) becomes its own md file with its role and steps. The orchestrator keeps only the call, and the same paragraph names the tools and model in a sentence: \`Use the tools {{+read}} and {{+edit}}, and the model {{#fast}}.\` No frontmatter is needed.
2. **The contract lives in the called file.** Turn its input/output bullets into lists under \`## {{>Inputs}}\` and \`## {{<Outputs}}\` there, one name per item, with \`(path)\` or \`(json)\` where the kind matters. Do not add these headings to the caller.
3. **One call, one line.** Each step of the orchestrator is a numbered heading with a link to the called file and the values on that line: \`[Analyst](agents/analyst.md) with {{>posting}} and receive {{<analysis}}\`. A step that must run isolated ends its heading with \`((use a subagent via sil run))\`. A loop or retry is a heading that states its condition and its bound (\`## 5. If validation fails (up to 2 times)\`) with the call below it. Parallel work is a heading that says "for each".
4. **Link every file the agent reads.** A split-out agent document links the rule documents it needs (\`Follow the [coding rules](../RULES.md)\`) and every other file it opens: md, json, log alike. Subagents receive files only through such links; a file name in backticks is not a link. When the file depends on a value, put the value in the target: \`[the reference](../references/{{>topic}}.md)\`.
5. **Diagrams, pseudocode and transfer tables stay, but do not count.** The parser cannot read mermaid, a while loop, or a "data passed between agents" table. Copy what they say onto the call lines; leave the originals for people.
6. **Value names are one word.** Letters, digits, \`_\`, \`-\`. No spaces, no symbols: \`{{>slug}}\`, not \`{{>company slug}}\`. Use the same name at the sender, the receiver, and in the contract. Words inside \`{{+…}}\`, \`{{#…}}\` and \`(( ))\` are free.
7. **Values attach only to calls.** A link to a rules or reference document carries no \`{{ }}\`.
8. **Prose stays prose.** Background, rationale, error handling, examples: leave them as they are. The notation appears only on lines with calls and on contract headings.
9. **Finish with \`sil lint\`.** Repeat until it reports error 0 and the last line shows task and call counts above 0. Warnings that remain should be real mismatches, not notation mistakes.
10. **Then remove the question.** When lint is at error 0, delete this file (\`.sil/migration.md\`) and the line that starts with "When starting work, if this project's md files do not yet follow" from CLAUDE.md, AGENTS.md, GEMINI.md and .github/copilot-instructions.md, and tell the user you did. silmari never removes them; otherwise the question comes back every session.

Before, one file:

\`\`\`markdown
## Agents
### 1. Analyst — tools: Read, Write · model: sonnet
Input: the posting. Output: analysis.json
### 2. Composer — …
## Flow (mermaid)
Analyst --> Composer --> Evaluator; score < 85 --> Composer (max 3)
\`\`\`

After, the orchestrator:

\`\`\`markdown
## 1. Analyse ((use a subagent via sil run))
Call [Analyst](agents/analyst.md) with {{>posting}} and receive {{<analysis}}.
Use the tools {{+read}} and {{+edit}}, and the model {{#balanced}}.
## 2. Compose ((use a subagent via sil run))
Call [Composer](agents/composer.md) with {{>analysis}} and receive {{<preset}}.
Use the tool {{+read}} and the model {{#balanced}}.
## 3. If the score is under 85 (up to 3 times) ((use a subagent via sil run))
Call [Composer](agents/composer.md) with {{>fixes}} and {{>preset}} and receive {{<preset}} again.
Use the tool {{+read}} and the model {{#balanced}}.
\`\`\`

And \`agents/analyst.md\`:

\`\`\`markdown
# Analyst
Follow the [writing rules](../RULES.md).
## {{>Inputs}}
- posting (path) — the job posting file
## Steps
1. …
## {{<Outputs}}
- analysis — a bullet list of skills and tone
\`\`\`
`

// One plain sentence for every tool. Import syntax such as @SILMARI.md is Claude-specific; the plain line made Claude read the file 4/4 (experiment 5).
// The first mention is a markdown link, so the graph has a real edge from every start file to the entry point (the viewer's entry view starts there).
// The link is relative to the start file's folder: `.github/copilot-instructions.md` links `../SILMARI.md`
const CALL = (f: string) => `[${ENTRY_MAIN}](${f.includes('/') ? '../'.repeat(f.split('/').length - 1) : ''}${ENTRY_MAIN}) is the entry point of everything in this project. The notation and flow of every md document follow ${ENTRY_MAIN}. Read ${ENTRY_MAIN} first, before any work.`
const LANG_LINE = (lang: string) => `The user's language is "${lang}". Write documents and answers in that language. Keep the notation from ${ENTRY_MAIN} as it is.`
/** The start of the migration question line, in every wording since 0.2.0. `sil update` rewrites an old line to the current one */
export const MIGRATE_PREFIX = "When starting work, if this project's md files do not yet follow"
const MIGRATE = `${MIGRATE_PREFIX} the ${ENTRY_MAIN} notation, first ask: "Start the silmari migration?" If yes, follow ${MIGRATION_PATH} rule by rule, finish with \`sil lint\` at error 0, then delete that file and this line from every agent start file.`
/** The line `sil update` adds when it wrote notes to .sil/updates/. The agent applies them in version order and deletes them and this line */
export const UPDATE_PREFIX = 'When starting work, apply the update notes in'
export const UPDATES_DIR = '.sil/updates'
const UPDATE_LINE = `${UPDATE_PREFIX} ${UPDATES_DIR}/: first tell the user, in their language and in plain words, what each note changed (how it was written before, how it is written now), then ask: "Start the silmari update?" If yes, apply the notes in version order, finish with \`sil lint\` at error 0, then delete those files and this line from every agent start file.`
const AGENT_HEAD = (f: string) => `# ${f.replace(/^.*\//, '').replace(/\.md$/, '')}`

/** Agent start files. Tools read them automatically each session. */
const AGENT_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md']

/** Add a SILMARI.md call to four agent start files. If md files exist, also add the migration question. Create missing files. Do not change files that already mention SILMARI.md. */
function linkAgentFiles(root: string, lang: string) {
  const skip = new Set([ENTRY_MAIN, ...AGENT_FILES])
  const hasDocs = [...loadDir(root).keys()].some((rel) => !skip.has(rel))
  const what = `${ENTRY_MAIN} call${lang !== 'en' ? ` · language ${lang}` : ''}${hasDocs ? ' · migration prompt' : ''}`
  if (hasDocs) writeMigrationDoc(root)
  for (const f of AGENT_FILES) {
    const lines = [CALL(f), ...(lang !== 'en' ? [LANG_LINE(lang)] : []), ...(hasDocs ? [MIGRATE] : [])]
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
  writeFileSync(p, template(entry, lang, silVersion()))
  process.stdout.write(`Created: ${p}\n`)
  process.stdout.write(`Entry: ${entry.join(', ')}\n`)
  return 0
}

const writeMigrationDoc = (root: string) => { mkdirSync(resolve(root, '.sil'), { recursive: true }); writeFileSync(resolve(root, MIGRATION_PATH), migrationDoc()); process.stdout.write(`Created: ${MIGRATION_PATH}\n`) }
const hasLine = (p: string, prefix: string) => existsSync(p) && readFileSync(p, 'utf8').split('\n').some((l) => l.startsWith(prefix))

/** sil migrate. Writes .sil/migration.md again and puts the question line back into the start files that lack it, for a migration run later. */
export function migrate(dir: string): number {
  const root = findProjectRoot(resolve(dir))
  if (!root) { process.stderr.write(`sil migrate: no .sil/ found above ${resolve(dir)}. Run sil init first.\n`); return 1 }
  writeMigrationDoc(root)
  for (const f of AGENT_FILES) {
    const p = resolve(root, f)
    if (!existsSync(p) || hasLine(p, MIGRATE_PREFIX)) continue
    appendFileSync(p, `${MIGRATE}\n`); process.stdout.write(`Appended: ${f} (migration prompt)\n`)
  }
  return 0
}

/** The version an unrecorded project was set up with, read from what that version's sil init left behind:
 *  0.1.x had a `words:` block in the config and no Running section; 0.2.0 wrote the Running section; 0.3.0 said that a link can point
 *  at any file. Null when nothing tells (a hand-written entry point): then every note applies */
function inferVersion(root: string, entries: string[]): string | null {
  const cfgText = existsSync(resolve(root, CONFIG_PATH)) ? readFileSync(resolve(root, CONFIG_PATH), 'utf8') : ''
  if (/^words:/m.test(cfgText)) return '0.1.0'
  const entry = entries.map((rel) => resolve(root, rel)).filter(existsSync).map((p) => readFileSync(p, 'utf8')).find((t) => t.includes('## Notation'))
  if (entry === undefined) return null
  if (!entry.includes('## Running a call')) return '0.1.0'
  return entry.includes('A link can point at any file') ? '0.3.0' : '0.2.0'
}
const GENERATED = ['Notation', 'Running a call', 'Subagents', 'Migration'] // the sections silmari owns in an entry document; Migration moved to .sil/migration.md in 0.3.1
/** A document as its head and its level-2 sections, each with the heading line. Blank lines at section ends are dropped and put back on join */
function sections(text: string): { head: string; list: { name: string; text: string }[] } {
  const list: { name: string; text: string }[] = []; const head: string[] = []
  let cur: { name: string; lines: string[] } | null = null
  const flush = () => { if (cur) list.push({ name: cur.name, text: cur.lines.join('\n').trimEnd() }) }
  let fence = false // a `## ` line inside a fenced code block (the migration examples have them) is not a heading
  for (const ln of text.split('\n')) {
    if (/^\s*```/.test(ln)) fence = !fence
    const m = fence ? null : /^## (.+?)\s*$/.exec(ln)
    if (m) { flush(); cur = { name: m[1], lines: [ln] } } else if (cur) cur.lines.push(ln); else head.push(ln)
  }
  flush()
  return { head: head.join('\n').trimEnd(), list }
}
/** The entry document with its generated sections replaced by the current ones, the user's sections kept in their order, and the
 *  Migration section dropped. Null when the document has no generated section (a hand-written entry point): nothing to refresh */
export function refreshEntry(text: string): string | null {
  const old = sections(text)
  if (!old.list.some((x) => GENERATED.includes(x.name))) return null
  const fresh = sections(skeleton(ENTRY_MAIN))
  // The generated Migration section ended with a fenced example. Lines a user added after it (the end of the file) are theirs: keep them
  const tail = old.list.filter((x) => x.name === 'Migration').map((x) => x.text.slice(x.text.lastIndexOf('```') + 3).trim()).filter(Boolean)
  const parts = [old.head, ...fresh.list.filter((x) => GENERATED.includes(x.name)).map((x) => x.text), ...old.list.filter((x) => !GENERATED.includes(x.name)).map((x) => x.text), ...tail]
  return parts.filter(Boolean).join('\n\n') + '\n'
}

/** sil update. Brings a project that ran an older sil init up to the installed version:
 *   1. the generated sections of the entry documents (Notation · Running a call · Subagents) are replaced; the user's sections stay
 *   2. the Migration section leaves SILMARI.md; if a start file still asks the migration question, .sil/migration.md is written and the line points at it
 *   3. the update notes newer than the recorded version go to .sil/updates/, with one line in the start files asking the agent to apply them
 *   4. the installed version is recorded in .sil/config.yaml
 *  Running it again changes nothing. */
export function update(dir: string): number {
  const root = findProjectRoot(resolve(dir))
  if (!root) { process.stderr.write(`sil update: no .sil/ found above ${resolve(dir)}. Run sil init first.\n`); return 1 }
  const cfg = readConfig(root), installed = silVersion()
  // Projects from before 0.3.1 recorded no version. What sil init wrote at the time says which one it was, so only the later notes apply
  const inferred = cfg.version === null ? inferVersion(root, cfg.entry) : null
  const from = cfg.version ?? inferred ?? '0.0.0'
  let changed = 0
  for (const rel of cfg.entry) {
    const p = resolve(root, rel)
    if (!existsSync(p)) continue
    const before = readFileSync(p, 'utf8'), after = refreshEntry(before)
    if (after === null) { process.stdout.write(`Unchanged: ${rel} (no generated sections)\n`); continue }
    if (after === before) { process.stdout.write(`Unchanged: ${rel}\n`); continue }
    writeFileSync(p, after); changed++; process.stdout.write(`Updated: ${rel} (Notation · Running a call · Subagents refreshed${before.includes('\n## Migration') ? ' · Migration moved to ' + MIGRATION_PATH : ''})\n`)
  }
  // The migration question: an old line said "the Migration section of SILMARI.md"; that section is gone, so the line points at the file
  let asking = false
  for (const f of AGENT_FILES) {
    const p = resolve(root, f)
    if (!hasLine(p, MIGRATE_PREFIX)) continue
    asking = true
    const lines = readFileSync(p, 'utf8').split('\n'), i = lines.findIndex((l) => l.startsWith(MIGRATE_PREFIX))
    if (lines[i] !== MIGRATE) { lines[i] = MIGRATE; writeFileSync(p, lines.join('\n')); changed++; process.stdout.write(`Updated: ${f} (migration line points at ${MIGRATION_PATH})\n`) }
  }
  if (asking && !existsSync(resolve(root, MIGRATION_PATH))) { writeMigrationDoc(root); changed++ }
  // Notes for the versions between the recorded one and this one
  const pending = Object.keys(UPDATE_NOTES).filter((v) => compareVersions(v, from) > 0 && compareVersions(v, installed) <= 0).sort(compareVersions)
  if (pending.length) {
    mkdirSync(resolve(root, UPDATES_DIR), { recursive: true })
    for (const v of pending) { writeFileSync(resolve(root, UPDATES_DIR, `${v}.md`), UPDATE_NOTES[v]); process.stdout.write(`Created: ${UPDATES_DIR}/${v}.md\n`); changed++ }
    let carried = false
    for (const f of AGENT_FILES) {
      const p = resolve(root, f)
      if (!existsSync(p)) continue
      carried = true
      if (hasLine(p, UPDATE_PREFIX)) continue
      appendFileSync(p, `${UPDATE_LINE}\n`); process.stdout.write(`Appended: ${f} (update notes prompt)\n`)
    }
    if (!carried) process.stdout.write(`Note: no agent start file (${AGENT_FILES.join(' · ')}) to carry the prompt. The notes wait in ${UPDATES_DIR}/ and sil lint reports them; tell your agent to apply them\n`)
  }
  // Record the version: replace the line or add it
  const cp = resolve(root, CONFIG_PATH)
  const text = existsSync(cp) ? readFileSync(cp, 'utf8') : ''
  if (cfg.version !== installed) {
    const line = `version: ${installed}        # the silmari that wrote SILMARI.md and this file. \`sil update\` refreshes them and records the new version`
    const next = /^version:.*$/m.test(text) ? text.replace(/^version:.*$/m, line) : text.replace(/\n?$/, '\n') + line + '\n'
    writeFileSync(cp, next); changed++; process.stdout.write(`Recorded: ${CONFIG_PATH} version ${installed}${cfg.version ? ` (was ${cfg.version})` : inferred ? ` (was ${inferred}, inferred from what sil init wrote)` : ' (no version recorded before: every note applies)'}\n`)
  }
  process.stdout.write(changed ? `Done: ${installed}${pending.length ? `. The agent applies ${UPDATES_DIR}/ at the start of the next session` : ''}\n` : `Up to date: ${installed}\n`)
  return 0
}
