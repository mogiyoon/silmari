# Notation

[← README](../README.md)

The markers are symbols. The words inside are yours, in any language.

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
| `{{!git status}}` | Commands this subagent may run without asking, in your words | "Pre-approve these commands" |
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
| none, or `(text)` | the value itself, or `@file` for a file's contents (the path is read from the current folder) | `--send tone=formal` · `--send note=@memo.md` | nothing |
| `(json)` | a JSON string, entered directly or read from `@file` (in Windows PowerShell 5 the inner double quotes are lost, so use `@file` there) | `--send options='{"depth": 2}'` | that it parses |
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

**An md file without notation is not an error.** You can adopt the notation one file at a time. [packages/core/test/fixtures/after](../packages/core/test/fixtures/after) is a small, complete example. It also serves as the golden test corpus.
