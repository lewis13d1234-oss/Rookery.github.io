// Puzzle generation. Everything produced here is verified before it is accepted:
//  - mate puzzles: proven forced mates (exhaustive mate solver), shortest mate only
//  - tactic/endgame puzzles: unique best move by a wide margin at several search depths
//  - opening puzzles: derived from the validated opening book
import { Chess, sqName, mFrom, mTo, mPromo } from './chess.js';
import { Engine, pickMove, mateMoves, longestDefence, evaluate, MATE } from './engine.js';
import { OPENINGS, nextBookMoves } from './openings.js';

const VALUE = [0, 1, 3, 3, 5, 9, 0];
const NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

function mkId(kind, fen) {
  let h = 2166136261;
  for (const c of kind + fen) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return kind[0] + (h >>> 0).toString(36);
}

function selfPlay(levelA, levelB, maxPlies = 140) {
  const g = new Chess();
  const fens = [];
  while (g.ply < maxPlies) {
    const st = g.status();
    if (st.over || g.claimableDraw()) break;
    fens.push(g.fen());
    // a little extra randomness in the opening so games differ
    let mv;
    if (g.ply < 6 && Math.random() < 0.8) { const l = g.legalMoves(); mv = g.uciOf(l[Math.floor(Math.random() * l.length)]); }
    else mv = pickMove(g, g.turn === 0 ? levelA : levelB, { movetimeCap: 60 })?.move;
    if (!mv || !g.move(mv)) break;
  }
  return { fens, final: g.status(), game: g };
}

function sanLine(fen, ucis) {
  const g = new Chess(fen); const out = [];
  for (const u of ucis) { const m = g.move(u); if (!m) break; out.push(m.san); }
  return out;
}

function numberedLine(fen, ucis) {
  const g = new Chess(fen), parts = [];
  for (const u of ucis) {
    const wasWhite = g.turn === 0, num = g.full;
    const m = g.move(u); if (!m) break;
    if (wasWhite) parts.push(`${num}. ${m.san}`); else parts.push(parts.length ? m.san : `${num}... ${m.san}`);
  }
  return parts.join(' ');
}

function backRankMate(fen, ucis) {
  const g = new Chess(fen);
  let last = null;
  for (const u of ucis) { last = g.move(u); if (!last) return false; }
  if (!g.isCheckmate()) return false;
  const k = g.kings[g.turn], rank = k >> 4;
  return (rank === 0 || rank === 7) && (last.piece === 'r' || last.piece === 'q') && last.to[1] === (rank === 0 ? '1' : '8');
}

// ---------------- mate puzzles ----------------
export function mateFromPosition(fen, n) {
  const g = new Chess(fen);
  const first = n <= 2 ? mateMoves(g, n) : mateMoves(g, n, { checksOnlyAfterFirst: true });
  if (!first.length) return null;
  if (n > 1) { // must be minimal
    const shorter = mateMoves(g, n - 1, { checksOnlyAfterFirst: n - 1 > 2 });
    if (shorter.length) return null;
  }
  if (first.length > (n === 1 ? 3 : 2)) return null;
  // principal variation: first solution + longest defence
  const line = [];
  const p = new Chess(fen);
  let rem = n;
  while (rem > 0) {
    const sols = rem <= 2 ? mateMoves(p, rem) : mateMoves(p, rem, { checksOnlyAfterFirst: true });
    if (!sols.length) return null;
    p.move(sols[0]); line.push(sols[0]);
    if (p.isCheckmate()) break;
    const d = longestDefence(p, rem - 1);
    if (!d) return null;
    p.move(d); line.push(d);
    rem--;
  }
  if (!p.isCheckmate()) return null;
  return { fen, kind: 'mate', mate: n, solutions: first, solution: line };
}

function explainMate(pz) {
  const san = numberedLine(pz.fen, pz.solution);
  const pat = backRankMate(pz.fen, pz.solution) ? ' This is a back-rank mate: the king is trapped behind its own pawns.' : '';
  const g = new Chess(pz.fen);
  const first = g.move(pz.solution[0]);
  const intro = pz.mate === 1 ? `${first.san} delivers checkmate.` : `${first.san} forces checkmate in ${pz.mate}.`;
  return `${intro} Main line: ${san}.${pat}`;
}

