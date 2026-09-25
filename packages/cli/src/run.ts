// sil run — starts one isolated step of a flow as a subagent, through the agent CLI the user already has.
//
//   sil run <runtime> --step <flow.md>#<N> --send name=value [--send name=@file] … [flags of that runtime]
//
// The orchestrator (an AI reading the flow document) types this line. It translates the call line's {{#model}} and {{+tools}} into
// the runtime's own flags itself; sil reads only --step and --send and passes everything else through untouched. What sil adds:
//   · the checks a program can do without understanding prose: the heading has a (( )) label, the --send names match the {{>…}} names,
//     a flag is present when the call line declares tools or a model, a flag that does not restrict is refused, `(path)` values exist
//   · the prompt: the called document's body, the values, and the reply format ({"<received name>": …})
//   · the subagent starts in the project root (the folder with .sil/). Links in the called document are written relative to that document,
//     so every link target and every (path) value is rewritten to the root before it enters the prompt; `{{>name}}` inside a target is
//     filled from --send and the file must exist. Before this, a document in agents/ linking ../references/x.md sent the subagent to a
//     path that did not exist whenever the flow file sat in another folder (2026-09-08)
//   · the runtime's project start files (CLAUDE.md · AGENTS.md · …) left in place, as people expect, unless the call line says {{-…}};
//     with that marker sil switches them off, so the step's rules come only from links in its own document
//   · verification where the runtime reports what the model was given (Claude Code prints its tool list), honesty where it does not
//   · a record of every run under .sil/run/, and a cached answer for an identical repeat: the same arguments and prompt, and the same content
//     in every file the prompt points at. A run that failed is recorded but never cached
// Measured on Claude Code and Codex CLI (2026-09-07): orchestrators typed the line correctly in every run once the Running section
// showed the runtime's flags; without the examples they guessed --allowedTools, which does not restrict, hence the refusal list.
// The prompt goes to the runtime on stdin, never on the command line: Windows caps a command line at 32,767 characters (8,191 through
// cmd.exe), and one document body with a file sent as @file passes that. The runtime is found and started by spawn.ts (2026-09-15)
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve, relative, join, sep } from 'node:path'
import { parseDoc, findProjectRoot, resolve as resolveLink, type Link, type Doc } from '@silmari/core/node'
import { findExecutable, commandLine, starts, stopTree } from './spawn.ts'

/** What sil has to know about one runtime CLI. Everything else about the command line belongs to the caller. */
export interface Adapter {
  /** Executable name */
  exe: string
  /** Base arguments. `{noRules}` is replaced by noRulesFlags or by nothing, `{sessionOff}` by sessionOffFlags unless --keep-session. The prompt is not among them: it is written to stdin
   *  (claude -p reads it there when no prompt argument is given; codex exec reads it for `-`) */
  base: string[]
  /** Flags that switch this runtime's project start files off. Used only when the call line carries {{-…}}.
   *  Empty when the runtime has no such switch: sil then refuses the step rather than running it with the rules still in. */
  noRulesFlags: string[]
  /** Flags that keep the runtime from saving this run as a session. sil keeps its own record under .sil/run/, so the runtime's copy
   *  only fills the user's session list. Absent or empty when the runtime has no such switch */
  sessionOffFlags?: string[]
  /** Flags that really restrict tools, and flags that set the model. Presence checks only; values are never interpreted. */
  toolsFlags: string[]; modelFlags: string[]
  /** Flags that look like a restriction but are not. Refused with the reason so the orchestrator can retry. */
  rejected: Record<string, string>
  /** How this runtime enforces tool limits, printed on the first line of every run. */
  enforcement: 'tool-removal' | 'os-sandbox' | 'none'
  /** Whether the output stream reports the tools the model was given (only Claude Code does) */
  verifies: boolean
  /** One example line for --help and for the Running section of SILMARI.md */
  example: string
  /** Reads one output event. Returns what it found; fields it cannot know stay undefined. `error` is set when the runtime says the run failed */
  read: (ev: Record<string, unknown>) => { tools?: string[]; model?: string; used?: string[]; result?: string; error?: string }
}

