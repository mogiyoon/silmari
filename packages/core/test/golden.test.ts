// Golden test. Parsing test/fixtures/after must match graph.example.json (design document §9 S1 check).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadDir, buildGraph, readConfig } from '../src/index.ts'
import type { Graph } from '../src/ir.ts'

const root = fileURLToPath(new URL('./fixtures/after/', import.meta.url))
const golden: Graph = JSON.parse(readFileSync(root + 'graph.example.json', 'utf8'))
const cfg = readConfig(root)
const got = buildGraph(loadDir(root, cfg.scan.exclude, cfg.words), { entry: cfg.entry })

test('Statistics match', () => assert.deepEqual(got.stats, golden.stats))
test('Nodes match', () => assert.deepEqual(got.nodes, golden.nodes))
test('Edges match', () => assert.deepEqual(got.edges, golden.edges))
test('Diagnostics match', () => assert.deepEqual(got.diagnostics, golden.diagnostics))
