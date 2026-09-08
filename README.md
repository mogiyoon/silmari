<p align="center"><img src="assets/silmari-icon.png" width="120" alt="silmari"></p>

# silmari

**Checks the flow and data in md documents and shows them as a graph.**
Agent md files are the source, silmari is the compiler, and AI is the runtime. It is like `tsc` for the md files that drive your agents.

```
sil lint    missing files, missing anchors, values sent that the callee does not take, references nobody calls   ← compiler
sil view    calls, send/receive, conditions and subagents between documents on one screen                        ← graph
sil run     starts one subagent step through the agent CLI you already have, with its tools and model enforced   ← runner
```

Two principles hold everywhere. **The notation has no language:** every marker is a symbol and the words inside are yours. **It belongs to no AI tool:** any agent reads the documents, and what differs between runtimes (Claude Code, Codex CLI, …) is handled by `sil run`, not by the notation.

The VS Code extension marks the same checks with wavy lines as you edit and opens the graph beside the editor.

## Install
<!-- npm -->

```sh
npm i -g silmari      # gives you the `sil` command
sil --version
sil --help
```

Node 20 or newer. Without installing: `npx silmari lint`.

VS Code: install the **silmari** extension from the marketplace (publisher `mogiyoon`). It ships the same checker and viewer; the CLI is not required.

## Quick start
<!-- npm -->

```sh
cd my-agent-project     # any folder with md files
sil init                # .sil/config.yaml + SILMARI.md, and a line in CLAUDE.md · AGENTS.md · GEMINI.md · copilot-instructions.md that points agents at it
sil lint                # read every md file, print what is wrong
sil view                # open the graph in the browser; it redraws when a file changes
```

`sil init` records your language (`--lang=ko`, else the locale) so agents write SILMARI.md and their replies in it. Nothing is rewritten by silmari itself.

What `sil lint` prints on the [demo corpus](packages/core/test/fixtures/after):

```
✖ review.md:10  L-N01  Linked file not found: review-criteria.md
✖ wrap-up.md:7  L-N09  Anchor not found in the target document: structure.md#rollback

error 2 · warning 0 · info 0
```

`--strict` makes it exit with code 1 on any error, for CI. `--json` prints the whole graph and diagnostics. Options take `--key=value` or `--key value`.

## Migrating existing documents
<!-- npm -->

If the folder already has md files, `sil init` adds one more line to the agent start files. On its next start the agent asks:

```
Start the silmari migration?
```

Say yes and the agent moves the documents to the notation, following the *Migration* section of `SILMARI.md` rule by rule:

- **One agent, one file.** An agent that was a section inside an orchestrator (`### 1. Analyst — tools · model …`) becomes its own md file; the same paragraph names the tools and model in a sentence: `Use the tools {{+read}} and {{+edit}}, and the model {{#fast}}.` No frontmatter.
- **The contract lives in the called file.** Its input/output bullets become lists under `## {{>Inputs}}` / `## {{<Outputs}}` there, not in the caller.
- **Rules travel by link.** A split-out agent document links the rule documents it must follow; subagents receive rules only that way.
- **One call, one line.** Each step of the orchestrator is a heading with a link and its values: `[Analyst](agents/analyst.md) with {{>posting}} and receive {{<analysis}}`. A retry is a heading that states the condition and the bound.
- **Diagrams, pseudocode and transfer tables stay for people.** The parser cannot read them; what they say is copied onto the call lines.
- **Prose stays prose.** Rationale, error handling and examples are left as they are. The notation appears only on lines with calls.
- **It ends with `sil lint` at error 0**, and then the agent deletes the question line from the agent start files, so it is not asked again.

silmari does not touch the files. The agent moves the text; `sil lint` checks the result. To run it again later, tell the agent "start the migration" in a session. What a flow and its called documents look like after the move is the [demo corpus](packages/core/test/fixtures/after).

## Notation: six symbols
<!-- npm -->

A standard Markdown link is an edge. Add values after the link with `{{ }}`; they attach to the link before them in the same paragraph. Link paths work like imports: `plan.md`, `./plan.md`, `../agents/plan.md` are relative to the document, and a leading `/` (`/agents/plan.md`) starts at the project root, the folder with `.sil/`.

