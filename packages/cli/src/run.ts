// sil run — starts one isolated step of a flow as a subagent, through the agent CLI the user already has.
//
//   sil run <runtime> --step <flow.md>#<N> --send name=value [--send name=@file] … [flags of that runtime]
//
// The orchestrator (an AI reading the flow document) types this line. It translates the call line's {{#model}} and {{+tools}} into
// the runtime's own flags itself; sil reads only --step and --send and passes everything else through untouched. What sil adds:
//   · the checks a program can do without understanding prose: the heading has a (( )) label, the --send names match the {{>…}} names,
//     a flag is present when the call line declares tools or a model, a flag that does not restrict is refused, `(path)` values exist
//   · the prompt: the called document's body, the values, and the reply format ({"<received name>": …})
//   · the runtime's project start files switched off, so a subagent's rules come only from links in its own document
//   · verification where the runtime reports what the model was given (Claude Code prints its tool list), honesty where it does not
//   · a record of every run under .sil/run/, and a cached answer for an identical repeat
// Measured on Claude Code and Codex CLI (2026-09-07): orchestrators typed the line correctly in every run once the Running section
// showed the runtime's flags; without the examples they guessed --allowedTools, which does not restrict, hence the refusal list.
import { spawnSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve, relative, join } from 'node:path'
import { parseDoc, findProjectRoot, type Link, type Doc } from '@silmari/core'

/** What sil has to know about one runtime CLI. Everything else about the command line belongs to the caller. */
export interface Adapter {
  /** Executable name */
  exe: string
  /** Base arguments. `{prompt}` is replaced by the assembled prompt. Includes machine-readable output and the start-file switch. */
  base: string[]
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
  /** Reads one output event. Returns what it found; fields it cannot know stay undefined. */
  read: (ev: Record<string, unknown>) => { tools?: string[]; model?: string; used?: string[]; result?: string }
}

export const ADAPTERS: Record<string, Adapter> = {
  claude: {
    exe: 'claude',
    // --setting-sources user: no CLAUDE.md injection (measured: self-report, token count and a behavioural rule all agree)
    base: ['-p', '{prompt}', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'user'],
    toolsFlags: ['--tools', '--disallowedTools', '--disallowed-tools'], modelFlags: ['--model'],
    rejected: { '--allowedTools': 'does not restrict tools; it only pre-approves permissions. Use --tools <Tool,Tool>.', '--allowed-tools': 'does not restrict tools; it only pre-approves permissions. Use --tools <Tool,Tool>.' },
    enforcement: 'tool-removal', verifies: true,
    example: 'sil run claude --step flow.md#1 --send posting=@posting.md --model haiku --tools Read,Bash',
    read: (ev) => {
      const out: ReturnType<Adapter['read']> = {}
      const msg = ev.message as { model?: string; content?: { type: string; name?: string }[] } | undefined
      if (ev.type === 'system' && ev.subtype === 'init') out.tools = (ev.tools as string[]) ?? []
      if (ev.type === 'assistant' && msg) { out.model = msg.model; out.used = (msg.content ?? []).filter((c) => c.type === 'tool_use').map((c) => c.name ?? '?') }
      if (ev.type === 'result') out.result = String(ev.result ?? '')
      return out
    },
  },
  codex: {
    exe: 'codex',
    // -c project_doc_max_bytes=0: no AGENTS.md injection (measured). --skip-git-repo-check: a flow folder need not be a repository
    base: ['exec', '--json', '--skip-git-repo-check', '-c', 'project_doc_max_bytes=0', '{prompt}'],
    toolsFlags: ['-s', '--sandbox'], modelFlags: ['-m', '--model'],
    rejected: {},
    enforcement: 'os-sandbox', verifies: false,
    example: 'sil run codex --step flow.md#1 --send posting=@posting.md -m gpt-5.4-mini -s read-only',
    read: (ev) => {
      const out: ReturnType<Adapter['read']> = {}
      const item = ev.item as { type?: string; text?: string } | undefined
      if (ev.type === 'item.completed' && item?.type === 'agent_message') out.result = item.text ?? ''
      if (ev.type === 'item.completed' && item?.type === 'command_execution') out.used = ['shell']
      return out
    },
  },
}

