// Interactive chessboard. Rules are NOT implemented here: the host page supplies `legalTargets(from)` (from the shared rules engine)
// and `onMove(from, to, promotion)`; this component handles rendering, animation, drag & click input, hints, arrows and promotion UI.
import { h, clear } from './util.js';
import { pieceSvg } from './pieces.js';

const FILES = 'abcdefgh';
export const sqToXY = (sq, orient) => { const f = sq.charCodeAt(0) - 97, r = sq.charCodeAt(1) - 49; return orient === 'w' ? [f, 7 - r] : [7 - f, r]; };
export const xyToSq = (x, y, orient) => orient === 'w' ? FILES[x] + (8 - y) : FILES[7 - x] + (y + 1);

export function parseFenBoard(fen) {
  const map = {}; const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, i) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { map[FILES[f] + (8 - i)] = { color: ch === ch.toUpperCase() ? 'w' : 'b', type: ch.toLowerCase() }; f++; } } });
  return map;
}

export class Board {
  constructor(host, o = {}) {
    this.o = { orientation: 'w', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', interactive: false, movableColor: 'both', coords: true, animate: true, set: 'rook', legalTargets: () => [], onMove: () => true, ...o };
    this.host = host; this.pieces = new Map(); this.sel = null; this.last = []; this.check = null; this.hints = []; this.arrows = []; this.drag = null; this.pos = {}; this.turn = 'w';
    this.root = h('div', { class: 'board', role: 'application', 'aria-label': 'Chess board', tabindex: 0 });
    this.sqLayer = h('div', { class: 'sq-layer' }); this.hlLayer = h('div', { class: 'hl-layer' }); this.pcLayer = h('div', { class: 'pc-layer' });
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); this.svg.setAttribute('class', 'arrow-layer'); this.svg.setAttribute('viewBox', '0 0 8 8');
    this.root.append(this.sqLayer, this.hlLayer, this.pcLayer, this.svg); host.append(this.root);
    this.root.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', this._mv = (e) => this.move(e)); window.addEventListener('pointerup', this._up = (e) => this.up(e));
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.addEventListener('keydown', (e) => this.key(e));
    this.cursor = null; this.live = h('div', { class: 'sr-only', 'aria-live': 'polite', role: 'status' }); this.root.append(this.live);
    this.root.addEventListener('focus', () => { if (!this.cursor) this.cursor = xyToSq(4, 6, this.o.orientation); this.renderHl(); this.say(this.describeSq(this.cursor) + '. Use the arrow keys to move around the board, Enter to select or move.'); });
    this.root.addEventListener('blur', () => this.renderHl());
    this.drawSquares(); this.setPosition(this.o.fen, { animate: false });
  }
  destroy() { window.removeEventListener('pointermove', this._mv); window.removeEventListener('pointerup', this._up); this.root.remove(); }
  drawSquares() {
    clear(this.sqLayer); const o = this.o.orientation;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const sq = xyToSq(x, y, o); const light = (x + y) % 2 === 0;
      const d = h('div', { class: 'sq ' + (light ? 'light' : 'dark'), dataset: { sq }, style: { left: x * 12.5 + '%', top: y * 12.5 + '%' } });
      if (this.o.coords) {
        if (x === 0) d.append(h('i', { class: 'coord rank' }, sq[1]));
        if (y === 7) d.append(h('i', { class: 'coord file' }, sq[0]));
      }
      this.sqLayer.append(d);
    }
  }
  place(el, sq) { const [x, y] = sqToXY(sq, this.o.orientation); el.style.transform = `translate(${x * 100}%, ${y * 100}%)`; }
  setOrientation(o) { if (o === this.o.orientation) return; this.o.orientation = o; this.drawSquares(); for (const [sq, el] of this.pieces) { el.style.transition = 'none'; this.place(el, sq); } this.renderHl(); this.renderArrows(); requestAnimationFrame(() => { for (const el of this.pieces.values()) el.style.transition = ''; }); }
  flip() { this.setOrientation(this.o.orientation === 'w' ? 'b' : 'w'); }
  setSet(set) { this.o.set = set; for (const [sq, el] of this.pieces) { const p = this.pos[sq]; if (p) el.innerHTML = pieceSvg(p.color, p.type, set); } }
  setInteractive(v, movable) { this.o.interactive = v; if (movable) this.o.movableColor = movable; if (!v) this.clearSel(); }

  setPosition(fen, { lastMove = null, check = null, animate = this.o.animate } = {}) {
    const next = parseFenBoard(fen); this.turn = fen.split(' ')[1] || 'w'; this.fen = fen;
    const old = this.pieces; const fresh = new Map();
    const keep = new Set(); // squares whose piece is unchanged
    for (const [sq, p] of Object.entries(next)) { const op = this.pos[sq]; if (op && op.color === p.color && op.type === p.type && old.has(sq)) { fresh.set(sq, old.get(sq)); keep.add(sq); } }
    const leaving = [...old.entries()].filter(([sq]) => !keep.has(sq));
    const used = new Set();
    for (const [sq, p] of Object.entries(next)) {
      if (keep.has(sq)) continue;
      // reuse a vanished piece of the same kind (a move) so it slides
      const j = leaving.findIndex(([osq, el], i) => !used.has(i) && this.pos[osq].color === p.color && this.pos[osq].type === p.type);
      if (j >= 0 && animate) { used.add(j); const [, el] = leaving[j]; fresh.set(sq, el); this.place(el, sq); el.classList.remove('dragging'); }
      else { const el = h('div', { class: 'piece', dataset: { sq } }); el.innerHTML = pieceSvg(p.color, p.type, this.o.set); el.style.transition = 'none'; this.place(el, sq); this.pcLayer.append(el); requestAnimationFrame(() => { el.style.transition = ''; }); fresh.set(sq, el); }
    }
    leaving.forEach(([, el], i) => { if (!used.has(i)) { el.classList.add('gone'); setTimeout(() => el.remove(), animate ? 160 : 0); } });
    for (const [sq, el] of fresh) el.dataset.sq = sq;
    this.pieces = fresh; this.pos = next; this.last = lastMove || []; this.check = check; this.clearSel(false); this.renderHl();
  }
  setLast(l) { this.last = l || []; this.renderHl(); }
  setCheck(sq) { this.check = sq; this.renderHl(); }
  setHints(list) { this.hints = list || []; this.renderHl(); }
  kingSquare(color) { return Object.entries(this.pos).find(([, p]) => p.type === 'k' && p.color === color)?.[0] || null; }

  renderHl() {
    clear(this.hlLayer); const add = (sq, cls) => { const [x, y] = sqToXY(sq, this.o.orientation); this.hlLayer.append(h('div', { class: 'hl ' + cls, style: { left: x * 12.5 + '%', top: y * 12.5 + '%' } })); };
    for (const sq of this.last) add(sq, 'last');
    if (this.check) add(this.check, 'check');
    if (this.sel) { add(this.sel, 'sel'); for (const t of this.sel_targets || []) add(t, this.pos[t] ? 'cap' : 'dot'); }
    for (const sq of this.hints) add(sq, 'hint');
    if (this.pre) { add(this.pre.from, 'pre'); add(this.pre.to, 'pre'); }
    if (this.cursor && document.activeElement === this.root) add(this.cursor, 'cur');
  }
  clearSel(render = true) { this.sel = null; this.sel_targets = null; if (render) this.renderHl(); }

  canMove(sq) { const p = this.pos[sq]; if (p && !this.o.interactive && this.o.canPremove && p.color === this.o.movableColor) return true; if (!p || !this.o.interactive) return false; if (this.o.movableColor !== 'both' && p.color !== this.o.movableColor) return false; return p.color === this.turn || this.o.premove === true || this.o.freeTurn; }
  select(sq) { this.sel = sq; this.sel_targets = !this.o.interactive && this.o.canPremove ? this.pseudoTargets(sq) : this.o.legalTargets(sq); this.renderHl(); }
  sqAt(e) { const r = this.root.getBoundingClientRect(); const x = Math.floor(((e.clientX - r.left) / r.width) * 8), y = Math.floor(((e.clientY - r.top) / r.height) * 8); if (x < 0 || x > 7 || y < 0 || y > 7) return null; return xyToSq(x, y, this.o.orientation); }
  down(e) {
    if (e.button === 2) { this.arrowStart = this.sqAt(e); return; }
    if (e.button !== 0) return;
    if (this.promo) return;
    this.arrows.length && !this.o.keepArrows && (this.arrows = [], this.renderArrows());
    const sq = this.sqAt(e); if (!sq) return;
    if (this.sel && this.sel !== sq && this.sel_targets?.includes(sq)) { this.attempt(this.sel, sq); return; }
    if (this.canMove(sq)) { this.select(sq); const el = this.pieces.get(sq); if (el) { this.drag = { sq, el, id: e.pointerId, moved: false, sx: e.clientX, sy: e.clientY }; this.root.setPointerCapture?.(e.pointerId); } }
    else { this.clearSel(); if (this.pre) this.clearPremove(); }
  }
  move(e) {
    const d = this.drag; if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
    d.moved = true; d.el.classList.add('dragging');
    const r = this.root.getBoundingClientRect(); const s = r.width / 8;
    d.el.style.transition = 'none';
    d.el.style.transform = `translate(${e.clientX - r.left - s / 2}px, ${e.clientY - r.top - s / 2}px)`;
  }
  up(e) {
    if (this.arrowStart) { const to = this.sqAt(e); if (to && to !== this.arrowStart) { const k = this.arrowStart + to; const i = this.arrows.findIndex((a) => a.from + a.to === k); if (i >= 0) this.arrows.splice(i, 1); else this.arrows.push({ from: this.arrowStart, to, color: 'rgba(240,160,40,.85)' }); this.renderArrows(); } this.arrowStart = null; return; }
    const d = this.drag; if (!d) return; this.drag = null;
    d.el.classList.remove('dragging'); d.el.style.transition = '';
    if (!d.moved) { this.place(d.el, d.sq); return; } // simple click: keep selection
    const to = this.sqAt(e);
    if (to && to !== d.sq && this.sel_targets?.includes(to)) { this.attempt(d.sq, to); } else { this.place(d.el, d.sq); }
  }
  async attempt(from, to) {
    const p = this.pos[from]; const rank = to[1];
    let promo;
    if (p?.type === 'p' && (rank === '8' || rank === '1')) { promo = await this.askPromotion(to, p.color); if (!promo) { this.place(this.pieces.get(from), from); this.clearSel(); return; } }
    const el = this.pieces.get(from); this.clearSel();
    if (!this.o.interactive && this.o.canPremove) { this.pre = { from, to, promo }; if (el) this.place(el, from); this.renderHl(); return; }
    const ok = await this.o.onMove(from, to, promo);
    if (ok === false && el) this.place(el, from);
  }
  askPromotion(sq, color) {
    return new Promise((res) => {
      const [x, y] = sqToXY(sq, this.o.orientation); const down = y === 0 ? 1 : -1;
      const box = h('div', { class: 'promo-back', onclick: (e) => { if (e.target === box) { box.remove(); this.promo = null; res(null); } } });
      ['q', 'n', 'r', 'b'].forEach((t, i) => { const yy = y + down * i; const b = h('button', { class: 'promo-choice', 'aria-label': 'Promote to ' + { q: 'queen', n: 'knight', r: 'rook', b: 'bishop' }[t], style: { left: x * 12.5 + '%', top: yy * 12.5 + '%' }, onclick: () => { box.remove(); this.promo = null; res(t); } }); b.innerHTML = pieceSvg(color, t, this.o.set); box.append(b); });
      this.promo = box; this.root.append(box);
    });
  }
  // Premoves: one queued move for the side that is waiting. Targets ignore checks and pins; the rules engine rechecks when the move is played.
  getPremove() { return this.pre || null; }
  clearPremove() { if (this.pre) { this.pre = null; this.renderHl(); } }
  takePremove() { const p = this.pre || null; this.pre = null; this.renderHl(); return p; }
  pseudoTargets(sq) {
    const p = this.pos[sq]; if (!p) return []; const f = sq.charCodeAt(0) - 97, r = sq.charCodeAt(1) - 49; const out = []; const name = (x, y) => String.fromCharCode(97 + x) + (y + 1);
    const ok = (x, y) => x >= 0 && x < 8 && y >= 0 && y < 8; const own = (x, y) => this.pos[name(x, y)]?.color === p.color;
    const ray = (dx, dy) => { for (let x = f + dx, y = r + dy; ok(x, y); x += dx, y += dy) { if (own(x, y)) break; out.push(name(x, y)); if (this.pos[name(x, y)]) break; } };
    const step = (dx, dy) => { const x = f + dx, y = r + dy; if (ok(x, y) && !own(x, y)) out.push(name(x, y)); };
    if (p.type === 'n') [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]].forEach(([a, c]) => step(a, c));
    else if (p.type === 'k') { for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) if (a || c) step(a, c); if (r === (p.color === 'w' ? 0 : 7) && f === 4) { out.push(name(6, r), name(2, r)); } }
    else if (p.type === 'p') { const d = p.color === 'w' ? 1 : -1; if (ok(f, r + d) && !this.pos[name(f, r + d)]) { out.push(name(f, r + d)); if (r === (p.color === 'w' ? 1 : 6) && !this.pos[name(f, r + 2 * d)]) out.push(name(f, r + 2 * d)); } for (const a of [-1, 1]) if (ok(f + a, r + d) && !own(f + a, r + d)) out.push(name(f + a, r + d)); }
    else { if (p.type !== 'b') { ray(1, 0); ray(-1, 0); ray(0, 1); ray(0, -1); } if (p.type !== 'r') { ray(1, 1); ray(1, -1); ray(-1, 1); ray(-1, -1); } }
    return out;
  }
  say(t) { this.live.textContent = ''; setTimeout(() => { this.live.textContent = t; }, 30); }
  describeSq(sq) { const p = this.pos[sq]; const N = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }; let t = sq + ', ' + (p ? (p.color === 'w' ? 'white ' : 'black ') + N[p.type] : 'empty'); if (this.sel === sq) t += ', selected'; else if (this.sel_targets?.includes(sq)) t += ', legal move'; return t; }
  key(e) {
    if (this.promo || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') { this.clearSel(); if (this.pre) { this.clearPremove(); this.say('Premove cancelled'); } else this.say('Selection cleared'); return; }
    const D = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (D) { e.preventDefault(); e.stopPropagation(); const [x, y] = sqToXY(this.cursor || xyToSq(4, 6, this.o.orientation), this.o.orientation); this.cursor = xyToSq(Math.max(0, Math.min(7, x + D[0])), Math.max(0, Math.min(7, y + D[1])), this.o.orientation); this.renderHl(); this.say(this.describeSq(this.cursor)); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); e.stopPropagation(); const sq = this.cursor; if (!sq || !this.o.interactive) { this.say('The board is not accepting moves right now.'); return; }
      if (this.sel && this.sel !== sq && this.sel_targets?.includes(sq)) { this.attempt(this.sel, sq); return; }
      if (this.canMove(sq)) { this.select(sq); const t = this.sel_targets || []; this.say(t.length ? `Selected ${this.describeSq(sq)}. ${t.length} legal move${t.length > 1 ? 's' : ''}: ${t.join(', ')}. Move to a highlighted square and press Enter.` : `Selected ${this.describeSq(sq)}. It has no legal moves.`); }
      else { this.clearSel(); this.say(this.describeSq(sq) + ' cannot be moved.'); }
    }
  }
  // arrows: [{from,to,color}]
  setArrows(list) { this.arrows = list || []; this.renderArrows(); }
  renderArrows() {
    this.svg.innerHTML = '';
    const ns = 'http://www.w3.org/2000/svg';
    for (const a of this.arrows) {
      const [x1, y1] = sqToXY(a.from, this.o.orientation), [x2, y2] = sqToXY(a.to, this.o.orientation);
      const sx = x1 + 0.5, sy = y1 + 0.5; let ex = x2 + 0.5, ey = y2 + 0.5; const dx = ex - sx, dy = ey - sy, len = Math.hypot(dx, dy) || 1; const ux = dx / len, uy = dy / len;
      ex -= ux * 0.3; ey -= uy * 0.3;
      const line = document.createElementNS(ns, 'line'); line.setAttribute('x1', sx); line.setAttribute('y1', sy); line.setAttribute('x2', ex); line.setAttribute('y2', ey); line.setAttribute('stroke', a.color || 'rgba(120,200,80,.85)'); line.setAttribute('stroke-width', 0.16); line.setAttribute('stroke-linecap', 'round');
      const head = document.createElementNS(ns, 'polygon'); const hx = ex + ux * 0.32, hy = ey + uy * 0.32; const px = -uy * 0.2, py = ux * 0.2;
      head.setAttribute('points', `${hx},${hy} ${ex + px},${ey + py} ${ex - px},${ey - py}`); head.setAttribute('fill', a.color || 'rgba(120,200,80,.85)');
      this.svg.append(line, head);
    }
  }
}
