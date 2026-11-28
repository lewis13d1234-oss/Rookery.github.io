// Game analysis. Move-quality method (documented so it can be checked):
//  * Each position is searched by the Rookery engine (depth ≤ 9, ~250 ms). Scores are centipawns from the side to move.
//  * Win probability  wp(cp) = 50 + 50·(2 / (1 + e^(−0.00368208·cp)) − 1)   (the logistic used by Lichess).
//  * A move's loss = wp(best play before the move) − wp(position after the move), both from the mover's side.
//  * Classification: loss < 1 and equals engine move → Best · < 3 → Excellent · < 5 → Good · < 10 → Inaccuracy · < 20 → Mistake · ≥ 20 → Blunder.
//  * Missed win: the mover was clearly winning (wp ≥ 85) and the move dropped wp below 65.
//  * Brilliant: a sacrifice of ≥ 3 points of material that the engine says loses ≤ 2 wp and the mover is not already winning (wp < 80 before).
//  * Accuracy per move = 103.1668·e^(−0.04354·loss) − 3.1669 (clamped 0–100); a player's accuracy is the mean.
// This is a lightweight engine, so treat the labels as guidance, not as a master-level verdict.
import { h, clear, toast, pickFile, download, tabs, spinner } from '../util.js';
import { state, get } from '../api.js';
import { Board } from '../board.js';
import { Chess, START_FEN } from '/shared/chess.js';
import { parsePgn, toPgn } from '/shared/pgn.js';
import { classify } from '/shared/openings.js';
import { analyse, cancelEngine } from '../engine-client.js';
import { moveList, captured } from '../game-ui.js';
import { soundForMove } from '../sound.js';

const wp = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const CLS = { best: ['Best', '★', '#4fbf7a'], excellent: ['Excellent', '✓', '#7fcf8e'], good: ['Good', '✓', '#9bb7a0'], inaccuracy: ['Inaccuracy', '?!', '#e6c34a'], mistake: ['Mistake', '?', '#e8963c'], blunder: ['Blunder', '??', '#e5645c'], missed: ['Missed win', '✗', '#d46bd8'], brilliant: ['Brilliant', '!!', '#35c9e0'] };

