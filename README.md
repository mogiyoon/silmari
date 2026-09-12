<p align="center"><img src="assets/silmari-icon.png" width="120" alt="silmari"></p>

# silmari

**Checks flow and data in md documents and shows them as a graph.**
Agent md files are the source. silmari is the compiler. AI is the runtime. It is like `tsc` for the md files that drive your agents.

```
sil lint    missing files, missing anchors, values sent that the callee does not take, references nobody calls   ← compiler
sil view    calls, send/receive, conditions and subagents between documents on one screen                        ← graph
sil run     starts one subagent step through the agent CLI you already have, with its tools and model enforced   ← runner
```

Two principles apply everywhere. **The notation has no language:** every marker is a symbol, and the words inside are yours. **It belongs to no AI tool:** any agent can read the documents. Differences between runtimes (Claude Code, Codex CLI, …) are handled by `sil run`, not by the notation.

The VS Code extension marks the same problems with wavy lines as you edit. It also opens the graph beside the editor.

## Install
<!-- npm -->

```sh
npm i -g silmari      # gives you the `sil` command
sil --version
sil --help
```

Requires Node 20 or newer. To use it without installing, run `npx silmari lint`.

VS Code: install the **silmari** extension from the marketplace (publisher `mogiyoon`). It includes the same checker and viewer. The CLI is not required.

## Quick start
<!-- npm -->

```sh
cd my-agent-project     # any folder with md files
sil init                # .sil/config.yaml + SILMARI.md, and a line in CLAUDE.md · AGENTS.md · GEMINI.md · copilot-instructions.md that points agents at it (missing ones are created)
sil lint                # read every md file, print what is wrong
sil view                # open the graph in the browser; it redraws when a file changes
sil update              # after upgrading silmari: refresh the generated parts of SILMARI.md and hand the agent the notes on what changed
sil backup              # copy every md file the scan sees to .sil/backups/<time>-manual/ (init, migrate, update and the agent do this on their own)
sil migrate             # put the migration rules (.sil/migration.md) and the question line in the start files back, to move documents later
```

`sil init` records your language (`--lang=ko`, else the locale) in the config and in a line of each start file. SILMARI.md is generated in English; the language applies to what agents write from then on, documents and replies alike. silmari itself rewrites nothing.

After upgrading silmari, run `sil update` in each project. It replaces the generated sections of SILMARI.md (Notation, Running a call, Subagents) and leaves your Flow section and any section you added. When the notation changed since the version recorded in `.sil/config.yaml`, it writes one note per version to `.sil/updates/` and adds one line to the agent start files: at the next session the agent explains each change to you in plain words (how it was written before, how it is written now), asks whether to apply it to your documents, and when done deletes the notes and the line. Both `sil update` and the agent (its first step) take a backup under `.sil/backups/` first. `sil lint` reminds you with L-I06 when SILMARI.md is older than the installed silmari, and with L-I07 while notes wait; the VS Code extension shows the same two in Problems, on `.sil/config.yaml` and `.sil/updates`.

Here is what `sil lint` prints for the [demo corpus](packages/core/test/fixtures/after):

```
✖ review.md:10   L-N01  Linked file not found: review-criteria.md
✖ wrap-up.md:11  L-N09  Anchor not found in the target document: structure.md#rollback
· flow.md        L-N23  A sent value is neither received from a call nor declared in this document's contract: target
· flow.md:19     L-N25  Subagent call names no {{+tools}} or {{#model}}; it runs with whatever the caller passes

error 2 · warning 0 · info 2
files 8 · task 6 · doc 2 · file 0 · ghost 1 · call 7 · read 0 · write 0 · ref 5 · mention 2
```

The last line is the count of what was read. A migration that changed nothing is visible there even when there is no error.

For CI, `--strict` makes the command exit with code 1 on any error. `--json` prints the full graph and all diagnostics. Options accept either `--key=value` or `--key value`.

## Your first flow
<!-- npm -->

`sil init` leaves the Flow section of SILMARI.md empty. Here is the smallest thing that fills it. Two files next to SILMARI.md:

`flow.md`, the orchestrator. An agent reads it and works through the steps in order.

```markdown
# Review a file

## {{>Inputs}}
- target (path) — the file to review

## 1. Read it ((use a subagent via sil run))

Call [read-file](read-file.md) with {{>target}} and receive {{<findings}}.
Use the tool {{+read}} and the model {{#fast}}.

## 2. Report

Show the findings to the user, grouped by file.

## {{<Outputs}}
- findings — one line per problem
```

