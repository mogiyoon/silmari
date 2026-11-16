# Running a step

[← README](../README.md)

Your agent follows the flow. A heading marked `((…))` runs as a fresh subagent session through `sil run`; unmarked steps are followed by the calling agent.

```sh
sil run claude --step flow.md#1 --send target=src/a.ts --model haiku --tools Read
sil run codex --step flow.md#1 --send target=src/a.ts -m gpt-5.4-mini -s read-only
```

The orchestrator translates the words inside `{{+…}}`, `{{#…}}` and `{{!…}}` into runtime flags. sil checks their presence and applies the flags; matching the meaning of free-text declarations to their runtime scopes is the orchestrator's responsibility.

## Address a step and send values

`--step` accepts the heading number, its explicit anchor, or its name without the number. For `## 2. Research ((…)) {#research}`, use `#2`, `#research` or `#Research`. Use an explicit anchor in scripts so renumbering or renaming a heading does not break the call.

Each `{{>name}}` on the call or inside its link target needs a matching `--send name=value`. The called document's contract determines the input format:

| Hint | Send |
|---|---|
| None / `(text)` | A literal value, or `@file` for its contents |
| `(json)` | Valid JSON, typed or read from `@file` |
| `(path)` | An existing path relative to the flow file; never `@file` |

An `@file` is read from the shell's current folder. Windows PowerShell 5 can lose quotes in JSON arguments; use `@file` there.

`[worker](agents/{{>track}}-worker.md)` uses `--send track=resume` to choose the file. A name that appears only in the target is not passed to the worker. Its value is one file-name part: no `/`, `\`, `.` or `..`.

## What reaches the worker

The called document's body becomes the prompt, along with the sent values and a JSON reply format. The worker starts in the project root, the folder with `.sil/`. Links in its document and `(path)` values are rewritten relative to that root; template links are filled from the values sent.

The prompt travels on stdin. The worker's conversation is separate from the caller's, and its answer is returned as JSON under the `{{<…}}` names. Its reasoning and other output stay in `.sil/run/`.

The runtime's project start files are inherited by default. To cut them for one step, add `{{-without the project rules}}` after the call link. sil adds the runtime switch; an unsupported runtime refuses the step. Rules that a cut step still needs must be linked from its document.

## Tools and models

| Runtime | Tools | Model | Enforcement |
|---|---|---|---|
| Claude Code | `--tools Read,Bash` | `--model haiku` | Tools removed; actual tool list checked |
| Codex CLI | `-s read-only` or `-s workspace-write` | `-m <model>` | OS sandbox; tool list not reported |

With Claude `--tools`, sil adds `--strict-mcp-config` so inherited MCP connections cannot add tools. Explicit `--mcp-config` servers are still checked against the requested list.

## Approve commands

Declare the commands a step may run without asking with `{{!…}}`, after the call link in the same paragraph as its tools and model:

```markdown
## 1. Check ((use a subagent via sil run))
Call [Checker](agents/checker.md) and receive {{<report}}.
Use {{+read}} and {{+bash}} on {{#fast}}, and approve {{!project python scripts}} and {{!git status}}.
```

```sh
sil run claude --step flow.md#1 --model haiku --tools Read,Bash \
  --allowedTools "Bash(python:*)" "Bash(git status:*)"
```

Claude supports these rules in non-interactive `-p` mode. `--allowed-tools` is an alias; multiple rule arguments and `--allowedTools=…` work too.

- A declaration requires approval rules, and approval flags require a declaration.
- Approval rules do not restrict tools and cannot replace `--tools`.
- Without a declaration, sil adds no approvals. Existing runtime permission settings still apply; sil does not add project-wide approval defaults.
- Codex refuses `{{!…}}` steps: `-a` / `--ask-for-approval` and `-s` / `--sandbox` cannot enforce command-level approval scopes.
- A permission denial reported in runtime events fails the run, even when the worker returns a normal report. sil lists the denied commands, records the failure and skips the cache.

The first line shows `approved: […]` or `approved: none`, the project-rules policy and the MCP policy. Run records include the declarations, actual rules, runtime arguments and denials.

## Records, caching and sessions

Every run is recorded under `.sil/run/`. An identical repeat can reuse a cached answer: arguments, declarations, prompt and the contents of linked files and `(path)` inputs must match. Failed runs are never cached.

sil disables the runtime's session copy when supported, because it already keeps a run record. Use `--keep-session` for one resumable run, or `run: keep_session: true` in `.sil/config.yaml` for the project. `--no-keep-session` overrides that setting for one run.

## Checks and inspection

Before starting, sil checks the subagent label, sent names, declared tool/model/approval flags, typed inputs and resolved target files. The first line states runtime enforcement and what can be verified from its output.

Use `--dry-run` to print the command, or `--prompt-only` to inspect the assembled prompt. `sil run --help` lists all supported options.

If sil is unavailable, use the agent's own subagent feature and apply the declarations as far as it allows. Tool limits then become a request to that agent.
