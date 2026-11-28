// Rookery engine: iterative-deepening alpha-beta (PVS) with quiescence, transposition table,
// null-move pruning, late-move reductions, killer/history ordering and a tapered-ish evaluation.
// It is a genuine search engine written for this project (NOT Stockfish). The UI can optionally use a
// Stockfish WASM build if one is dropped into /public/vendor/stockfish (see README).
import { Chess, mFrom, mTo, mPromo, mFlags, F_CAP, F_EP } from './chess.js';

export const MATE = 30000;
const INF = 32000;
const VAL = [0, 100, 320, 330, 500, 900, 0];

// piece-square tables (white's point of view, rank 8 first), after the classic "simplified evaluation function"
const PST = {
  1: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  2: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  3: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  4: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  5: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  6: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
};
const KING_END = [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50];
const PASSED_BONUS = [0, 5, 10, 20, 35, 60, 100, 0];

function centerDist(sq) { const f = sq & 7, r = sq >> 4; return Math.max(3 - f, f - 4) + Math.max(3 - r, r - 4); }
function kingDist(a, b) { return Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 4) - (b >> 4))); }

/** Static evaluation in centipawns from the side-to-move's perspective. */
export function evaluate(pos) {
  const b = pos.b;
  let mg = 0, material = [0, 0], nonPawn = [0, 0], bishops = [0, 0], pawns = [0, 0];
  const pawnFiles = [new Int8Array(8), new Int8Array(8)];
  const pawnSq = [[], []];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = r * 16 + f, pc = b[sq];
      if (!pc) continue;
      const t = pc & 7, c = pc >> 3;
      if (t === 6) continue;
      material[c] += VAL[t];
      if (t === 1) { pawns[c]++; pawnFiles[c][f]++; pawnSq[c].push(sq); } else { nonPawn[c] += VAL[t]; if (t === 3) bishops[c]++; }
      const idx = c === 0 ? (7 - r) * 8 + f : r * 8 + f;
      const v = VAL[t] + PST[t][idx];
      mg += c === 0 ? v : -v;
    }
  }
  const phaseTotal = nonPawn[0] + nonPawn[1];
  const endgame = phaseTotal <= 2600;
  const kw = pos.kings[0], kb = pos.kings[1];
  const kiw = (7 - (kw >> 4)) * 8 + (kw & 7), kib = (kb >> 4) * 8 + (kb & 7);
  if (endgame) mg += KING_END[kiw] - KING_END[kib]; else mg += PST[6][kiw] - PST[6][kib];
  if (bishops[0] >= 2) mg += 30; if (bishops[1] >= 2) mg -= 30;
  for (let c = 0; c < 2; c++) {
    const sign = c === 0 ? 1 : -1;
    for (let f = 0; f < 8; f++) {
      if (pawnFiles[c][f] > 1) mg -= sign * 12 * (pawnFiles[c][f] - 1);
      if (pawnFiles[c][f] && !(f > 0 && pawnFiles[c][f - 1]) && !(f < 7 && pawnFiles[c][f + 1])) mg -= sign * 10; // isolated
    }
    for (const sq of pawnSq[c]) {
      const f = sq & 7, r = sq >> 4, o = c ^ 1;
      let passed = true;
      for (let rr = r + (c === 0 ? 1 : -1); rr >= 0 && rr <= 7 && passed; rr += (c === 0 ? 1 : -1)) {
        for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1); ff++) if (b[rr * 16 + ff] === (1 | (o << 3))) { passed = false; break; }
      }
      if (passed) mg += sign * PASSED_BONUS[c === 0 ? r : 7 - r] * (endgame ? 1.5 : 1);
    }
  }
  // mop-up: drive a bare king to the edge when ahead with mating material
  for (let c = 0; c < 2; c++) {
    const o = c ^ 1;
    if (pawns[o] === 0 && nonPawn[o] === 0 && (nonPawn[c] >= 500 || pawns[c] > 0)) {
      const bonus = 12 * centerDist(pos.kings[o]) + 6 * (7 - kingDist(pos.kings[0], pos.kings[1]));
      mg += c === 0 ? bonus : -bonus;
    }
  }
  const score = mg + (pos.turn === 0 ? 8 : -8);
  return pos.turn === 0 ? score : -score;
}