export function generateMatePuzzles({ m1 = 30, m2 = 40, m3 = 25, maxSeconds = 120, log = () => {} } = {}) {
  const want = { 1: m1, 2: m2, 3: m3 }, got = { 1: [], 2: [], 3: [] };
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < maxSeconds * 1000 && (got[1].length < want[1] || got[2].length < want[2] || got[3].length < want[3])) {
    const { fens, final } = selfPlay(2, 3);
    if (final.reason !== 'checkmate') continue;
    const n = fens.length;
    for (const [back, mateN] of [[1, 1], [3, 2], [5, 3]]) {
      if (n - back < 8 || got[mateN].length >= want[mateN]) continue;
      const fen = fens[n - back];
      if (seen.has(fen)) continue; seen.add(fen);
      const pz = mateFromPosition(fen, mateN);
      if (pz) {
        pz.themes = ['mate', `mateIn${mateN}`]; if (backRankMate(fen, pz.solution)) pz.themes.push('backRankMate');
        pz.id = mkId('m', fen); pz.explanation = explainMate(pz);
        const pieces = fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;
        pz.rating = Math.round(700 + 330 * (mateN - 1) + Math.min(200, pieces * 8) + (Math.random() * 60 - 30));
        pz.verified = 'proven-forced-mate';
        got[mateN].push(pz);
        log(`mate-in-${mateN} #${got[mateN].length}`);
      }
    }
  }
  return [...got[1], ...got[2], ...got[3]];
}

// ---------------- tactics ----------------
function attackedBy(g, sq) { // enemy pieces attacked by the piece on sq (pseudo-attacks)
  const us = g.turn ^ 1; // after our move it's the opponent's turn
  const out = [];
  const copy = new Chess(g.fen());
  copy.turn = us; copy.ep = -1; // moves of the piece that just moved
  const moves = copy.gen([]);
  for (const m of moves) {
    if (mFrom(m) !== sq) continue;
    const t = copy.b[mTo(m)];
    if (t && (t >> 3) !== us) out.push({ sq: mTo(m), type: t & 7 });
  }
  return out;
}

function themesFor(fen, ucis) {
  const themes = new Set();
  const g = new Chess(fen);
  const first = g.parseUci(ucis[0]);
  const piece = g.b[mFrom(first)] & 7;
  const target = g.b[mTo(first)] & 7;
  g.make(first);
  const att = attackedBy(g, mTo(first));
  const juicy = att.filter((a) => VALUE[a.type] > VALUE[piece] || a.type === 6 || !g.isAttacked(a.sq, g.turn));
  if (juicy.length >= 2) themes.add('fork');
  if (target && !g.isAttacked(mTo(first), g.turn ^ 1 ^ 1)) { /* captured piece was possibly loose */ }
  const pg = new Chess(fen);
  if (target) {
    const defended = (() => { const q = new Chess(fen); return q.isAttacked(mTo(first), q.turn ^ 1); })();
    themes.add(defended ? 'captureSequence' : 'loosePiece');
  }
  for (let i = 0; i < ucis.length; i += 2) { const mm = pg.parseUci(ucis[i]); if (mm && mPromo(mm)) themes.add('promotion'); if (!pg.move(ucis[i])) break; if (!pg.move(ucis[i + 1] || 'a1a1')) break; }
  themes.add('winMaterial');
  return [...themes];
}

export function tacticFromPosition(fen, eng, { endgame = false } = {}) {
  const g = new Chess(fen);
  if (!g.hasLegalMove()) return null;
  const stat = evaluate(g);
  if (Math.abs(stat) > 260) return null;
  const pre = eng.rootScores(g, 3); // cheap prefilter: most positions have no tactic at all
  if (pre.length < 2 || pre[0].score < 120 || pre[0].score - pre[1].score < 90) return null;
  const sc = eng.rootScores(g, 5);
  if (sc.length < 2) return null;
  if (sc[0].score < 180 || sc[0].score - sc[1].score < 150) return null;
  if (sc[0].score > MATE - 300) return null; // handled by mate generator
  // deeper confirmation
  const sc7 = eng.rootScores(g, 7);
  if (sc7[0].move !== sc[0].move || sc7[0].score < 200 || sc7[0].score - sc7[1].score < 150) return null;
  if (sc7[0].score > MATE - 300) return null;
  const line = [sc7[0].move];
  const p = new Chess(fen); p.move(sc7[0].move);
  for (let k = 0; k < 2; k++) {
    if (p.status().over) break;
    const r = eng.search(p, { depth: 7, movetime: 600 });
    if (!r.move || !p.move(r.move)) break;
    if (p.status().over) break;
    const s2 = eng.rootScores(p, 6);
    if (s2.length < 2 || s2[0].score < 150 || s2[0].score - s2[1].score < 150 || s2[0].score > MATE - 300) break;
    line.push(r.move, s2[0].move); p.move(s2[0].move);
  }
  // difficulty = shallowest depth at which the key move becomes best
  let d = 1;
  for (; d <= 5; d++) { const q = eng.rootScores(g, d); if (q[0].move === line[0] && q[0].score - (q[1]?.score ?? -999) >= 60) break; }
  const themes = themesFor(fen, line);
  const pieces = fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;
  const gain = ((sc7[0].score - stat) / 100).toFixed(1);
  const first = new Chess(fen).move(line[0]);
  const why = themes.includes('fork') ? `${first.san} attacks two valuable targets at once (a fork), so one of them falls.`
    : themes.includes('loosePiece') ? `${first.san} wins a piece that has no defender.`
    : themes.includes('promotion') ? `${first.san} starts a sequence that ends with a new queen.`
    : `${first.san} wins material by force; every other move leaves the advantage with the opponent.`;
  return {
    fen, kind: endgame || pieces <= 9 ? 'endgame' : 'tactic', mate: null, solution: line, solutions: [line[0]],
    themes: endgame || pieces <= 9 ? [...themes, 'endgame'] : themes,
    rating: Math.round(800 + 120 * (d - 1) + 50 * (line.length - 1) / 2 + Math.min(200, pieces * 5) + (Math.random() * 60 - 30)),
    explanation: `${why} Line: ${numberedLine(fen, line)}. The engine rates this about ${gain} pawns better than the position's static balance and finds no other move within 1.5 pawns.`,
    verified: 'engine-depth-7-unique',
  };
}

