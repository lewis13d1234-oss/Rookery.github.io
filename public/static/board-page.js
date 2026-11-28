// Analysis board: move pieces for both sides from any position, load a FEN or PGN, and ask the engine what it thinks.
import { h, clear, toast, download } from '../util.js';
import { state } from '../api.js';
import { Board } from '../board.js';
import { Chess, START_FEN } from '/shared/chess.js';
import { parsePgn, toPgn } from '/shared/pgn.js';
import { soundForMove } from '../sound.js';
import { moveList, captured } from '../game-ui.js';
import { analyse, cancelEngine } from '../engine-client.js';

export default async function boardPage(root, ctx) {
  ctx.setTitle('Analysis board'); ctx.wide();
  let startFen = START_FEN, sans = [], ply = 0, engineOn = false, token = 0, board, dead = false;
  const posAt = (n) => { const g = new Chess(startFen); sans.slice(0, n).forEach((s) => g.move(s)); return g; };
  const host = h('div'), movesEl = h('div', { class: 'moves' }), evalEl = h('div', { class: 'eval-box' }), fenIn = h('input', { class: 'mono', 'aria-label': 'FEN', spellcheck: false }), pgnIn = h('textarea', { rows: 4, placeholder: 'Paste a PGN here…', 'aria-label': 'PGN' });
  const capEl = h('div', { class: 'muted small' }); const barFill = h('div', { class: 'evalbar-fill' }); const bar = h('div', { class: 'evalbar', 'aria-hidden': 'true' }, barFill);
  const engBtn = h('button', { class: 'btn', 'aria-pressed': 'false', onclick: () => { engineOn = !engineOn; engBtn.setAttribute('aria-pressed', engineOn); engBtn.classList.toggle('primary', engineOn); if (engineOn) think(); else { token++; cancelEngine(); clear(evalEl); board.setArrows([]); } } }, '⚡ Engine');
  root.append(h('div', { class: 'game-layout' },
    h('div', { class: 'board-col' }, h('div', { class: 'row', style: { flexWrap: 'nowrap', alignItems: 'stretch' } }, bar, h('div', { class: 'grow' }, host)), capEl),
    h('div', { class: 'side-panel' },
      h('div', { class: 'card' }, h('h2', { style: { marginTop: 0 } }, 'Analysis board'), h('div', { class: 'controls' }, engBtn, h('button', { class: 'btn', onclick: () => { goto(ply - 1); } }, '◀'), h('button', { class: 'btn', onclick: () => goto(ply + 1) }, '▶'), h('button', { class: 'btn', onclick: () => board.flip() }, '⇅ Flip')), evalEl),
      h('div', { class: 'card' }, h('div', { class: 'panel-title' }, 'Moves'), movesEl),
      h('div', { class: 'card' }, h('div', { class: 'panel-title' }, 'Position'), h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, fenIn, h('button', { class: 'btn', onclick: loadFen }, 'Load')), h('div', { class: 'controls', style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: () => { startFen = START_FEN; sans = []; ply = 0; refresh(); } }, 'Start position'), h('button', { class: 'btn small', onclick: async () => { try { await navigator.clipboard.writeText(posAt(ply).fen()); toast('FEN copied', 'success'); } catch { fenIn.select(); toast('Press Ctrl+C to copy', 'info'); } } }, 'Copy FEN'))),
      h('div', { class: 'card' }, h('div', { class: 'panel-title' }, 'PGN'), pgnIn, h('div', { class: 'controls', style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: loadPgn }, 'Load PGN'), h('button', { class: 'btn small', onclick: () => download('rookery-analysis.pgn', pgnOut()) }, '⬇ Save PGN'), h('button', { class: 'btn small', onclick: () => { try { sessionStorage.setItem('rk_analyse_pgn', pgnOut()); } catch {} location.hash = '/analysis'; } }, '🔍 Full game report'))))));
  const pgnOut = () => toPgn({ headers: startFen === START_FEN ? { Event: 'Rookery analysis board' } : { Event: 'Rookery analysis board', SetUp: '1', FEN: startFen }, moves: sans, result: '*', fen: startFen === START_FEN ? null : startFen });
  board = new Board(host, { orientation: 'w', set: state.prefs.pieces, coords: state.prefs.coords !== false, animate: state.prefs.animations !== false, interactive: true, movableColor: 'w', legalTargets: (sq) => [...new Set(posAt(ply).moves({ square: sq, verbose: true }).map((m) => m.to))], onMove });
  function onMove(from, to, promo) {
    const g = posAt(ply); const mv = g.move({ from, to, promotion: promo }); if (!mv) return false;
    if (sans[ply] === mv.san) { ply++; } else { sans = sans.slice(0, ply); sans.push(mv.san); ply++; }
    soundForMove(mv, g.inCheck()); refresh(); return true;
  }
  function goto(n) { ply = Math.max(0, Math.min(sans.length, n)); refresh(false); }
  function refresh(animate = true) {
    const g = posAt(ply), fen = g.fen(), uci = g.historyUci(); const li = ply - 1;
    board.setPosition(fen, { lastMove: li >= 0 && uci[li] ? [uci[li].slice(0, 2), uci[li].slice(2, 4)] : null, check: g.inCheck() ? board.kingSquare(g.turnColor()) : null, animate });
    board.setInteractive(true, g.turnColor()); fenIn.value = fen; moveList(movesEl, sans, ply, (n) => goto(n));
    const st = g.status(); const cp = captured(fen); capEl.textContent = st.over ? (st.result === '1/2-1/2' ? 'Draw: ' + st.reason : (st.result === '1-0' ? 'White' : 'Black') + ' wins: ' + st.reason) : `${g.turnColor() === 'w' ? 'White' : 'Black'} to move`;
    if (engineOn) think(); else { board.setArrows([]); }
  }
  let timer; function think() { clearTimeout(timer); timer = setTimeout(run, 250); }
  async function run() {
    const my = ++token; const g = posAt(ply); if (g.status().over) { clear(evalEl); evalEl.append(h('span', { class: 'muted' }, 'Game over')); barFill.style.height = g.status().result === '1-0' ? '100%' : g.status().result === '0-1' ? '0%' : '50%'; board.setArrows([]); return; }
    evalEl.textContent = 'Thinking…';
    try {
      const r = await analyse(g.fen(), { depth: 14, movetime: 1500 }); if (dead || my !== token) return;
      const white = g.turnColor() === 'w' ? r.score : -r.score; const m = r.mate != null ? (g.turnColor() === 'w' ? r.mate : -r.mate) : null;
      const label = m != null ? (m > 0 ? '+M' : '-M') + Math.abs(m) : (white >= 0 ? '+' : '−') + (Math.abs(white) / 100).toFixed(2);
      const pct = m != null ? (m > 0 ? 100 : 0) : 50 + 50 * (2 / (1 + Math.exp(-white / 180)) - 1); barFill.style.height = Math.max(2, Math.min(98, pct)) + '%';
      const line = []; const pg = new Chess(g.fen()); for (const u of (r.pv || [r.move]).slice(0, 8)) { const mv = pg.move(u); if (!mv) break; line.push(mv.san); }
      clear(evalEl); evalEl.append(h('div', { class: 'row' }, h('strong', { class: 'eval-num' }, label), h('span', { class: 'muted small' }, 'depth ' + (r.depth || '?'))), h('div', { class: 'small' }, 'Best: ', h('strong', null, line[0] || '—')), h('div', { class: 'muted small mono' }, line.join(' ')));
      if (r.move) board.setArrows([{ from: r.move.slice(0, 2), to: r.move.slice(2, 4) }]);
    } catch (e) { if (e.message !== 'cancelled') { evalEl.textContent = ''; } }
  }
  function loadFen() { try { const g = new Chess(); g.load(fenIn.value.trim()); startFen = g.fen(); sans = []; ply = 0; refresh(false); toast('Position loaded', 'success'); } catch (e) { toast(e.message, 'error'); } }
  function loadPgn() { const { games, errors } = parsePgn(pgnIn.value); if (!games.length) return toast(errors[0] || 'No game found in that text', 'error'); const G = games[0]; startFen = G.fen; sans = G.moves.slice(); ply = 0; refresh(false); toast(`Loaded ${sans.length} moves`, 'success'); }
  const kh = (e) => { if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return; if (e.key === 'ArrowLeft') goto(ply - 1); else if (e.key === 'ArrowRight') goto(ply + 1); else if (e.key === 'Home') goto(0); else if (e.key === 'End') goto(sans.length); };
  window.addEventListener('keydown', kh); refresh(false);
  return () => { dead = true; token++; clearTimeout(timer); cancelEngine(); window.removeEventListener('keydown', kh); board.destroy(); };
}