export const ADAPTERS: Record<string, Adapter> = {
  claude: {
    exe: 'claude',
    base: ['-p', '--output-format', 'stream-json', '--verbose', '{noRules}', '{sessionOff}'],
    // --setting-sources user: no CLAUDE.md injection (measured: self-report, token count and a behavioural rule all agree)
    noRulesFlags: ['--setting-sources', 'user'],
    // --no-session-persistence: works only with -p, which sil always passes. Without it every step lands in ~/.claude/projects/
    sessionOffFlags: ['--no-session-persistence'],
    toolsFlags: ['--tools', '--disallowedTools', '--disallowed-tools'], modelFlags: ['--model'],
    rejected: { '--allowedTools': 'does not restrict tools; it only pre-approves permissions. Use --tools <Tool,Tool>.', '--allowed-tools': 'does not restrict tools; it only pre-approves permissions. Use --tools <Tool,Tool>.' },
    enforcement: 'tool-removal', verifies: true,
    example: 'sil run claude --step flow.md#1 --send posting=@posting.md --model haiku --tools Read,Bash',
    read: (ev) => {
      const out: ReturnType<Adapter['read']> = {}
      const msg = ev.message as { model?: string; content?: { type: string; name?: string }[] } | undefined
      if (ev.type === 'system' && ev.subtype === 'init') out.tools = (ev.tools as string[]) ?? []
      if (ev.type === 'assistant' && msg) { out.model = msg.model; out.used = (msg.content ?? []).filter((c) => c.type === 'tool_use').map((c) => c.name ?? '?') }
      if (ev.type === 'result') {
        if (typeof ev.result === 'string') out.result = ev.result
        // An error result (max turns, an API error) may carry no text. It used to become an empty answer, cached and replayed (2026-09-15)
        if (ev.is_error === true || (typeof ev.subtype === 'string' && ev.subtype !== 'success')) out.error = [String(ev.subtype ?? 'error'), typeof ev.result === 'string' ? ev.result : ''].filter(Boolean).join(': ').slice(0, 300)
      }
      return out
    },
  },
  codex: {
    exe: 'codex',
    // --skip-git-repo-check: a flow folder need not be a repository. `-`: the prompt comes from stdin
    base: ['exec', '--json', '--skip-git-repo-check', '{noRules}', '-'],
    // -c project_doc_max_bytes=0: no AGENTS.md injection (measured)
    noRulesFlags: ['-c', 'project_doc_max_bytes=0'],
    sessionOffFlags: [],
    toolsFlags: ['-s', '--sandbox'], modelFlags: ['-m', '--model'],
    rejected: {},
    enforcement: 'os-sandbox', verifies: false,
    example: 'sil run codex --step flow.md#1 --send posting=@posting.md -m gpt-5.4-mini -s read-only',
    read: (ev) => {
      const out: ReturnType<Adapter['read']> = {}
      const item = ev.item as { type?: string; text?: string } | undefined
      if (ev.type === 'item.completed' && item?.type === 'agent_message') out.result = item.text ?? ''
      if (ev.type === 'item.completed' && item?.type === 'command_execution') out.used = ['shell']
      if (ev.type === 'turn.failed') out.error = String((ev.error as { message?: string } | undefined)?.message ?? 'turn failed').slice(0, 300)
      return out
    },
  },
}