`read-file.md`, the document that step 1 calls. Its body is the prompt the subagent receives.

```markdown
# Read file

## {{>Inputs}}
- target (path) — the file to read. Open it yourself; only the location is given

## Steps

Read the file. List anything that looks wrong.

## {{<Outputs}}
- findings — one line per problem, with `file:line`
```

Then add one line under `## Flow` in SILMARI.md, so the graph starts there:

```markdown
- [Review a file](flow.md)
```

`sil lint` now prints `No problems`. Two things in that example are easy to miss. The flow document needs its own `## {{>Inputs}}`, because `{{>target}}` has to come from somewhere; without it lint reports L-N23. And a value you receive has to be used or declared, which is what `## {{<Outputs}}` does for `findings`.

## Using it
<!-- npm -->

silmari does not run your flow. Your agent does, and silmari checks the documents and starts the isolated steps.

1. Open the agent you already use in that folder. Its start file points at SILMARI.md, so it reads the notation first.
2. Tell it what to do in your own words: "follow flow.md for src/a.ts".
3. At step 1 it sees the `(( ))` label, so it does not start a subagent of its own. It types one line:

```sh
sil run claude --step flow.md#1 --send target=src/a.ts --model haiku --tools Read
```

4. That returns `{"findings": …}`, and the agent carries the value into step 2, which has no label and so it does itself.

Steps without a `(( ))` label are ordinary reading. Only labelled steps go through `sil run`, which is where the tools, the model and the project rules are enforced.

## Notation: seven symbols
<!-- npm -->

A standard Markdown link is an edge. Add values after the link with `{{ }}`. They attach to the preceding link in the same paragraph. Link paths work like imports. `plan.md`, `./plan.md`, and `../agents/plan.md` are relative to the document. A leading `/` (`/agents/plan.md`) starts at the project root, which is the folder containing `.sil/`.

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
| `[research](research.md)` | Edge from caller to callee | "Read that file" |
| `{{>plan}}` | Send a parameter | "Pass this value" |
| `{{<changed-files}}` | Receive a return value | "Keep this value" |
| `{{+read}}` | Tools the subagent may use, in your words | "Only these tools" |
| `{{#fast}}` | Model the subagent runs on, in your words | "This model" |
| `{{-without the project rules}}` | Run this subagent without the project start files (CLAUDE.md · AGENTS.md · …), in your words | "Ignore the project rules" |
| `## {{=Run the CLI}}` | The first link in this section is executed, even with no values | "Run this target" |
| `## … ((use a subagent via sil run))` | Calls in this section are isolated. The double parentheses are the symbol. The words inside can be in any language (`((서브 에이전트 사용))`) | "Use a subagent" |

The sequence follows line order. A heading (`## If there are review comments`) marks a choice. To show repetition, call again under a condition such as "until", or use "for each".

A link can point at any file, not only md: `[spec](../spec.json)`, `[log](out/run.log)`, a folder. Nothing but md is parsed. On a non-md file link, `{{>name}}` writes a value into the file and `{{<name}}` imports a value from it. A declared output path may be absent until runtime; the graph shows it as a planned file instead of a broken link.

When the file depends on a value, the value goes inside the target: `[the reference](../references/{{>topic}}.md)`. The name is one of the document's inputs, or a value received from an earlier call. Lint checks that at least one file matches the pattern (L-N28) and that the name has a source (L-N29). `sil run` fills it from `--send` and refuses the step when the file is missing.

In the called file, the contract is a list under a heading that contains exactly one marker: `## {{>Inputs}}` for inputs or `## {{<Outputs}}` for outputs. The heading can be at any level and use any words (`### {{>입력}}`). The item name is the first word. `(path)`, `(text)` or `(json)` after the name gives the value type. Any remaining text (`— the file to read`) describes the value for the model. No frontmatter is required. The only key silmari reads is `sil:` / `type: task|doc`, which overrides its task-or-reference guess.

A deterministic task puts its execution target in a `{{=…}}` section. The first link in that section is called. A later non-md file link with `{{>name}}` is an output written by that target. Commands remain ordinary Markdown code: they appear in the document detail but do not become graph nodes.

````markdown
## {{=Document CLI}}

[Document CLI](app/cli.py) receives {{>planfile}} and {{>specfile}}.

[Gathered document](flows/out/doc1.json) stores {{>docfile}}.

```bash
uv run app expand --plan <planfile> --spec <specfile> > flows/out/doc0.json
uv run app gather --doc flows/out/doc0.json > flows/out/doc1.json
```
````

