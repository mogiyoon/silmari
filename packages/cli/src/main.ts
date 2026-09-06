#!/usr/bin/env node
// sil. Design §7.7. init · lint · view.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { findProjectRoot } from '@silmari/core'
import { lint } from './lint.ts'
import { init } from './init.ts'
import { view } from './view.ts'

// The bundle gets the version from package.json at build time (esbuild define); the source run reads the file
declare const __SIL_VERSION__: string | undefined
const version = (): string => {
  if (typeof __SIL_VERSION__ === 'string') return __SIL_VERSION__
  try { return (JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string }).version } catch { return '0.0.0' }
}

// Arguments: `--key=value`, `--key value`, or a bare `--flag`. Short forms -h and -v
const VALUE_FLAGS = new Set(['entry', 'lang', 'port', 'out'])
const argv = process.argv.slice(2)
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
                    "Start the silmari migration?". Generated text is English; the user's language (--lang, else the locale) is
                    recorded in the config and agents are told to write in it.
                      --entry=file.md   entry point        --lang=ko   language the agents write in
  lint [dir]        Checks the md files and prints the problems. Exit code 0; with --strict, 1 when there is an error.
                    Without dir: the nearest folder above the current one that has .sil/, else the current folder
                      --strict          exit 1 on error    --json      print the graph and diagnostics as JSON
  view [dir]        Graph viewer. Starts a local server and opens the browser; redraws when an md file changes
                      --port=4141       next free port if taken       --no-open   do not open the browser
                      --out=file.html   one HTML file, no server

  -h, --help        this text          -v, --version   print the version

Docs: https://github.com/mogiyoon/silmari
`

// process.exit() cuts off piped stdout. Use exitCode.
if (flags.has('version') || cmd === 'version') { process.stdout.write(`${version()}\n`) }
else if (flags.has('help') || cmd === 'help') { process.stdout.write(usage) }
else switch (cmd) {
  case 'init': process.exitCode = init(args[0] ?? '.', { entry: opt('entry'), lang: opt('lang') }); break
  case 'lint': process.exitCode = lint(project(), { strict: flags.has('strict'), json: flags.has('json') }); break
  case 'view': process.exitCode = view(project(), { port: opt('port') ? Number(opt('port')) : undefined, out: opt('out'), open: !flags.has('no-open') }); break
  default: process.stdout.write(usage); process.exitCode = cmd ? 2 : 0
}