// ----- transposition table -----
const TT_BITS = 20, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
const EXACT = 0, LOWER = 1, UPPER = 2;

export class Engine {
  constructor() {
    this.ttLo = new Int32Array(TT_SIZE); this.ttHi = new Int32Array(TT_SIZE);
    this.ttDepth = new Int8Array(TT_SIZE).fill(-1); this.ttFlag = new Int8Array(TT_SIZE);
    this.ttScore = new Int16Array(TT_SIZE); this.ttMove = new Int32Array(TT_SIZE);
    this.killers = Array.from({ length: 128 }, () => [0, 0]);
    this.history = new Int32Array(2 * 128 * 128);
    this.moveBuf = Array.from({ length: 128 }, () => []);
    this.nodes = 0; this.stopped = false;
  }

  clear() { this.ttDepth.fill(-1); this.history.fill(0); }

  _stop() {
    if (this.stopped) return true;
    if ((this.nodes & 1023) === 0) {
      if (Date.now() >= this.deadline || this.nodes >= this.nodeLimit) this.stopped = true;
    }
    return this.stopped;
  }

  _score(pos, moves, ttMove, ply) {
    const sc = new Array(moves.length);
    const k = this.killers[ply] || [0, 0];
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (m === ttMove) sc[i] = 1e7;
      else if (mFlags(m) & F_CAP) {
        const victim = (mFlags(m) & F_EP) ? 1 : pos.b[mTo(m)] & 7, att = pos.b[mFrom(m)] & 7;
        sc[i] = 1e6 + victim * 100 - att + (mPromo(m) === 5 ? 500 : 0);
      } else if (mPromo(m)) sc[i] = 9e5 + mPromo(m);
      else if (m === k[0]) sc[i] = 8e5; else if (m === k[1]) sc[i] = 7e5;
      else sc[i] = this.history[(pos.turn * 128 + mFrom(m)) * 128 + mTo(m)];
    }
    return sc;
  }

  _quiesce(pos, alpha, beta, ply) {
    this.nodes++;
    if (this._stop()) return 0;
    const inCheck = pos.inCheck();
    let best;
    if (!inCheck) {
      best = evaluate(pos);
      if (best >= beta) return best;
      if (best > alpha) alpha = best;
    } else best = -MATE + ply;
    if (ply >= 100) return best;
    const moves = pos.gen([], !inCheck);
    const sc = this._score(pos, moves, 0, ply);
    let legal = 0;
    for (let n = 0; n < moves.length; n++) {
      let bi = n;
      for (let j = n + 1; j < moves.length; j++) if (sc[j] > sc[bi]) bi = j;
      if (bi !== n) { [moves[n], moves[bi]] = [moves[bi], moves[n]]; [sc[n], sc[bi]] = [sc[bi], sc[n]]; }
      const m = moves[n];
      if (!inCheck && !mPromo(m)) { // delta pruning
        const victim = (mFlags(m) & F_EP) ? 1 : pos.b[mTo(m)] & 7;
        if (best + VAL[victim] + 200 < alpha) continue;
      }
      if (!pos.makeLegal(m)) continue;
      legal++;
      const s = -this._quiesce(pos, -beta, -alpha, ply + 1);
      pos.unmake();
      if (this.stopped) return 0;
      if (s > best) { best = s; if (s > alpha) { alpha = s; if (s >= beta) return s; } }
    }
    if (inCheck && legal === 0) return -MATE + ply;
    return best;
  }

  _isRepetition(pos) {
    const i = pos.ply, lo = pos.kLo[i], hi = pos.kHi[i];
    const limit = Math.max(0, i - pos.half);
    for (let j = i - 2; j >= limit; j -= 2) if (pos.kLo[j] === lo && pos.kHi[j] === hi) return true;
    return false;
  }

  _search(pos, depth, alpha, beta, ply, nullOk) {
    this.nodes++;
    if (this._stop()) return 0;
    if (ply > 0) {
      if (pos.half >= 100 || this._isRepetition(pos)) return 0;
      alpha = Math.max(alpha, -MATE + ply); beta = Math.min(beta, MATE - ply - 1);
      if (alpha >= beta) return alpha;
    }
    const inCheck = pos.inCheck();
    if (inCheck && ply < 90) depth++;
    if (depth <= 0 || ply >= 100) return this._quiesce(pos, alpha, beta, ply);
    const isPV = beta - alpha > 1;
    const idx = pos.kLo[pos.ply] & TT_MASK;
    let ttMove = 0;
    if (this.ttLo[idx] === pos.kLo[pos.ply] && this.ttHi[idx] === pos.kHi[pos.ply] && this.ttDepth[idx] >= 0) {
      ttMove = this.ttMove[idx];
      if (!isPV && this.ttDepth[idx] >= depth) {
        let s = this.ttScore[idx];
        if (s > MATE - 200) s -= ply; else if (s < -MATE + 200) s += ply;
        const f = this.ttFlag[idx];
        if (f === EXACT || (f === LOWER && s >= beta) || (f === UPPER && s <= alpha)) return s;
      }
    }
    // null-move pruning
    if (!isPV && nullOk && !inCheck && depth >= 3) {
      const us = pos.turn; let np = 0;
      for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const p = pos.b[s]; if (p && (p >> 3) === us) { const t = p & 7; if (t > 1 && t < 6) np++; } }
      if (np > 0 && evaluate(pos) >= beta) {
        pos.makeNull();
        const s = -this._search(pos, depth - 1 - (depth > 6 ? 3 : 2), -beta, -beta + 1, ply + 1, false);
        pos.unmake();
        if (this.stopped) return 0;
        if (s >= beta) return s >= MATE - 200 ? beta : s;
      }
    }
    const moves = pos.gen(this.moveBuf[ply] || []);
    const sc = this._score(pos, moves, ttMove, ply);
    let best = -INF, bestMove = 0, legal = 0, flag = UPPER;
    const origAlpha = alpha;
    for (let n = 0; n < moves.length; n++) {
      let bi = n;
      for (let j = n + 1; j < moves.length; j++) if (sc[j] > sc[bi]) bi = j;
      if (bi !== n) { [moves[n], moves[bi]] = [moves[bi], moves[n]]; [sc[n], sc[bi]] = [sc[bi], sc[n]]; }
      const m = moves[n];
      const quiet = !(mFlags(m) & F_CAP) && !mPromo(m);
      if (!pos.makeLegal(m)) continue;
      legal++;
      let s;
      const givesCheck = pos.inCheck();
      if (legal === 1) s = -this._search(pos, depth - 1, -beta, -alpha, ply + 1, true);
      else {
        let red = 0;
        if (depth >= 3 && quiet && !inCheck && !givesCheck && legal > 3) red = legal > 8 ? 2 : 1;
        s = -this._search(pos, depth - 1 - red, -alpha - 1, -alpha, ply + 1, true);
        if (s > alpha && red) s = -this._search(pos, depth - 1, -alpha - 1, -alpha, ply + 1, true);
        if (s > alpha && s < beta) s = -this._search(pos, depth - 1, -beta, -alpha, ply + 1, true);
      }
      pos.unmake();
      if (this.stopped) return 0;
      if (s > best) {
        best = s; bestMove = m;
        if (s > alpha) {
          alpha = s; flag = EXACT;
          if (s >= beta) {
            flag = LOWER;
            if (quiet) {
              const k = this.killers[ply]; if (k && k[0] !== m) { k[1] = k[0]; k[0] = m; }
              this.history[(pos.turn * 128 + mFrom(m)) * 128 + mTo(m)] += depth * depth;
            }
            break;
          }
        }
      }
    }
    if (legal === 0) return inCheck ? -MATE + ply : 0;
    let store = best;
    if (store > MATE - 200) store += ply; else if (store < -MATE + 200) store -= ply;
    if (this.ttDepth[idx] <= depth || this.ttLo[idx] !== pos.kLo[pos.ply]) {
      this.ttLo[idx] = pos.kLo[pos.ply]; this.ttHi[idx] = pos.kHi[pos.ply]; this.ttDepth[idx] = Math.min(depth, 127);
      this.ttFlag[idx] = flag; this.ttScore[idx] = store; this.ttMove[idx] = bestMove;
    }
    return best;
  }

  _pv(pos, first, maxLen = 12) {
    const pv = [], made = [];
    let m = first;
    for (let i = 0; i < maxLen && m; i++) {
      if (!pos.makeLegal(m)) break;
      made.push(m); pv.push(pos.uciOf(m));
      const idx = pos.kLo[pos.ply] & TT_MASK;
      m = (this.ttLo[idx] === pos.kLo[pos.ply] && this.ttHi[idx] === pos.kHi[pos.ply] && this.ttDepth[idx] >= 0) ? this.ttMove[idx] : 0;
      if (pos.status().over) break;
    }
    for (let i = made.length; i > 0; i--) pos.unmake();
    return pv;
  }

  /**
   * Iterative deepening search.
   * @returns {{move:string|null, score:number, depth:number, nodes:number, pv:string[], mate:number|null}}
   * score is centipawns from the side to move's point of view.
   */
  search(pos, { depth = 64, movetime = 1000, nodes = Infinity, onInfo = null } = {}) {
    this.nodes = 0; this.stopped = false;
    this.deadline = Date.now() + movetime; this.nodeLimit = nodes;
    for (const k of this.killers) { k[0] = 0; k[1] = 0; }
    const rootMoves = pos.legalMoves();
    if (!rootMoves.length) return { move: null, score: pos.inCheck() ? -MATE : 0, depth: 0, nodes: 0, pv: [], mate: pos.inCheck() ? 0 : null };
    let best = rootMoves[0], bestScore = 0, doneDepth = 0, pv = [];
    const baseKey = pos.ply;
    for (let d = 1; d <= depth; d++) {
      let alpha = -INF, beta = INF, iterBest = 0, iterScore = -INF;
      // order: previous best first
      rootMoves.sort((a, b2) => (b2 === best) - (a === best));
      for (let n = 0; n < rootMoves.length; n++) {
        const m = rootMoves[n];
        pos.make(m);
        let s;
        if (n === 0) s = -this._search(pos, d - 1, -beta, -alpha, 1, true);
        else {
          s = -this._search(pos, d - 1, -alpha - 1, -alpha, 1, true);
          if (s > alpha && !this.stopped) s = -this._search(pos, d - 1, -beta, -alpha, 1, true);
        }
        pos.unmake();
        if (this.stopped) break;
        if (s > iterScore) { iterScore = s; iterBest = m; if (s > alpha) alpha = s; }
      }
      if (this.stopped && !iterBest) break;
      if (iterBest) { best = iterBest; bestScore = iterScore; }
      if (this.stopped) { break; }
      doneDepth = d;
      const idx = pos.kLo[baseKey] & TT_MASK;
      this.ttLo[idx] = pos.kLo[baseKey]; this.ttHi[idx] = pos.kHi[baseKey]; this.ttDepth[idx] = d; this.ttFlag[idx] = EXACT; this.ttScore[idx] = bestScore; this.ttMove[idx] = best;
      pv = this._pv(pos, best);
      if (onInfo) onInfo({ depth: d, score: bestScore, nodes: this.nodes, pv, mate: mateIn(bestScore) });
      if (Math.abs(bestScore) > MATE - 100 && d >= 2 + Math.floor((MATE - Math.abs(bestScore)) / 2)) break;
      if (Date.now() >= this.deadline) break;
    }
    return { move: pos.uciOf(best), score: bestScore, depth: doneDepth, nodes: this.nodes, pv: pv.length ? pv : [pos.uciOf(best)], mate: mateIn(bestScore) };
  }

  /** Score every root move at a fixed depth. Used for puzzle generation, noise-based weak levels and analysis. */
  rootScores(pos, depth, movetimeEach = 1e9) {
    const out = [];
    for (const m of pos.legalMoves()) {
      pos.make(m);
      this.nodes = 0; this.stopped = false; this.deadline = Date.now() + movetimeEach; this.nodeLimit = Infinity;
      const s = -this._search(pos, depth - 1, -INF, INF, 1, true);
      pos.unmake();
      out.push({ move: pos.uciOf(m), m, score: s });
    }
    return out.sort((a, b) => b.score - a.score);
  }
}

