// Finding and starting a runtime without `which` or a shell. The Windows cases run on any platform: the lookup and the cmd.exe line take the
// platform, PATH and a file check as arguments.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findExecutable, commandLine } from '../src/spawn.ts'

test('findExecutable on Windows: PATH walked with PATHEXT, quoted entries, a case-insensitive Path; the extensionless npm sh script is skipped', () => {
  const files = new Set(['C:\\npm\\claude', 'C:\\Program Files\\nodejs\\claude.CMD', 'C:\\tools\\codex.exe', 'C:\\tools\\x.ps1'])
  const has = (p: string) => [...files].some((f) => f.toLowerCase() === p.toLowerCase()) // Windows file names are case-insensitive
  const env = { Path: 'C:\\npm;"C:\\Program Files\\nodejs";C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' }
  assert.equal(findExecutable('claude', env, 'win32', has), 'C:\\Program Files\\nodejs\\claude.CMD', 'claude (a sh script) in C:\\npm cannot run on Windows; the .CMD is found')
  assert.equal(findExecutable('codex', env, 'win32', has), 'C:\\tools\\codex.EXE', 'codex.exe, named with the PATHEXT spelling')
  assert.equal(findExecutable('x.ps1', env, 'win32', has), 'C:\\tools\\x.ps1', 'a name that has an extension is tried as it is')
  assert.equal(findExecutable('gemini', env, 'win32', has), null)
  assert.equal(findExecutable('claude', { PATH: 'C:\\Program Files\\nodejs' }, 'win32', has), 'C:\\Program Files\\nodejs\\claude.CMD', 'without PATHEXT the Windows default applies')
})

test('findExecutable on POSIX: the first PATH entry that has the file', () => {
  const files = new Set(['/usr/local/bin/claude', '/home/u/.local/bin/claude'])
  assert.equal(findExecutable('claude', { PATH: '/home/u/.local/bin:/usr/local/bin' }, 'linux', (p) => files.has(p)), '/home/u/.local/bin/claude')
  assert.equal(findExecutable('claude', { PATH: '/usr/bin' }, 'darwin', (p) => files.has(p)), null)
  assert.equal(findExecutable('/usr/local/bin/claude', {}, 'linux', (p) => files.has(p)), '/usr/local/bin/claude', 'a path is not looked up on PATH')
})

test('commandLine: an .exe or a POSIX file starts directly; a .cmd runs through cmd.exe with each argument quoted and its metacharacters escaped', () => {
  assert.deepEqual(commandLine('C:\\tools\\codex.exe', ['exec', '-'], 'win32'), { file: 'C:\\tools\\codex.exe', args: ['exec', '-'], options: {} })
  assert.deepEqual(commandLine('/usr/bin/claude.cmd', ['-p'], 'linux'), { file: '/usr/bin/claude.cmd', args: ['-p'], options: {} })
  const c = commandLine('C:\\Program Files\\nodejs\\claude.cmd', ['-p', '--tools', 'Read,Bash', 'a "b" & c'], 'win32', 'C:\\Windows\\system32\\cmd.exe')
  assert.equal(c.file, 'C:\\Windows\\system32\\cmd.exe')
  assert.deepEqual(c.options, { windowsVerbatimArguments: true })
  assert.deepEqual(c.args.slice(0, 3), ['/d', '/s', '/c'])
  assert.equal(c.args[3], '"C:\\Program^ Files\\nodejs\\claude.cmd ^"-p^" ^"--tools^" ^"Read^,Bash^" ^"a^ \\^"b\\^"^ ^&^ c^""')
  const shim = commandLine('C:\\p\\node_modules\\.bin\\claude.cmd', ['a&b'], 'win32', 'cmd.exe')
  assert.equal(shim.args[3], '"C:\\p\\node_modules\\.bin\\claude.cmd ^^^"a^^^&b^^^""', 'a node_modules\\.bin shim passes arguments through cmd twice, so they are escaped twice')
})
