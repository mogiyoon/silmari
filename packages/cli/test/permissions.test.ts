import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, delimiter } from 'node:path'
import { ADAPTERS } from '../src/run.ts'

const MAIN = resolve(import.meta.dirname, '../src/main.ts')
const FLOW = '# Flow\n\n## 1. Check ((use a subagent via sil run))\nCall [worker](worker.md) and receive {{<report}}. Use {{+bash}}. APPROVALS\n'
const fixture = () => {
  const d = mkdtempSync(resolve(tmpdir(), 'sil-permissions-'))
  mkdirSync(resolve(d, '.sil')); mkdirSync(resolve(d, 'bin'))
  writeFileSync(resolve(d, '.sil/config.yaml'), 'entry: [flow.md]\n')
  writeFileSync(resolve(d, 'worker.md'), '# Worker\n\n## {{<Outputs}}\n- report\n')
  const flow = (declarations: string) => writeFileSync(resolve(d, 'flow.md'), FLOW.replace('APPROVALS', declarations))
  flow('{{!프로젝트 python 스크립트}} {{!git status}}')
  const run = (rt: string, flags: string[], mode = '') => spawnSync(process.execPath, ['--experimental-strip-types', MAIN, 'run', rt, '--step', 'flow.md#1', ...flags], { cwd: d, encoding: 'utf8', env: { ...process.env, PATH: `${resolve(d, 'bin')}${delimiter}${process.env.PATH}`, FAKE_MODE: mode } })
  return { d, flow, run }
}

