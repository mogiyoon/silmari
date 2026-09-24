// @silmari/core/node — everything @silmari/core has, plus the parts that need a file system.
// One import specifier is enough for the CLI and the VS Code extension: they take types and the file system from here.
export * from '../index.ts'
export { loadDir, loadDirAsync, existsIn, globIn, findProjectRoot, ALWAYS_EXCLUDE, MIN_PARALLEL, docCache, type DocCache } from './load.ts'
export { readConfig } from './config.ts'
export { projectNotes } from './notes.ts'
export { writeRange, readRange, readLink, retargetLink, replaceBody, replaceBodies, WriteError, type WriteResult } from './writer.ts'
