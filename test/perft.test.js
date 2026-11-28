// Verifies move generation against the published perft node counts (chessprogramming.org/Perft_Results).
import { Chess, START_FEN } from '../shared/chess.js';

const cases = [
  ['startpos', START_FEN, [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862, 4085603]],
  ['position3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238, 674624]],
  ['position4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467, 422333]],
  ['position5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379, 2103487]],
  ['position6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890, 3894594]],
];

let fail = 0;
for (const [name, fen, expected] of cases) {
  const g = new Chess(fen);
  const t = Date.now();
  expected.forEach((exp, i) => {
    const got = g.perft(i + 1);
    const ok = got === exp;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} d${i + 1}: ${got}${ok ? '' : ' (expected ' + exp + ')'}`);
  });
  if (g.fen() !== new Chess(fen).fen()) { fail++; console.log('FAIL state not restored after perft for', name); }
  console.log(`   ${name} took ${Date.now() - t}ms`);
}
if (fail) { console.error(`${fail} perft failures`); process.exit(1); }
console.log('perft: all passed');
