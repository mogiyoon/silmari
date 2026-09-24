// Refuses to build a tarball with npm.
//
// exports points at src/*.ts so the workspace runs on source. What npm ships has to point at dist, and the rewrite comes from
// publishConfig.exports — which pnpm applies when it packs and npm does not (npm's publishConfig only carries config values
// such as registry, tag and access). Packed with npm, @silmari/core would install with exports pointing at src/index.ts,
// a file the tarball does not contain, and every import of it would fail. A published version cannot be replaced, so this
// stops before the tarball exists rather than after.
//
//   pnpm pack       inspect the tarball
//   pnpm publish    publish it
const agent = process.env.npm_config_user_agent ?? ''
if (!/\bpnpm\//.test(agent)) {
  process.stderr.write(`@silmari/core must be packed and published with pnpm, not ${agent.split('/')[0] || 'this client'}.\n`)
  process.stderr.write('Only pnpm applies publishConfig.exports, which repoints exports from src/ to dist/. Run: pnpm pack · pnpm publish\n')
  process.exit(1)
}
