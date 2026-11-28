// Helpers shared by the puzzles / learn / openings pages (rules-aware board wrapper, tiny rich text, sparkline).
import { h } from './util.js';
import { Board } from './board.js';
import { Chess } from '/shared/chess.js';
import { state } from './api.js';
import { soundForMove } from './sound.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const norm = (san) => String(san).replace(/[+#!?]/g, '');

/** **bold** → <strong>, everything else as plain text (never innerHTML) */
export function richText(s) { return String(s).split(/(\*\*[^*]+\*\*)/).map((p) => (p.startsWith('**') && p.endsWith('**') ? h('strong', null, p.slice(2, -2)) : p)); }

/** Board + rules engine. The page supplies onUserMove(from,to,promo) -> boolean|Promise<boolean>; false snaps the piece back. */
export class RB {
  constructor(host, { fen, orientation = 'w', movable = 'both', interactive = true, onUserMove, coords } = {}) {
    this.g = new Chess(fen); this.onUserMove = onUserMove;
    this.board = new Board(host, {
      fen, orientation, interactive, movableColor: movable, set: state.prefs.pieces, coords: coords ?? state.prefs.coords !== false,
      animate: state.prefs.animations !== false,
      legalTargets: (sq) => [...new Set(this.g.moves({ square: sq, verbose: true }).map((m) => m.to))],
      onMove: (f, t, p) => (this.onUserMove ? this.onUserMove(f, t, p) : false),
    });
  }
  checkSq() { return this.g.inCheck() ? this.board.kingSquare(this.g.turnColor()) : null; }
  sync(last = null, animate) { this.board.setPosition(this.g.fen(), { lastMove: last, check: this.checkSq(), animate }); }
  /** apply move (SAN/UCI/{from,to,promotion}) to engine + board; returns descriptor or null */
  apply(arg, { sound = true } = {}) { const mv = this.g.move(arg); if (!mv) return null; this.sync([mv.from, mv.to]); if (sound) soundForMove(mv, this.g.inCheck()); return mv; }
  undo() { this.g.undo(); this.sync(null); }
  load(fen, orientation) { this.g.load(fen); if (orientation) this.board.setOrientation(orientation); this.board.setArrows([]); this.board.setHints([]); this.board.setPosition(fen, { animate: false }); }
  destroy() { this.board.destroy(); }
}

export function sparkline(values, { w = 280, h: hh = 60 } = {}) {
  if (values.length < 2) return h('div', { class: 'muted small' }, 'Play a few rated puzzles to see your rating graph.');
  const min = Math.min(...values), max = Math.max(...values), rng = Math.max(1, max - min);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${hh - 4 - ((v - min) / rng) * (hh - 8)}`).join(' ');
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); t.setAttribute('viewBox', `0 0 ${w} ${hh}`); t.setAttribute('class', 'spark'); t.setAttribute('role', 'img'); t.setAttribute('aria-label', `Rating from ${Math.round(values[0])} to ${Math.round(values[values.length - 1])}`);
  const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); pl.setAttribute('points', pts); pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', 'var(--accent)'); pl.setAttribute('stroke-width', '2.5'); pl.setAttribute('stroke-linejoin', 'round');
  t.append(pl); return t;
}
export const colorName = (c) => (c === 'w' ? 'White' : 'Black');