export function mateIn(score) {
  if (score > MATE - 200) return Math.ceil((MATE - score) / 2);
  if (score < -MATE + 200) return -Math.ceil((MATE + score) / 2);
  return null;
}

// ------------------------------------------------------------------------------------------------
// Playing strength levels. Strength is shaped by search depth, think time and (for the weakest levels)
// calibrated evaluation noise, so low levels play sensible-but-human mistakes rather than random moves.
// Elo figures are rough estimates for orientation only; they have not been measured against rated players.
export const LEVELS = [
  { id: 1, name: 'Beginner', approxElo: 500, depth: 1, noise: 220, blunder: 0.25, movetime: 200 },
  { id: 2, name: 'Easy', approxElo: 900, depth: 2, noise: 110, blunder: 0.08, movetime: 300 },
  { id: 3, name: 'Intermediate', approxElo: 1300, depth: 3, noise: 45, blunder: 0.02, movetime: 500 },
  { id: 4, name: 'Advanced', approxElo: 1650, depth: 5, noise: 0, blunder: 0, movetime: 900 },
  { id: 5, name: 'Expert', approxElo: 1950, depth: 8, noise: 0, blunder: 0, movetime: 2000 },
  { id: 6, name: 'Maximum', approxElo: 2200, depth: 20, noise: 0, blunder: 0, movetime: 5000 },
];

