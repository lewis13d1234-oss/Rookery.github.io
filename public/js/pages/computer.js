import { h, clear, toast, confirmBox, avatar, fmtClock } from '../util.js';
import { state, post } from '../api.js';
import { Board } from '../board.js';
import { Chess, START_FEN } from '/shared/chess.js';
import { toPgn } from '/shared/pgn.js';
import { soundForMove, play } from '../sound.js';
import { engineMove, analyse, cancelEngine, LEVELS } from '../engine-client.js';
import { moveList, captured, resultText, clockEl, paintClock, playerStrip } from '../game-ui.js';

const TCS = [['No clock', 0, 0], ['1+0', 60, 0], ['3+2', 180, 2], ['5+0', 300, 0], ['10+0', 600, 0], ['15+10', 900, 10]];
export default async function computer(root, ctx) {
  ctx.setTitle('Play the computer'); ctx.wide();
  let level = +localStorage.getItem('rk_level') || 3, color = 'w', tcIdx = 0;
  const setup = h('div', { class: 'card setup' });
  const levelBox = h('div', { class: 'levels' }), colorBox = h('div', { class: 'seg' }), tcBox = h('div', { class: 'seg' });
  const drawSetup = () => {
    clear(levelBox); for (const l of LEVELS) levelBox.append(h('button', { class: 'level' + (l.id === level ? ' active' : ''), onclick: () => { level = l.id; localStorage.setItem('rk_level', level); drawSetup(); } }, h('strong', null, l.name), h('span', { class: 'muted small' }, '≈' + l.approxElo)));
    clear(colorBox); for (const [c, t] of [['w', '♔ White'], ['r', '🎲 Random'], ['b', '♚ Black']]) colorBox.append(h('button', { class: color === c ? 'active' : '', onclick: () => { color = c; drawSetup(); } }, t));
    clear(tcBox); TCS.forEach(([t], i) => tcBox.append(h('button', { class: tcIdx === i ? 'active' : '', onclick: () => { tcIdx = i; drawSetup(); } }, t)));
  };
  drawSetup();
  setup.append(h('h1', null, 'Play the computer'), h('p', { class: 'muted' }, 'Free, unlimited games against the Rookery engine, right in your browser. Strength labels are rough estimates, not measured ratings.'),
    h('h3', null, 'Strength'), levelBox, h('h3', { style: { marginTop: '16px' } }, 'You play'), colorBox, h('h3', { style: { marginTop: '16px' } }, 'Clock'), tcBox,
    h('div', { style: { marginTop: '20px' } }, h('button', { class: 'btn primary large', onclick: () => start() }, 'Start game')));
  root.append(setup);
  let cleanup = () => {};
  function start() {
    clear(root); const c = color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : color; const [, tcI, tcInc] = TCS[tcIdx];
    cleanup = playGame(root, ctx, { level, human: c, initial: tcI, inc: tcInc, again: () => { cleanup(); clear(root); root.append(setup); } });
  }
  return () => cleanup();
}

