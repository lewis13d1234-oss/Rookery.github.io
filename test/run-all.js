import { spawnSync } from 'node:child_process';
let bad = 0;
for (const f of ['rules', 'perft', 'engine', 'server']) {
  console.log(`\n=== ${f} ===`);
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', `test/${f}.test.js`], { stdio: 'inherit' });
  if (r.status) bad++;
}
console.log(bad ? `\n${bad} suite(s) failed` : '\nall suites passed');
process.exit(bad ? 1 : 0);
