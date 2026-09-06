# silmari

Checks the flow and data in md documents and shows them as a graph. Agent md files are the source, silmari is the compiler, and AI is the runtime.

## Install

```sh
npm i -g silmari      # gives you the `sil` command (Node 20+)
sil --version
```

## Use

```sh
sil init                # .sil/config.yaml + SILMARI.md, and a pointer line in CLAUDE.md · AGENTS.md · GEMINI.md · copilot-instructions.md
sil lint                # missing files, missing anchors, values the callee does not take, references nobody calls. --strict exits 1 on error, --json prints the graph
sil view                # local server + browser. Redraws when an md file changes
sil view --out=g.html   # one HTML file, no server
```

```
✖ review.md:10  L-N01  Linked file not found: review-criteria.md
✖ wrap-up.md:7  L-N09  Anchor not found in the target document: structure.md#rollback

error 2 · warning 0 · info 0
```

![sil view: one flow, orchestrators on the left calling agents on the right](https://raw.githubusercontent.com/mogiyoon/silmari/main/assets/silmari-graph.png)

## Notation

A standard Markdown link is an edge. Add values after the link: `{{>send}}` and `{{<receive}}`. A heading is a condition. A double-parenthesis label at the end of a heading, such as `((use a subagent))`, isolates the calls in that section. In the called file, the lists under `## Inputs` / `## Steps` / `## Outputs` are the contract. An md file without notation is not an error.

```markdown
## 1. Research ((use a subagent))
For each target file, call [research](research.md) with {{>target}} and receive {{<findings}}.
```

It never calls a model, never rewrites your text, and writes only what you asked for.

Full guide, rule list, and the graph's controls: https://github.com/mogiyoon/silmari