```markdown
# Feature work

## 1. Research ((use a subagent via sil run))
For each target file, call [research](research.md) with {{>target}} and receive {{<findings}}.
Use the tool {{+read}} and the model {{#fast}}.

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
| `{{+read}}` | The tools the subagent may use, in your words | "Only these tools" |
| `{{#fast}}` | The model the subagent runs on, in your words | "This model" |
| `## … ((use a subagent via sil run))` | Calls in that section are isolated. The double parentheses are the symbol; the words inside can be in any language (`((서브 에이전트 사용))`) | "Use a subagent" |

Sequence follows line order. A heading (`## If there are review comments`) marks a choice. Show repetition by calling again under a condition ("until") or with "for each".

In the called file, the contract is a list under a heading that is exactly one marker: `## {{>Inputs}}` for inputs, `## {{<Outputs}}` for outputs, at any level and in any words (`### {{>입력}}`). The item name is the first word; `(path)`, `(text)` or `(json)` after it says what kind of value it is. Whatever follows (`— the file to read`) is description for the model. No frontmatter is required; the only key silmari reads is `sil:` / `type: task|doc`, to override the task-or-reference guess.

The hint tells the orchestrator what to put in `--send`, and tells `sil run` what to check before the subagent starts:

| Hint on the item | What to send | Example | `sil run` checks |
|---|---|---|---|
| none, or `(text)` | the value itself, or `@file` for a file's content | `--send tone=formal` · `--send note=@memo.md` | nothing |
| `(json)` | a JSON string, typed or `@file` | `--send options='{"depth": 2}'` | it parses |
| `(path)` | the path itself, relative to the flow file. Never `@` | `--send spec=docs/design.md` | the file or folder exists; `@` is refused |

Every value lands in the prompt as it is, under `## Values for this run`. A `(path)` lands as the path string, and the subagent opens it with its own tools, so the call line needs `{{+read}}` or wider. The subagent cannot tell a typed value from an `@file` one; the difference is only who reads the file. Send content for short values and a path for large ones or several files, so the prompt stays small.

```markdown
## {{>Inputs}}
- spec (path) — the design document. Open it yourself; only the location is given
- options (json) — run options, e.g. {"depth": 2}
- note — a free memo from the caller
```

```sh
sil run claude --step flow.md#1 --send spec=docs/design.md --send 'options={"depth": 2}' --send note=@memo.md --model haiku --tools Read
```

The lint does not check any of this; it only matches names. The checks run in `sil run`, at the moment the values are about to be written into the prompt.

**An md file without notation is not an error.** Adopt it one file at a time. [packages/core/test/fixtures/after](packages/core/test/fixtures/after) is a small complete example (it doubles as the golden test corpus).

## What lint catches
<!-- npm: link -->

| Code | Level | Meaning |
|---|---|---|
| L-N01 | error | Linked file not found |
| L-N09 | error | Anchor not found in the target document |
| L-N03 | error | Reference-style link has no definition |
| L-N04 | error | Invalid value name in `{{ }}` |
| L-N13 | error | `{{ }}` with no link before it to attach to |
| L-N16 | error | The same name is received twice under the same condition |
| L-C01 | warning | Sends values that are not in the callee's inputs |
| L-C02 | warning | Receives values that are not in the callee's outputs |
| L-N14 | warning | Data attached to a reference document (it has no contract) |
| L-G01 | warning | Reference document that nobody links to. A cleanup candidate; never deleted |
| L-G06 | warning | A document is called again without a condition: there is no way out |
| L-N15 | warning | `{{*x}}` is retired notation; write `{{>x}}` and say "for each" in words |
| L-N17 | info | A received value is never used |
| L-N05 | info | A link inside a heading is not an edge |
| L-N06 | info | No H1, or more than one; the file name is used as the title |
| L-I05 | info | Heading label written as `[…]`: write `((…))`, Markdown reads `[ ]` as a reference link |
| L-I04 | info | `[@…]` in a heading label: drop the `@`, models read it as a mention |
| L-N18 | warning | Empty marker: `{{>}}`, `{{+}}`, `(())` — nothing is read from it |
| L-N20 | warning | A heading starts with a contract marker but has more text, so it is not a contract heading |
| L-N21 | warning | Unbalanced parentheses at the end of a heading: a label is `((…))` |
| L-N26 | warning | `{{+…}}` / `{{#…}}` on a call that is not a subagent step have no effect |
| L-N19 | info | A contract heading as H1 |
| L-N22 | info | Called with values but the file declares no contract, so the names cannot be checked |
| L-N23 | info | A sent value is neither received from a call nor declared in the document's contract |
| L-N24 | info | One file is called with different tool sets from different places |
| L-N25 | info | A subagent call names no `{{+tools}}` or `{{#model}}` |

Rules that need a contract or a call only run on documents that have one, so plain Markdown stays quiet. The last line of `sil lint` always shows the kind counts (`task 6 · call 7 …`), so a migration that changed nothing is visible even at error 0.

## Running a step: sil run
<!-- npm -->

The orchestrator (an agent reading the flow) reaches `## 1. Research ((use a subagent via sil run))` and types one line:

```sh
sil run claude --step flow.md#1 --send target=src/a.ts --model haiku --tools Read
sil run codex  --step flow.md#1 --send target=src/a.ts -m gpt-5.4-mini -s read-only
```

`sil` reads only `--step` and `--send`. Everything else goes to that runtime's CLI unchanged; the orchestrator translates `{{#fast}}` and `{{+read}}` into the runtime's own flags. What `sil run` adds: it refuses a step whose heading has no `(( ))`, `--send` names that differ from the `{{>…}}` names, a missing tools or model flag when the call line declares one, a flag that only pre-approves permissions instead of restricting (`--allowedTools`), and a value that does not match its hint (a `(path)` that does not exist or was sent as `@file`, a `(json)` that does not parse; see the table under Notation). It assembles the prompt from the called document, switches the runtime's project start files off so the subagent's rules come only from links, verifies the tool list where the runtime reports it (Claude Code does; Codex does not, and the first line says so), returns the `{{<…}}` values as JSON, records the run under `.sil/run/`, and answers an identical repeat from the cache. Without `sil`, agents start subagents with their own feature: the model is applied, tool limits become a request.

Measured on Claude Code (sonnet, haiku) and Codex CLI: orchestrators typed the line correctly in every run once the Running section showed the runtime's flags, including Korean, Japanese and Chinese words inside the markers; with `--tools` the subagent physically lacked the other tools.

## The graph
<!-- npm: link -->

![One flow in sil view: the orchestrators on the left call the agents on the right](assets/silmari-graph.png)

- **Two scopes.** *Entry flows* starts from what `SILMARI.md` registers: the agent start files (`CLAUDE.md` links `SILMARI.md`, so that edge is real) → the entry document → one box per flow it links. ▸▸ on a box opens that flow alone; a document that another flow also calls carries a `+1 outside` badge, and the diagnostics panel says how many findings the hidden documents hold. *All md files* is the same graph grouped by what links to what. Both are visibility filters over the graph `sil lint --json` prints, so nothing is drawn that is not in the files.
- **Flows.** Documents that link to each other form a flow. In the *All md files* scope, with more than one flow you start on an overview map; open one to see it.
- **Folding.** A flow opens folded to its first level. On a node, ▸ shows its children, ▸▸ everything below it, ◂ folds it again. The rail buttons ▸▸ / ◂◂ do it for the whole flow. The fold state is saved in `.sil/layout.json`.
- **Lines.** Solid lines are calls that carry values; the label shows what is sent and received and the heading the call sits under. Dashed lines are references. A purple border marks a subagent call. Red dashed lines go to files that do not exist.
- **Labels in two orders.** ⌥ puts each label next to the node it goes to; ☰ keeps the document's line order. Toggle on the rail.
- **Selection.** Click a node: its prompt opens on the right, everything except the node and its neighbours fades. Click empty space to clear.
- **Editing.** *Edit ✎* opens every heading body of the selected document (and the documents it calls) as text fields; one Save writes them back, each into its own heading. *Raw ✎* edits the whole file. Both go through a writer that checks the file hash and keeps a backup, and never touches bytes outside what you changed.
- **Scale.** Tens of thousands of documents work: only changed files are re-parsed, the graph is sent gzipped, and past 2,000 visible nodes the far view is drawn with WebGL while the DOM only holds what is on screen.

![The graph with the side panel: a selected orchestrator and its prompt](assets/silmari-graph-window.png)

The same checks in VS Code's Problems panel:

![VS Code Problems panel with silmari diagnostics](assets/silmari-lint-error.png)

## Configuration
<!-- npm -->

`sil init` writes `.sil/config.yaml`. Every key is optional.

```yaml
entry: [flow.md]            # entry documents: drawn first, and orphan checks start from them
lang: en                    # the language agents should write in (recorded by sil init)
scan:
  exclude: [drafts/]        # gitignore syntax, on top of .gitignore itself and .git, node_modules, .sil, .claude/worktrees
```

There is no word list: contract headings are the symbols `{{>…}}` / `{{<…}}`, so documents in any language are read the same way. `.sil/run/` holds `sil run` records and its cache; add it and `.sil/layout.json` to `.gitignore`.

`SILMARI.md` is the entry point agents read first: it carries the notation summary and points at the entry documents. The `.sil/layout.json` next to the config holds per-user viewer state (dragged nodes, folds, open panels); add it to `.gitignore`.

## What it never does
<!-- npm -->

- It does not call a model API. `sil run` starts the agent CLI you installed, with the prompt taken from your document as written. There is no assembler that rewrites prompts.
- It does not summarize, rewrite, or normalize the text. It does not delete files.
- Outside the folder you run it in, it writes nothing. Inside it, only what you asked for: `sil init` creates the files listed above, and the viewer's Save writes the bytes you edited.

## Development

```sh
pnpm install
pnpm build          # bundles viewer → cli → vscode, in that order
pnpm test           # golden corpus (packages/core/test/fixtures/after) + rule unit tests
pnpm --filter silmari-vscode package   # packages/vscode/dist/silmari.vsix
```

```
packages/core      parser · IR · lint rules · graph · writer. Pure functions, no IO except loadDir. The reference implementation
packages/cli       sil — init · lint · view (local server, incremental parsing, gzip, whole-file edit API) · run (runtime adapters: claude, codex)
packages/viewer    React Flow graph: flow map, subtree folding, WebGL + DOM virtualization, label layout, editing, ko/en. vite builds one HTML file
packages/vscode    extension — Diagnostic · graph webview · configurationDefaults
tools/stress.mjs   load-test corpus generator — node tools/stress.mjs <out> [flows] [depth] [fanout]
tools/readme.mjs   builds packages/cli/README.md (the npm page) from this README. `pnpm readme`; the cli tests check it is current
```

## License

MIT