function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

let shared = null;
export function pickMove(pos, levelId, { movetimeCap = null } = {}) {
  const lvl = LEVELS.find((l) => l.id === levelId) || LEVELS[2];
  shared = shared || new Engine();
  const legal = pos.legalMoves();
  if (!legal.length) return null;
  if (legal.length === 1) return { move: pos.uciOf(legal[0]), score: 0, depth: 0 };
  if (lvl.noise > 0) {
    if (Math.random() < lvl.blunder) { const m = legal[Math.floor(Math.random() * legal.length)]; return { move: pos.uciOf(m), score: 0, depth: 0 }; }
    const scores = shared.rootScores(pos, lvl.depth);
    let best = null, bs = -Infinity;
    for (const s of scores) {
      const adj = s.score + gauss() * lvl.noise;
      if (adj > bs) { bs = adj; best = s; }
    }
    return { move: best.move, score: best.score, depth: lvl.depth };
  }
  const r = shared.search(pos, { depth: lvl.depth, movetime: Math.min(lvl.movetime, movetimeCap ?? Infinity) });
  return { move: r.move, score: r.score, depth: r.depth, pv: r.pv };
}

export function analysePosition(pos, { depth = 10, movetime = 800 } = {}) {
  shared = shared || new Engine();
  return shared.search(pos, { depth, movetime });
}

