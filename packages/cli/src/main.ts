#!/usr/bin/env node
// sil. Design §7.7. init · update · migrate · lint · view · run.
import { isMainThread } from 'node:worker_threads'
import { findProjectRoot } from '@silmari/core'
import { lint } from './lint.ts'
import { init, update, migrate } from './init.ts'
import { silVersion as version } from './version.ts'
import { backup } from './backup.ts'
import { view } from './view.ts'
import { run } from './run.ts'


// Arguments: `--key=value`, `--key value`, or a bare `--flag`. Short forms -h and -v
const VALUE_FLAGS = new Set(['entry', 'lang', 'port', 'out'])
const argv = process.argv.slice(2)
// `sil run` owns its own arguments: everything after the runtime name that is not --step/--send goes to that runtime untouched
const isRun = argv[0] === 'run'
const flags = new Map<string, string | true>()
const args: string[] = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '-h') flags.set('help', true)
  else if (a === '-v') flags.set('version', true)
  else if (a.startsWith('--')) {
    const eq = a.indexOf('=')
    if (eq > 0) flags.set(a.slice(2, eq), a.slice(eq + 1))
    else if (VALUE_FLAGS.has(a.slice(2)) && i + 1 < argv.length && !argv[i + 1].startsWith('-')) flags.set(a.slice(2), argv[++i])
    else flags.set(a.slice(2), true)
  } else args.push(a)
}
const cmd = args.shift()
const opt = (k: string): string | undefined => { const v = flags.get(k); return typeof v === 'string' ? v : undefined }
// Without a dir, lint and view work on the project the current folder belongs to: the nearest ancestor with .sil/, else the folder itself
const project = (): string => args[0] ?? findProjectRoot(process.cwd()) ?? '.'

const usage = `sil <command> [dir] [options]

  init [dir]        Creates .sil/config.yaml and SILMARI.md (entry point with a notation summary). Creates the agent start
                    files that are missing (CLAUDE.md · AGENTS.md · GEMINI.md · .github/copilot-instructions.md) and appends
                    a SILMARI.md call to the existing ones; if the project already has md files, also a line that asks
                    "Start the silmari migration?" and writes the migration rules to .sil/migration.md. Generated text is English;
                    the user's language (--lang, else the locale) is recorded in the config and agents are told to write in it.
                      --entry=file.md   entry point        --lang=ko   language the agents write in
  update [dir]      Brings a project that ran an older sil init up to this version: refreshes the generated sections of
                    SILMARI.md (the Flow section and your own sections stay), writes the notes on notation changes since the
                    recorded version to .sil/updates/ with a line in the start files asking the agent to apply and delete them,
                    and records the version in .sil/config.yaml. Running it again changes nothing
  migrate [dir]     Writes .sil/migration.md again and puts the "Start the silmari migration?" line back into the start files,
                    to move documents to the notation later
  backup [dir]      Copies every md file the scan sees to .sil/backups/<time>-manual/, keeping paths. init (with md files),
                    migrate and update take one themselves before handing documents to an agent; the agent takes another
                    right before editing. Nothing is deleted; copy a folder back to undo
  lint [dir]        Checks the md files and prints the problems. Exit code 0; with --strict, 1 when there is an error.
                    Without dir: the nearest folder above the current one that has .sil/, else the current folder
                      --strict          exit 1 on error    --json      print the graph and diagnostics as JSON
  view [dir]        Graph viewer. Starts a local server and opens the browser; redraws when an md file changes
                      --port=4141       next free port if taken       --no-open   do not open the browser
                      --out=file.html   one HTML file, no server
  run <runtime> --step <flow.md>#<N> --send name=value … [runtime flags]
                    Starts step N of a flow as a subagent through that runtime's CLI (claude, codex). Checks the call line,
                    assembles the prompt, passes the flags through, records the run. "sil run --help" lists the runtimes

  -h, --help        this text          -v, --version   print the version

Docs: https://github.com/mogiyoon/silmari
`

// process.exit() cuts off piped stdout. Use exitCode.
// Parse workers run this same file (core's loadDirAsync spawns it as a worker thread); in that case the CLI must not run
if (!isMainThread) { /* worker: core handles it at import time */ }
else if (isRun) { run(argv.slice(1)).then((c) => { process.exitCode = c }) }
else if (flags.has('version') || cmd === 'version') { process.stdout.write(`${version()}\n`) }
else if (flags.has('help') || cmd === 'help') { process.stdout.write(usage) }
else switch (cmd) {
  case 'init': process.exitCode = init(args[0] ?? '.', { entry: opt('entry'), lang: opt('lang') }); break
  case 'update': process.exitCode = update(args[0] ?? '.'); break
  case 'migrate': process.exitCode = migrate(args[0] ?? '.'); break
  case 'backup': process.exitCode = backup(args[0] ?? '.'); break
  case 'lint': lint(project(), { strict: flags.has('strict'), json: flags.has('json') }).then((c) => { process.exitCode = c }); break
  case 'view': view(project(), { port: opt('port') ? Number(opt('port')) : undefined, out: opt('out'), open: !flags.has('no-open') }).then((c) => { process.exitCode = c }); break
  default: process.stdout.write(usage); process.exitCode = cmd ? 2 : 0
}