export function generateTacticPuzzles({ count = 80, maxSeconds = 150, log = () => {} } = {}) {
  const eng = new Engine();
  const out = [], seen = new Set();
  const t0 = Date.now();
  while (out.length < count && Date.now() - t0 < maxSeconds * 1000) {
    const { fens } = selfPlay(3, 3, 110);
    for (let i = 10; i < fens.length; i += 3) {
      if (out.length >= count || Date.now() - t0 > maxSeconds * 1000) break;
      const fen = fens[i];
      if (seen.has(fen)) continue; seen.add(fen);
      const pz = tacticFromPosition(fen, eng);
      if (pz) { pz.id = mkId('t', fen); out.push(pz); log(`tactic ${out.length} (${pz.kind})`); }
    }
  }
  return out;
}

// ---------------- endgames ----------------
function randSq() { return Math.floor(Math.random() * 8) + 16 * Math.floor(Math.random() * 8); }

export function generateEndgameMates({ count = 25, maxSeconds = 60, log = () => {} } = {}) {
  const sets = [['Q'], ['R'], ['R', 'R'], ['Q', 'R'], ['Q', 'B'], ['R', 'B']];
  const out = [], seen = new Set(), t0 = Date.now();
  while (out.length < count && Date.now() - t0 < maxSeconds * 1000) {
    const set = sets[Math.floor(Math.random() * sets.length)];
    const used = new Set(); const place = () => { let s; do { s = randSq(); } while (used.has(s)); used.add(s); return s; };
    const wk = place(), bk = place();
    if (Math.max(Math.abs((wk & 7) - (bk & 7)), Math.abs((wk >> 4) - (bk >> 4))) < 2) continue;
    const rows = Array.from({ length: 8 }, () => Array(8).fill(1));
    const put = (sq, ch) => { rows[7 - (sq >> 4)][sq & 7] = ch; };
    put(wk, 'K'); put(bk, 'k');
    for (const p of set) put(place(), p);
    const fen = rows.map((r) => { let s = '', e = 0; for (const c of r) { if (c === 1) e++; else { if (e) { s += e; e = 0; } s += c; } } return s + (e || ''); }).join('/') + ' w - - 0 1';
    let g; try { g = new Chess(fen); } catch { continue; }
    if (seen.has(fen)) continue; seen.add(fen);
    for (const n of [2, 3]) {
      const pz = mateFromPosition(fen, n);
      if (pz) {
        pz.kind = 'endgame'; pz.themes = ['endgame', 'mate', `mateIn${n}`]; pz.id = mkId('e', fen);
        pz.explanation = explainMate(pz); pz.rating = 900 + 250 * (n - 2) + Math.round(Math.random() * 80); pz.verified = 'proven-forced-mate';
        out.push(pz); log(`endgame mate-in-${n} #${out.length}`); break;
      }
    }
  }
  return out;
}

