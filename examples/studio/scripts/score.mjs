// score.mjs <verdict.json>: must 통과면 50, nice 하나에 10
const v = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'))
console.log(JSON.stringify({ score: (v.must ? 50 : 0) + 10 * (v.nice?.length ?? 0) }))
