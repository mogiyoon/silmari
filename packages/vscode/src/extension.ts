// silmari VS Code extension. S11 (configurationDefaults is in package.json) + S12 (Diagnostic) + graph webview.
import * as vscode from 'vscode'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { findProjectRoot } from '@silmari/core'
import { graphWithOverride, byFile, toLineCol, yieldToVscode } from './diagnose.ts'

const EXCLUDE = ['node_modules', '.sil', '.git']
let collection: vscode.DiagnosticCollection
let panel: vscode.WebviewPanel | undefined
let timer: ReturnType<typeof setTimeout> | undefined

const SEV = { error: vscode.DiagnosticSeverity.Error, warning: vscode.DiagnosticSeverity.Warning, info: vscode.DiagnosticSeverity.Information } as const

function readText(p: string): string | null { try { return readFileSync(p, 'utf8') } catch { return null } }

/** The project the file belongs to: the nearest folder above it with `.sil/`, never above the workspace folder. Without one, the
 *  workspace folder itself. So a silmari project inside a bigger repository (even one the repository's .gitignore hides) is scanned as its own */
function rootOf(doc?: vscode.TextDocument): string | undefined {
  const ws = (doc && vscode.workspace.getWorkspaceFolder(doc.uri)) ?? vscode.workspace.workspaceFolders?.[0]
  if (!ws) return undefined
  const from = doc && doc.uri.scheme === 'file' ? dirname(doc.uri.fsPath) : ws.uri.fsPath
  return findProjectRoot(from, ws.uri.fsPath) ?? ws.uri.fsPath
}
const rel = (root: string, uri: vscode.Uri) => relative(root, uri.fsPath).split(sep).join('/')

function refresh(active?: vscode.TextDocument) {
  const root = rootOf(active)
  if (!root) return
  const override = active && active.languageId === 'markdown' && !active.uri.fsPath.includes(`${sep}node_modules${sep}`)
    ? { rel: rel(root, active.uri), text: active.getText() } : undefined
  let graph
  try { graph = graphWithOverride(root, EXCLUDE, override) }
  catch (e) { console.error('silmari', e); return }

  // When built-in VS Code link validation is active through configurationDefaults, let it handle missing files and anchors in open files.
  const md = vscode.workspace.getConfiguration('markdown')
  const on = md.get<boolean>('validate.enabled') === true
  const yieldOpt = { fileLinks: on && md.get<string>('validate.fileLinks.enabled') !== 'ignore', fragmentLinks: on && md.get<string>('validate.fragmentLinks.enabled') !== 'ignore' }
  const open = new Set(vscode.workspace.textDocuments.filter((t) => t.languageId === 'markdown').map((t) => t.uri.fsPath))

  collection.clear()
  for (const [file, ds] of byFile(graph)) {
    const fsPath = join(root, file)
    const uri = vscode.Uri.file(fsPath)
    const shown = open.has(fsPath) ? yieldToVscode(ds, yieldOpt) : ds
    if (!shown.length) continue
    const text = override && fsPath === active!.uri.fsPath ? override.text : readText(fsPath)
    collection.set(uri, shown.map((d) => {
      const line = Math.max(0, d.line - 1)
      let range = new vscode.Range(line, 0, line, 1e4)
      if (d.range && text !== null) { const a = toLineCol(text, d.range.start), b = toLineCol(text, d.range.end); range = new vscode.Range(a.line, a.col, b.line, b.col) }
      const diag = new vscode.Diagnostic(range, d.message, SEV[d.severity])
      diag.code = d.code; diag.source = 'silmari'
      return diag
    }))
  }
  if (panel) panel.webview.postMessage({ type: 'graph', graph })
}

function schedule(doc?: vscode.TextDocument) {
  clearTimeout(timer)
  timer = setTimeout(() => refresh(doc), 250)
}

function openGraph(context: vscode.ExtensionContext) {
  if (panel) { panel.reveal(); return }
  panel = vscode.window.createWebviewPanel('silmari.graph', 'silmari graph', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true })
  const html = readFileSync(join(context.extensionPath, 'dist', 'viewer.html'), 'utf8')
  // The viewer does not poll /graph. It receives IR through postMessage.
  const root = rootOf(vscode.window.activeTextEditor?.document)
  const layFile = root ? join(root, '.sil', 'layout.json') : null
  const lay = layFile && existsSync(layFile) ? readFileSync(layFile, 'utf8').replace(/</g, '\\u003c') : 'null'
  // Layout save path: webview → extension → .sil/layout.json (only when .sil exists).
  panel.webview.onDidReceiveMessage((m: { type?: string; saved?: unknown }) => {
    if (m?.type === 'layout' && layFile && existsSync(join(root!, '.sil'))) { try { writeFileSync(layFile, JSON.stringify(m.saved)) } catch { /* */ } }
  })
  panel.webview.html = html.replace('</head>', `<script>window.__SIL_GRAPH__=null;window.__SIL_LANG__=${JSON.stringify(vscode.env.language)};window.__SIL_ROOT__=${JSON.stringify(root ?? '')};window.__SIL_LAYOUT__=${lay};(function(){var v=acquireVsCodeApi();window.__SIL_SAVE_LAYOUT__=function(s){v.postMessage({type:'layout',saved:s})}})();window.addEventListener('message',e=>{if(e.data&&e.data.type==='graph'){window.__SIL_LAST__=e.data.graph;window.__SIL_SET__&&window.__SIL_SET__(e.data.graph)}})</script></head>`)
  panel.onDidDispose(() => { panel = undefined })
  refresh(vscode.window.activeTextEditor?.document)
}

export function activate(context: vscode.ExtensionContext) {
  collection = vscode.languages.createDiagnosticCollection('silmari')
  context.subscriptions.push(
    collection,
    vscode.commands.registerCommand('silmari.view', () => openGraph(context)),
    vscode.commands.registerCommand('silmari.lint', () => refresh(vscode.window.activeTextEditor?.document)),
    vscode.workspace.onDidChangeTextDocument((e) => { if (e.document.languageId === 'markdown') schedule(e.document) }),
    vscode.workspace.onDidSaveTextDocument((d) => { if (d.languageId === 'markdown') schedule(d) }),
    // Opening or closing a file changes who checks missing files and anchors. VS Code checks open files. We check the rest.
    vscode.workspace.onDidOpenTextDocument((d) => { if (d.languageId === 'markdown') schedule(d) }),
    vscode.workspace.onDidCloseTextDocument((d) => { if (d.languageId === 'markdown') schedule() }),
    vscode.workspace.onDidCreateFiles(() => schedule()),
    vscode.workspace.onDidDeleteFiles(() => schedule()),
    vscode.workspace.onDidRenameFiles(() => schedule()),
    vscode.window.onDidChangeActiveTextEditor((ed) => { if (ed?.document.languageId === 'markdown') schedule(ed.document) }),
  )
  refresh(vscode.window.activeTextEditor?.document)
}

export function deactivate() { clearTimeout(timer) }
