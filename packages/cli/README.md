<!-- Generated from README.md at the repository root by tools/readme.mjs. Edit that file, then run: pnpm readme -->
<p align="center"><img src="https://raw.githubusercontent.com/mogiyoon/silmari/main/assets/silmari-icon.png" width="120" alt="silmari"></p>

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

```sh
npm i -g silmari      # gives you the `sil` command
sil --version
sil --help
```

Requires Node 20 or newer. To use it without installing, run `npx silmari lint`.

VS Code: install the **silmari** extension from the marketplace (publisher `mogiyoon`). It includes the same checker and viewer. The CLI is not required.

## Quick start

```sh
cd my-agent-project     # any folder with md files
sil init                # .sil/config.yaml + SILMARI.md, and a line in CLAUDE.md · AGENTS.md · GEMINI.md · copilot-instructions.md that points agents at it (missing ones are created)
sil lint                # read every md file, print what is wrong
sil view                # open the graph in the browser; it redraws when a file changes
sil update              # after upgrading silmari: refresh the generated parts of SILMARI.md and hand the agent the notes on what changed
```

`sil init` records your language (`--lang=ko`, else the locale) in the config and in a line of each start file. SILMARI.md is generated in English; the language applies to what agents write from then on, documents and replies alike. silmari itself rewrites nothing.

After upgrading silmari, run `sil update` in each project. It replaces the generated sections of SILMARI.md (Notation, Running a call, Subagents) and leaves your Flow section and any section you added. When the notation changed since the version recorded in `.sil/config.yaml`, it writes one note per version to `.sil/updates/` and adds one line to the agent start files: at the next session the agent explains each change to you in plain words (how it was written before, how it is written now), asks whether to apply it to your documents, and when done deletes the notes and the line. Both `sil update` and the agent (its first step) take a backup under `.sil/backups/` first. `sil lint` reminds you with L-I06 when SILMARI.md is older than the installed silmari, and with L-I07 while notes wait.