This draws `task.md → app/cli.py → flows/out/doc1.json`. Another document imports the same node by linking the same normalized path with `{{<document}}`. A dynamic output such as `[result](flows/out/{{>job-id}}.json)` is one planned path-pattern node; matching concrete files appear after runtime. silmari does not execute the commands.

The hint tells the orchestrator what to put in `--send`. It also tells `sil run` what to check before starting the subagent:

| Hint on the item | What to send | Example | `sil run` checks |
|---|---|---|---|
| none, or `(text)` | the value itself, or `@file` for a file's contents | `--send tone=formal` · `--send note=@memo.md` | nothing |
| `(json)` | a JSON string, entered directly or read from `@file` | `--send options='{"depth": 2}'` | that it parses |
| `(path)` | the path itself, relative to the flow file. Never `@` | `--send spec=docs/design.md` | that the file or folder exists; `@` is refused |

Every value enters the prompt unchanged under `## Values for this run`. A `(path)` enters as a path string. The subagent opens it with its own tools, so the call line needs `{{+read}}` or broader access. The subagent cannot tell whether a value was entered directly or read from `@file`. The difference is only who reads the file. Send content for short values. Send a path for large values or several files, so the prompt stays small.

```markdown
## {{>Inputs}}
- spec (path) — the design document. Open it yourself; only the location is given
- options (json) — run options, e.g. {"depth": 2}
- note — a free memo from the caller
```

```sh
sil run claude --step flow.md#1 --send spec=docs/design.md --send 'options={"depth": 2}' --send note=@memo.md --model haiku --tools Read
```

The linter does not check these details. It only matches names. The other checks run in `sil run` just before the values are written into the prompt.

**An md file without notation is not an error.** You can adopt the notation one file at a time. [packages/core/test/fixtures/after](packages/core/test/fixtures/after) is a small, complete example. It also serves as the golden test corpus.

## Migrating existing documents
<!-- npm -->

If the folder already contains md files, `sil init` writes the migration rules to `.sil/migration.md` and adds one line to the agent start files. The next time the agent starts, it asks:

```
Start the silmari migration?
```

Say yes. Before that, `sil init` already copied every md file to a folder under `.sil/backups/`, and the agent's first rule is to run `sil backup` once more and tell you the folder, so anything the migration changes can be put back by copying it over. The agent then moves the documents to the notation by following `.sil/migration.md` one rule at a time:

- **One agent, one file.** An agent that was a section inside an orchestrator (`### 1. Analyst — tools · model …`) becomes its own md file. The same paragraph names the tools and model in a sentence: `Use the tools {{+read}} and {{+edit}}, and the model {{#fast}}.` No frontmatter.
- **The contract lives in the called file.** Its input and output bullets become lists under `## {{>Inputs}}` / `## {{<Outputs}}` in that file, not in the caller.
- **Rules travel by link.** A separate agent document links to the rule documents it must follow. A subagent keeps the project start files, but every other file reaches it only through a link.
- **One call, one line.** Each orchestrator step is a heading with a link and its values: `[Analyst](agents/analyst.md) with {{>posting}} and receive {{<analysis}}`. A retry is a heading that states the condition and limit.
- **Diagrams, pseudocode and transfer tables stay for people.** The parser cannot read them. Their information is copied onto the call lines.
- **Prose stays prose.** Rationale, error handling and examples remain unchanged. The notation appears only on lines with calls.
- **It ends with `sil lint` at error 0**. The agent then deletes `.sil/migration.md` and the question line from the agent start files, so nothing of the migration stays behind.

silmari does not touch the files. The agent moves the text. `sil lint` checks the result. To run the migration again later, `sil migrate` writes the rules and the question line back. The [demo corpus](packages/core/test/fixtures/after) shows a flow and its called documents after migration.

## What lint catches
<!-- npm: link -->

