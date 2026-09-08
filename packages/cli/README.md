<!-- Generated from README.md at the repository root by tools/readme.mjs. Edit that file, then run: pnpm readme -->
<p align="center"><img src="https://raw.githubusercontent.com/mogiyoon/silmari/main/assets/silmari-icon.png" width="120" alt="silmari"></p>

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

```sh
npm i -g silmari      # gives you the `sil` command
sil --version
sil --help
```

Node 20 or newer. Without installing: `npx silmari lint`.

VS Code: install the **silmari** extension from the marketplace (publisher `mogiyoon`). It ships the same checker and viewer; the CLI is not required.

## Quick start

```sh
cd my-agent-project     # any folder with md files
sil init                # .sil/config.yaml + SILMARI.md, and a line in CLAUDE.md · AGENTS.md · GEMINI.md · copilot-instructions.md that points agents at it
sil lint                # read every md file, print what is wrong
sil view                # open the graph in the browser; it redraws when a file changes
```

`sil init` records your language (`--lang=ko`, else the locale) so agents write SILMARI.md and their replies in it. Nothing is rewritten by silmari itself.

What `sil lint` prints on the [demo corpus](https://github.com/mogiyoon/silmari/blob/main/packages/core/test/fixtures/after):

```
✖ review.md:10  L-N01  Linked file not found: review-criteria.md
✖ wrap-up.md:7  L-N09  Anchor not found in the target document: structure.md#rollback

error 2 · warning 0 · info 0
```

`--strict` makes it exit with code 1 on any error, for CI. `--json` prints the whole graph and diagnostics. Options take `--key=value` or `--key value`.

## Migrating existing documents

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

silmari does not touch the files. The agent moves the text; `sil lint` checks the result. To run it again later, tell the agent "start the migration" in a session. What a flow and its called documents look like after the move is the [demo corpus](https://github.com/mogiyoon/silmari/blob/main/packages/core/test/fixtures/after).

## Notation: six symbols

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

**An md file without notation is not an error.** Adopt it one file at a time. [packages/core/test/fixtures/after](https://github.com/mogiyoon/silmari/blob/main/packages/core/test/fixtures/after) is a small complete example (it doubles as the golden test corpus).

## What lint catches

See [What lint catches](https://github.com/mogiyoon/silmari#what-lint-catches) in the repository README.

## Running a step: sil run

The orchestrator (an agent reading the flow) reaches `## 1. Research ((use a subagent via sil run))` and types one line:

```sh
sil run claude --step flow.md#1 --send target=src/a.ts --model haiku --tools Read
sil run codex  --step flow.md#1 --send target=src/a.ts -m gpt-5.4-mini -s read-only
```

`sil` reads only `--step` and `--send`. Everything else goes to that runtime's CLI unchanged; the orchestrator translates `{{#fast}}` and `{{+read}}` into the runtime's own flags. What `sil run` adds: it refuses a step whose heading has no `(( ))`, `--send` names that differ from the `{{>…}}` names, a missing tools or model flag when the call line declares one, a flag that only pre-approves permissions instead of restricting (`--allowedTools`), and a value that does not match its hint (a `(path)` that does not exist or was sent as `@file`, a `(json)` that does not parse; see the table under Notation). It assembles the prompt from the called document, switches the runtime's project start files off so the subagent's rules come only from links, verifies the tool list where the runtime reports it (Claude Code does; Codex does not, and the first line says so), returns the `{{<…}}` values as JSON, records the run under `.sil/run/`, and answers an identical repeat from the cache. Without `sil`, agents start subagents with their own feature: the model is applied, tool limits become a request.

Measured on Claude Code (sonnet, haiku) and Codex CLI: orchestrators typed the line correctly in every run once the Running section showed the runtime's flags, including Korean, Japanese and Chinese words inside the markers; with `--tools` the subagent physically lacked the other tools.

## The graph

See [The graph](https://github.com/mogiyoon/silmari#the-graph) in the repository README.

## Configuration

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

- It does not call a model API. `sil run` starts the agent CLI you installed, with the prompt taken from your document as written. There is no assembler that rewrites prompts.
- It does not summarize, rewrite, or normalize the text. It does not delete files.
- Outside the folder you run it in, it writes nothing. Inside it, only what you asked for: `sil init` creates the files listed above, and the viewer's Save writes the bytes you edited.

Full guide, rule list, and the graph's controls: https://github.com/mogiyoon/silmari
