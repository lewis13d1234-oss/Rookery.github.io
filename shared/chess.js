// Rookery rules engine — full legal chess on a 0x88 board.
// Shared by the server (authoritative validation), the browser (UI) and the search engine.
// Verified against published perft counts (see test/perft.test.js).

export const WHITE = 0, BLACK = 1;
export const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const FILES = 'abcdefgh';
const TYPE_CHARS = ' pnbrqk';
const PIECE_LETTERS = ' PNBRQK';

export const sqName = (s) => FILES[s & 7] + ((s >> 4) + 1);
export const sqFromName = (n) => {
  if (typeof n !== 'string' || !/^[a-h][1-8]$/.test(n)) return -1;
  return (n.charCodeAt(0) - 97) + (n.charCodeAt(1) - 49) * 16;
};

// move int: from(7) | to(7)<<7 | promo(3)<<14 | flags<<17
const F_CAP = 1, F_EP = 2, F_KS = 4, F_QS = 8, F_DBL = 16;
export const mFrom = (m) => m & 127;
export const mTo = (m) => (m >> 7) & 127;
export const mPromo = (m) => (m >> 14) & 7;
export const mFlags = (m) => m >> 17;
export const mkMove = (from, to, promo = 0, flags = 0) => from | (to << 7) | (promo << 14) | (flags << 17);
export const isCapture = (m) => (m >> 17) & (F_CAP | F_EP);
export { F_CAP, F_EP, F_KS, F_QS, F_DBL };

const KNIGHT_OFFS = [-33, -31, -18, -14, 14, 18, 31, 33];
const KING_OFFS = [-17, -16, -15, -1, 1, 15, 16, 17];
const BISHOP_OFFS = [-17, -15, 15, 17];
const ROOK_OFFS = [-16, -1, 1, 16];

const CASTLE_MASK = new Int8Array(128).fill(15);
CASTLE_MASK[4] = ~3 & 15; CASTLE_MASK[0] = ~2 & 15; CASTLE_MASK[7] = ~1 & 15;
CASTLE_MASK[116] = ~12 & 15; CASTLE_MASK[112] = ~8 & 15; CASTLE_MASK[119] = ~4 & 15;

// ---- Zobrist (deterministic) ----
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) | 0;
  };
}
const rnd = mulberry32(0xC0FFEE);
const zLo = new Int32Array(16 * 128), zHi = new Int32Array(16 * 128);
for (let i = 0; i < zLo.length; i++) { zLo[i] = rnd(); zHi[i] = rnd(); }
const zSideLo = rnd(), zSideHi = rnd();
const zCastLo = new Int32Array(16), zCastHi = new Int32Array(16);
for (let i = 0; i < 16; i++) { zCastLo[i] = rnd(); zCastHi[i] = rnd(); }
const zEpLo = new Int32Array(8), zEpHi = new Int32Array(8);
for (let i = 0; i < 8; i++) { zEpLo[i] = rnd(); zEpHi[i] = rnd(); }

const MAXPLY = 2048;

export class Chess {
  constructor(fen = START_FEN) {
    this.b = new Int8Array(128);
    this.kings = [4, 116];
    this.sM = new Int32Array(MAXPLY); this.sCap = new Int8Array(MAXPLY);
    this.sCast = new Int8Array(MAXPLY); this.sEp = new Int16Array(MAXPLY);
    this.sHalf = new Int16Array(MAXPLY); this.sLo = new Int32Array(MAXPLY); this.sHi = new Int32Array(MAXPLY);
    this.kLo = new Int32Array(MAXPLY + 1); this.kHi = new Int32Array(MAXPLY + 1);
    this.sans = [];
    this.load(fen);
  }

