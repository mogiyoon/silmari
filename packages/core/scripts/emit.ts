// 골든 IR 재생성 — test/fixtures/after → graph.example.json.
// 실행: node --experimental-strip-types packages/core/scripts/emit.ts
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadDir, buildGraph } from '../src/index.ts'

const root = fileURLToPath(new URL('../test/fixtures/after/', import.meta.url))
const graph = buildGraph(loadDir(root))
const out = root + 'graph.example.json'
writeFileSync(out, JSON.stringify(graph, null, 2) + '\n')
console.log(`emitted ${out} — 노드 ${graph.stats.nodes} · 엣지 ${graph.stats.edges} · 진단 ${graph.stats.diagnostics}`)