test('approvals require the declaration and runtime rules, and never satisfy tool limits; Codex refuses command scopes', () => {
  const { d, flow, run } = fixture()
  try {
    assert.match(run('claude', ['--tools', 'Bash', '--dry-run']).stderr, /no approval rules/)
    assert.match(run('claude', ['--allowedTools', 'Bash(python:*)', '--dry-run']).stderr, /no tools flag/)
    for (const flag of ['--allowedTools', '--allowed-tools']) {
      const ok = run('claude', ['--tools=Bash', `${flag}=Bash(python:*),Bash(git status:*)`, '--dry-run'])
      assert.equal(ok.status, 0, ok.stderr); assert.match(ok.stdout, /--strict-mcp-config/)
    }
    assert.equal(run('claude', ['--tools', 'Bash', '--allowedTools', 'Bash(python:*) Bash(git status:*)', '--dry-run']).status, 0)
    assert.match(run('codex', ['-s', 'workspace-write', '--dry-run']).stderr, /cannot enforce a per-command approval allowlist/)
    assert.match(run('claude', ['--tools', 'Bash', '--allowedTools', 'Bash(python:*)', '--permission-mode=bypassPermissions', '--dry-run']).stderr, /bypasses all approvals/)
    flow('')
    for (const flag of ['--allowedTools', '--allowed-tools']) {
      const refused = run('claude', ['--tools', 'Bash', `${flag}=Bash(python:*)`, '--dry-run'])
      assert.equal(refused.status, 1); assert.match(refused.stderr, /declaration on this call is required/)
    }
    assert.equal(run('codex', ['-s', 'workspace-write', '--dry-run']).status, 0)
    const dry = run('claude', ['--tools', 'Read', 'Bash', '--strict-mcp-config', '--dry-run'])
    assert.equal(dry.status, 0); assert.equal(dry.stdout.match(/--strict-mcp-config/g)?.length, 1)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('Claude streams: successful worker reports with denials fail, persist commands and never cache; MCP strict flag is sent', { skip: process.platform === 'win32' }, () => {
  const { d, flow, run } = fixture()
  writeFileSync(resolve(d, 'bin/claude'), `#!${process.execPath}
const fs = require('node:fs')
if (process.argv.includes('--version')) process.exit(0)
process.stdin.resume().on('end', () => {
  const args = process.argv.slice(2), mode = process.env.FAKE_MODE
  fs.writeFileSync('.sil/args.json', JSON.stringify(args))
  const emit = e => console.log(JSON.stringify(e))
  const tools = args.includes('--strict-mcp-config') ? ['Read', 'Bash'] : ['Read', 'Bash', 'mcp__claude_ai_Claude_Docs__search']
  emit({ type: 'system', subtype: 'init', tools })
  emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'python -m patterns.melee_check 12' } }] } })
  if (mode === 'tool-denial') emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', is_error: true, content: 'Permission denied' }] } })
  if (mode === 'command-error') emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', is_error: true, content: 'SyntaxError: invalid syntax' }] } })
  emit({ type: 'result', subtype: 'success', result: '{"report":"worker claims success"}', permission_denials: mode === 'denial' ? [{ tool_name: 'Bash', tool_use_id: 'tool-1', tool_input: { command: 'git status' } }] : [] })
})
`, { mode: 0o755 })
  const flags = ['--tools', 'Read,Bash', '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash(python:*)', 'Bash(git status:*)']
  const metas = () => readdirSync(resolve(d, '.sil/run')).filter((n) => n !== 'cache').map((n) => JSON.parse(readFileSync(resolve(d, '.sil/run', n, 'meta.json'), 'utf8')))
  try {
    for (const mode of ['denial', 'tool-denial', 'denial']) {
      const bad = run('claude', flags, mode)
      assert.equal(bad.status, 1, bad.stderr); assert.equal(bad.stdout, '')
      assert.match(bad.stderr, /permission denials: Bash\((?:git status|python -m patterns.melee_check 12)\)/)
      assert.match(bad.stderr, /Not cached; record/)
      assert.equal(readdirSync(resolve(d, '.sil/run/cache')).length, 0)
    }
    const first = metas()[0]
    assert.deepEqual(first.approvalDeclarations, ['프로젝트 python 스크립트', 'git status'])
    assert.deepEqual(first.approved, ['Bash(python:*)', 'Bash(git status:*)'])
    assert.equal(first.exitCode, 1); assert.equal(first.runtimeExitCode, 0)
    assert.equal(first.permissionDenials.length, 1); assert.equal(first.strictMcpConfig, true)
    const ok = run('claude', flags, 'command-error')
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(ok.stderr.split('\n').find((line) => line.startsWith('→')) ?? '', /approved: \["Bash\(python:\*\)","Bash\(git status:\*\)"\].*MCP: --strict-mcp-config/)
    assert.deepEqual(JSON.parse(ok.stdout), { report: 'worker claims success' })
    assert.ok(JSON.parse(readFileSync(resolve(d, '.sil/args.json'), 'utf8')).includes('--strict-mcp-config'))
    assert.match(run('claude', flags, 'denial').stderr, /cached from/)
    // Changing just the declaration changes the cache key, even when the translated flags stay the same.
    flow('{{!다른 python 범위}} {{!git status}}')
    assert.equal(run('claude', flags, 'denial').status, 1)
    flow('')
    const none = run('claude', ['--tools', 'Read,Bash'], 'tool-denial')
    assert.equal(none.status, 1); assert.match(none.stderr, /→ .*approved: none/)
    // A runtime that still injects MCP tools must fail validation; sil never silently ignores them.
    const fake = readFileSync(resolve(d, 'bin/claude'), 'utf8').replace("args.includes('--strict-mcp-config')", 'false')
    writeFileSync(resolve(d, 'bin/claude'), fake)
    const mismatch = run('claude', ['--tools', 'Read,Bash'])
    assert.equal(mismatch.status, 1); assert.match(mismatch.stderr, /runtime gave the model tools.*mcp__/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('Codex command denials are distinguished from command errors and worker prose', () => {
  const read = ADAPTERS.codex.read
  assert.deepEqual(read({ type: 'item.completed', item: { type: 'command_execution', command: 'git status', aggregated_output: 'command rejected by user', status: 'failed' } }).denied, [{ tool: 'shell', command: 'git status' }])
  assert.equal(read({ type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'SyntaxError', status: 'failed' } }).denied, undefined)
  assert.equal(read({ type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'permission denied', status: 'completed', exit_code: 0 } }).denied, undefined, 'reading a log that mentions a denial is not itself a denial')
  assert.equal(read({ type: 'item.completed', item: { type: 'agent_message', text: 'permission denied' } }).denied, undefined)
})

test('Claude tool-result denial messages are detected without inspecting a worker report', () => {
  for (const content of ['Permission was denied', "Claude requested permissions to use Bash, but you haven't granted it yet.", 'This tool use was rejected.']) {
    const event = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'id', is_error: true, content }] } }
    assert.equal(ADAPTERS.claude.read(event).denied?.length, 1, content)
  }
  assert.equal(ADAPTERS.claude.read({ type: 'result', subtype: 'success', result: 'permission denied' }).denied, undefined)
})

test('Codex denial plus a successful report exits nonzero and is not cached', { skip: process.platform === 'win32' }, () => {
  const { d, flow, run } = fixture()
  flow('')
  writeFileSync(resolve(d, 'bin/codex'), `#!${process.execPath}
if (process.argv.includes('--version')) process.exit(0)
process.stdin.resume().on('end', () => {
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'python -m patterns.melee_check', status: 'declined', aggregated_output: '' } }))
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"report":"done"}' } }))
})
`, { mode: 0o755 })
  try {
    for (let i = 0; i < 2; i++) {
      const bad = run('codex', ['-s', 'workspace-write'])
      assert.equal(bad.status, 1, bad.stderr); assert.equal(bad.stdout, '')
      assert.match(bad.stderr, /permission denials: shell\(python -m patterns.melee_check\)/)
      assert.match(bad.stderr, /Not cached/)
    }
    assert.equal(readdirSync(resolve(d, '.sil/run/cache')).length, 0)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('live Claude: the declared python module runs without an approval prompt', { skip: process.env.SIL_TEST_CLAUDE !== '1' && 'set SIL_TEST_CLAUDE=1 with Claude login and python3 available' }, () => {
  const { d, flow } = fixture()
  flow('{{!python3 verification module}}')
  writeFileSync(resolve(d, 'worker.md'), '# Worker\n\nRun exactly `python3 -m sil_permission_probe` using Bash once, then return stdout as report.\n\n## {{<Outputs}}\n- report\n')
  writeFileSync(resolve(d, 'sil_permission_probe.py'), 'from pathlib import Path\nPath("proof.txt").write_text("approved")\nprint("SIL_APPROVAL_PROBE_OK")\n')
  try {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', MAIN, 'run', 'claude', '--step', 'flow.md#1', '--model', 'haiku', '--tools', 'Bash', '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash(python3:*)', '--max-turns', '3', '--max-budget-usd', '0.25'], { cwd: d, encoding: 'utf8', timeout: 60000, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDECODE')) })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(resolve(d, 'proof.txt'), 'utf8'), 'approved')
    assert.match(result.stdout, /SIL_APPROVAL_PROBE_OK/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