// ------------------------------------------------------------------------------------------------
// Exhaustive forced-mate solver (sound: any line returned is a proven forced mate).
/** Moves (UCI) after which the side to move can force mate within `n` of its own moves. */
export function mateMoves(pos, n, { checksOnlyAfterFirst = false } = {}) {
  const res = [];
  const win = (rem, first) => {
    // side to move must deliver mate within rem moves
    const moves = pos.legalMoves();
    for (const m of moves) {
      pos.make(m);
      let ok;
      const defMoves = pos.legalMoves();
      if (defMoves.length === 0) ok = pos.inCheck();
      else if (rem <= 1) ok = false;
      else if (checksOnlyAfterFirst && !first && !pos.inCheck()) ok = false;
      else {
        ok = true;
        for (const d of defMoves) {
          pos.make(d);
          const w = win(rem - 1, false);
          pos.unmake();
          if (!w) { ok = false; break; }
        }
      }
      pos.unmake();
      if (ok) { if (!first) return true; res.push(pos.uciOf(m)); }
    }
    return false;
  };
  win(n, true);
  return res;
}

/** Defender reply that holds out longest (or any reply) in a forced-mate position; null if none. */
export function longestDefence(pos, remaining) {
  let bestMove = null, bestLen = -1;
  for (const d of pos.legalMoves()) {
    pos.make(d);
    let len = 0;
    for (let k = 1; k <= remaining; k++) { if (mateMoves(pos, k).length) { len = k; break; } }
    pos.unmake();
    if (len > bestLen) { bestLen = len; bestMove = pos.uciOf(d); }
  }
  return bestMove;
}
