// Two players, one device. Full rules, optional board auto-flip, takebacks, PGN export and analysis hand-off.
import { h, clear, toast, confirmBox, download, fmtClock } from '../util.js';
import { state } from '../api.js';
import { Board } from '../board.js';
import { Chess, START_FEN } from '/shared/chess.js';
import { toPgn } from '/shared/pgn.js';
import { soundForMove, play } from '../sound.js';
import { saveGame } from './mygames.js';
import { profiles, activeProfile } from '../profiles.js';
import { loadLocal, saveLocal, resumeCard } from '../resume.js';
import { moveList, captured, resultText, clockEl, paintClock } from '../game-ui.js';

const TCS = [['No clock', 0, 0], ['1+0', 60, 0], ['3+2', 180, 2], ['5+0', 300, 0], ['10+0', 600, 0], ['15+10', 900, 10]];
export default async function local(root, ctx) {
  ctx.setTitle('Two players'); ctx.wide();
  let tcIdx = 0, flip = localStorage.getItem('rk_autoflip') === '1'; let cleanup = () => {};
  const names = profiles().map((p) => p.name); const act = activeProfile().name; const other = names.find((n) => n !== act) || 'Guest';
  const sel = (def) => { const el = h('select', { 'aria-label': 'Player name' }, [...new Set([...names, 'Guest', 'Guest 2'])].map((n) => h('option', { value: n }, n))); el.value = def; return el; };
  const wsel = sel(act), bsel = sel(other === act ? 'Guest' : other);
  const setup = h('div', { class: 'card setup' }); const tcBox = h('div', { class: 'seg' });
  const draw = () => { clear(tcBox); TCS.forEach(([t], i) => tcBox.append(h('button', { class: tcIdx === i ? 'active' : '', onclick: () => { tcIdx = i; draw(); } }, t))); };
  draw();
  const fl = h('input', { type: 'checkbox', checked: flip, onchange: () => { flip = fl.checked; try { localStorage.setItem('rk_autoflip', flip ? '1' : '0'); } catch {} } });
  setup.append(h('h1', null, 'Two players, one device'), h('p', { class: 'muted' }, 'Pass the device back and forth, or sit side by side. Full rules, with an optional clock.'), h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', null, 'White'), wsel), h('label', { class: 'field' }, h('span', null, 'Black'), bsel)), h('h3', null, 'Clock'), tcBox,
    h('label', { class: 'check', style: { marginTop: '14px' } }, fl, ' Turn the board after every move'), h('div', { style: { marginTop: '20px' } }, h('button', { class: 'btn primary large', onclick: start }, 'Start game')));
  const rc = resumeCard('local', 'Unfinished two-player game', (r) => `${r.o.white} vs ${r.o.black} \u00b7 ${Math.ceil(r.moves.length / 2)} moves`, (r) => { clear(root); cleanup = game(root, { ...r.o, resume: r, again: () => { cleanup(); clear(root); root.append(setup); } }); });
  root.append(rc, setup);
  function start() { clear(root); const [, initial, inc] = TCS[tcIdx]; cleanup = game(root, { initial, inc, flip, white: wsel.value, black: bsel.value, again: () => { cleanup(); clear(root); root.append(setup); } }); }
  return () => cleanup();
}
function game(root, o) {
  const chess = new Chess(START_FEN); if (o.resume) for (const m of o.resume.moves) chess.move(m); let over = null, viewPly = null, clocks = o.resume ? o.resume.clocks : [o.initial * 1000, o.initial * 1000], last = Date.now(), timer, board;
  const topClock = clockEl(), botClock = clockEl(), host = h('div'), movesEl = h('div', { class: 'moves' }), banner = h('div'), actions = h('div', { class: 'controls' }), turnEl = h('strong');
  const nm = (c) => (c === 'w' ? 'White' : 'Black');
  const strip = (c, clk) => h('div', { class: 'pstrip row', style: { justifyContent: 'space-between', padding: '6px 0' } }, h('strong', null, c === 'w' ? '\u2654 ' + o.white : '\u265a ' + o.black), clk);
  const top = h('div'), bot = h('div');
  root.append(h('div', { class: 'game-layout' }, h('div', { class: 'board-col' }, top, host, bot), h('div', { class: 'side-panel' }, h('div', { class: 'card' }, turnEl, h('div', { class: 'muted small' }, o.initial ? `Clock ${o.initial / 60}+${o.inc}` : 'No clock')), banner, h('div', { class: 'card' }, h('div', { class: 'panel-title' }, 'Moves'), movesEl), h('div', { class: 'card' }, actions))));
  const strips = () => { clear(top); clear(bot); const bottom = board.o.orientation, topc = bottom === 'w' ? 'b' : 'w'; top.append(strip(topc, topClock)); bot.append(strip(bottom, botClock)); };
  board = new Board(host, { orientation: 'w', set: state.prefs.pieces, coords: state.prefs.coords !== false, animate: state.prefs.animations !== false, interactive: true, movableColor: 'w', legalTargets: (sq) => [...new Set(chess.moves({ square: sq, verbose: true }).map((m) => m.to))], onMove: onUser });
  strips();
  const fenAt = (n) => { const g = new Chess(START_FEN); chess.history().slice(0, n).forEach((s) => g.move(s)); return g.fen(); };
  const goto = (n) => { viewPly = n == null || n >= chess.ply ? null : Math.max(0, n); refresh(false); };
  function refresh(animate = true) {
    const fen = viewPly == null ? chess.fen() : fenAt(viewPly); const hist = chess.history(), uci = chess.historyUci(), li = (viewPly ?? hist.length) - 1; const g = new Chess(fen);
    board.setPosition(fen, { lastMove: li >= 0 ? [uci[li].slice(0, 2), uci[li].slice(2, 4)] : null, check: g.inCheck() ? board.kingSquare(g.turnColor()) : null, animate });
    board.setInteractive(!over && viewPly == null, chess.turnColor()); moveList(movesEl, hist, viewPly ?? hist.length, goto);
    turnEl.textContent = over ? 'Game over' : `${nm(chess.turnColor())} to move`; drawActions();
  }
  function paint() {
    const c = [...clocks], now = Date.now();
    if (o.initial && !over && chess.ply >= 2) { const i = chess.turn; c[i] = Math.max(0, c[i] - (now - last)); if (c[i] <= 0) return end(i === 0 ? '0-1' : '1-0', 'timeout'); }
    const b = board.o.orientation; for (const [el, col] of [[topClock, b === 'w' ? 'b' : 'w'], [botClock, b]]) { if (!o.initial) { el.textContent = '∞'; continue; } paintClock(el, c[col === 'w' ? 0 : 1], !over && chess.turnColor() === col && chess.ply >= 2); }
  }
  function end(result, reason) { if (over) return; over = { result, reason }; saveLocal(null); clearInterval(timer); if (chess.ply > 0) saveGame({ mode: 'local', result, reason, moves: chess.history(), white: o.white, black: o.black }); const r = resultText(result, reason, null); clear(banner); banner.append(h('div', { class: 'card result-banner' }, h('h3', null, r.title), h('div', { class: 'muted' }, `${result} · ${r.sub}`))); play('end'); refresh(false); }
  const pgn = () => toPgn({ headers: { Event: 'Rookery two-player game', White: o.white, Black: o.black }, moves: chess.history(), result: over?.result || '*' });
  function drawActions() {
    clear(actions);
    if (!over) {
      actions.append(h('button', { class: 'btn', disabled: !chess.ply, onclick: () => { const n = chess.history().length; chess.undo(); if (o.initial && n) last = Date.now(); saveLocal({ o: { initial: o.initial, inc: o.inc, flip: o.flip, white: o.white, black: o.black }, moves: chess.history(), clocks }); viewPly = null; refresh(false); } }, '↶ Take back'));
      const cl = chess.claimableDraw(); if (cl) actions.append(h('button', { class: 'btn', onclick: () => end('1/2-1/2', cl === 'threefold' ? 'threefold' : 'fifty') }, 'Claim draw'));
      actions.append(h('button', { class: 'btn', onclick: async () => { if (await confirmBox('Draw by agreement?', 'Both players agree to a draw.', 'Agree draw')) end('1/2-1/2', 'agreement'); } }, '½ Agree draw'),
        h('button', { class: 'btn danger', onclick: async () => { const c = chess.turnColor(); if (await confirmBox(nm(c) + ' resigns?', nm(c) + ' will lose the game.', 'Resign')) end(c === 'w' ? '0-1' : '1-0', 'resignation'); } }, '⚑ Resign'));
    } else actions.append(h('button', { class: 'btn primary', onclick: o.again }, '↻ New game'), h('button', { class: 'btn', onclick: () => { try { sessionStorage.setItem('rk_analyse_pgn', pgn()); } catch {} location.hash = '/analysis'; } }, '🔍 Analyse game'), h('button', { class: 'btn', onclick: () => download('rookery-game.pgn', pgn()) }, '⬇ PGN'));
    actions.append(h('button', { class: 'btn ghost small', onclick: () => { board.flip(); strips(); paint(); } }, '⇅ Flip'));
  }
  function onUser(from, to, promo) {
    if (over || viewPly != null) return false; const mv = chess.move({ from, to, promotion: promo }); if (!mv) return false;
    const now = Date.now(); if (o.initial && chess.ply >= 3) clocks[1 - chess.turn] = Math.max(0, clocks[1 - chess.turn] - (now - last)) + o.inc * 1000; last = now;
    soundForMove(mv, chess.inCheck()); saveLocal({ o: { initial: o.initial, inc: o.inc, flip: o.flip, white: o.white, black: o.black }, moves: chess.history(), clocks }); const st = chess.status(); if (o.flip && !st.over) { board.setOrientation(chess.turnColor()); strips(); }
    if (st.over) { refresh(); end(st.result, st.reason); } else refresh(); return true;
  }
  timer = setInterval(paint, 100); refresh(false);
  const kh = (e) => { if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return; if (e.key === 'ArrowLeft') goto((viewPly ?? chess.ply) - 1); else if (e.key === 'ArrowRight') goto((viewPly ?? chess.ply) + 1); };
  window.addEventListener('keydown', kh);
  return () => { clearInterval(timer); window.removeEventListener('keydown', kh); board.destroy(); };
}
