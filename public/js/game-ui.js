// Shared bits for game-like pages: move list, captured pieces, result text, clocks.
import { h, clear, fmtClock } from './util.js';
const GL = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' }; const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };

export function moveList(el, sans, cur, onSelect, startTurn = 'w', startNum = 1) {
  clear(el); let i = 0;
  if (startTurn === 'b') { el.append(h('span', { class: 'n' }, startNum + '.'), h('span', { class: 'm' }, '…')); }
  const off = startTurn === 'b' ? 1 : 0;
  sans.forEach((s, k) => {
    if ((k + off) % 2 === 0) el.append(h('span', { class: 'n' }, startNum + Math.floor((k + off) / 2) + '.'));
    el.append(h('span', { class: 'm' + (k + 1 === cur ? ' cur' : ''), onclick: () => onSelect(k + 1), dataset: { ply: k + 1 } }, s));
  });
  const c = el.querySelector('.cur'); if (c) c.scrollIntoView({ block: 'nearest' }); else el.scrollTop = el.scrollHeight;
}
/** captured pieces & material balance from a FEN → {w: 'string of pieces white captured', b:…, diff} (diff>0 white ahead) */
export function captured(fen) {
  const start = { p: 8, n: 2, b: 2, r: 2, q: 1 }, have = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const ch of fen.split(' ')[0]) { const l = ch.toLowerCase(); if (have.w[l] === undefined) continue; have[ch === l ? 'b' : 'w'][l]++; }
  const out = { w: '', b: '' }; let diff = 0;
  for (const t of ['q', 'r', 'b', 'n', 'p']) {
    const lostB = Math.max(0, start[t] - have.b[t]), lostW = Math.max(0, start[t] - have.w[t]);
    out.w += GL[t].repeat(lostB); out.b += GL[t].repeat(lostW); diff += (have.w[t] - have.b[t]) * VAL[t];
  }
  return { ...out, diff };
}
export const REASONS = { checkmate: 'by checkmate', resignation: 'by resignation', timeout: 'on time', 'timeout-insufficient': 'on time vs insufficient material', stalemate: 'by stalemate', agreement: 'by agreement', threefold: 'by threefold repetition', fifty: 'by the fifty-move rule', fivefold: 'by fivefold repetition', seventyfive: 'by the 75-move rule', insufficient: 'by insufficient material', abandoned: 'because a player left', aborted: 'game aborted', 'no-show': 'no-show', expired: 'expired', cancelled: 'cancelled' };
export function resultText(result, reason, myColor) {
  const why = REASONS[reason] || reason || '';
  if (reason === 'aborted') return { title: 'Game aborted', sub: 'No rating change.' };
  if (result === '1/2-1/2') return { title: 'Draw', sub: why };
  const wWon = result === '1-0';
  const won = myColor ? (myColor === 'w') === wWon : null;
  return { title: won == null ? (wWon ? 'White wins' : 'Black wins') : won ? 'You won!' : 'You lost', sub: (won == null ? '' : wWon ? 'White' : 'Black') + ' ' + (won == null ? '' : 'won ') + why };
}
export function clockEl() { return h('div', { class: 'clock', 'aria-live': 'off' }, '0:00'); }
export function paintClock(el, ms, active) { el.textContent = fmtClock(ms); el.classList.toggle('active', !!active); el.classList.toggle('low', ms < 20000 && ms > 0 && active); }
export function playerStrip(avatarEl, nameEl, ratingText, clock) { const caps = h('div', { class: 'caps' }); const strip = h('div', { class: 'player-strip' }, avatarEl, h('div', null, h('div', null, nameEl, ' ', h('span', { class: 'prating' }, ratingText)), caps), clock); strip.caps = caps; return strip; }
