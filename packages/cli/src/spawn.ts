// Finding and starting a runtime CLI (claude, codex) the same way on every platform, without a shell and without `which`.
// On Windows `which` exists only inside Git Bash (C:\Program Files\Git\usr\bin), so a server started from PowerShell reported an installed
// claude as missing (2026-09-15). The lookup here walks PATH itself and tries PATHEXT on Windows. What npm installs there is a .cmd shim,
// which spawn refuses to start without a shell since Node 20.12 (CVE-2024-27980): such a file runs through cmd.exe with every argument
// escaped for it, the way cross-spawn does.
import { spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { statSync } from 'node:fs'
import { posix, win32 } from 'node:path'

const isFile = (p: string) => { try { return statSync(p).isFile() } catch { return false } }
/** Environment names are case-insensitive on Windows (`Path`), and a copied env object loses process.env's lookup */
const envGet = (env: NodeJS.ProcessEnv, name: string) => Object.entries(env).find(([k]) => k.toUpperCase() === name)?.[1]

/** The file `exe` resolves to on PATH, or null. On Windows each PATHEXT extension is tried; a bare name is tried only when it already has an
 *  extension, because npm puts an extensionless sh script next to claude.cmd and Windows cannot start it */
export function findExecutable(exe: string, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform, exists: (p: string) => boolean = isFile): string | null {
  const win = platform === 'win32', path = win ? win32 : posix
  const exts = win ? (envGet(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : ['']
  if (win && path.extname(exe)) exts.unshift('')
  const dirs = /[\\/]/.test(exe) ? [''] : (envGet(env, 'PATH') ?? '').split(win ? ';' : ':').map((d) => d.replace(/^"(.*)"$/, '$1')).filter(Boolean)
  for (const d of dirs) for (const e of exts) { const p = d ? path.join(d, exe + e) : exe + e; if (exists(p)) return p }
  return null
}

/** cmd.exe metacharacters, each escaped with ^ (cross-spawn's list) */
const META = /([()\][%!^"`<>&|;, *?])/g

/** How to start `file` with `args`: directly, or through cmd.exe when it is a .cmd or .bat on Windows */
export function commandLine(file: string, args: string[], platform: string = process.platform, comspec: string | undefined = process.env.comspec): { file: string; args: string[]; options: SpawnOptions } {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return { file, args, options: {} }
  // A shim inside node_modules\.bin hands its arguments to cmd once more, so they are escaped twice
  const twice = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(file)
  const quote = (a: string) => {
    const q = `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`.replace(META, '^$1')
    return twice ? q.replace(META, '^$1') : q
  }
  const line = [win32.normalize(file).replace(META, '^$1'), ...args.map(quote)].join(' ')
  return { file: comspec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], options: { windowsVerbatimArguments: true } }
}

/** Whether `file` starts and exits 0 with --version. Being on PATH is not enough: a file there may not run */
export function starts(file: string): boolean {
  const c = commandLine(file, ['--version'])
  return spawnSync(c.file, c.args, { ...c.options, stdio: 'ignore', timeout: 30_000 }).status === 0
}

/** Stops a child and what it started. On Windows kill() ends only the process sil started, which for a .cmd shim is cmd.exe: the runtime kept running */
export function stopTree(child: ChildProcess, platform: string = process.platform): void {
  if (platform === 'win32' && child.pid !== undefined) { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); return }
  child.kill()
}