function playGame(root, ctx, o) {
  const lvl = LEVELS.find((l) => l.id === o.level); const chess = new Chess(START_FEN); const cpuColor = o.human === 'w' ? 'b' : 'w';
  let over = null, thinking = false, viewPly = null, board, clocks = [o.initial * 1000, o.initial * 1000], last = Date.now(), timer = null, token = 0, hintArrow = false, dead = false, saved = false;
  const topClock = clockEl(), botClock = clockEl(), boardHost = h('div'), movesEl = h('div', { class: 'moves' }), banner = h('div'), status = h('div', { class: 'muted small' }), actions = h('div', { class: 'controls' });
  const cpuStrip = playerStrip(h('span', { class: 'avatar init', style: { width: '34px', height: '34px', background: '#556' } }, '🤖'), h('strong', null, `Computer (${lvl.name})`), `≈${lvl.approxElo}`, o.human === 'w' ? topClock : botClock);
  const meStrip = playerStrip(avatar(state.user || { username: 'You' }, 34), h('strong', null, state.user?.username || 'You'), '', o.human === 'w' ? botClock : topClock);
  const top = h('div'), bot = h('div'); top.append(cpuStrip); bot.append(meStrip);
  const navBtns = h('div', { class: 'nav-btns' }, [['⏮', () => goto(0)], ['◀', () => goto((viewPly ?? chess.ply) - 1)], ['▶', () => goto((viewPly ?? chess.ply) + 1)], ['⏭', () => goto(null)]].map(([t, f]) => h('button', { class: 'btn small', onclick: f }, t)));
  root.append(h('div', { class: 'game-layout' }, h('div', { class: 'board-col' }, top, boardHost, bot), h('div', { class: 'side-panel' }, h('div', { class: 'card' }, h('strong', null, `Playing: ${o.human === 'w' ? 'White' : 'Black'}`), h('div', { class: 'muted small' }, o.initial ? `Clock ${o.initial / 60}+${o.inc}` : 'No clock'), status), banner, h('div', { class: 'card' }, h('p', { class: 'panel-title' }, 'Moves'), movesEl, navBtns), h('div', { class: 'card' }, actions))));
  board = new Board(boardHost, { orientation: o.human, set: state.prefs.pieces, coords: state.prefs.coords !== false, animate: state.prefs.animations !== false, interactive: true, movableColor: o.human, legalTargets: (sq) => [...new Set(chess.moves({ square: sq, verbose: true }).map((m) => m.to))], onMove: onUser });
  const fenAt = (n) => { const g = new Chess(START_FEN); chess.history().slice(0, n).forEach((s) => g.move(s)); return g.fen(); };
  function goto(n) { viewPly = n == null || n >= chess.ply ? null : Math.max(0, n); refresh(false); }
  function refresh(animate = true) {
    const fen = viewPly == null ? chess.fen() : fenAt(viewPly); const hist = chess.history(); const uci = chess.historyUci(); const li = (viewPly ?? hist.length) - 1;
    const g = new Chess(fen); board.setPosition(fen, { lastMove: li >= 0 ? [uci[li].slice(0, 2), uci[li].slice(2, 4)] : null, check: g.inCheck() ? board.kingSquare(g.turnColor()) : null, animate });
    board.setInteractive(!over && !thinking && viewPly == null && chess.turnColor() === o.human, o.human);
    board.o.canPremove = !over && viewPly == null && chess.turnColor() !== o.human && state.prefs.premove !== false; if (!board.o.canPremove && chess.turnColor() !== o.human) board.clearPremove();
    moveList(movesEl, hist, viewPly ?? hist.length, goto);
    const cap = captured(fen); const hm = o.human, cm = cpuColor;
    meStrip.caps.textContent = cap[hm] + ((hm === 'w' ? cap.diff : -cap.diff) > 0 ? ' +' + Math.abs(cap.diff) : ''); cpuStrip.caps.textContent = cap[cm] + ((cm === 'w' ? cap.diff : -cap.diff) > 0 ? ' +' + Math.abs(cap.diff) : '');
    drawActions();
  }
  function paintClocks() {
    const now = Date.now(); const c = [...clocks];
    if (o.initial && !over && chess.ply >= 2) { const i = chess.turn; c[i] = Math.max(0, c[i] - (now - last)); if (c[i] <= 0) return endGame(i === 0 ? '0-1' : '1-0', 'timeout'); }
    for (const [el, col] of [[topClock, o.human === 'w' ? 'b' : 'w'], [botClock, o.human]]) { if (!o.initial) { el.textContent = '∞'; continue; } paintClock(el, c[col === 'w' ? 0 : 1], !over && chess.turnColor() === col && chess.ply >= 2); }
  }
  function drawActions() {
    clear(actions);
    if (!over) {
      actions.append(h('button', { class: 'btn', onclick: hint, disabled: thinking || chess.turnColor() !== o.human }, '💡 Hint'), h('button', { class: 'btn', onclick: takeback, disabled: chess.ply < (o.human === 'w' ? 2 : 3) || thinking }, '↶ Takeback'), h('button', { class: 'btn', onclick: offerDraw }, '½ Offer draw'));
      const cl = chess.claimableDraw(); if (cl) actions.append(h('button', { class: 'btn', onclick: () => endGame('1/2-1/2', cl === 'threefold' ? 'threefold' : 'fifty') }, 'Claim draw'));
      actions.append(h('button', { class: 'btn danger', onclick: async () => { if (!state.prefs.confirmResign || await confirmBox('Resign?', 'The computer wins this game.', 'Resign')) endGame(o.human === 'w' ? '0-1' : '1-0', 'resignation'); } }, '⚑ Resign'));
    } else actions.append(h('button', { class: 'btn primary', onclick: o.again }, '↻ New game'), h('button', { class: 'btn', onclick: analyseGame }, '🔍 Analyse game'), h('button', { class: 'btn', onclick: () => { const t = toPgn({ headers: { White: o.human === 'w' ? (state.user?.username || 'Human') : `Computer (${lvl.name})`, Black: o.human === 'b' ? (state.user?.username || 'Human') : `Computer (${lvl.name})` }, moves: chess.history(), result: over.result }); navigator.clipboard?.writeText(t); toast('PGN copied to clipboard', 'success'); } }, '📋 Copy PGN'));
    actions.append(h('button', { class: 'btn ghost small', onclick: () => board.flip() }, '⇅ Flip'));
  }
  function analyseGame() { try { sessionStorage.setItem('rk_analyse_pgn', toPgn({ headers: { White: o.human === 'w' ? (state.user?.username || 'You') : `Computer (${lvl.name})`, Black: o.human === 'b' ? (state.user?.username || 'You') : `Computer (${lvl.name})` }, moves: chess.history(), result: over?.result || '*' })); } catch {} ctx.navigate('/analysis'); }
  function advanceClock() { const now = Date.now(); if (o.initial && chess.ply >= 2) { const i = 1 - chess.turn; clocks[i] = Math.max(0, clocks[i] - (now - last)) + (o.inc * 1000); } last = now; }
  function afterMove(mv) {
    soundForMove(mv, chess.inCheck()); hintArrow && (board.setArrows([]), board.setHints([]), hintArrow = false);
    const st = chess.status(); if (st.over) { board.clearPremove(); return endGame(st.result, st.reason); } refresh(); maybeCpu(); if (mv.color !== o.human) { const pm = board.takePremove(); if (pm) setTimeout(() => { if (!dead && !over) onUser(pm.from, pm.to, pm.promo); }, 60); }
  }
  async function onUser(from, to, promo) {
    if (over || thinking || chess.turnColor() !== o.human || viewPly != null) return false;
    const p = promo || (state.prefs.autoQueen ? undefined : undefined);
    const mv = chess.move({ from, to, promotion: promo }); if (!mv) return false;
    if (o.initial && chess.ply >= 3) { const now = Date.now(); clocks[1 - chess.turn] = Math.max(0, clocks[1 - chess.turn] - (now - last)) + o.inc * 1000; last = now; } else last = Date.now();
    afterMove(mv); return true;
  }
  async function maybeCpu() {
    if (over || chess.turnColor() !== cpuColor) return; thinking = true; const my = ++token; status.textContent = 'Computer is thinking…'; refresh(false);
    const t0 = Date.now(); const cap = o.initial ? Math.max(150, Math.min(3000, clocks[cpuColor === 'w' ? 0 : 1] / 25)) : null;
    try {
      const r = await engineMove(chess.fen(), o.level, cap); if (dead || my !== token) return;
      const wait = Math.max(0, 350 - (Date.now() - t0)); await new Promise((s) => setTimeout(s, wait)); if (dead || my !== token) return;
      thinking = false; status.textContent = '';
      if (!r?.move) return; const mv = chess.move(r.move); if (!mv) return;
      if (o.initial && chess.ply >= 3) { const now = Date.now(); clocks[1 - chess.turn] = Math.max(0, clocks[1 - chess.turn] - (now - last)) + o.inc * 1000; last = now; } else last = Date.now();
      afterMove(mv);
    } catch (e) { thinking = false; if (e.message !== 'cancelled') { status.textContent = ''; toast(e.message, 'error'); } }
  }
  async function hint() { status.textContent = 'Thinking about a hint…'; try { const r = await analyse(chess.fen(), { depth: 9, movetime: 700 }); status.textContent = ''; if (r.move) { board.setArrows([{ from: r.move.slice(0, 2), to: r.move.slice(2, 4) }]); board.o.keepArrows = true; hintArrow = true; } } catch { status.textContent = ''; } }
  function takeback() { if (thinking) return; board.clearPremove(); token++; const n = chess.turnColor() === o.human ? 2 : 1; for (let i = 0; i < n; i++) chess.undo(); viewPly = null; board.setArrows([]); refresh(false); }
  async function offerDraw() {
    status.textContent = 'Computer is considering your draw offer…';
    try { const r = await analyse(chess.fen(), { depth: 7, movetime: 500 }); status.textContent = ''; const sc = r.score * (chess.turnColor() === cpuColor ? 1 : -1); if (sc <= -80 || (chess.ply > 80 && sc < 40)) endGame('1/2-1/2', 'agreement'); else toast('The computer declines the draw.', 'info'); } catch { status.textContent = ''; }
  }
  function endGame(result, reason) {
    if (over) return; over = { result, reason }; token++; cancelEngine(); thinking = false; clearInterval(timer); status.textContent = '';
    const r = resultText(result, reason, o.human); banner.append(h('div', { class: 'result-banner' }, h('h3', null, r.title), h('div', { class: 'muted' }, `${result} · ${r.sub}`))); play(result === '1/2-1/2' ? 'end' : (result === (o.human === 'w' ? '1-0' : '0-1') ? 'win' : 'end'));
    refresh(false);
    if (state.user && chess.ply > 0 && !saved) { saved = true; post('/api/games/computer', { moves: chess.history(), level: o.level, color: o.human, result, reason, initial: o.initial, inc: o.inc }).then(() => status.textContent = 'Game saved to your profile.').catch(() => {}); }
  }
  timer = setInterval(paintClocks, 100);
  const keyH = (e) => { if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return; if (e.key === 'ArrowLeft') goto((viewPly ?? chess.ply) - 1); else if (e.key === 'ArrowRight') goto((viewPly ?? chess.ply) + 1); };
  window.addEventListener('keydown', keyH);
  refresh(false); maybeCpu();
  return () => { dead = true; token++; cancelEngine(); clearInterval(timer); window.removeEventListener('keydown', keyH); board.destroy(); };
}
