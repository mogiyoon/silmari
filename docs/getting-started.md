# Your first flow

[← README](../README.md)

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

## Run the flow

silmari does not run your flow. Your agent does, and silmari checks the documents and starts the isolated steps.

1. Open the agent you already use in that folder. Its start file points at SILMARI.md, so it reads the notation first.
2. Tell it what to do in your own words: "follow flow.md for src/a.ts".
3. At step 1 it sees the `(( ))` label, so it does not start a subagent of its own. It types one line:

```sh
sil run claude --step flow.md#1 --send target=src/a.ts --model haiku --tools Read
```

4. That returns `{"findings": …}`, and the agent carries the value into step 2, which has no label and so it does itself.

Steps without a `(( ))` label are ordinary reading. Only labelled steps go through `sil run`, which is where the tools, the model and the project rules are enforced.