  // ---------- FEN ----------
  load(fen) {
    const parts = String(fen).trim().split(/\s+/);
    if (parts.length < 4) throw new Error('Invalid FEN: need at least 4 fields');
    const rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('Invalid FEN: need 8 ranks');
    const b = new Int8Array(128);
    const kings = [-1, -1];
    const counts = [0, 0];
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (ch >= '1' && ch <= '8') { f += +ch; continue; }
        const lower = ch.toLowerCase();
        const t = TYPE_CHARS.indexOf(lower);
        if (t < 1 || f > 7) throw new Error('Invalid FEN: bad piece placement');
        const color = ch === lower ? 1 : 0;
        const sq = (7 - r) * 16 + f;
        if (t === P && ((sq >> 4) === 0 || (sq >> 4) === 7)) throw new Error('Invalid FEN: pawn on back rank');
        if (t === K) { if (kings[color] !== -1) throw new Error('Invalid FEN: two kings'); kings[color] = sq; }
        b[sq] = t | (color << 3); counts[color]++;
        f++;
      }
      if (f !== 8) throw new Error('Invalid FEN: rank does not have 8 files');
    }
    if (kings[0] < 0 || kings[1] < 0) throw new Error('Invalid FEN: both kings required');
    if (parts[1] !== 'w' && parts[1] !== 'b') throw new Error('Invalid FEN: side to move');
    this.b = b; this.kings = kings;
    this.turn = parts[1] === 'w' ? 0 : 1;
    let c = 0;
    const cs = parts[2];
    if (cs !== '-') for (const ch of cs) {
      const bit = { K: 1, Q: 2, k: 4, q: 8 }[ch];
      if (!bit) throw new Error('Invalid FEN: castling');
      c |= bit;
    }
    // drop castling rights that are impossible
    if (b[4] !== (K | 0)) c &= ~3;
    if (b[116] !== (K | 8)) c &= ~12;
    if (b[7] !== (R | 0)) c &= ~1;
    if (b[0] !== (R | 0)) c &= ~2;
    if (b[119] !== (R | 8)) c &= ~4;
    if (b[112] !== (R | 8)) c &= ~8;
    this.castling = c;
    this.ep = -1;
    if (parts[3] !== '-') {
      const e = sqFromName(parts[3]);
      if (e < 0) throw new Error('Invalid FEN: en passant');
      this.ep = e;
    }
    this.half = parts[4] !== undefined ? Math.max(0, parseInt(parts[4], 10) || 0) : 0;
    this.full = parts[5] !== undefined ? Math.max(1, parseInt(parts[5], 10) || 1) : 1;
    this.startFull = this.full; this.startTurn = this.turn;
    this.ply = 0; this.sans = [];
    // the side that is NOT to move must not be in check
    if (this.isAttacked(kings[this.turn ^ 1], this.turn)) throw new Error('Invalid FEN: opponent king in check');
    this.startFen = null;
    this.computeHash();
    this.startFen = this.fen();
    return true;
  }

  computeHash() {
    let lo = 0, hi = 0;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) continue;
      const p = this.b[s];
      if (p) { lo ^= zLo[p * 128 + s]; hi ^= zHi[p * 128 + s]; }
    }
    if (this.turn) { lo ^= zSideLo; hi ^= zSideHi; }
    lo ^= zCastLo[this.castling]; hi ^= zCastHi[this.castling];
    this.hLo = lo; this.hHi = hi;
    this.setKey(0);
  }

  epCapturable() {
    if (this.ep < 0) return false;
    const us = this.turn, dir = us === 0 ? -16 : 16; // squares from which our pawns capture onto ep
    const pawn = P | (us << 3);
    for (const d of [dir - 1, dir + 1]) {
      const s = this.ep + d;
      if (!(s & 0x88) && this.b[s] === pawn) return true;
    }
    return false;
  }

  setKey(i) {
    let lo = this.hLo, hi = this.hHi;
    if (this.ep >= 0 && this.epCapturable()) { lo ^= zEpLo[this.ep & 7]; hi ^= zEpHi[this.ep & 7]; }
    this.kLo[i] = lo; this.kHi[i] = hi;
  }

  fen() {
    let s = '';
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.b[r * 16 + f];
        if (!p) { empty++; continue; }
        if (empty) { s += empty; empty = 0; }
        const ch = TYPE_CHARS[p & 7];
        s += (p >> 3) ? ch : ch.toUpperCase();
      }
      if (empty) s += empty;
      if (r) s += '/';
    }
    let c = '';
    if (this.castling & 1) c += 'K'; if (this.castling & 2) c += 'Q';
    if (this.castling & 4) c += 'k'; if (this.castling & 8) c += 'q';
    const ep = this.ep >= 0 && this.epCapturable() ? sqName(this.ep) : '-';
    return `${s} ${this.turn ? 'b' : 'w'} ${c || '-'} ${ep} ${this.half} ${this.full}`;
  }

  // ---------- attacks ----------
  isAttacked(sq, by) {
    const b = this.b, c = by << 3;
    let s;
    if (by === 0) {
      s = sq - 15; if (!(s & 0x88) && b[s] === 1) return true;
      s = sq - 17; if (!(s & 0x88) && b[s] === 1) return true;
    } else {
      s = sq + 15; if (!(s & 0x88) && b[s] === 9) return true;
      s = sq + 17; if (!(s & 0x88) && b[s] === 9) return true;
    }
    for (let i = 0; i < 8; i++) { s = sq + KNIGHT_OFFS[i]; if (!(s & 0x88) && b[s] === (c | N)) return true; }
    for (let i = 0; i < 8; i++) { s = sq + KING_OFFS[i]; if (!(s & 0x88) && b[s] === (c | K)) return true; }
    for (let i = 0; i < 4; i++) {
      const o = BISHOP_OFFS[i]; s = sq + o;
      while (!(s & 0x88)) { const p = b[s]; if (p) { if (p === (c | B) || p === (c | Q)) return true; break; } s += o; }
    }
    for (let i = 0; i < 4; i++) {
      const o = ROOK_OFFS[i]; s = sq + o;
      while (!(s & 0x88)) { const p = b[s]; if (p) { if (p === (c | R) || p === (c | Q)) return true; break; } s += o; }
    }
    return false;
  }

  inCheck() { return this.isAttacked(this.kings[this.turn], this.turn ^ 1); }

  // ---------- generation ----------
  gen(out = [], capsOnly = false) {
    const b = this.b, us = this.turn;
    out.length = 0;
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const from = r * 16 + f, pc = b[from];
        if (!pc || (pc >> 3) !== us) continue;
        const t = pc & 7;
        if (t === P) {
          const dir = us === 0 ? 16 : -16, startR = us === 0 ? 1 : 6, promoR = us === 0 ? 6 : 1;
          const one = from + dir;
          if (!(one & 0x88) && !b[one]) {
            if (r === promoR) { for (let p = Q; p >= N; p--) out.push(mkMove(from, one, p, 0)); }
            else if (!capsOnly) {
              out.push(mkMove(from, one, 0, 0));
              const two = one + dir;
              if (r === startR && !b[two]) out.push(mkMove(from, two, 0, F_DBL));
            }
          }
          for (let k = -1; k <= 1; k += 2) {
            const to = from + dir + k;
            if (to & 0x88) continue;
            const tp = b[to];
            if (tp && (tp >> 3) !== us) {
              if (r === promoR) { for (let p = Q; p >= N; p--) out.push(mkMove(from, to, p, F_CAP)); }
              else out.push(mkMove(from, to, 0, F_CAP));
            } else if (!tp && to === this.ep) out.push(mkMove(from, to, 0, F_EP | F_CAP));
          }
        } else if (t === N || t === K) {
          const offs = t === N ? KNIGHT_OFFS : KING_OFFS;
          for (let i = 0; i < 8; i++) {
            const to = from + offs[i];
            if (to & 0x88) continue;
            const tp = b[to];
            if (!tp) { if (!capsOnly) out.push(mkMove(from, to, 0, 0)); }
            else if ((tp >> 3) !== us) out.push(mkMove(from, to, 0, F_CAP));
          }
        } else {
          const offs = t === B ? BISHOP_OFFS : t === R ? ROOK_OFFS : KING_OFFS;
          const n = t === Q ? 8 : 4;
          for (let i = 0; i < n; i++) {
            const o = offs[i]; let to = from + o;
            while (!(to & 0x88)) {
              const tp = b[to];
              if (!tp) { if (!capsOnly) out.push(mkMove(from, to, 0, 0)); }
              else { if ((tp >> 3) !== us) out.push(mkMove(from, to, 0, F_CAP)); break; }
              to += o;
            }
          }
        }
      }
    }
    if (!capsOnly) {
      const base = us === 0 ? 0 : 112, them = us ^ 1;
      const ks = us === 0 ? 1 : 4, qs = us === 0 ? 2 : 8;
      if ((this.castling & (ks | qs)) && b[base + 4] === (K | (us << 3)) && !this.isAttacked(base + 4, them)) {
        if ((this.castling & ks) && !b[base + 5] && !b[base + 6] && b[base + 7] === (R | (us << 3)) &&
            !this.isAttacked(base + 5, them) && !this.isAttacked(base + 6, them)) out.push(mkMove(base + 4, base + 6, 0, F_KS));
        if ((this.castling & qs) && !b[base + 3] && !b[base + 2] && !b[base + 1] && b[base] === (R | (us << 3)) &&
            !this.isAttacked(base + 3, them) && !this.isAttacked(base + 2, them)) out.push(mkMove(base + 4, base + 2, 0, F_QS));
      }
    }
    return out;
  }

  // ---------- make / unmake ----------
  make(m) {
    const b = this.b, us = this.turn, i = this.ply;
    const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, fl = m >> 17;
    const pc = b[from];
    let cap = b[to];
    this.sM[i] = m; this.sCast[i] = this.castling; this.sEp[i] = this.ep; this.sHalf[i] = this.half;
    this.sLo[i] = this.hLo; this.sHi[i] = this.hHi;
    let lo = this.hLo, hi = this.hHi;
    lo ^= zCastLo[this.castling]; hi ^= zCastHi[this.castling];
    const np = promo ? (promo | (us << 3)) : pc;
    lo ^= zLo[pc * 128 + from] ^ zLo[np * 128 + to];
    hi ^= zHi[pc * 128 + from] ^ zHi[np * 128 + to];
    if (fl & F_EP) {
      const cs = us === 0 ? to - 16 : to + 16;
      cap = b[cs]; b[cs] = 0;
      lo ^= zLo[cap * 128 + cs]; hi ^= zHi[cap * 128 + cs];
    } else if (cap) {
      lo ^= zLo[cap * 128 + to]; hi ^= zHi[cap * 128 + to];
    }
    this.sCap[i] = cap;
    b[to] = np; b[from] = 0;
    if ((pc & 7) === K) this.kings[us] = to;
    if (fl & F_KS) {
      const rp = R | (us << 3);
      b[to - 1] = rp; b[to + 1] = 0;
      lo ^= zLo[rp * 128 + to + 1] ^ zLo[rp * 128 + to - 1]; hi ^= zHi[rp * 128 + to + 1] ^ zHi[rp * 128 + to - 1];
    } else if (fl & F_QS) {
      const rp = R | (us << 3);
      b[to + 1] = rp; b[to - 2] = 0;
      lo ^= zLo[rp * 128 + to - 2] ^ zLo[rp * 128 + to + 1]; hi ^= zHi[rp * 128 + to - 2] ^ zHi[rp * 128 + to + 1];
    }
    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    lo ^= zCastLo[this.castling]; hi ^= zCastHi[this.castling];
    this.ep = (fl & F_DBL) ? (us === 0 ? from + 16 : from - 16) : -1;
    this.half = ((pc & 7) === P || cap) ? 0 : this.half + 1;
    this.turn = us ^ 1;
    lo ^= zSideLo; hi ^= zSideHi;
    if (us === 1) this.full++;
    this.hLo = lo; this.hHi = hi;
    this.ply = i + 1;
    this.setKey(i + 1);
  }

  unmake() {
    const i = --this.ply, b = this.b;
    const m = this.sM[i], us = this.turn ^ 1;
    this.turn = us;
    if (m === 0) { // null move
      this.ep = this.sEp[i]; this.half = this.sHalf[i]; this.hLo = this.sLo[i]; this.hHi = this.sHi[i];
      if (us === 1) this.full--;
      return;
    }
    const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, fl = m >> 17;
    const cap = this.sCap[i];
    let pc = b[to];
    if (promo) pc = P | (us << 3);
    b[from] = pc;
    if (fl & F_EP) { b[to] = 0; b[us === 0 ? to - 16 : to + 16] = cap; }
    else b[to] = cap;
    if ((pc & 7) === K) this.kings[us] = from;
    if (fl & F_KS) { b[to + 1] = R | (us << 3); b[to - 1] = 0; }
    else if (fl & F_QS) { b[to - 2] = R | (us << 3); b[to + 1] = 0; }
    this.castling = this.sCast[i]; this.ep = this.sEp[i]; this.half = this.sHalf[i];
    this.hLo = this.sLo[i]; this.hHi = this.sHi[i];
    if (us === 1) this.full--;
  }

  makeNull() {
    const i = this.ply;
    this.sM[i] = 0; this.sEp[i] = this.ep; this.sHalf[i] = this.half; this.sLo[i] = this.hLo; this.sHi[i] = this.hHi;
    this.ep = -1; this.half++;
    this.turn ^= 1; this.hLo ^= zSideLo; this.hHi ^= zSideHi;
    if (this.turn === 0) this.full++;
    this.ply = i + 1;
    this.setKey(i + 1);
  }

  /** make + legality check; returns false (and leaves position untouched) if the move leaves own king in check */
  makeLegal(m) {
    const us = this.turn;
    this.make(m);
    if (this.isAttacked(this.kings[us], us ^ 1)) { this.unmake(); return false; }
    return true;
  }

  legalMoves() {
    const pseudo = this.gen([]), res = [];
    for (let i = 0; i < pseudo.length; i++) {
      if (this.makeLegal(pseudo[i])) { this.unmake(); res.push(pseudo[i]); }
    }
    return res;
  }

  hasLegalMove() {
    const pseudo = this.gen([]);
    for (let i = 0; i < pseudo.length; i++) {
      if (this.makeLegal(pseudo[i])) { this.unmake(); return true; }
    }
    return false;
  }

  perft(depth) {
    if (depth === 0) return 1;
    const ms = this.gen([]);
    let n = 0;
    for (let i = 0; i < ms.length; i++) {
      if (!this.makeLegal(ms[i])) continue;
      n += depth === 1 ? 1 : this.perft(depth - 1);
      this.unmake();
    }
    return n;
  }

  // ---------- SAN ----------
  sanOf(m, legal = null) {
    const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, fl = m >> 17;
    const pc = this.b[from], t = pc & 7;
    let s;
    if (fl & F_KS) s = 'O-O';
    else if (fl & F_QS) s = 'O-O-O';
    else if (t === P) {
      s = (fl & F_CAP) ? FILES[from & 7] + 'x' : '';
      s += sqName(to);
      if (promo) s += '=' + PIECE_LETTERS[promo];
    } else {
      s = PIECE_LETTERS[t];
      const others = (legal || this.legalMoves()).filter((o) => o !== m && ((this.b[o & 127] & 7) === t) && (((o >> 7) & 127) === to) && ((o & 127) !== from));
      if (others.length) {
        const sameFile = others.some((o) => (o & 7) === (from & 7));
        const sameRank = others.some((o) => ((o & 127) >> 4) === (from >> 4));
        if (!sameFile) s += FILES[from & 7];
        else if (!sameRank) s += (from >> 4) + 1;
        else s += FILES[from & 7] + ((from >> 4) + 1);
      }
      if (fl & F_CAP) s += 'x';
      s += sqName(to);
    }
    this.make(m);
    if (this.inCheck()) s += this.hasLegalMove() ? '+' : '#';
    this.unmake();
    return s;
  }

  parseSan(str) {
    if (typeof str !== 'string') return 0;
    let s = str.trim().replace(/[+#!?]+$/g, '').replace(/0/g, 'O').replace(/e\.p\.$/, '').trim();
    if (!s) return 0;
    const legal = this.legalMoves();
    if (/^O-O(-O)?$/.test(s)) {
      const flag = s === 'O-O' ? F_KS : F_QS;
      return legal.find((m) => (m >> 17) & flag) || 0;
    }
    const mt = /^([NBRQK])?([a-h])?([1-8])?(x|-)?([a-h][1-8])(?:=?([NBRQ]))?$/.exec(s);
    if (!mt) return 0;
    const type = mt[1] ? PIECE_LETTERS.indexOf(mt[1]) : P;
    const to = sqFromName(mt[5]);
    const promo = mt[6] ? PIECE_LETTERS.indexOf(mt[6]) : 0;
    const cands = legal.filter((m) => {
      if (((m >> 7) & 127) !== to) return false;
      const from = m & 127;
      if ((this.b[from] & 7) !== type) return false;
      if (((m >> 14) & 7) !== promo) return false;
      if (mt[2] && FILES[from & 7] !== mt[2]) return false;
      if (mt[3] && String((from >> 4) + 1) !== mt[3]) return false;
      return true;
    });
    return cands.length === 1 ? cands[0] : 0;
  }

  parseUci(u) {
    if (typeof u !== 'string' || u.length < 4) return 0;
    const from = sqFromName(u.slice(0, 2)), to = sqFromName(u.slice(2, 4));
    if (from < 0 || to < 0) return 0;
    const promo = u[4] ? 'nbrq'.indexOf(u[4].toLowerCase()) + 2 : 0;
    if (u[4] && promo < 2) return 0;
    return this.legalMoves().find((m) => (m & 127) === from && ((m >> 7) & 127) === to && ((m >> 14) & 7) === promo) || 0;
  }

  uciOf(m) {
    const p = (m >> 14) & 7;
    return sqName(m & 127) + sqName((m >> 7) & 127) + (p ? TYPE_CHARS[p] : '');
  }

  describe(m, san) {
    const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, fl = m >> 17;
    const pc = this.b[from];
    const captured = (fl & F_EP) ? P : (this.b[to] & 7) || 0;
    const flags = (fl & F_CAP ? 'c' : '') + (fl & F_EP ? 'e' : '') + (fl & F_KS ? 'k' : '') + (fl & F_QS ? 'q' : '') +
      (fl & F_DBL ? 'b' : '') + (promo ? 'p' : '');
    const o = { color: (pc >> 3) ? 'b' : 'w', from: sqName(from), to: sqName(to), piece: TYPE_CHARS[pc & 7], san, flags };
    if (captured) o.captured = TYPE_CHARS[captured];
    if (promo) o.promotion = TYPE_CHARS[promo];
    o.lan = o.from + o.to + (promo ? TYPE_CHARS[promo] : '');
    return o;
  }

  // ---------- friendly API ----------
  turnColor() { return this.turn ? 'b' : 'w'; }

  moves({ verbose = false, square = null } = {}) {
    const legal = this.legalMoves();
    let list = legal;
    if (square) { const sq = sqFromName(square); list = legal.filter((m) => (m & 127) === sq); }
    return list.map((m) => { const san = this.sanOf(m, legal); return verbose ? this.describe(m, san) : san; });
  }

  /** Accepts SAN string, UCI string, or {from,to,promotion}. Returns move descriptor or null. */
  move(arg) {
    let m = 0;
    if (typeof arg === 'string') {
      m = this.parseSan(arg);
      if (!m && /^[a-h][1-8][a-h][1-8][nbrqNBRQ]?$/.test(arg)) m = this.parseUci(arg.toLowerCase());
    } else if (arg && arg.from && arg.to) {
      const promo = arg.promotion ? 'nbrq'.indexOf(String(arg.promotion).toLowerCase()) + 2 : 0;
      const from = sqFromName(arg.from), to = sqFromName(arg.to);
      m = this.legalMoves().find((x) => (x & 127) === from && ((x >> 7) & 127) === to && ((x >> 14) & 7) === promo) || 0;
    }
    if (!m) return null;
    const legal = this.legalMoves();
    const san = this.sanOf(m, legal);
    const desc = this.describe(m, san);
    this.make(m);
    this.sans[this.ply - 1] = san;
    return desc;
  }

  undo() {
    if (this.ply === 0) return null;
    const san = this.sans[this.ply - 1];
    this.unmake();
    this.sans.length = this.ply;
    return san;
  }

  history() { return this.sans.slice(0, this.ply); }
  historyUci() { const r = []; for (let i = 0; i < this.ply; i++) r.push(this.uciOf(this.sM[i])); return r; }

  get(square) {
    const p = this.b[sqFromName(square)];
    return p ? { type: TYPE_CHARS[p & 7], color: (p >> 3) ? 'b' : 'w' } : null;
  }

  board() {
    const rows = [];
    for (let r = 7; r >= 0; r--) {
      const row = [];
      for (let f = 0; f < 8; f++) {
        const p = this.b[r * 16 + f];
        row.push(p ? { type: TYPE_CHARS[p & 7], color: (p >> 3) ? 'b' : 'w', square: FILES[f] + (r + 1) } : null);
      }
      rows.push(row);
    }
    return rows;
  }

  // ---------- game state ----------
  isCheck() { return this.inCheck(); }
  isCheckmate() { return this.inCheck() && !this.hasLegalMove(); }
  isStalemate() { return !this.inCheck() && !this.hasLegalMove(); }

  isInsufficientMaterial() {
    const minors = [];
    let bishopsW = 0, bishopsB = 0, others = 0;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) continue;
      const p = this.b[s]; if (!p) continue;
      const t = p & 7;
      if (t === K) continue;
      if (t === P || t === R || t === Q) return false;
      minors.push(t);
      if (t === B) { ((s + (s >> 4)) & 1) ? bishopsB++ : bishopsW++; } else others++;
    }
    if (minors.length <= 1) return true;
    if (others === 0 && (bishopsW === 0 || bishopsB === 0)) return true; // all bishops on one colour
    return false;
  }

  repetitionCount() {
    let n = 1;
    const i = this.ply, lo = this.kLo[i], hi = this.kHi[i];
    const limit = Math.max(0, i - this.half);
    for (let j = i - 2; j >= limit; j -= 2) if (this.kLo[j] === lo && this.kHi[j] === hi) n++;
    return n;
  }

  isThreefold() { return this.repetitionCount() >= 3; }
  isFivefold() { return this.repetitionCount() >= 5; }
  isFiftyMoves() { return this.half >= 100; }

  /** Automatic game end per FIDE (checkmate, stalemate, dead position, fivefold, 75-move) */
  status() {
    if (!this.hasLegalMove()) {
      if (this.inCheck()) return { over: true, result: this.turn ? '1-0' : '0-1', reason: 'checkmate' };
      return { over: true, result: '1/2-1/2', reason: 'stalemate' };
    }
    if (this.isInsufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'insufficient' };
    if (this.isFivefold()) return { over: true, result: '1/2-1/2', reason: 'fivefold' };
    if (this.half >= 150) return { over: true, result: '1/2-1/2', reason: 'seventyfive' };
    return { over: false, result: '*', reason: null };
  }

  /** Draws a player may claim: threefold repetition, fifty-move rule */
  claimableDraw() {
    if (this.isThreefold()) return 'threefold';
    if (this.isFiftyMoves()) return 'fifty';
    return null;
  }

  isGameOver() { return this.status().over; }
  isDraw() { const s = this.status(); return s.over && s.result === '1/2-1/2'; }

  /** FEN after replaying a list of SAN moves from a start FEN; throws on illegal move */
  static replay(sans, fen = START_FEN) {
    const g = new Chess(fen);
    for (const s of sans) if (!g.move(s)) throw new Error('Illegal move: ' + s);
    return g;
  }
}

export const PIECE_VALUES = [0, 100, 320, 330, 500, 900, 0];
