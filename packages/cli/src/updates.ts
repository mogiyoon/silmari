// Update notes: what changed in the notation between versions and what an agent should check in the project's documents.
// `sil update` writes the notes newer than the recorded version to .sil/updates/<version>.md and asks the agent, through one line in
// the start files, to apply them in order and delete them. Only versions that changed the notation have a note; a version that only
// changed silmari's own files (SILMARI.md sections, config) needs none, since `sil update` rewrites those itself.
// The facts come from the published packages: `sil init` of each npm version, diffed in order (0.1.0 → 0.1.1 label; 0.1.1 → 0.1.2 Migration
// section only; 0.1.2 → 0.2.0 symbols, call-line tools/model, hints, sil run; 0.2.0 → 0.3.0 any-file links, template targets, root cwd;
// 0.3.1 → 0.4.0 the {{-…}} marker and the flipped default for the runtime's project start files).
export const UPDATE_NOTES: Record<string, string> = {
  '0.1.1': `# silmari 0.1.1 — what changed

## 1. Tell the user first

In the user's language, in plain words:

- **Subagent label.** Before: single brackets at the end of the heading, \`## 1. Research [use a subagent]\`. Now: double parentheses, \`## 1. Research ((use a subagent))\`. Markdown read the brackets as a reference link, so editors and linters complained, and models followed the parentheses more reliably.

Then ask: "Start the silmari update?" If the answer is no, stop here and leave this file.

## 2. If yes: what to change in the documents

0. **Back up first.** Run \`sil backup\`; it copies every md file to a folder under \`.sil/backups/\` and prints the folder. Tell the user where it is. If the project is a git repository with uncommitted changes, commit first as well.
1. **Labels \`[…]\` → \`((…))\`.** At the end of each heading that marks a subagent step, replace the brackets with double parentheses; drop a leading \`@\`. Lint reports the old forms as L-I05 and L-I04.
   - Before: \`## 1. Research [use a subagent]\`
   - Now: \`## 1. Research ((use a subagent))\`
2. Run \`sil lint\` until it reports error 0, then delete this file.
`,
  '0.2.0': `# silmari 0.2.0 — what changed

## 1. Tell the user first

In the user's language, in plain words. Each line is "before → now":

- **Contract headings.** Before: the called document listed its values under \`## Inputs\` / \`## Steps\` / \`## Outputs\`, and the words for other languages had to be registered under \`words:\` in \`.sil/config.yaml\`. Now: the heading is one symbol, \`## {{>Inputs}}\` for inputs and \`## {{<Outputs}}\` for outputs, with any words inside (\`### {{>입력}}\`). No word list; \`## Steps\` is an ordinary heading.
- **Tools and model.** Before: in the called document's frontmatter (\`tools:\`, \`model:\`). Now: on the call line in the orchestrator, in your own words: \`Use the tools {{+read}} and {{+edit}}, and the model {{#fast}}.\` The only frontmatter silmari reads is \`sil:\` / \`type: task|doc\`.
- **Value hints.** Now a contract item can say what kind of value it is: \`- spec (path) — the design document\`, \`(json)\`, \`(text)\`. \`sil run\` checks a \`(path)\` exists and a \`(json)\` parses before the subagent starts.
- **Running a step.** Now a step with a \`(( ))\` label is started with \`sil run <runtime> --step flow.md#N --send name=value …\` instead of the agent's own subagent feature; the subagent starts with the project's start files switched off and receives rules only through links.

Then ask: "Start the silmari update?" If the answer is no, stop here and leave this file.

## 2. If yes: what to change in the documents

0. **Back up first.** Run \`sil backup\`; it copies every md file to a folder under \`.sil/backups/\` and prints the folder. Tell the user where it is. If the project is a git repository with uncommitted changes, commit first as well.
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
3. **Add hints where the kind of value matters.** Put \`(path)\` after an input that is a file location and \`(json)\` after one that is structured data. Values that are plain text need nothing.
4. Run \`sil lint\` until it reports error 0, then delete this file.
`,
  '0.3.0': `# silmari 0.3.0 — what changed

## 1. Tell the user first

In the user's language, in plain words. Each line is "before → now":

- **Links.** Before: only md documents could be linked; other files were named in prose. Now: any file can be linked — \`[spec](../spec.json)\`, \`[log](out/run.log)\`, a folder — and the graph shows it. A subagent receives only linked files, so a file an agent must read has to be a link.
- **Which file to read.** Before: a link named one fixed file, so "read the reference for the topic" stayed prose. Now: a value goes inside the target — \`[reference](../references/{{>topic}}.md)\` — and \`sil run\` fills it in when the step runs.
- **Where a subagent starts.** Before: in the flow file's folder, so a link in an agent document could point at a path that did not exist. Now: in the project root, and \`sil run\` rewrites every link and (path) value to it. Existing links keep working; nothing to rewrite.

Then ask: "Start the silmari update?" If the answer is no, stop here and leave this file.

## 2. If yes: what to change in the documents

0. **Back up first.** Run \`sil backup\`; it copies every md file to a folder under \`.sil/backups/\` and prints the folder. Tell the user where it is. If the project is a git repository with uncommitted changes, commit first as well.
1. **Prose file names → links.** Find files that documents name in prose or in backticks and that the agent has to open, and make them links. A file the step *creates* is not a link: it is an output value, \`- report (path)\` under \`## {{<Outputs}}\`.
   - Before: \`Read \\\`../references/README.md\\\` first.\`
   - Now: \`Read [the index](../references/README.md) first.\`
2. **"Read the file for X" → a template link.** Where the file depends on a value, put the value in the target. The name must be an input of that document (\`## {{>Inputs}}\`) or a value it received from a call. Lint checks that a file matches (L-N28) and that the name has a source (L-N29).
   - Before: \`Read the reference document for the topic.\`
   - Now: \`Read [the reference](../references/{{>topic}}.md).\` with \`- topic\` in the inputs
3. **Links that leave the project.** Lint now reports a link that climbs above the project root (L-N30): a subagent cannot reach it. Move the file inside the project, or drop the link.
4. Run \`sil lint\` until it reports error 0, then delete this file.
`,
  '0.4.0': `# silmari 0.4.0 — what changed

## 1. Tell the user first

In the user's language, in plain words. Each line is "before → now":

- **Project rules and subagents.** Before: every \`sil run\` step started with the runtime's project start files (CLAUDE.md · AGENTS.md · …) switched off, whether the document said so or not. Now: a subagent keeps them, which is what people expect when they write a rule in CLAUDE.md. A step that must judge by its own document alone says so on the call line with the new \`{{-…}}\` marker.
- **The new marker.** \`{{-…}}\` sits next to \`{{+tools}}\` and \`{{#model}}\`, and the words inside are yours: \`{{-without the project rules}}\` \`{{-프로젝트 규칙 없이}}\`. \`sil run\` adds the runtime's own switch; the graph shows a badge beside the subagent badge; the first line of every run says which way it went.

This one changes how existing steps run, so it matters even if you change nothing: a subagent that used to see no project rules now sees them.

Then ask: "Start the silmari update?" If the answer is no, stop here and leave this file.

## 2. If yes: what to change in the documents

0. **Back up first.** Run \`sil backup\`; it copies every md file to a folder under \`.sil/backups/\` and prints the folder. Tell the user where it is. If the project is a git repository with uncommitted changes, commit first as well.
1. **Decide, step by step, which subagent calls keep the project rules.** Go through every call under a \`(( ))\` heading and ask the user about each one. Steps that judge a file on its own terms (research, review against a linked standard, anything that must be reproducible outside this project) usually want \`{{-…}}\`. Steps that write or change code usually want the project rules, so they stay as they are.
   - Before: \`Use the tool {{+read}} and the model {{#fast}}.\`
   - Now, when the step should keep judging by its own document alone: \`Use the tool {{+read}}, the model {{#fast}}, and run it {{-without the project rules}}.\`
2. **Where a cut step needs a rule, link it.** Under \`{{-…}}\` the subagent's only rules are the links in its own document. If a rule in CLAUDE.md must still apply there, put it in its own document and link it from the called file: \`Follow the [writing rules](../RULES.md).\` Write it as an instruction, not as a note.
3. Run \`sil lint\` until it reports error 0, then delete this file. Lint reports \`{{-…}}\` on a call that is not a subagent step as L-N26.
`,
}
