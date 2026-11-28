// Generates data/puzzles.json. Usage: node scripts/generate-puzzles.js [--append] [--quick]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMatePuzzles, generateTacticPuzzles, generateEndgameMates, generatePawnEndgames, generateOpeningPuzzles, dedupe, verifyPuzzle } from '../shared/puzzlegen.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'data', 'puzzles.json');
const quick = process.argv.includes('--quick');
const append = process.argv.includes('--append');
const arg = (k) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1];
const only = arg('only');
const outFile = arg('out') || out;
const merge = process.argv.includes('--merge');
const t = Date.now();
const log = (m) => process.stdout.write(`\r[${((Date.now() - t) / 1000).toFixed(0)}s] ${m}        `);

let all = [];
if (append && fs.existsSync(out)) all = JSON.parse(fs.readFileSync(out, 'utf8'));

if (merge) { // node scripts/generate-puzzles.js --merge a.json b.json ...
  const files = process.argv.slice(2).filter((a) => a.endsWith('.json'));
  let m = fs.existsSync(out) && append ? JSON.parse(fs.readFileSync(out, 'utf8')) : [];
  for (const f of files) m.push(...JSON.parse(fs.readFileSync(f, 'utf8')));
  m = dedupe(m).filter((p) => !verifyPuzzle(p));
  m.sort((a, b) => a.rating - b.rating);
  fs.writeFileSync(out, JSON.stringify(m));
  const k = {}; for (const p of m) k[p.kind] = (k[p.kind] || 0) + 1;
  console.log(`merged ${m.length} puzzles`, k); process.exit(0);
}
const scale = quick ? 0.25 : 1;
const batches = [
  ['mate', () => generateMatePuzzles({ m1: Math.ceil(40 * scale), m2: Math.ceil(50 * scale), m3: Math.ceil(30 * scale), maxSeconds: 150 * scale, log })],
  ['tactics', () => generateTacticPuzzles({ count: Math.ceil(110 * scale), maxSeconds: 240 * scale, log })],
  ['endgame mates', () => generateEndgameMates({ count: Math.ceil(30 * scale), maxSeconds: 60 * scale, log })],
  ['pawn endgames', () => generatePawnEndgames({ count: Math.ceil(12 * scale), maxSeconds: 90 * scale, log })],
  ['opening', () => generateOpeningPuzzles({ max: 90 })],
];
for (const [name, fn] of batches) {
  if (only && !name.startsWith(only)) continue;
  const got = fn();
  console.log(`\n${name}: ${got.length}`);
  all.push(...got);
}
all = dedupe(all);
let bad = 0;
all = all.filter((p) => { const e = verifyPuzzle(p); if (e) { bad++; console.log('dropped', p.id, e); return false; } return true; });
all.sort((a, b) => a.rating - b.rating);
fs.writeFileSync(outFile, JSON.stringify(all));
const byKind = {};
for (const p of all) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
console.log(`\nwrote ${all.length} puzzles (${bad} dropped on re-verification)`, byKind);
