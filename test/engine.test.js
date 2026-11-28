import assert from 'node:assert/strict';
import { Chess } from '../shared/chess.js';
import { Engine, LEVELS, pickMove, mateMoves, evaluate, MATE } from '../shared/engine.js';

let n = 0;
const t = (name, fn) => { try { const s = Date.now(); fn(); n++; console.log(`PASS ${name} (${Date.now() - s}ms)`); } catch (e) { console.error('FAIL', name, '\n', e); process.exitCode = 1; } };

t('finds mate in 1', () => {
  const g = new Chess('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
  const r = new Engine().search(g, { depth: 4, movetime: 2000 });
  assert.equal(r.move, 'a1a8'); assert.equal(r.mate, 1);
});

t('finds a true mate in 2 and the solver agrees', () => {
  const g = new Chess('k7/8/2K5/8/8/8/8/7R w - - 0 1');
  assert.equal(mateMoves(g, 1).length, 0, 'must not be mate in 1');
  assert.ok(mateMoves(g, 2).length > 0, 'solver should prove mate in 2');
  const r = new Engine().search(g, { depth: 6, movetime: 3000 });
  assert.equal(r.mate, 2, JSON.stringify(r));
  assert.ok(mateMoves(g, 2).includes(r.move), 'engine move must be one the solver proves');
});

t('solver rejects positions with no forced mate', () => {
  const h = new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  assert.equal(mateMoves(h, 2).length, 0);
  const k = new Chess('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.equal(mateMoves(k, 1).length, 0);
});

t('wins free material (hanging queen)', () => {
  const g = new Chess('rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1');
  const r = new Engine().search(g, { depth: 4, movetime: 2000 });
  assert.equal(r.move, 'f3h4');
});

t('avoids stalemate when winning and gives mate with KQ vs K', () => {
  const g = new Chess('7k/8/5K2/8/8/8/8/6Q1 w - - 0 1');
  const eng = new Engine();
  for (let i = 0; i < 30 && !g.status().over; i++) {
    const r = eng.search(g, { depth: 8, movetime: 800 });
    assert.ok(g.move(r.move), 'engine produced illegal move ' + r.move);
    if (!g.status().over) {
      const d = eng.search(g, { depth: 6, movetime: 300 });
      assert.ok(g.move(d.move));
    }
  }
  assert.equal(g.status().reason, 'checkmate', 'engine should convert KQ vs K, final: ' + g.fen());
});

t('every level returns legal moves, stronger levels beat weaker levels', () => {
  const play = (white, black) => {
    const g = new Chess();
    for (let i = 0; i < 160 && !g.status().over && !g.claimableDraw(); i++) {
      const lvl = g.turn === 0 ? white : black;
      const r = pickMove(g, lvl, { movetimeCap: 120 });
      assert.ok(r && g.move(r.move), `level ${lvl} illegal move ${r && r.move}`);
    }
    const s = g.status();
    return s.over ? s.result : (g.claimableDraw() ? '1/2-1/2' : '1/2-1/2');
  };
  let strongPts = 0, games = 0;
  for (let i = 0; i < 3; i++) {
    for (const [w, b, strongIsWhite] of [[4, 1, true], [1, 4, false]]) {
      const r = play(w, b); games++;
      if (r === '1/2-1/2') strongPts += 0.5; else if ((r === '1-0') === strongIsWhite) strongPts += 1;
    }
  }
  console.log(`   level 4 scored ${strongPts}/${games} vs level 1`);
  assert.ok(strongPts >= games * 0.8, 'advanced should clearly beat beginner');
});

t('evaluation is symmetric', () => {
  const a = new Chess('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
  const b = new Chess('rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq e6 0 1');
  assert.equal(evaluate(a), evaluate(b));
});

t('search speed (nodes/sec)', () => {
  const g = new Chess('r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10');
  const e = new Engine(); const s = Date.now();
  const r = e.search(g, { depth: 6, movetime: 4000 });
  const dt = (Date.now() - s) / 1000;
  console.log(`   depth ${r.depth}, ${r.nodes} nodes, ${(r.nodes / dt / 1000).toFixed(0)} knps, best ${r.move}`);
  assert.ok(r.depth >= 4);
});

console.log(`\n${n} engine tests passed`);
