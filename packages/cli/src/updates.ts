// Update notes: what changed in the notation between versions and what an agent should check in the project's documents.
// `sil update` writes the notes newer than the recorded version to .sil/updates/<version>.md and asks the agent, through one line in
// the start files, to apply them in order and delete them. Only versions that changed the notation have a note; a version that only
// changed silmari's own files (SILMARI.md sections, config) needs none, since `sil update` rewrites those itself.
export const UPDATE_NOTES: Record<string, string> = {
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
