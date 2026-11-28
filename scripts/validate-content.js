// Validates lessons, openings and puzzles against the rules engine. Exits non-zero on any problem.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess, sqFromName } from '../shared/chess.js';
import { Engine, mateMoves } from '../shared/engine.js';
import { LESSONS } from '../data/lessons.js';
import { validateOpenings } from '../shared/openings.js';
import { verifyPuzzle } from '../shared/puzzlegen.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const problems = [], warnings = [];
const eng = new Engine();

for (const p of validateOpenings()) problems.push('opening: ' + p);

const ids = new Set();
let exercises = 0;
for (const l of LESSONS) {
  if (ids.has(l.id)) problems.push('duplicate lesson id ' + l.id); ids.add(l.id);
  if (!l.steps.some((s) => s.type === 'exercise')) problems.push(`${l.id}: no exercise`);
  l.steps.forEach((s, i) => {
    const where = `${l.id}#${i}`;
    if (s.fen) { try { new Chess(s.fen); } catch (e) { problems.push(`${where}: bad FEN ${e.message}`); } }
    if (s.type !== 'exercise') return;
    exercises++;
    if (s.kind === 'move') {
      const g = new Chess(s.fen);
      for (const u of s.solutions) if (!g.parseUci(u)) problems.push(`${where}: illegal solution ${u}`);
      const r = eng.rootScores(g, 5);
      const bestScore = r[0].score;
      const sol = r.filter((x) => s.solutions.includes(x.move));
      if (!sol.length || bestScore - Math.max(...sol.map((x) => x.score)) > 60) warnings.push(`${where}: engine prefers ${r[0].move} (${r[0].score}) over listed solutions (${sol.map((x) => x.score)})`);
    } else if (s.kind === 'reach') {
      const g = new Chess(s.fen);
      if (!g.moves({ square: s.square }).length) problems.push(`${where}: piece on ${s.square} has no moves`);
    } else if (s.kind === 'mate') {
      const g = new Chess(s.fen);
      let found = false;
      for (let k = 1; k <= s.n && !found; k++) if ((k <= 2 ? mateMoves(g, k) : mateMoves(g, k, { checksOnlyAfterFirst: true })).length) found = true;
      if (!found) problems.push(`${where}: no forced mate within ${s.n}`);
    } else if (s.kind === 'choice') {
      if (!(s.answer >= 0 && s.answer < s.options.length)) problems.push(`${where}: bad answer index`);
    } else if (s.kind === 'line') {
      try { Chess.replay(s.moves.split(' ')); } catch (e) { problems.push(`${where}: ${e.message}`); }
    } else problems.push(`${where}: unknown exercise kind ${s.kind}`);
  });
}

const pzFile = path.join(here, '..', 'data', 'puzzles.json');
let pzCount = 0;
if (fs.existsSync(pzFile)) {
  const pz = JSON.parse(fs.readFileSync(pzFile, 'utf8'));
  pzCount = pz.length;
  for (const p of pz) { const e = verifyPuzzle(p); if (e) problems.push(`puzzle ${p.id}: ${e}`); }
} else warnings.push('data/puzzles.json missing — run npm run gen-puzzles');

console.log(`${LESSONS.length} lessons, ${exercises} exercises, ${pzCount} puzzles checked`);
for (const w of warnings) console.log('WARN', w);
for (const p of problems) console.log('FAIL', p);
if (problems.length) process.exit(1);
console.log('content validation passed');
