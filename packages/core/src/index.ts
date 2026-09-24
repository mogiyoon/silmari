// @silmari/core — documents in, graph out. Nothing here touches a file system, so it runs in a browser as well as in Node.
// Anything that reads or writes files is @silmari/core/node (src/node/), and no file outside that folder may import `node:`.
// test/browser.test.ts holds that line: it fails if one creeps in, and again if an esbuild browser bundle of this entry
// pulls in a Node built-in.
export * from './ir.ts'
export { parseDoc, byteOffset, slug } from './parse.ts'
export type { Doc, Link, Diag } from './parse.ts'
export { buildGraph, resolve, templateRegex, type BuildOptions } from './graph.ts'
export { parseConfig, CONFIG_PATH, ENTRY_MAIN, ENTRY_FILES, ENTRY_DIRS, isConventionalEntry, type Config } from './config.ts'
export { addDiagnostics, compareVersions, UPDATES_DIR } from './notes.ts'
export { format, summary } from './lint.ts'