Here is what `sil lint` prints for the [demo corpus](https://github.com/mogiyoon/silmari/blob/main/packages/core/test/fixtures/after):

```
✖ review.md:10   L-N01  Linked file not found: review-criteria.md
✖ wrap-up.md:11  L-N09  Anchor not found in the target document: structure.md#rollback
· flow.md        L-N23  A sent value is neither received from a call nor declared in this document's contract: target
· flow.md:19     L-N25  Subagent call names no {{+tools}} or {{#model}}; it runs with whatever the caller passes

error 2 · warning 0 · info 2
files 8 · task 6 · doc 2 · file 0 · ghost 1 · call 7 · ref 5 · mention 2
```

The last line is the count of what was read. A migration that changed nothing is visible there even when there is no error.

For CI, `--strict` makes the command exit with code 1 on any error. `--json` prints the full graph and all diagnostics. Options accept either `--key=value` or `--key value`.

## Your first flow

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
| `## … ((use a subagent via sil run))` | Calls in this section are isolated. The double parentheses are the symbol. The words inside can be in any language (`((서브 에이전트 사용))`) | "Use a subagent" |

The sequence follows line order. A heading (`## If there are review comments`) marks a choice. To show repetition, call again under a condition such as "until", or use "for each".

A link can point at any file, not only md: `[spec](../spec.json)`, `[log](out/run.log)`, a folder. The graph shows it as a file node and lint checks that it exists. Nothing but md is parsed. Every file an agent reads is a link, because a subagent receives files only through links; a file name in backticks is not a link and makes no edge. A file the step creates is an output value (`- report (path)` under `## {{<Outputs}}`), not a link.

When the file depends on a value, the value goes inside the target: `[the reference](../references/{{>topic}}.md)`. The name is one of the document's inputs, or a value received from an earlier call. Lint checks that at least one file matches the pattern (L-N28) and that the name has a source (L-N29). `sil run` fills it from `--send` and refuses the step when the file is missing.

In the called file, the contract is a list under a heading that contains exactly one marker: `## {{>Inputs}}` for inputs or `## {{<Outputs}}` for outputs. The heading can be at any level and use any words (`### {{>입력}}`). The item name is the first word. `(path)`, `(text)` or `(json)` after the name gives the value type. Any remaining text (`— the file to read`) describes the value for the model. No frontmatter is required. The only key silmari reads is `sil:` / `type: task|doc`, which overrides its task-or-reference guess.

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

**An md file without notation is not an error.** You can adopt the notation one file at a time. [packages/core/test/fixtures/after](https://github.com/mogiyoon/silmari/blob/main/packages/core/test/fixtures/after) is a small, complete example. It also serves as the golden test corpus.

## Migrating existing documents

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

silmari does not touch the files. The agent moves the text. `sil lint` checks the result. To run the migration again later, `sil migrate` writes the rules and the question line back. The [demo corpus](https://github.com/mogiyoon/silmari/blob/main/packages/core/test/fixtures/after) shows a flow and its called documents after migration.

## What lint catches

See [What lint catches](https://github.com/mogiyoon/silmari#what-lint-catches) in the repository README.

## Running a step: sil run

The orchestrator is an agent reading the flow. When it reaches `## 1. Research ((use a subagent via sil run))`, it types one line:

```sh
sil run claude --step flow.md#1 --send target=src/a.ts --model haiku --tools Read
sil run codex  --step flow.md#1 --send target=src/a.ts -m gpt-5.4-mini -s read-only
```

`sil` reads only `--step` and `--send`. It passes everything else to the runtime's CLI unchanged. The orchestrator translates `{{#fast}}` and `{{+read}}` into that runtime's flags. `sil run` adds several checks and behaviors. It refuses a step whose heading has no `(( ))`. It refuses `--send` names that differ from the `{{>…}}` names. It refuses a missing tools or model flag when the call line declares one. It refuses a flag that only pre-approves permissions instead of restricting them (`--allowedTools`). It also refuses a value that does not match its hint, such as a missing `(path)`, a `(path)` sent as `@file`, or a `(json)` value that does not parse. See the table under Notation. It builds the prompt from the called document. It starts the subagent in the project root, the folder with `.sil/`, and rewrites every link in the document and every `(path)` value to that root, so the paths the subagent opens are the ones the document meant. A `{{>name}}` inside a link target is filled from `--send`, and the step is refused when that file is missing. It leaves the runtime's project start files (CLAUDE.md · AGENTS.md · …) in place, so a rule you wrote there still applies, which is what people expect. When the call line carries `{{-…}}`, it switches them off for that run instead, and the step's rules come only through links; a runtime with no such switch refuses the step rather than running it with the rules still in. The first line of every run says which way it went. It verifies the tool list when the runtime reports it. Claude Code does; Codex does not, and the first line reports that. It returns the `{{<…}}` values as JSON. It records the run under `.sil/run/`. It returns an identical repeated call from the cache. Without `sil`, agents use their own subagent feature. The model is applied, but tool limits become a request.

Tests used Claude Code (sonnet, haiku) and Codex CLI. Once the Running section showed each runtime's flags, orchestrators typed the line correctly in every run. This included runs with Korean, Japanese and Chinese words inside the markers. With `--tools`, the subagent physically lacked the other tools.

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

There is no word list. Contract headings use the symbols `{{>…}}` / `{{<…}}`, so documents in every language are read the same way. `.sil/run/` contains `sil run` records and its cache. Add it and `.sil/layout.json` to `.gitignore`.

`SILMARI.md` is the entry point that agents read first. It contains the notation summary and links to the entry documents. The `.sil/layout.json` file beside the config stores per-user viewer state, including dragged nodes, folds and open panels. Add it to `.gitignore`.

## What it never does

- It does not call a model API. `sil run` starts the installed agent CLI with the prompt exactly as written in your document. No assembler rewrites prompts.
- It does not summarize, rewrite or normalize text. It does not delete files.
- It writes nothing outside the folder where you run it. Inside that folder, it writes only what you request. `sil init` creates the files listed above. Save in the viewer writes the bytes you edited.

Full guide, rule list, and the graph's controls: https://github.com/mogiyoon/silmari
