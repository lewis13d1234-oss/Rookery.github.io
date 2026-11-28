import assert from 'node:assert/strict';
import { Chess, START_FEN } from '../shared/chess.js';
import { parsePgn, toPgn } from '../shared/pgn.js';
import { update } from '../shared/glicko2.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; console.log('PASS', name); } catch (e) { console.error('FAIL', name, '\n', e); process.exitCode = 1; } };

t('scholar\'s mate', () => {
  const g = new Chess();
  for (const m of ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']) assert.ok(g.move(m), m);
  assert.equal(g.isCheckmate(), true);
  assert.deepEqual(g.status(), { over: true, result: '1-0', reason: 'checkmate' });
});

t('fool\'s mate', () => {
  const g = new Chess();
  for (const m of ['f3', 'e5', 'g4', 'Qh4#']) assert.ok(g.move(m), m);
  assert.equal(g.status().result, '0-1');
});

t('stalemate', () => {
  const g = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(g.isStalemate(), true);
  assert.equal(g.status().reason, 'stalemate');
});

t('castling both sides and rights lost', () => {
  const g = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.ok(g.moves().includes('O-O') && g.moves().includes('O-O-O'));
  g.move('O-O');
  assert.equal(g.get('g1').type, 'k'); assert.equal(g.get('f1').type, 'r');
  assert.ok(g.moves().includes('O-O') === false);
  g.undo();
  assert.equal(g.fen(), 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
});

t('cannot castle through check or out of check', () => {
  const g = new Chess('4k3/8/8/8/8/5r2/8/R3K2R w KQ - 0 1');
  assert.ok(!g.moves().includes('O-O'));
  assert.ok(g.moves().includes('O-O-O'));
  const h = new Chess('4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1');
  assert.ok(!h.moves().includes('O-O') && !h.moves().includes('O-O-O'));
});

t('en passant', () => {
  const g = new Chess();
  for (const m of ['e4', 'a6', 'e5', 'd5']) g.move(m);
  assert.ok(g.moves().includes('exd6'));
  const mv = g.move('exd6');
  assert.equal(mv.captured, 'p'); assert.equal(g.get('d5'), null);
  g.undo();
  assert.equal(g.get('d5').type, 'p');
});

t('en passant only appears in FEN when capturable', () => {
  const g = new Chess(); g.move('e4');
  assert.equal(g.fen().split(' ')[3], '-');
  const h = new Chess('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 3');
  assert.equal(h.fen().split(' ')[3], 'e3');
});

t('pawn promotion & SAN', () => {
  const g = new Chess('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  assert.deepEqual(g.moves().sort(), ['Ka2', 'Kb1', 'Kb2', 'a8=B', 'a8=N', 'a8=Q', 'a8=R']);
  const mv = g.move({ from: 'a7', to: 'a8', promotion: 'q' });
  assert.equal(mv.san, 'a8=Q');
  const chk = new Chess('7k/P7/8/8/8/8/8/K7 w - - 0 1');
  assert.ok(chk.moves().includes('a8=Q+'));
  assert.equal(g.get('a8').type, 'q');
  g.undo();
  assert.equal(g.get('a7').type, 'p');
});

t('SAN disambiguation', () => {
  const g = new Chess('4k3/8/8/8/8/8/4K3/R6R w - - 0 1');
  assert.ok(g.moves().includes('Rad1') && g.moves().includes('Rhd1'));
  const h = new Chess('4k3/8/8/8/R7/8/8/R3K3 w - - 0 1');
  assert.ok(h.moves().includes('R4a2') || h.moves().includes('R1a2'));
});

t('threefold repetition is claimable, fivefold automatic', () => {
  const g = new Chess();
  const cyc = ['Nf3', 'Nf6', 'Ng1', 'Ng8'];
  for (let i = 0; i < 2; i++) for (const m of cyc) g.move(m);
  assert.equal(g.claimableDraw(), 'threefold');
  assert.equal(g.status().over, false);
  for (let i = 0; i < 2; i++) for (const m of cyc) g.move(m);
  assert.equal(g.status().reason, 'fivefold');
});

t('fifty-move claim and seventy-five automatic', () => {
  const g = new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 100 80');
  assert.equal(g.claimableDraw(), 'fifty');
  const h = new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 150 100');
  assert.equal(h.status().reason, 'seventyfive');
});

t('insufficient material', () => {
  assert.equal(new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1').isInsufficientMaterial(), true);
  assert.equal(new Chess('4k3/8/8/8/8/8/8/3BK3 w - - 0 1').isInsufficientMaterial(), true);
  assert.equal(new Chess('4k3/8/8/8/8/8/8/2NNK3 w - - 0 1').isInsufficientMaterial(), false);
  assert.equal(new Chess('4k3/8/8/8/8/8/8/3RK3 w - - 0 1').isInsufficientMaterial(), false);
  // bishops on same colour
  assert.equal(new Chess('4kb2/8/8/8/8/8/8/2B1K3 w - - 0 1').isInsufficientMaterial(), true);
  assert.equal(new Chess('2b1k3/8/8/8/8/8/8/2B1K3 w - - 0 1').isInsufficientMaterial(), false);
});

t('rejects illegal moves and bad FEN', () => {
  const g = new Chess();
  assert.equal(g.move('e5'), null);
  assert.equal(g.move({ from: 'e2', to: 'e5' }), null);
  assert.throws(() => new Chess('nonsense'));
  assert.throws(() => new Chess('8/8/8/8/8/8/8/8 w - - 0 1'));
  assert.throws(() => new Chess('4k3/8/8/8/8/8/8/4K2R b - - 0 1'.replace('4K2R', '4K2r')));
});

t('pinned piece cannot move', () => {
  const g = new Chess('4k3/4r3/8/8/8/8/4N3/4K3 w - - 0 1');
  assert.equal(g.moves({ square: 'e2' }).length, 0);
});

t('PGN round trip with comments and variations', () => {
  const text = `[Event "T"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 {best} e5 (1... c5 2. Nf3) 2. Nf3 $1 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O 1-0\n\n[Event "T2"]\n[Result "*"]\n\n1. d4 d5 *`;
  const { games, errors } = parsePgn(text);
  assert.equal(errors.length, 0); assert.equal(games.length, 2);
  assert.deepEqual(games[0].moves, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']);
  const out = toPgn({ headers: games[0].headers, moves: games[0].moves, result: '1-0' });
  const re = parsePgn(out);
  assert.deepEqual(re.games[0].moves, games[0].moves);
});

t('PGN with illegal move is rejected', () => {
  const { games, errors } = parsePgn('[Event "x"]\n\n1. e4 e5 2. Ke3 *');
  assert.equal(games.length, 0); assert.equal(errors.length, 1);
});

t('Glicko-2 reproduces Glickman\'s worked example', () => {
  const r = update({ rating: 1500, rd: 200, vol: 0.06 }, [
    { rating: 1400, rd: 30, score: 1 }, { rating: 1550, rd: 100, score: 0 }, { rating: 1700, rd: 300, score: 0 }]);
  assert.ok(Math.abs(r.rating - 1464.06) < 0.05, 'rating ' + r.rating);
  assert.ok(Math.abs(r.rd - 151.52) < 0.05, 'rd ' + r.rd);
  assert.ok(Math.abs(r.vol - 0.05999) < 0.0001, 'vol ' + r.vol);
});

console.log(`\n${n} rules tests executed`);
