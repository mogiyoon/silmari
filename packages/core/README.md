# @silmari/core

**Checks flow and data in md documents and turns them into a graph.** This is the library behind the
[silmari](https://github.com/mogiyoon/silmari) CLI (`sil lint` · `sil view`) and its VS Code extension.

Nothing in this entry point touches a file system, so it runs in a browser as it does in Node: a docs site, a playground page
or a web editor can check documents that were never written to disk. Reading a folder is the second entry point,
`@silmari/core/node`.

```sh
npm i @silmari/core
```

## Documents in, graph out

```js
import { parseDoc, buildGraph, format, summary } from '@silmari/core'

// any set of md documents: the path is the key, the text is the value
const files = {
  'flow.md': '# Review\n\n## 1. Read it ((use a subagent))\n\nCall [read-file](read-file.md) with {{>target}} and receive {{<findings}}.\n\n## {{>Inputs}}\n- target (path)\n\n## {{<Outputs}}\n- findings\n',
  'read-file.md': '# Read file\n\n## {{>Inputs}}\n- target (path)\n\n## {{<Outputs}}\n- findings\n',
}

const graph = buildGraph(new Map(Object.entries(files).map(([path, text]) => [path, parseDoc(path, text)])))

process.stdout.write(graph.diagnostics.length ? format(graph.diagnostics) : 'No problems\n')
process.stdout.write(summary(graph) + '\n')   // files 2 · task 2 · doc 0 · … · call 1 · …
graph.nodes   // the boxes:  id · kind · title · headings · contract · hash
graph.edges   // the arrows: from · to · type · sends · returns · tools · model · isolated
```

`format` and `summary` are the two functions `sil lint` prints with, so a page shows exactly what the terminal shows, and
`Graph` is the same IR `sil view` draws and `sil lint --json` prints.

## `@silmari/core`

| | |
|---|---|
| `parseDoc(path, text)` | one document → `Doc`: title, headings with their bodies and byte ranges, links with their values, contract, anchors, per-file diagnostics |
| `buildGraph(docs, opts?)` | `Map<path, Doc>` → `Graph`: nodes, edges, diagnostics and counts. `opts`: `exists`, `glob`, `entry` |
| `format(diagnostics)` · `summary(graph)` | what `sil lint` prints |
| `resolve(from, target)` · `templateRegex(pattern)` | link resolution, the same rules the graph uses |
| `parseConfig(text)` · `CONFIG_PATH` · `ENTRY_MAIN` · `ENTRY_FILES` · `ENTRY_DIRS` · `isConventionalEntry` | `.sil/config.yaml` and the conventional entry points |
| `addDiagnostics(graph, extra)` · `compareVersions(a, b)` · `UPDATES_DIR` | project-level notes |
| `slug(text)` · `byteOffset(text, index)` | heading anchors (github-slugger) and UTF-16 → UTF-8 byte offsets |
| types | `Graph` · `Node` · `Edge` · `Diagnostic` · `Heading` · `Contract` · `Range` · `NodeKind` · `EdgeType` · `Severity` · `Doc` · `Link` · `Config` |

## `@silmari/core/node`

Everything above, plus the parts that need a file system.

```js
import { loadDir, buildGraph, readConfig, existsIn, globIn, format } from '@silmari/core/node'

const cfg = readConfig(root)
const graph = buildGraph(loadDir(root, cfg.scan.exclude), { exists: existsIn(root), glob: globIn(root), entry: cfg.entry })
```

| | |
|---|---|
| `loadDir(root, exclude?, cache?)` · `loadDirAsync(…)` | walk a folder and parse every md file. Obeys `.gitignore`. The async one spreads parsing over worker threads above 500 pending files |
| `docCache()` · `MIN_PARALLEL` · `ALWAYS_EXCLUDE` | incremental reloads: a file whose mtime and size are unchanged is not parsed again |
| `existsIn(root)` · `globIn(root)` | the `exists` and `glob` callbacks `buildGraph` takes |
| `findProjectRoot(start, stop?)` | the nearest folder above `start` that has `.sil/` |
| `readConfig(root)` · `projectNotes(root, installed, cfg?)` | `.sil/config.yaml`, and L-I06 · L-I07 |
| `writeRange` · `readRange` · `readLink` · `retargetLink` · `replaceBody` · `replaceBodies` · `WriteError` | editing md in place: byte ranges only, backup, atomic write, post-check, and a stale-hash refusal |

## Notes

- The document hash is SHA-1 of the file bytes, computed the same way in both entry points, so a hash taken in a browser is the
  hash `writeRange` checks against the file on disk.
- Diagnostic codes, messages and the graph shape are the CLI's. They move together, not separately.

The notation, the rule list and the graph's controls: [github.com/mogiyoon/silmari](https://github.com/mogiyoon/silmari)

MIT
