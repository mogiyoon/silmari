# Contributing

```sh
pnpm install
pnpm build          # bundles viewer → cli → vscode, in that order
pnpm test           # golden corpus (packages/core/test/fixtures/after) + rule unit tests. Needs Node 22.6+ for --experimental-strip-types
pnpm --filter silmari-vscode package   # packages/vscode/dist/silmari.vsix
```

```
packages/core      parser · IR · lint rules · graph · lint output. @silmari/core runs in a browser; src/node (loadDir · readConfig · writer) is @silmari/core/node
packages/cli       sil — init · lint · view (local server, incremental parsing, gzip, whole-file edit API) · run (runtime adapters: claude, codex)
packages/viewer    React Flow graph: flow map, subtree folding, WebGL + DOM virtualization, label layout, editing, ko/en. vite builds one HTML file
packages/vscode    extension — Diagnostic · graph webview · configurationDefaults
tools/stress.mjs   load-test corpus generator — node tools/stress.mjs <out> [flows] [depth] [fanout]
tools/readme.mjs   builds packages/cli/README.md (the npm page) from this README. `pnpm readme`; the cli tests check it is current
```

`@silmari/core` is published with **pnpm**, not npm: its `exports` points at `src/` so the workspace runs on source, and only
pnpm applies `publishConfig.exports` to repoint it at `dist/` when packing. A `prepack` script refuses an npm pack rather than
let a broken tarball out. `pnpm pack` to look at it, `pnpm publish` to send it.

## Documentation

Keep README.md focused on what silmari does, installation and a first example. Put detailed instructions in `docs/` and link them from the README.

`README.md` is also the source for the npm page. After editing it, run:

```sh
pnpm readme
node tools/readme.mjs --check
```

Comments such as `<!-- npm -->` choose which sections appear on npm. Check relative links and examples from both the repository README and `packages/cli/README.md`.
