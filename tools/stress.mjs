#!/usr/bin/env node
// Generates a large corpus for stress-testing sil view. Usage: node tools/stress.mjs <outDir> [flows=5] [depth=3] [fanout=4]
// Each flow is a disconnected call tree (root → fanout children → … depth levels) with: subagent labels on every other call,
// one return loop per flow, one shared reference doc per flow, one ghost link, and a few orphans. Files = flows × (fanout + fanout² + …) + extras.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const [out = 'stress', flows = 5, depth = 3, fanout = 4] = process.argv.slice(2).map((v, i) => (i ? Number(v) : v))
rmSync(out, { recursive: true, force: true }); mkdirSync(join(out, '.sil'), { recursive: true })
writeFileSync(join(out, '.sil/config.yaml'), 'entry: [flow-1.md]\nwords:\n  inputs: [inputs, input]\n  outputs: [outputs, output]\n  task: [steps, procedure]\n')
let files = 0
const write = (name, text) => { writeFileSync(join(out, `${name}.md`), text); files++ }
const calls = (kids) => kids.map((c, k) => `## ${k + 1}. ${c}${k % 2 ? ' ((use a subagent))' : ''}\n\n[${c}](${c}.md) receives {{>in${c}}} and returns {{<out${c}}}.\n`).join('\n')
/** Writes node `name` at `level` and its whole subtree. A node calls fanout children until the last level, which are leaves. */
const node = (name, level, f) => {
  const kids = level < depth ? Array.from({ length: fanout }, (_, j) => `${name}-${j + 1}`) : []
  const body = kids.length
    ? `# ${name}\n\nStep ${name}. Reads [rules ${f}](rules-${f}.md).\n\n${calls(kids)}\n## Inputs\n- in${name}\n\n## Outputs\n- out${name}\n`
    : `# ${name}\n\nLeaf ${name}. Does one thing and returns it.\n\n## Inputs\n- in${name}\n\n## Steps\n\nRead the input, do the work, write the output.\n\n## Outputs\n- out${name}\n`
  write(name, body)
  for (const c of kids) node(c, level + 1, f)
}
for (let f = 1; f <= flows; f++) {
  const top = Array.from({ length: fanout }, (_, k) => `f${f}-${k + 1}`)
  const flow = [`# Flow ${f}`, '', `Stress flow ${f}: depth ${depth}, fanout ${fanout}. Every other call is a subagent.`, '', '## Inputs', `- job${f}`, '', '## Outputs', `- result${f}`, '',
    calls(top),
    `## If the result is rejected (at most 2 times)`, '', `[${top[0]}](${top[0]}.md) receives {{>fixes${f}}} and returns {{<out${top[0]}}} again, then go back to step 2.`, '',
    `## ${fanout + 1}. Wrap up`, '', `Write the summary. See [archive](archive-${f}.md) and the missing [checklist](checklist-${f}.md).`, '']
  write(`flow-${f}`, flow.join('\n'))
  for (const c of top) node(c, 1, f)
  write(`rules-${f}`, `# Rules ${f}\n\nShared reference for flow ${f}. Keep functions short.\n\n## Layers\n\nA, B, C.\n`)
  write(`archive-${f}`, `# Archive ${f}\n\nOld notes for flow ${f}.\n`)
}
for (let o = 1; o <= 3; o++) write(`orphan-${o}`, `# Orphan ${o}\n\nNobody links here.\n`)
console.log(`${files} files → ${out}`)