| Code | Level | Meaning |
|---|---|---|
| L-N01 | error | Linked file does not exist |
| L-N09 | error | Anchor does not exist in the target document |
| L-N03 | error | Reference-style link has no definition |
| L-N04 | error | Invalid value name in `{{ }}` |
| L-N13 | error | `{{ }}` has no preceding link to attach to |
| L-N16 | error | The same name is received twice under one condition |
| L-C01 | warning | Sends values not listed in the callee's inputs |
| L-C02 | warning | Receives values not listed in the callee's outputs |
| L-N14 | warning | Data is attached to a reference document, which has no contract |
| L-G01 | warning | Reference document that nobody links to. It may need cleanup, but is never deleted |
| L-G06 | warning | A document is called again without a condition, so there is no way out |
| L-N15 | warning | `{{*x}}` is retired notation; write `{{>x}}` and say "for each" in words |
| L-N17 | info | A received value is never used |
| L-N05 | info | A link inside a heading is not an edge |
| L-N06 | info | The file has no H1 or more than one, so its file name is used as the title |
| L-I05 | info | Heading label uses `[…]`: write `((…))`, because Markdown reads `[ ]` as a reference link |
| L-I04 | info | `[@…]` appears in a heading label: drop the `@`, because models read it as a mention |
| L-N18 | warning | Empty marker: `{{>}}`, `{{+}}`, `(())` — nothing can be read from it |
| L-N20 | warning | A heading starts with a contract marker but contains more text, so it is not a contract heading |
| L-N21 | warning | Unbalanced parentheses at the end of a heading: a label must be `((…))` |
| L-N26 | warning | `{{+…}}` / `{{#…}}` / `{{-…}}` on a call outside a subagent step have no effect |
| L-N19 | info | A contract heading is used as H1 |
| L-N22 | info | The file is called with values but declares no contract, so the names cannot be checked |
| L-N23 | info | A sent value is neither received from a call nor declared in the document's contract |
| L-N24 | info | Different callers call one file with different tool sets |
| L-N25 | info | A subagent call names no `{{+tools}}` or `{{#model}}` |
| L-I06 | info | SILMARI.md was written by an older silmari than the one installed: run `sil update` |
| L-I07 | info | Update notes in `.sil/updates/` have not been applied yet |
| L-N28 | error | No file matches a template link such as `[x](refs/{{>topic}}.md)` |
| L-N29 | warning | A value inside a link target is neither an input of the document nor received from a call |
| L-N30 | warning | A link points outside the project root, where a subagent cannot reach it |
| L-N31 | warning | A `{{=…}}` execution section has no target link |

Rules that require a contract or call run only on documents that contain one. Plain Markdown stays quiet. The last line of `sil lint` always shows the type counts (`task 6 · call 7 …`). This makes a migration that changed nothing visible, even at error 0.

## Running a step: sil run
<!-- npm -->

The orchestrator is an agent reading the flow. When it reaches `## 1. Research ((use a subagent via sil run))`, it types one line:

```sh
sil run claude --step flow.md#1 --send target=src/a.ts --model haiku --tools Read
sil run codex  --step flow.md#1 --send target=src/a.ts -m gpt-5.4-mini -s read-only
```

`sil` reads only `--step` and `--send`. It passes everything else to the runtime's CLI unchanged. The orchestrator translates `{{#fast}}` and `{{+read}}` into that runtime's flags. `sil run` adds several checks and behaviors. It refuses a step whose heading has no `(( ))`. It refuses `--send` names that differ from the `{{>…}}` names. It refuses a missing tools or model flag when the call line declares one. It refuses a flag that only pre-approves permissions instead of restricting them (`--allowedTools`). It also refuses a value that does not match its hint, such as a missing `(path)`, a `(path)` sent as `@file`, or a `(json)` value that does not parse. See the table under Notation. It builds the prompt from the called document. It starts the subagent in the project root, the folder with `.sil/`, and rewrites every link in the document and every `(path)` value to that root, so the paths the subagent opens are the ones the document meant. A `{{>name}}` inside a link target is filled from `--send`, and the step is refused when that file is missing. It leaves the runtime's project start files (CLAUDE.md · AGENTS.md · …) in place, so a rule you wrote there still applies, which is what people expect. When the call line carries `{{-…}}`, it switches them off for that run instead, and the step's rules come only through links; a runtime with no such switch refuses the step rather than running it with the rules still in. The first line of every run says which way it went. It verifies the tool list when the runtime reports it. Claude Code does; Codex does not, and the first line reports that. It returns the `{{<…}}` values as JSON. It records the run under `.sil/run/`. It returns an identical repeated call from the cache. Without `sil`, agents use their own subagent feature. The model is applied, but tool limits become a request.

Tests used Claude Code (sonnet, haiku) and Codex CLI. Once the Running section showed each runtime's flags, orchestrators typed the line correctly in every run. This included runs with Korean, Japanese and Chinese words inside the markers. With `--tools`, the subagent physically lacked the other tools.

## The graph
<!-- npm: link -->

![One flow in sil view: the orchestrators on the left call the agents on the right](assets/silmari-graph.png)

