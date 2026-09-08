// Update notes: what changed in the notation between versions and what an agent should check in the project's documents.
// `sil update` writes the notes newer than the recorded version to .sil/updates/<version>.md and asks the agent, through one line in
// the start files, to apply them in order and delete them. Only versions that changed the notation have a note; a version that only
// changed silmari's own files (SILMARI.md sections, config) needs none, since `sil update` rewrites those itself.
export const UPDATE_NOTES: Record<string, string> = {
  '0.2.0': `# silmari 0.2.0 — what changed

## 1. Tell the user first

In the user's language, in plain words. Each line is "before → now":

- **Contract headings.** Before: the called document listed its values under \`## Inputs\` / \`## Steps\` / \`## Outputs\`, and the words for other languages had to be registered under \`words:\` in \`.sil/config.yaml\`. Now: the heading is one symbol, \`## {{>Inputs}}\` for inputs and \`## {{<Outputs}}\` for outputs, with any words inside (\`### {{>입력}}\`). No word list; \`## Steps\` is an ordinary heading.
- **Tools and model.** Before: in the called document's frontmatter (\`tools:\`, \`model:\`). Now: on the call line in the orchestrator, in your own words: \`Use the tools {{+read}} and {{+edit}}, and the model {{#fast}}.\` The only frontmatter silmari reads is \`sil:\` / \`type: task|doc\`.
- **Subagent label.** Before: single brackets at the end of the heading, \`## 1. Research [use a subagent]\`. Now: double parentheses, \`## 1. Research ((use a subagent via sil run))\`. Markdown read the brackets as a reference link.
- **Value hints.** Now a contract item can say what kind of value it is: \`- spec (path) — the design document\`, \`(json)\`, \`(text)\`. \`sil run\` checks a \`(path)\` exists and a \`(json)\` parses before the subagent starts.
- **Running a step.** Now a step with a \`(( ))\` label is started with \`sil run <runtime> --step flow.md#N --send name=value …\` instead of the agent's own subagent feature; the subagent starts with the project's start files switched off and receives rules only through links.

Then ask: "Start the silmari update?" If the answer is no, stop here and leave this file.

## 2. If yes: what to change in the documents

1. **Contract headings → symbols.** In every called document, make the inputs heading \`## {{>…}}\` and the outputs heading \`## {{<…}}\`, keeping your words inside. Leave \`## Steps\` as it is. Then delete the \`words:\` block from \`.sil/config.yaml\`; it is ignored.
   - Before: \`## 입력\` … \`## 출력\` with \`words: { inputs: [입력], outputs: [출력] }\` in the config
   - Now: \`## {{>입력}}\` … \`## {{<출력}}\`, no config entry
2. **Frontmatter tools and model → the call line.** For each called document that has \`tools:\` or \`model:\` in its frontmatter, write them on the line that calls it, in the orchestrator, and remove them from the frontmatter. Keep \`sil: type\` if present; every other key belongs to another tool and stays.
   - Before, at the top of agents/analyst.md:
     \`\`\`yaml
     ---
     tools: [Read, Write]
     model: sonnet
     ---
     \`\`\`
   - Now, on the call line in flow.md: \`Call [Analyst](agents/analyst.md) with {{>posting}} and receive {{<analysis}}. Use the tools {{+read}} and {{+write}}, and the model {{#balanced}}.\`
3. **Labels \`[…]\` → \`((…))\`.** At the end of each heading that marks a subagent step, replace the brackets with double parentheses; drop a leading \`@\`. Lint reports the old forms as L-I05 and L-I04.
   - Before: \`## 1. Research [use a subagent]\`
   - Now: \`## 1. Research ((use a subagent via sil run))\`
4. **Add hints where the kind of value matters.** Put \`(path)\` after an input that is a file location and \`(json)\` after one that is structured data. Values that are plain text need nothing.
5. Run \`sil lint\` until it reports error 0, then delete this file.
`,
  '0.3.0': `# silmari 0.3.0 — what changed

## 1. Tell the user first

In the user's language, in plain words. Each line is "before → now":

- **Links.** Before: only md documents could be linked; other files were named in prose. Now: any file can be linked — \`[spec](../spec.json)\`, \`[log](out/run.log)\`, a folder — and the graph shows it. A subagent receives only linked files, so a file an agent must read has to be a link.
- **Which file to read.** Before: a link named one fixed file, so "read the reference for the topic" stayed prose. Now: a value goes inside the target — \`[reference](../references/{{>topic}}.md)\` — and \`sil run\` fills it in when the step runs.
- **Where a subagent starts.** Before: in the flow file's folder, so a link in an agent document could point at a path that did not exist. Now: in the project root, and \`sil run\` rewrites every link and (path) value to it. Existing links keep working; nothing to rewrite.

Then ask: "Start the silmari update?" If the answer is no, stop here and leave this file.

## 2. If yes: what to change in the documents

1. **Prose file names → links.** Find files that documents name in prose or in backticks and that the agent has to open, and make them links. A file the step *creates* is not a link: it is an output value, \`- report (path)\` under \`## {{<Outputs}}\`.
   - Before: \`Read \\\`../references/README.md\\\` first.\`
   - Now: \`Read [the index](../references/README.md) first.\`
2. **"Read the file for X" → a template link.** Where the file depends on a value, put the value in the target. The name must be an input of that document (\`## {{>Inputs}}\`) or a value it received from a call. Lint checks that a file matches (L-N28) and that the name has a source (L-N29).
   - Before: \`Read the reference document for the topic.\`
   - Now: \`Read [the reference](../references/{{>topic}}.md).\` with \`- topic\` in the inputs
3. **Links that leave the project.** Lint now reports a link that climbs above the project root (L-N30): a subagent cannot reach it. Move the file inside the project, or drop the link.
4. Run \`sil lint\` until it reports error 0, then delete this file.
`,
}
