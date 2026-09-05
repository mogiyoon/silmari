<p align="center"><img src="assets/silmari-icon.png" width="120" alt="silmari"></p>

<h1 align="center">silmari</h1>
<h3 align="center">Keep your docs talking to each other.</h3>

**Checks the flow and data in md documents and shows them as a graph.**
Agent md files are the source, silmari is the compiler, and AI is the runtime. It is like `tsc`.

```
sil lint    catches missing files, missing anchors, data without a link, references nobody calls   ← compiler
sil view    calls, send/receive, conditions and subagents between documents on one screen        ← graph
```

The VS Code extension marks the same checks with wavy lines as you edit. It opens the graph beside the editor.

## Notation: four things to learn

A standard Markdown link is an edge. Add values after the link with `{{ }}` (the values attach to the link before them in the same paragraph).

```markdown
# Feature work

## 1. Research [use a subagent]
For each target file, call [research](research.md) with {{>target}} and receive {{<findings}}.

## 2. Plan
Call [plan](plan.md) with {{>findings}} and receive {{<plan}}.

## 3. If there are review comments
Call [implement](implement.md) with {{>comments}} and receive {{<changed-files}} again.
```

| Notation | Meaning | For the model |
|---|---|---|
| `[research](research.md)` | Edge. Caller → callee | "Read that file" |
| `{{>plan}}` | Send (parameter) | "Pass this value" |
| `{{<changed-files}}` | Receive (return) | "Keep this value" |
| `## … [use a subagent]` | Calls in that section are isolated. The brackets are the symbol; the words inside can be in any language (`[서브 에이전트 사용]`). In English, use a verb phrase | "Use a subagent" |

Sequence follows line order. A heading (`## If there are review comments`) marks a choice. Show repetition by calling again under a condition ("until") or with "for each". The only symbols are `>` and `<`.
In the called file, the lists under `## Inputs` / `## Steps` / `## Outputs` are the contract (other languages: set the words in `.sil/config.yaml`). There is no frontmatter.

**An md file without notation is not an error.** Adopt it one file at a time. [packages/core/test/fixtures/after](packages/core/test/fixtures/after) is a small complete example in this notation (it doubles as the golden test corpus).

## What it looks like

One flow, fully unfolded. Solid lines are calls that carry values, dashed lines are references, the green box is a reference document, and the purple border marks a subagent call.

![One flow in sil view: the orchestrators on the left call the agents on the right](assets/silmari-graph.png)

The right panel: flows, kinds, the selected node with its prompt (Edit changes heading bodies, Raw edits the whole file), and the diagnostics list.

![The graph with the side panel: a selected orchestrator and its prompt](assets/silmari-graph-window.png)

The same checks in VS Code's Problems panel: a missing file, a missing anchor, and reference documents nobody links to.

![VS Code Problems panel with silmari diagnostics](assets/silmari-lint-error.png)

## Usage

```sh
sil lint            # check the md files in the current folder. --strict exits with code 1 on error
sil view            # local server + browser. Edit ✎ changes prompt bodies heading by heading; Raw ✎ edits the whole file. Both write through the hash-checked writer
sil view --out=g.html   # one HTML file, no server
sil init            # .sil/config.yaml + SILMARI.md (entry point with a notation summary). Creates the missing agent start files (CLAUDE.md · AGENTS.md · GEMINI.md · copilot-instructions) and appends a SILMARI.md call to existing ones. Generated text is English; the user's language (--lang, else the locale) is recorded and agents write in it
```

VS Code: Install the `silmari` extension to see wavy lines while editing md files. Open the graph with **silmari: Show graph** in the command palette. It does not change the user's `settings.json`.

## What it never does

- It does not call a model. Prompts go to the model exactly as written. There is no assembler.
- It does not summarize, rewrite, or normalize the text. It does not delete files.
- It does not create files in other repositories (`sil init` only creates an optional `.sil/config.yaml`).

## Development

```sh
pnpm install
pnpm build          # bundles viewer → cli → vscode, in that order
pnpm test           # golden corpus (packages/core/test/fixtures/after) + rule unit tests
pnpm --filter silmari-vscode package   # packages/vscode/dist/silmari.vsix
```

```
packages/core      parser · IR · lint rules · graph · writer. Pure functions, no IO except loadDir. The reference implementation
packages/cli       sil — init · lint · view (local server, incremental parsing, gzip, whole-file edit API)
packages/viewer    React Flow graph: flow map, subtree folding, WebGL + DOM virtualization, label layout, editing, ko/en. vite builds one HTML file
packages/vscode    extension — Diagnostic · graph webview · configurationDefaults
tools/stress.mjs   load-test corpus generator — node tools/stress.mjs <out> [flows] [depth] [fanout]
```

## License

MIT