export const runUsage = (): string => `sil run <runtime> --step <flow.md>#<N> --send <name>=<value> … [runtime flags]

  Starts step N of the flow as a subagent through that runtime's CLI. sil reads --step and --send; every other argument
  goes to the runtime unchanged. Put the model named by {{#…}} and the tools named by {{+…}} in the runtime's own flags.
    --send name=value      a value for a {{>name}} on the call line        --send name=@file   a file's content (path from the current folder)
    --dry-run              print the command that would run, and stop      --prompt-only       print the assembled prompt
    --keep-session         let the runtime save this run as a session you can resume (off by default: sil keeps its own record)

  What --send takes, by the hint on that name in the called document's {{>…}} list (checked before anything starts):
    none or (text)   the value itself, or @file for a file's content     --send tone=formal   --send note=@memo.md
    (json)           a JSON string, typed or @file; refused when it does not parse     --send options='{"depth": 2}'
    (path)           the path itself, relative to the flow file; must exist; never @   --send spec=docs/design.md
  Every value lands in the prompt as it is. A (path) lands as the path string; the subagent opens it with its own tools.
  Windows PowerShell 5 drops the double quotes inside an argument on its way to a program: send JSON there as @file.
  The subagent starts in the project root (the folder with .sil/). Links in the called document and (path) values are rewritten
  to that root, so the paths it opens are the ones the document meant. {{>name}} inside a link target is filled from --send.
  The prompt reaches the runtime on stdin, so a long one is not cut by a command-line limit.

  Project rules. The subagent keeps the runtime's project start files (CLAUDE.md · AGENTS.md · …), as people expect. To run a
  step without them, write {{-…}} on the call line next to {{+tools}} and {{#model}}; sil then adds the runtime's switch itself.
  The words inside are yours: {{-without the project rules}} {{-프로젝트 규칙 없이}}. A runtime with no such switch refuses the step.

  An identical repeat (same arguments and prompt, same content in every linked file and (path) value) is answered from .sil/run/cache.
  A run that fails is recorded under .sil/run/ and not cached.

  Runtimes and the flags that restrict tools (a flag that only pre-approves permissions is refused):
${Object.entries(ADAPTERS).map(([n, a]) => `    ${n.padEnd(8)} ${a.example}\n${''.padEnd(13)}tools: ${a.toolsFlags.join(' / ')} · model: ${a.modelFlags.join(' / ')} · enforcement: ${a.enforcement} · ${a.verifies ? 'verified from the output' : 'not verifiable from the output'} · {{-…}}: ${a.noRulesFlags.length ? a.noRulesFlags.join(' ') : 'not supported'} · no session: ${a.sessionOffFlags?.length ? a.sessionOffFlags.join(' ') : 'not supported'}`).join('\n')}
`

const fail = (msg: string): number => { process.stderr.write(`sil run: ${msg}\n`); return 1 }
const hasFlag = (args: string[], flags: string[]) => args.some((a) => flags.some((f) => a === f || a.startsWith(f + '=')))
const flagValue = (args: string[], flags: string[]): string | undefined => {
  for (let i = 0; i < args.length; i++) for (const f of flags) { if (args[i] === f) return args[i + 1]; if (args[i].startsWith(f + '=')) return args[i].slice(f.length + 1) }
  return undefined
}
/** The runtimes that are on PATH and start */
const installedRuntimes = () => Object.entries(ADAPTERS).filter(([, a]) => { const f = findExecutable(a.exe); return f !== null && starts(f) }).map(([n]) => n).join(', ') || 'none'
const fill = (s: string, sends: Map<string, { value: string }>) => s.replace(/\{\{>([^}]*)\}\}/g, (m, n: string) => sends.get(n.trim())?.value ?? m)

/** Finds the call line of step N: the first link under the heading whose text starts with `N.` (or equals N) */
function findStep(doc: Doc, step: string): { heading: string; link: Link } | string {
  const h = doc.headings.find((x) => new RegExp(`^${step.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\s|$)`).test(x.text) || x.text === step)
  if (!h) return `no heading numbered ${step} in the flow file`
  const link = doc.links.find((l) => l.under[l.under.length - 1] === h.text) ?? doc.links.find((l) => l.under.includes(h.text))
  if (!link) return `no call line (a markdown link) under step ${step} "${h.text}"`
  return { heading: h.text, link }
}