export function generatePawnEndgames({ count = 12, maxSeconds = 60, log = () => {} } = {}) {
  const eng = new Engine();
  const out = [], seen = new Set(), t0 = Date.now();
  while (out.length < count && Date.now() - t0 < maxSeconds * 1000) {
    const used = new Set(); const place = (pawn) => { let s; do { s = randSq(); if (pawn && ((s >> 4) < 2 || (s >> 4) > 5)) s = -1; } while (s < 0 || used.has(s)); used.add(s); return s; };
    const wp = place(true), wk = place(), bk = place();
    if (Math.max(Math.abs((wk & 7) - (bk & 7)), Math.abs((wk >> 4) - (bk >> 4))) < 2) continue;
    if ((wp >> 4) < 4) continue; // keep the pawn advanced so promotion is within the horizon
    const rows = Array.from({ length: 8 }, () => Array(8).fill(1));
    const put = (sq, ch) => { rows[7 - (sq >> 4)][sq & 7] = ch; };
    put(wk, 'K'); put(bk, 'k'); put(wp, 'P');
    const fen = rows.map((r) => { let s = '', e = 0; for (const c of r) { if (c === 1) e++; else { if (e) { s += e; e = 0; } s += c; } } return s + (e || ''); }).join('/') + ' w - - 0 1';
    let g; try { g = new Chess(fen); } catch { continue; }
    if (seen.has(fen) || g.inCheck()) continue; seen.add(fen);
    const sc = eng.rootScores(g, 12);
    if (sc.length < 2 || sc[0].score < 600 || sc[0].score - sc[1].score < 400) continue;
    const confirm = eng.rootScores(g, 15);
    if (confirm[0].move !== sc[0].move || confirm[0].score < 600 || confirm[0].score - confirm[1].score < 400) continue;
    const line = [sc[0].move];
    const r = eng.search(new Chess(fen), { depth: 14, movetime: 4000 });
    const first = new Chess(fen).move(line[0]);
    out.push({
      id: mkId('k', fen), fen, kind: 'endgame', mate: null, solution: line, solutions: [line[0]], themes: ['endgame', 'pawnEndgame', 'promotion'],
      rating: 1200 + Math.round(Math.random() * 300),
      explanation: `${first.san} is the only move that keeps the win. Other moves let the defending king catch the pawn or reach a drawn position. Engine principal variation: ${sanLine(fen, r.pv.slice(0, 8)).join(' ')}.`,
      verified: 'engine-depth-15-unique',
    });
    log(`pawn endgame ${out.length}`);
  }
  return out;
}

// ---------------- opening puzzles (book) ----------------
export function generateOpeningPuzzles({ max = 80 } = {}) {
  const out = [], seen = new Set();
  for (const o of OPENINGS) {
    for (let k = 2; k < o.moves.length; k++) {
      if (out.length >= max) break;
      const prefix = o.moves.slice(0, k);
      const g = Chess.replay(prefix);
      const fen = g.fen();
      if (seen.has(fen)) continue;
      const nb = nextBookMoves(prefix);
      if (!nb.length) continue;
      const mine = o.moves[k];
      // every book continuation is accepted, the main-line move is the displayed solution
      const alts = [...new Set(nb.map((x) => x.san))].map((san) => new Chess(fen).move(san).lan);
      const sol = new Chess(fen).move(mine).lan;
      const note = o.notes[k];
      // keep only positions with a pedagogical note, or the last move of the line
      if (!note && k !== o.moves.length - 1) continue;
      seen.add(fen);
      const side = g.turn === 0 ? 'White' : 'Black';
      out.push({
        id: mkId('o', fen), fen, kind: 'opening', mate: null, solution: [sol], solutions: [...new Set([sol, ...alts])], themes: ['opening', o.family],
        rating: Math.round(600 + k * 45 + Math.random() * 50),
        explanation: `${side} plays ${mine} in the ${o.name} (${o.eco}). ${note || o.idea}`,
        verified: 'opening-book', opening: { eco: o.eco, name: o.name },
      });
    }
  }
  return out;
}

export function dedupe(list) {
  const seen = new Set();
  return list.filter((p) => { const k = p.fen; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Re-verify an existing puzzle record; returns null if OK or a message. */
export function verifyPuzzle(pz) {
  let g;
  try { g = new Chess(pz.fen); } catch (e) { return 'bad FEN: ' + e.message; }
  if (!g.hasLegalMove()) return 'no legal moves';
  if (pz.mate) {
    const sols = pz.mate <= 2 ? mateMoves(g, pz.mate) : mateMoves(g, pz.mate, { checksOnlyAfterFirst: true });
    if (!sols.length) return 'not a forced mate in ' + pz.mate;
    if (!sols.includes(pz.solution[0])) return 'stored solution is not a mating move';
    return null;
  }
  const p = new Chess(pz.fen);
  for (const u of pz.solution) if (!p.move(u)) return 'illegal solution move ' + u;
  for (const u of pz.solutions || []) if (!new Chess(pz.fen).move(u)) return 'illegal alt ' + u;
  return null;
}