export const runUsage = (): string => `sil run <runtime> --step <flow.md>#<N> --send <name>=<value> … [runtime flags]

  Starts step N of the flow as a subagent through that runtime's CLI. sil reads --step and --send; every other argument
  goes to the runtime unchanged. Put the model named by {{#…}} and the tools named by {{+…}} in the runtime's own flags.
    --send name=value      a value for a {{>name}} on the call line        --send name=@file   the file's content
    --dry-run              print the command that would run, and stop      --prompt-only       print the assembled prompt

  What --send takes, by the hint on that name in the called document's {{>…}} list (checked before anything starts):
    none or (text)   the value itself, or @file for a file's content     --send tone=formal   --send note=@memo.md
    (json)           a JSON string, typed or @file; refused when it does not parse     --send options='{"depth": 2}'
    (path)           the path itself, relative to the flow file; must exist; never @   --send spec=docs/design.md
  Every value lands in the prompt as it is. A (path) lands as the path string; the subagent opens it with its own tools.

  Runtimes and the flags that restrict tools (a flag that only pre-approves permissions is refused):
${Object.entries(ADAPTERS).map(([n, a]) => `    ${n.padEnd(8)} ${a.example}\n${''.padEnd(13)}tools: ${a.toolsFlags.join(' / ')} · model: ${a.modelFlags.join(' / ')} · enforcement: ${a.enforcement} · ${a.verifies ? 'verified from the output' : 'not verifiable from the output'}`).join('\n')}
`