export default async function analysis(root, ctx) {
  ctx.setTitle('Game analysis'); ctx.wide();
  let G = null, depthSel = null, ply = 0, res = [], running = false, runTok = 0, dead = false, board, live = 0, liveTimer;
  const host = h('div'), movesEl = h('div', { class: 'moves' }), evalFill = h('div', { class: 'w' }), evalNum = h('span'), graph = h('div', { class: 'eval-graph' }), sumEl = h('div'), progress = h('div'), liveEl = h('div', { class: 'live-eng' }), headEl = h('div');
  const evalBar = h('div', { class: 'eval-bar', style: { height: '100%' }, 'aria-label': 'Evaluation' }, evalFill, evalNum);
  const topStrip = h('div', { class: 'player-strip' }), botStrip = h('div', { class: 'player-strip' });
  const navBtns = h('div', { class: 'nav-btns' }, [['⏮', () => go(0)], ['◀', () => go(ply - 1)], ['▶', () => go(ply + 1)], ['⏭', () => go(G ? G.moves.length : 0)]].map(([t, f]) => h('button', { class: 'btn small', onclick: f }, t)));
  const importCard = h('div', { class: 'card' });
  const tabEls = { moves: h('div'), summary: sumEl }; let tab = 'summary';
  const tb = tabs([['summary', 'Summary'], ['moves', 'Moves']], tab, (t) => { tab = t; for (const [k, el] of Object.entries(tabEls)) el.hidden = k !== t; });
  tabEls.moves.append(movesEl);
  const side = h('div', { class: 'side-panel' }, headEl, h('div', { class: 'card' }, tb, tabEls.summary, tabEls.moves, navBtns), liveEl, importCard);
  root.append(h('h1', null, 'Game analysis'), h('div', { class: 'game-layout analysis-layout' }, h('div', { class: 'board-col fill' }, topStrip, h('div', { class: 'row', style: { flexWrap: 'nowrap', alignItems: 'stretch', gap: '8px' } }, h('div', { class: 'evalwrap' }, evalBar), h('div', { style: { flex: 1, minWidth: 0 } }, host)), botStrip, h('div', { class: 'card', style: { marginTop: '12px' } }, h('p', { class: 'panel-title' }, 'Evaluation graph'), graph, progress)), side));
  tabEls.moves.hidden = true;
  board = new Board(host, { set: state.prefs.pieces, coords: state.prefs.coords !== false, animate: state.prefs.animations !== false, interactive: true, movableColor: 'both', legalTargets: (sq) => { const g = new Chess(fenAt(ply)); return [...new Set(g.moves({ square: sq, verbose: true }).map((m) => m.to))]; }, onMove: userMove });

  const fenAt = (n) => (G ? G.fens[Math.min(n, G.fens.length - 1)] : START_FEN);
  function setGame(parsed, headers = {}) {
    const g = new Chess(parsed.fen || START_FEN); const fens = [g.fen()], ucis = [], sans = [];
    for (const s of parsed.moves) { const mv = g.move(s); if (!mv) break; sans.push(mv.san); ucis.push(mv.lan); fens.push(g.fen()); }
    G = { headers, moves: sans, ucis, fens, result: parsed.result || '*', start: parsed.fen || START_FEN }; ply = 0; res = []; runTok++; cancelEngine(); running = false;
    drawHead(); go(0); run();
  }
  function drawHead() {
    clear(headEl); const hd = G.headers; const o = classify(G.moves);
    headEl.append(h('div', { class: 'card' }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('strong', null, `${hd.White || 'White'} vs ${hd.Black || 'Black'}`), h('span', { class: 'pill' }, G.result)), h('div', { class: 'muted small' }, [hd.Event, hd.Date].filter((x) => x && x !== '?').join(' · ')), o ? h('div', { style: { marginTop: '6px' } }, h('span', { class: 'pill accent' }, o.eco), ' ', o.name) : null));
    for (const [el, c] of [[topStrip, 'b'], [botStrip, 'w']]) { clear(el); el.append(h('strong', null, c === 'w' ? (hd.White || 'White') : (hd.Black || 'Black')), h('span', { class: 'muted' }, c === 'w' ? (hd.WhiteElo ? '(' + hd.WhiteElo + ')' : '') : (hd.BlackElo ? '(' + hd.BlackElo + ')' : '')), h('span', { class: 'acc', dataset: { c } })); }
  }
  function go(n) { if (!G) return; ply = Math.max(0, Math.min(G.moves.length, n)); paint(); }
  function paint() {
    const fen = fenAt(ply); const g = new Chess(fen); const lm = ply > 0 ? [G.ucis[ply - 1].slice(0, 2), G.ucis[ply - 1].slice(2, 4)] : null;
    board.setPosition(fen, { lastMove: lm, check: g.inCheck() ? board.kingSquare(g.turnColor()) : null }); board.setInteractive(true, 'both'); board.o.freeTurn = false;
    moveList(movesEl, G.moves.map((s, i) => s + (res[i + 1]?.cls && ['blunder', 'mistake', 'inaccuracy', 'brilliant', 'missed'].includes(res[i + 1].cls) ? ' ' + CLS[res[i + 1].cls][1] : '')), ply, go, G.start.split(' ')[1], parseInt(G.start.split(' ')[5]) || 1);
    const r = res[ply]; setEval(r ? r.white : null, r); const best = res[ply]?.best; board.setArrows(best && ply < G.moves.length ? [{ from: best.slice(0, 2), to: best.slice(2, 4), color: 'rgba(80,200,120,.85)' }] : []);
    if (ply > 0 && res[ply]?.cls) liveEl.firstChild || null; drawLiveHint(); drawGraph();
  }
  function setEval(cpWhite, r) {
    const p = cpWhite == null ? 50 : wp(cpWhite); evalFill.style.height = p + '%';
    const txt = !r ? '' : r.mate != null ? 'M' + Math.abs(r.mate) : (Math.abs(r.white) / 100).toFixed(1); evalNum.textContent = txt; evalNum.style.top = p >= 50 ? '4px' : 'auto'; evalNum.style.bottom = p >= 50 ? 'auto' : '4px';
  }
  function drawLiveHint() {
    clear(liveEl); if (!G || ply === 0) return; const r = res[ply]; const c = r?.cls;
    if (c) { const [name, ico, col] = CLS[c]; const g = new Chess(fenAt(ply - 1)); const sanBest = r.prevBest ? (() => { try { return g.move(r.prevBest)?.san; } catch { return null; } })() : null;
      liveEl.append(h('div', { class: 'card move-card', style: { borderLeft: `4px solid ${col}` } }, h('strong', { style: { color: col } }, `${ico} ${G.moves[ply - 1]} — ${name}`), r.loss != null ? h('div', { class: 'muted small' }, `Win-chance change: ${r.loss > 0 ? '−' : '+'}${Math.abs(r.loss).toFixed(1)}%`) : null, sanBest && !['best', 'brilliant'].includes(c) ? h('div', { class: 'small' }, 'Better was ', h('strong', null, sanBest), '.') : null)); }
  }
  function drawGraph() {
    clear(graph); if (!G || !res.length) { graph.append(h('div', { class: 'muted small' }, 'The graph fills in as the engine analyses each move.')); return; }
    const W = 600, H = 90, n = G.fens.length; const pts = []; for (let i = 0; i < n; i++) { const r = res[i]; if (!r) break; pts.push([(i / Math.max(1, n - 1)) * W, H - (wp(r.white) / 100) * H]); }
    const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'graph-svg'); svg.setAttribute('preserveAspectRatio', 'none');
    const bg = document.createElementNS(ns, 'rect'); bg.setAttribute('width', W); bg.setAttribute('height', H); bg.setAttribute('fill', '#2b2e38'); svg.append(bg);
    if (pts.length > 1) { const area = document.createElementNS(ns, 'polygon'); area.setAttribute('points', `0,${H} ${pts.map((p) => p.join(',')).join(' ')} ${pts[pts.length - 1][0]},${H}`); area.setAttribute('fill', '#f1ecde'); svg.append(area); }
    const mid = document.createElementNS(ns, 'line'); mid.setAttribute('x1', 0); mid.setAttribute('x2', W); mid.setAttribute('y1', H / 2); mid.setAttribute('y2', H / 2); mid.setAttribute('stroke', 'rgba(128,128,128,.6)'); svg.append(mid);
    for (let i = 1; i < n; i++) { const c = res[i]?.cls; if (['blunder', 'mistake'].includes(c)) { const d = document.createElementNS(ns, 'circle'); d.setAttribute('cx', (i / (n - 1)) * W); d.setAttribute('cy', pts[i] ? pts[i][1] : H / 2); d.setAttribute('r', 4); d.setAttribute('fill', CLS[c][2]); svg.append(d); } }
    const cur = document.createElementNS(ns, 'line'); cur.setAttribute('x1', (ply / Math.max(1, n - 1)) * W); cur.setAttribute('x2', (ply / Math.max(1, n - 1)) * W); cur.setAttribute('y1', 0); cur.setAttribute('y2', H); cur.setAttribute('stroke', 'var(--accent)'); cur.setAttribute('stroke-width', 2); svg.append(cur);
    svg.addEventListener('click', (e) => { const r = svg.getBoundingClientRect(); go(Math.round(((e.clientX - r.left) / r.width) * (n - 1))); }); graph.append(svg);
  }
  async function run() {
    if (running || !G) return; running = true; const tok = ++runTok; const n = G.fens.length; clear(progress);
    const bar = h('div', { class: 'progress', style: { marginTop: '8px' } }, h('i', { style: { width: '0%' } })); const txt = h('div', { class: 'muted small' }, 'Analysing…'); progress.append(bar, txt, h('button', { class: 'btn small', onclick: () => { runTok++; cancelEngine(); running = false; txt.textContent = 'Analysis stopped.'; } }, 'Stop'));
    res = new Array(n);
    for (let i = 0; i < n; i++) {
      if (dead || tok !== runTok) return;
      const g = new Chess(G.fens[i]); const turnW = g.turnColor() === 'w'; let r;
      if (g.isCheckmate()) r = { cp: -30000, mate: 0, best: null }; else if (!g.hasLegalMove() || g.isInsufficientMaterial()) r = { cp: 0, mate: null, best: null };
      else { try { const [dd, mt] = { quick: [9, 250], standard: [12, 800], deep: [16, 2500] }[depthSel?.value || 'standard']; const a = await analyse(G.fens[i], { depth: dd, movetime: mt }); r = { cp: a.score, mate: a.mate, best: a.move, pv: a.pv }; } catch { return; } }
      if (tok !== runTok) return;
      const cpW = turnW ? r.cp : -r.cp; res[i] = { cp: r.cp, white: Math.max(-3000, Math.min(3000, cpW)), mate: r.mate == null ? null : (turnW ? r.mate : -r.mate), best: r.best, pv: r.pv };
      if (i > 0) classifyMove(i);
      bar.firstChild.style.width = ((i + 1) / n * 100) + '%'; txt.textContent = `Analysing position ${i + 1} of ${n}…`;
      if (i === ply || i === ply - 1 || i % 3 === 0) paint();
    }
    running = false; clear(progress); progress.append(h('div', { class: 'muted small' }, 'Analysis complete.')); paint(); summarise();
  }
  function classifyMove(i) { // move i (1-based ply) was played from position i-1 to i
    const before = res[i - 1], after = res[i]; const mover = G.fens[i - 1].split(' ')[1]; const sign = mover === 'w' ? 1 : -1;
    const cpBefore = Math.max(-3000, Math.min(3000, before.cp)), cpAfter = sign * after.white; // mover POV
    const wpB = wp(cpBefore), wpA = wp(cpAfter); let loss = wpB - wpA; const played = G.ucis[i - 1]; after.prevBest = before.best; after.loss = loss; after.mover = mover;
    let cls; if (loss < 1 && before.best === played) cls = 'best'; else if (loss < 1) cls = 'excellent'; else if (loss < 3) cls = 'excellent'; else if (loss < 5) cls = 'good'; else if (loss < 10) cls = 'inaccuracy'; else if (loss < 20) cls = 'mistake'; else cls = 'blunder';
    if (wpB >= 85 && wpA < 65) cls = 'missed';
    if (loss <= 2 && wpB < 80 && isSacrifice(i)) cls = 'brilliant';
    after.cls = cls; after.acc = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, loss)) - 3.1669));
  }
  function isSacrifice(i) { // moved piece lands where it can be captured by a cheaper piece, and the opponent's engine reply is that capture
    const gb = new Chess(G.fens[i - 1]); const mv = gb.move(G.ucis[i - 1]); if (!mv || ['p', 'k'].includes(mv.piece) && !mv.captured) return false; const reply = res[i]?.best; if (!reply) return false;
    const ga = new Chess(G.fens[i]); const rm = ga.move(reply); if (!rm || !rm.captured) return false; const given = VAL[rm.captured]; const won = mv.captured ? VAL[mv.captured] : 0; return rm.to === mv.to && given - won >= 3;
  }
  function summarise() {
    clear(sumEl); const out = { w: [], b: [] }; const counts = { w: {}, b: {} }; const phases = { w: { opening: 0, middlegame: 0, endgame: 0 }, b: { opening: 0, middlegame: 0, endgame: 0 } }; const worst = [];
    for (let i = 1; i < res.length; i++) { const r = res[i]; if (!r?.cls) continue; const c = r.mover; out[c].push(r.acc); counts[c][r.cls] = (counts[c][r.cls] || 0) + 1; if (['blunder', 'mistake', 'missed'].includes(r.cls)) { const g = new Chess(G.fens[i]); let mat = 0; for (const ch of G.fens[i].split(' ')[0]) if (VAL[ch.toLowerCase()]) mat += VAL[ch.toLowerCase()]; const ph = i <= 20 ? 'opening' : mat <= 26 ? 'endgame' : 'middlegame'; phases[c][ph]++; worst.push({ i, c, r }); } }
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0); const hd = G.headers;
    for (const c of ['w', 'b']) { const el = root.querySelector(`.acc[data-c="${c}"]`); if (el) el.textContent = `Accuracy ${mean(out[c]).toFixed(1)}%`; }
    const row = (k) => h('tr', null, h('td', null, h('span', { class: 'cls-dot', style: { background: CLS[k][2] } }), CLS[k][0]), h('td', { class: 'num' }, counts.w[k] || 0), h('td', { class: 'num' }, counts.b[k] || 0));
    sumEl.append(h('div', { class: 'grid-2' }, acc(hd.White || 'White', mean(out.w)), acc(hd.Black || 'Black', mean(out.b))), h('table', { class: 'table small' }, h('thead', null, h('tr', null, h('th', null, 'Move quality'), h('th', { class: 'num' }, 'White'), h('th', { class: 'num' }, 'Black'))), h('tbody', null, ['brilliant', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder', 'missed'].map(row))));
    worst.sort((a, b) => b.r.loss - a.r.loss); const key = worst.slice(0, 3);
    if (key.length) { sumEl.append(h('h3', { style: { marginTop: '14px' } }, 'Key moments'), ...key.map((k) => { const g = new Chess(G.fens[k.i - 1]); const best = k.r.prevBest && g.move(k.r.prevBest)?.san; return h('div', { class: 'key-moment', onclick: () => go(k.i) }, h('strong', { style: { color: CLS[k.r.cls][2] } }, `${Math.ceil(k.i / 2)}${k.c === 'w' ? '.' : '...'} ${G.moves[k.i - 1]} ${CLS[k.r.cls][1]}`), h('span', { class: 'muted small' }, ` ${k.c === 'w' ? 'White' : 'Black'} ${CLS[k.r.cls][0].toLowerCase()}${best ? ` — ${best} was better` : ''}`)); })); }
    const tips = suggestions(counts, phases, mean(out.w), mean(out.b)); sumEl.append(h('h3', { style: { marginTop: '14px' } }, 'Suggested improvements'), h('ul', { class: 'tips' }, tips.map((t) => h('li', null, t.text, t.href ? [' ', h('a', { href: t.href }, t.label)] : null))));
    sumEl.append(h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn small', onclick: exportPgn }, '⬇ Annotated PGN'), h('button', { class: 'btn small', onclick: () => board.flip() }, '⇅ Flip')));
  }
  const acc = (name, v) => h('div', { class: 'stat' }, h('b', null, v ? v.toFixed(1) + '%' : '—'), h('span', null, name + ' accuracy'));
  function suggestions(counts, phases, aw, ab) {
    const out = []; const total = (c, k) => counts[c][k] || 0; const mine = G.headers.Black && state.user && G.headers.Black === state.user.username ? 'b' : 'w'; const who = (c) => (c === 'w' ? 'White' : 'Black');
    for (const c of ['w', 'b']) {
      const p = phases[c], bl = total(c, 'blunder'), ms = total(c, 'mistake'), mw = total(c, 'missed');
      if (p.opening >= 2) out.push({ text: `${who(c)} made ${p.opening} serious error(s) in the first 10 moves. Review opening principles (develop pieces, control the centre, castle early).`, href: '#/learn', label: 'Open the lessons →' });
      if (mw) out.push({ text: `${who(c)} missed ${mw} winning chance(s). When ahead, look for forcing moves (checks, captures, threats) before choosing a calm one.`, href: '#/puzzles/tactic', label: 'Train tactics →' });
      if (bl >= 2) out.push({ text: `${who(c)} blundered ${bl} times — before each move, ask "what does this leave undefended?"` });
      if (p.endgame >= 1) out.push({ text: `${who(c)} slipped in the endgame. Practise basic endgames.`, href: '#/puzzles/endgame', label: 'Endgame puzzles →' });
      if (ms + bl === 0 && G.moves.length > 20) out.push({ text: `${who(c)} played a clean game with no mistakes or blunders. Well played!` });
    }
    if (!out.length) out.push({ text: 'No major problems found. Keep playing and analysing your games to spot patterns.' }); return out.slice(0, 6);
  }
  function exportPgn() {
    const sym = { blunder: '??', mistake: '?', inaccuracy: '?!', brilliant: '!!', missed: '?' }; const moves = G.moves.map((s, i) => s + (sym[res[i + 1]?.cls] || ''));
    const t = toPgn({ headers: { ...G.headers, Annotator: 'Rookery engine' }, moves, result: G.result, fen: G.start }); download('rookery-analysis.pgn', t); }
  async function userMove(from, to, promo) { // free analysis: playing a move branches the game from the current ply
    const g = new Chess(fenAt(ply)); const mv = g.move({ from, to, promotion: promo }); if (!mv) return false;
    if (ply < G.moves.length && G.ucis[ply] === mv.lan) { go(ply + 1); return true; }
    const sans = [...G.moves.slice(0, ply), mv.san]; setGame({ moves: sans, fen: G.start, result: '*' }, { ...G.headers }); go(sans.length); soundForMove(mv, g.inCheck()); return true;
  }
  // ---- import UI
  depthSel = h('select', { 'aria-label': 'Analysis depth' }, h('option', { value: 'quick' }, 'Quick (≈0.25 s/move)'), h('option', { value: 'standard', selected: true }, 'Standard (≈0.8 s/move)'), h('option', { value: 'deep' }, 'Deep (≈2.5 s/move)'));
  const ta = h('textarea', { rows: 5, placeholder: 'Paste PGN or a FEN here…', 'aria-label': 'PGN or FEN' }), sel = h('select', { hidden: true, 'aria-label': 'Choose game' });
  let loaded = [];
  function loadText(text) {
    text = text.trim(); if (!text) return;
    if (!/\[|\d+\.|^[a-hNBRQKO]/.test(text) || /^[rnbqkpRNBQKP1-8/]+ [wb] /.test(text)) { try { new Chess(text); setGame({ moves: [], fen: text, result: '*' }, { Event: 'Position' }); return; } catch {} }
    const { games, errors } = parsePgn(text); if (!games.length) { toast(errors[0] || 'Could not read that PGN', 'error'); return; }
    loaded = games; clear(sel); games.forEach((g, i) => sel.append(h('option', { value: i }, `${i + 1}. ${g.headers.White || '?'} – ${g.headers.Black || '?'} (${g.result})`))); sel.hidden = games.length < 2; if (errors.length) toast(`${errors.length} game(s) skipped (illegal or unreadable moves)`, 'info'); pickGame(0);
  }
  const pickGame = (i) => setGame(loaded[i], loaded[i].headers); sel.addEventListener('change', () => pickGame(+sel.value));
  importCard.append(h('p', { class: 'panel-title' }, 'Import a game'), ta, sel, h('label', { class: 'field', style: { marginTop: '8px' } }, h('span', null, 'Engine depth'), depthSel), h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn primary', onclick: () => loadText(ta.value) }, 'Analyse'), h('button', { class: 'btn', onclick: async () => { const f = await pickFile('.pgn,.txt'); if (f) loadText(await f.text()); } }, '⬆ Upload PGN'), h('button', { class: 'btn', onclick: () => setGame({ moves: [], result: '*' }, { Event: 'Analysis board' }) }, 'Blank board')), h('p', { class: 'muted small', style: { marginTop: '8px' } }, 'Your PGN never leaves your browser — analysis runs locally with the built-in Rookery engine (strong club level, not Stockfish), so very deep tactics can be missed. Illegal moves are rejected.'));
  const kh = (e) => { if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return; if (e.key === 'ArrowLeft') go(ply - 1); else if (e.key === 'ArrowRight') go(ply + 1); else if (e.key === 'Home') go(0); else if (e.key === 'End') go(G?.moves.length || 0); }; window.addEventListener('keydown', kh);
  // ---- source
  const hand = (() => { try { const v = sessionStorage.getItem('rk_analyse_pgn'); sessionStorage.removeItem('rk_analyse_pgn'); return v; } catch { return null; } })();
  if (ctx.params.id) { try { const { game } = await get('/api/games/' + ctx.params.id); setGame({ moves: game.moves, fen: game.startFen, result: game.result || '*' }, { White: game.white.name, Black: game.black.name, WhiteElo: game.white.rating, BlackElo: game.black.rating, Event: `${game.rated ? 'Rated' : 'Casual'} ${game.cat}`, Date: new Date(game.createdAt).toISOString().slice(0, 10) }); } catch (e) { toast(e.message, 'error'); } }
  else if (hand) loadText(hand);
  else { sumEl.append(h('p', { class: 'muted' }, 'Import a PGN below (or play moves on the board) to get engine analysis, an evaluation graph, accuracy and suggestions.')); G = { headers: {}, moves: [], ucis: [], fens: [START_FEN], result: '*', start: START_FEN }; drawHead(); paint(); }
  return () => { dead = true; runTok++; cancelEngine(); window.removeEventListener('keydown', kh); board.destroy(); };
}