export async function run(argv: string[]): Promise<number> {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') { process.stdout.write(runUsage()); return 0 }
  const rt = argv[0], ad = ADAPTERS[rt]
  if (!ad) return fail(`unknown runtime "${rt}". Known: ${Object.keys(ADAPTERS).join(', ')}. Installed: ${installedRuntimes()}`)
  if (argv[1] === '--help' || argv[1] === '-h') { process.stdout.write(runUsage()); return 0 }
  let step: string | undefined; const sends = new Map<string, { value: string; fromFile: boolean }>(); const rest: string[] = []
  let dry = false, promptOnly = false, keepSession = false
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--step' && i + 1 < argv.length) { step = argv[++i]; continue }
    if (a.startsWith('--step=')) { step = a.slice(7); continue }
    if (a === '--send' || a.startsWith('--send=')) {
      const kv = a === '--send' ? argv[++i] : a.slice(7)
      if (kv === undefined || !kv.includes('=')) return fail(`--send expects name=value, got: ${kv ?? '(nothing)'}`)
      const k = kv.slice(0, kv.indexOf('=')), v = kv.slice(kv.indexOf('=') + 1)
      if (v.startsWith('@')) { if (!existsSync(v.slice(1))) return fail(`--send ${k}: file not found: ${resolve(v.slice(1))} (an @file path is read from the current folder)`); sends.set(k, { value: readFileSync(v.slice(1), 'utf8'), fromFile: true }) }
      else sends.set(k, { value: v, fromFile: false })
      continue
    }
    if (a === '--dry-run') { dry = true; continue }
    if (a === '--prompt-only') { promptOnly = true; continue }
    if (a === '--keep-session') { keepSession = true; continue }
    rest.push(a)
  }
  if (!step || !step.includes('#')) return fail('--step <flow.md>#<N> is required')
  const [flowPath, num] = [step.slice(0, step.lastIndexOf('#')), step.slice(step.lastIndexOf('#') + 1)]
  const flowAbs = resolve(flowPath)
  if (!existsSync(flowAbs)) return fail(`flow file not found: ${flowPath}`)
  const flowDir = dirname(flowAbs)
  const flow = parseDoc(relative(flowDir, flowAbs), readFileSync(flowAbs, 'utf8'))
  const found = findStep(flow, num)
  if (typeof found === 'string') return fail(found)
  const { heading, link } = found
  if (!link.isolated) return fail(`step ${num} "${heading}" is not a subagent step: its heading has no (( )) label. Do this step yourself.`)
  // --send names must be exactly the {{>…}} names on the call line
  const expected = [...new Set(link.sends)].sort(), got = [...sends.keys()].sort()
  if (expected.join('\0') !== got.join('\0')) return fail(`step ${num} expects --send for: ${expected.join(' ') || 'nothing'}. Got: ${got.join(' ') || 'none'}.`)
  // The call line declares tools or a model: the runtime flag must be there. Presence only; the words inside {{ }} are for the orchestrator
  for (const [f, why] of Object.entries(ad.rejected)) if (hasFlag(rest, [f])) return fail(`${f} ${why}`)
  if (link.tools.length && !hasFlag(rest, ad.toolsFlags)) return fail(`the call line declares tools {{+${link.tools.join('}} {{+')}}} but no tools flag was given for ${rt} (${ad.toolsFlags.join(' / ')}).`)
  if (link.model && !hasFlag(rest, ad.modelFlags)) return fail(`the call line declares a model {{#${link.model}}} but no model flag was given for ${rt} (${ad.modelFlags.join(' / ')}).`)
  // {{-…}} asks for a run without the project start files. A runtime that cannot do it must not run the step with the rules still in
  if (link.noRules && !ad.noRulesFlags.length) return fail(`the call line says {{-${link.noRules}}}, but ${rt} has no switch for its project start files. They would still reach the subagent. Remove the marker to accept that, or run this step on a runtime that has one.`)
  // The subagent's working directory is the project root, and every path in the prompt is written from there
  const root = findProjectRoot(flowDir) ?? flowDir
  const fromRoot = (abs: string) => relative(root, abs).split(sep).join('/')
  // The called document: its body is the prompt, its contract types are checked. The target is read the way lint reads it: percent-escapes
  // decoded (`my%20agent.md`), {{>name}} filled from --send, a leading / meaning the project root
  let callPath = link.target.split('#')[0]; try { callPath = decodeURIComponent(callPath) } catch { /* keep it as written */ }
  callPath = fill(callPath, sends)
  const targetAbs = callPath.startsWith('/') ? join(root, callPath.slice(1)) : resolve(flowDir, callPath)
  if (!existsSync(targetAbs)) return fail(`called file not found: ${link.target}`)
  const targetRel = fromRoot(targetAbs)
  const src = readFileSync(targetAbs, 'utf8')
  const target = parseDoc(targetRel, src)
  for (const [k, s] of sends) {
    const t = target.contractTypes[k]
    if (t === 'path') {
      if (s.fromFile) return fail(`${k} is a (path) input: pass the path itself (--send ${k}=some/file), not @file`)
      if (!existsSync(resolve(flowDir, s.value))) return fail(`${k} is a (path) input but no file or folder exists at: ${s.value}`)
    }
    if (t === 'json') { try { JSON.parse(s.value) } catch { return fail(`${k} is a (json) input but the value is not valid JSON`) } }
  }
  // Links in the called document are relative to that document. Rewrite each target from the root, filling {{>name}} from --send
  const rewritten = rewriteLinks(src, target, sends, (rel) => existsSync(join(root, rel)))
  for (const m of rewritten.missing) {
    if (m.filled) return fail(`${targetRel}:${m.line} links ${m.target}, which becomes ${m.rel} with the values sent, but no file exists there`)
    process.stderr.write(`sil run: warning: ${targetRel}:${m.line} links ${m.target}, but ${m.rel} does not exist (sil lint reports this as L-N01)\n`)
  }
  // A CRLF checkout (Windows, core.autocrlf) reaches the subagent as the same text an LF one does
  const body = stripFrontmatter(rewritten.text).replace(/\r\n/g, '\n').trim()
  const shownValue = (k: string, s: { value: string }) => (target.contractTypes[k] === 'path' ? fromRoot(resolve(flowDir, s.value)) : s.value)
  const opening = link.noRules
    ? 'This session runs one isolated step of a flow. The project start files are switched off for it, so the document below and the values after it are everything this step needs. File paths are relative to the current working directory.'
    : 'This session runs one step of a flow as a subagent. The document below and the values after it describe the step; the project rules you were started with still apply. File paths are relative to the current working directory.'
  const prompt = [
    opening,
    '', body, '', '## Values for this run',
    ...[...sends].map(([k, s]) => `- ${k}:\n${shownValue(k, s)}`),
    '', '## Reply format', `Reply with only a JSON object whose keys are: ${link.returns.join(', ') || 'result'}`, '',
  ].join('\n')
  if (promptOnly) { process.stdout.write(prompt); return 0 }
  const args = [...ad.base.flatMap((x) => (x === '{noRules}' ? (link.noRules ? ad.noRulesFlags : []) : x === '{sessionOff}' ? (keepSession ? [] : ad.sessionOffFlags ?? []) : [x])), ...rest]
  if (dry) { process.stdout.write(`${[ad.exe, ...args].join(' ')} < <prompt>\n`); return 0 }
  // Records live under the project's .sil/run/. An identical repeat is answered from the cache: same runtime, arguments and prompt, and the
  // same content in every file the prompt points at. The prompt carries paths, not contents, so a (path) file or a linked document that
  // changed must miss the cache; before, only the called document's hash was in the key (2026-09-15)
  const runDir = join(root, '.sil', 'run'); mkdirSync(join(runDir, 'cache'), { recursive: true })
  const pointed = [...new Set([
    ...[...sends].filter(([k]) => target.contractTypes[k] === 'path').map(([, s]) => resolve(flowDir, s.value)),
    ...rewritten.linked.map((rel) => join(root, rel)),
  ])].sort()
  const key = createHash('sha1').update(JSON.stringify([rt, args, prompt, pointed.map((p) => [fromRoot(p), fingerprint(p)])])).digest('hex').slice(0, 16)
  const cachePath = join(runDir, 'cache', `${key}.json`)
  const rules = link.noRules ? `project rules cut ({{-${link.noRules}}})` : 'project start files inherited'
  const session = !ad.sessionOffFlags?.length ? 'session saved by the runtime' : keepSession ? 'session kept (--keep-session)' : 'session not saved'
  process.stderr.write(`→ ${link.target} · ${rt} · ${rest.join(' ') || '(no flags)'} · ${rules} · ${session} · enforcement ${ad.enforcement} · ${ad.verifies ? 'verified from the output' : 'unverified: this runtime does not report the tools or model it used'}\n`)
  if (existsSync(cachePath)) { const c = JSON.parse(readFileSync(cachePath, 'utf8')) as { out: unknown; ran: string }; process.stderr.write(`· cached from ${c.ran}; nothing ran\n`); process.stdout.write(JSON.stringify(c.out) + '\n'); return 0 }
  const exe = findExecutable(ad.exe)
  if (!exe) return fail(`${ad.exe} was not found on PATH. Installed runtimes: ${installedRuntimes()}`)
  if (!starts(exe)) return fail(`${exe} is on PATH but "${ad.exe} --version" did not exit 0. Installed runtimes: ${installedRuntimes()}`)
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-step${num}`
  mkdirSync(join(runDir, id), { recursive: true })
  const streamFile = createWriteStream(join(runDir, id, 'stream.jsonl'))
  const c = commandLine(exe, args)
  const child = spawn(c.file, c.args, { ...c.options, cwd: root, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDECODE')) as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'] })
  let given: string[] | undefined, model: string | undefined, result: string | undefined, error: string | undefined
  const used: string[] = []; let stderr = ''; let aborted: string | null = null; let startError = null as Error | null
  const wanted = flagValue(rest, ['--tools'])?.split(/[,\s]+/).filter(Boolean)
  // Decoded as UTF-8 across chunks: String(chunk) turned a character split between two chunks into U+FFFD (2026-09-15)
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
  child.stderr.on('data', (d: string) => { stderr += d })
  const onLine = (line: string) => {
    streamFile.write(line + '\n')
    let ev: Record<string, unknown>; try { ev = JSON.parse(line) } catch { return }
    const r = ad.read(ev)
    if (r.tools) {
      given = r.tools
      // Claude Code lists the tools it gave the model. If the list is not what --tools asked for, stop before the model does anything
      if (wanted && (given.length !== wanted.length || given.some((t) => !wanted.includes(t)))) { aborted = `the runtime gave the model tools [${given.join(', ')}] but --tools asked for [${wanted.join(', ')}]. Aborting.`; stopTree(child) }
    }
    if (r.model) model = r.model
    if (r.used) used.push(...r.used)
    if (r.result !== undefined) result = r.result
    if (r.error !== undefined) error = r.error
  }
  let buf = ''
  child.stdout.on('data', (d: string) => {
    buf += d
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); onLine(line) }
  })
  // A runtime that exits before reading the whole prompt closes the pipe: that shows in its exit code, not as a crash of sil
  child.stdin.on('error', () => { /* see the exit code */ })
  child.stdin.end(prompt)
  const code: number = await new Promise((res) => { child.on('close', (x) => res(x ?? 1)); child.on('error', (e) => { startError = e; res(-1) }) })
  if (buf.trim()) onLine(buf)
  streamFile.end()
  if (startError) return fail(`could not start ${exe}: ${startError.message}`)
  if (aborted) return fail(aborted)
  const meta = { runtime: rt, flow: flow.rel, step: num, heading, target: link.target, sends: [...sends.keys()], flags: rest, enforcement: ad.enforcement, verified: ad.verifies && given !== undefined, toolsGiven: given ?? null, model: model ?? null, toolCalls: used, exitCode: code, error: error ?? null, ran: new Date().toISOString() }
  writeFileSync(join(runDir, id, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
  // Only a clean run is cached. A failed one would be replayed as "nothing ran" on every retry
  if (error !== undefined || code !== 0 || result === undefined) {
    const why = error !== undefined ? `reported an error (${error})` : `exited with code ${code}${result === undefined ? ' and no result' : ''}`
    return fail(`${rt} ${why}. Not cached; record .sil/run/${id}. ${stderr.trim().slice(0, 400)}`.trim())
  }
  const out = extractJson(result, link.returns)
  writeFileSync(cachePath, JSON.stringify({ out, ran: id }) + '\n')
  process.stderr.write(`· ran as ${model ?? '(model not reported)'} · tools given ${given ? `[${given.join(', ')}]` : '(not reported)'} · tool calls [${used.join(', ')}] · record .sil/run/${id}\n`)
  process.stdout.write(JSON.stringify(out) + '\n')
  return 0
}

const FINGERPRINT_SKIP = new Set(['.git', 'node_modules', '.sil'])
/** What a file or folder the prompt points at holds, for the cache key: a file's content hash; a folder's entries (path, size, mtime) all the
 *  way down, without .git, node_modules and .sil, and without following links to folders. Null when nothing is there */
function fingerprint(abs: string): string | null {
  let st; try { st = statSync(abs) } catch { return null }
  if (st.isFile()) return createHash('sha1').update(readFileSync(abs)).digest('hex')
  const h = createHash('sha1')
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (FINGERPRINT_SKIP.has(e.name)) continue
      const p = join(dir, e.name), r = `${rel}/${e.name}`
      if (e.isDirectory()) { walk(p, r); continue }
      try { const s = statSync(p); h.update(`${r}\0${s.size}\0${s.mtimeMs}\n`) } catch { h.update(`${r}\0?\n`) }
    }
  }
  walk(abs, '')
  return h.digest('hex')
}

/** Rewrites every link target of the called document so it resolves from the project root, where the subagent starts. `{{>name}}` inside
 *  a target is filled from the values sent; a target that still has a marker (its value comes from a later call) keeps it, root-relative.
 *  Inline links are replaced by their byte range from the end of the file (INV-8); reference-style links live in their definition lines.
 *  `missing` lists targets with nothing on disk; `filled` marks the ones a sent value completed, which the caller refuses.
 *  `linked` lists every resolved target (root-relative, markers filled), for the cache key. */
export function rewriteLinks(src: string, doc: Doc, sends: Map<string, { value: string }>, exists: (rel: string) => boolean): { text: string; missing: { line: number; target: string; rel: string; filled: boolean }[]; linked: string[] } {
  const missing: { line: number; target: string; rel: string; filled: boolean }[] = []
  const linked: string[] = []
  const retarget = (raw: string, line: number): string => {
    let t: string; try { t = decodeURIComponent(raw) } catch { t = raw }
    const filled = fill(t, sends)
    const r = resolveLink(doc.rel, filled)
    if (r.kind === 'self' || r.kind === 'external') return raw
    if (!r.template) { linked.push(r.rel!); if (!exists(r.rel!)) missing.push({ line, target: t, rel: r.rel!, filled: filled !== t }) }
    return r.rel! + (r.anchor ? `#${r.anchor}` : '')
  }
  let buf = Buffer.from(src, 'utf8')
  for (const l of doc.links.filter((x) => !x.refstyle).sort((a, b) => b.range.start - a.range.start)) {
    const slice = buf.subarray(l.range.start, l.range.end).toString('utf8')
    const out = slice.replace(/\]\(\s*(<[^>]*>|[^\s)]+)([^)]*)\)$/, (_m, url: string, tail: string) => `](${retarget(url.startsWith('<') ? url.slice(1, -1) : url, l.line)}${tail})`)
    if (out !== slice) buf = Buffer.concat([buf.subarray(0, l.range.start), Buffer.from(out, 'utf8'), buf.subarray(l.range.end)])
  }
  const joined = buf.toString('utf8')
  const text = joined.replace(/^(\s{0,3}\[[^\]]+\]:\s*)(\S+)/gm, (_m, head: string, url: string, offset: number) => head + retarget(url, joined.slice(0, offset).split('\n').length))
  return { text, missing, linked }
}
/** The document without its frontmatter. The fences are matched without a trailing \r, so a CRLF file's frontmatter does not leak into the prompt */
const stripFrontmatter = (src: string) => {
  const l = src.replace(/^﻿/, '').split('\n'), bare = l.map((x) => x.replace(/\r$/, ''))
  if (bare[0] !== '---') return l.join('\n')
  const e = bare.indexOf('---', 1)
  return e < 0 ? l.join('\n') : l.slice(e + 1).join('\n')
}
/** The reply should be a JSON object with the received names as keys. When it is not, the whole text becomes the first received value */
function extractJson(text: string, returns: string[]): Record<string, unknown> {
  const m = /\{[\s\S]*\}/.exec(text)
  if (m) { try { const o = JSON.parse(m[0]) as Record<string, unknown>; if (o && typeof o === 'object' && !Array.isArray(o)) return o } catch { /* fall through */ } }
  return { [returns[0] ?? 'result']: text.trim() }
}