const fail = (msg: string): number => { process.stderr.write(`sil run: ${msg}\n`); return 1 }
const hasFlag = (args: string[], flags: string[]) => args.some((a) => flags.some((f) => a === f || a.startsWith(f + '=')))
const flagValue = (args: string[], flags: string[]): string | undefined => {
  for (let i = 0; i < args.length; i++) for (const f of flags) { if (args[i] === f) return args[i + 1]; if (args[i].startsWith(f + '=')) return args[i].slice(f.length + 1) }
  return undefined
}

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
  if (!ad) return fail(`unknown runtime "${rt}". Known: ${Object.keys(ADAPTERS).join(', ')}. Installed: ${Object.entries(ADAPTERS).filter(([, a]) => installed(a.exe)).map(([n]) => n).join(', ') || 'none'}`)
  if (argv[1] === '--help' || argv[1] === '-h') { process.stdout.write(runUsage()); return 0 }
  let step: string | undefined; const sends = new Map<string, { value: string; fromFile: boolean }>(); const rest: string[] = []
  let dry = false, promptOnly = false
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--step' && i + 1 < argv.length) { step = argv[++i]; continue }
    if (a.startsWith('--step=')) { step = a.slice(7); continue }
    if (a === '--send' || a.startsWith('--send=')) {
      const kv = a === '--send' ? argv[++i] : a.slice(7)
      if (kv === undefined || !kv.includes('=')) return fail(`--send expects name=value, got: ${kv ?? '(nothing)'}`)
      const k = kv.slice(0, kv.indexOf('=')), v = kv.slice(kv.indexOf('=') + 1)
      if (v.startsWith('@')) { if (!existsSync(v.slice(1))) return fail(`--send ${k}: file not found: ${v.slice(1)}`); sends.set(k, { value: readFileSync(v.slice(1), 'utf8'), fromFile: true }) }
      else sends.set(k, { value: v, fromFile: false })
      continue
    }
    if (a === '--dry-run') { dry = true; continue }
    if (a === '--prompt-only') { promptOnly = true; continue }
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
  // The called document: its body is the prompt, its contract types are checked
  const targetAbs = resolve(flowDir, link.target.split('#')[0])
  if (!existsSync(targetAbs)) return fail(`called file not found: ${link.target}`)
  const target = parseDoc(relative(flowDir, targetAbs), readFileSync(targetAbs, 'utf8'))
  for (const [k, s] of sends) {
    const t = target.contractTypes[k]
    if (t === 'path') {
      if (s.fromFile) return fail(`${k} is a (path) input: pass the path itself (--send ${k}=some/file), not @file`)
      if (!existsSync(resolve(flowDir, s.value))) return fail(`${k} is a (path) input but no file or folder exists at: ${s.value}`)
    }
    if (t === 'json') { try { JSON.parse(s.value) } catch { return fail(`${k} is a (json) input but the value is not valid JSON`) } }
  }
  const body = stripFrontmatter(readFileSync(targetAbs, 'utf8')).trim()
  const prompt = [
    'This session runs one isolated step of a flow. The document below and the values after it are everything this step needs.',
    '', body, '', '## Values for this run',
    ...[...sends].map(([k, s]) => `- ${k}:\n${s.value}`),
    '', '## Reply format', `Reply with only a JSON object whose keys are: ${link.returns.join(', ') || 'result'}`, '',
  ].join('\n')
  if (promptOnly) { process.stdout.write(prompt); return 0 }
  const cmd = [ad.exe, ...ad.base.map((x) => (x === '{prompt}' ? prompt : x)), ...rest]
  const shown = cmd.map((x) => (x === prompt ? '"<prompt>"' : x)).join(' ')
  if (dry) { process.stdout.write(shown + '\n'); return 0 }
  if (!installed(ad.exe)) return fail(`${ad.exe} is not installed. Installed runtimes: ${Object.entries(ADAPTERS).filter(([, a]) => installed(a.exe)).map(([n]) => n).join(', ') || 'none'}`)
  // Records live under the project's .sil/run/. An identical repeat (same step, values, flags, and called document) is answered from the cache
  const root = findProjectRoot(flowDir) ?? flowDir
  const runDir = join(root, '.sil', 'run'); mkdirSync(join(runDir, 'cache'), { recursive: true })
  const key = createHash('sha1').update(JSON.stringify([rt, flow.rel, num, [...sends].map(([k, s]) => [k, s.value]), rest, target.hash])).digest('hex').slice(0, 16)
  const cachePath = join(runDir, 'cache', `${key}.json`)
  process.stderr.write(`→ ${link.target} · ${rt} · ${rest.join(' ') || '(no flags)'} · enforcement ${ad.enforcement} · ${ad.verifies ? 'verified from the output' : 'unverified: this runtime does not report the tools or model it used'}\n`)
  if (existsSync(cachePath)) { const c = JSON.parse(readFileSync(cachePath, 'utf8')) as { out: unknown; ran: string }; process.stderr.write(`· cached from ${c.ran}; nothing ran\n`); process.stdout.write(JSON.stringify(c.out) + '\n'); return 0 }
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-step${num}`
  mkdirSync(join(runDir, id), { recursive: true })
  const streamFile = createWriteStream(join(runDir, id, 'stream.jsonl'))
  const child = spawn(cmd[0], cmd.slice(1), { cwd: flowDir, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDECODE')) as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  let given: string[] | undefined, model: string | undefined, result: string | undefined; const used: string[] = []; let stderr = ''; let aborted: string | null = null
  const wanted = flagValue(rest, ['--tools'])?.split(/[,\s]+/).filter(Boolean)
  child.stderr.on('data', (d) => { stderr += String(d) })
  let buf = ''
  child.stdout.on('data', (d) => {
    buf += String(d)
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1); streamFile.write(line + '\n')
      let ev: Record<string, unknown>; try { ev = JSON.parse(line) } catch { continue }
      const r = ad.read(ev)
      if (r.tools) {
        given = r.tools
        // Claude Code lists the tools it gave the model. If the list is not what --tools asked for, stop before the model does anything
        if (wanted && (given.length !== wanted.length || given.some((t) => !wanted.includes(t)))) { aborted = `the runtime gave the model tools [${given.join(', ')}] but --tools asked for [${wanted.join(', ')}]. Aborting.`; child.kill() }
      }
      if (r.model) model = r.model
      if (r.used) used.push(...r.used)
      if (r.result !== undefined) result = r.result
    }
  })
  const code: number = await new Promise((res) => child.on('close', (c) => res(c ?? 1)))
  streamFile.end()
  if (aborted) return fail(aborted)
  if (result === undefined) return fail(`${rt} exited with code ${code} and no result. ${stderr.trim().slice(0, 400)}`)
  const out = extractJson(result, link.returns)
  const meta = { runtime: rt, flow: flow.rel, step: num, heading, target: link.target, sends: [...sends.keys()], flags: rest, enforcement: ad.enforcement, verified: ad.verifies && given !== undefined, toolsGiven: given ?? null, model: model ?? null, toolCalls: used, ran: new Date().toISOString() }
  writeFileSync(join(runDir, id, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
  writeFileSync(cachePath, JSON.stringify({ out, ran: id }) + '\n')
  process.stderr.write(`· ran as ${model ?? '(model not reported)'} · tools given ${given ? `[${given.join(', ')}]` : '(not reported)'} · tool calls [${used.join(', ')}] · record .sil/run/${id}\n`)
  process.stdout.write(JSON.stringify(out) + '\n')
  return 0
}

const installed = (exe: string) => spawnSync('which', [exe], { encoding: 'utf8' }).status === 0
const stripFrontmatter = (src: string) => { const l = src.split('\n'); if (l[0] !== '---') return src; const e = l.indexOf('---', 1); return e < 0 ? src : l.slice(e + 1).join('\n') }
/** The reply should be a JSON object with the received names as keys. When it is not, the whole text becomes the first received value */
function extractJson(text: string, returns: string[]): Record<string, unknown> {
  const m = /\{[\s\S]*\}/.exec(text)
  if (m) { try { const o = JSON.parse(m[0]) as Record<string, unknown>; if (o && typeof o === 'object' && !Array.isArray(o)) return o } catch { /* fall through */ } }
  return { [returns[0] ?? 'result']: text.trim() }
}