- **Two scopes.** *Entry flows* starts from the files registered by `SILMARI.md`. The path is the agent start files (`CLAUDE.md` links `SILMARI.md`, so that edge is real) → the entry document → one box for each linked flow. A registration is a plain link; when the entry document calls its documents with values, it is a flow itself and is shown whole. ▸▸ on a box opens only that flow. A document also called by another flow has a `+1 outside` badge. The diagnostics panel shows how many findings are in hidden documents. *All md files* shows the same graph grouped by links. Both scopes are visibility filters over the graph printed by `sil lint --json`. Nothing is drawn unless it exists in the files.
- **Flows.** Documents that link to one another form a flow. In the *All md files* scope, an overview map appears when there is more than one flow. Open a flow to view it.
- **Folding.** A flow opens folded to its first level. On a node, ▸ shows its children, ▸▸ shows everything below it, and ◂ folds it again. The rail buttons ▸▸ / ◂◂ apply to the whole flow. The fold state is saved in `.sil/layout.json`.
- **Lines.** Solid grey lines are calls; `=` makes the first link in its section a call even without values. Teal lines carry file data: the arrow direction and `write` / `import` label distinguish the operation. Dashed lines are references. A purple border marks a subagent call. An amber `no rules` strip at the top of an edge label marks that invocation as running without the project start files (`{{-…}}`); its tooltip gives the source phrase. Red dashed lines lead to missing targets. Grey dotted pills are existing linked files that are not md; a hollow grey pill is a planned runtime output. A template link (`out/{{>job-id}}.json`) is one path-pattern pill whose description lists matching files.
- **Routes.** Every line runs at right angles with rounded corners. Its vertical parts stay in the margin between a column of nodes and the column of labels, so a line never runs under a label or through an expanded node. A call leaves the caller's right side, passes through its label and enters the target's left side; a reference with nothing to label bends once. A link back to an earlier column takes a clear lane between the nodes. An import comes in from above: the reader keeps an empty row over itself for the import labels, and a file that nothing writes stands in that row right over its first reader.
- **Labels.** The first line of a label names the link, `caller.md → target.md`; the second names it at heading level, `## Steps → ## Layers` (the heading the link sits under → the heading its anchor points to, resolved to that heading's title). Below come the model and tools of a subagent call, then the values sent and received. Drag a label to move it; the line follows. ↺ puts it back.
- **Labels in two orders.** ⌥ places each label beside its target node. ☰ keeps the document's line order, and a child moves down under the labels of the repeat calls before it, so the first call to each child stays a straight line. Use the rail to switch between them.
- **Selection.** Click a node to open its prompt on the right, every heading unfolded. The documents it calls sit below in one folded group, each with its own prompt. A file that is not md shows its text, read-only. Everything except that node and its neighbours fades. Click a heading box inside an expanded node to keep only that heading's calls and the documents they reach; hovering a heading box lights the same without fading the rest. Click empty space to clear the selection.
- **Editing.** *Edit ✎* opens the body of every heading in the selected document and the documents it calls as text fields. One Save writes each field back to its own heading. *Raw ✎* edits the whole file. Both use a writer that checks the file hash and keeps a backup. They never touch bytes outside your changes.
- **Scale.** Tens of thousands of documents work. Only changed files are parsed again. The graph is sent gzipped. Above 2,000 visible nodes, the distant view uses WebGL, while the DOM contains only what is on screen.

![The graph with the side panel: a selected orchestrator and its prompt](assets/silmari-graph-window.png)

VS Code's Problems panel shows the same checks:

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

There is no word list. Contract headings use the symbols `{{>…}}` / `{{<…}}`, so documents in every language are read the same way. `.sil/run/` contains `sil run` records and its cache. Add it and `.sil/layout.json` to `.gitignore`.

`SILMARI.md` is the entry point that agents read first. It contains the notation summary and links to the entry documents. The `.sil/layout.json` file beside the config stores per-user viewer state, including dragged nodes, dragged edge-label positions, folds and open panels. Drag a label by its ⠿ handle; its ↺ button restores just that label's automatic position. Add the file to `.gitignore`.

## What it never does
<!-- npm -->

- It does not call a model API. `sil run` starts the installed agent CLI with the prompt exactly as written in your document. No assembler rewrites prompts.
- It does not summarize, rewrite or normalize text. It does not delete files.
- It writes nothing outside the folder where you run it. Inside that folder, it writes only what you request. `sil init` creates the files listed above. Save in the viewer writes the bytes you edited.

## Development

```sh
pnpm install
pnpm build          # bundles viewer → cli → vscode, in that order
pnpm test           # golden corpus (packages/core/test/fixtures/after) + rule unit tests. Needs Node 22.6+ for --experimental-strip-types
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
