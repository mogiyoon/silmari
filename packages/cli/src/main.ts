#!/usr/bin/env node
// sil. Design §7.7. init · lint · view · split. Currently init · lint.
import { lint } from './lint.ts'
import { init } from './init.ts'
import { view } from './view.ts'

const [cmd, ...rest] = process.argv.slice(2)
const flags = new Set(rest.filter((a) => a.startsWith('--')))
const args = rest.filter((a) => !a.startsWith('--'))

const usage = `sil <command>

  init [dir]        Creates .sil/config.yaml and SILMARI.md (entry point with a notation summary). Creates the agent start
                    files that are missing (CLAUDE.md · AGENTS.md · GEMINI.md · .github/copilot-instructions.md) and appends
                    a SILMARI.md call to the existing ones; if the project already has md files, also a line that asks
                    "Start the silmari migration?". Generated text is English; the user's language (--lang, else the locale) is
                    recorded in the config and agents are told to write in it. --entry=file.md sets the entry point directly
  lint [dir]        Checks the md files. --strict exits with code 1 when there is an error
                    --json prints the graph and diagnostics as JSON
  view [dir]        Graph viewer. Starts a local server and opens the browser
                    --port=4141 (next free port if taken)  --no-open  --out=file.html (a single HTML file, no server)
`
const opt = (k: string) => [...flags].find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3)

// process.exit() cuts off piped stdout. Use exitCode.
switch (cmd) {
  case 'init': process.exitCode = init(args[0] ?? '.', { entry: opt('entry'), lang: opt('lang') }); break
  case 'lint': process.exitCode = lint(args[0] ?? '.', { strict: flags.has('--strict'), json: flags.has('--json') }); break
  case 'view': process.exitCode = view(args[0] ?? '.', { port: opt('port') ? Number(opt('port')) : undefined, out: opt('out'), open: !flags.has('--no-open') }); break
  default: process.stdout.write(usage); process.exitCode = cmd ? 2 : 0
}
