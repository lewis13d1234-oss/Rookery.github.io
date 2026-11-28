import { h, clear, toast, modal, avatar, userLink, fmtTc, download, confirmBox, promptBox } from '../util.js';
import { state, get, post, on, sendWs, serverNow } from '../api.js';
import { Board } from '../board.js';
import { Chess } from '/shared/chess.js';
import { soundForMove, play } from '../sound.js';
import { moveList, captured, resultText, clockEl, paintClock, playerStrip } from '../game-ui.js';

export default async function game(root, ctx) {
  const id = ctx.params.id; ctx.wide();
  const unsubs = []; let G = null, chess = null, board = null, viewPly = null, spectating = false, tick = null, clockAt = 0, clocks = [0, 0], running = false, turn = 'w', pendingGet = false, ended = false;
  const myId = state.user?.id;
  const mine = () => G?.myColor || null;
  // ---- layout
  const topClock = clockEl(), botClock = clockEl(), boardHost = h('div'), movesEl = h('div', { class: 'moves' }), status = h('div', { class: 'status' });
  const chatLog = h('div', { class: 'chat-log' }), chatIn = h('input', { placeholder: 'Say something nice…', maxLength: 200, 'aria-label': 'Chat message' });
  const banner = h('div'), actions = h('div', { class: 'controls' }), info = h('div', { class: 'muted small' }), waitBox = h('div');
  let topStrip, botStrip;
  const navBtns = h('div', { class: 'nav-btns' }, [['⏮', () => goto(0)], ['◀', () => goto((viewPly ?? chess.ply) - 1)], ['▶', () => goto((viewPly ?? chess.ply) + 1)], ['⏭', () => goto(null)]].map(([t, f]) => h('button', { class: 'btn small', onclick: f, 'aria-label': 'Navigate moves' }, t)));
  const side = h('div', { class: 'side-panel' }, h('div', { class: 'card' }, info, status), banner, h('div', { class: 'card' }, h('p', { class: 'panel-title' }, 'Moves'), movesEl, navBtns), h('div', { class: 'card' }, actions),
    h('div', { class: 'card chat' }, h('p', { class: 'panel-title' }, 'Chat'), chatLog, h('form', { onsubmit: (e) => { e.preventDefault(); const t = chatIn.value.trim(); if (!t) return; if (!state.user) return toast('Log in to chat', 'info'); sendWs({ t: 'chat', id, text: t }); chatIn.value = ''; } }, chatIn, h('button', { class: 'btn small', type: 'submit' }, 'Send'))));
  const col = h('div', { class: 'board-col' }); const topHolder = h('div'), botHolder = h('div'); col.append(topHolder, boardHost, botHolder);
  root.append(waitBox, h('div', { class: 'game-layout' }, col, side));

  function build() {
    const o = (mine() === 'b') ? 'b' : 'w'; const top = o === 'w' ? 'b' : 'w';
    const pl = (c) => (c === 'w' ? G.white : G.black);
    const strip = (c, clk) => { const p = pl(c); return playerStrip(avatar({ username: p.name, avatar: p.avatar }, 34), p.id ? userLink(p.name) : h('span', null, p.name), p.rating ? `(${p.rating})` : '', clk); };
    clear(topHolder); clear(botHolder); topStrip = strip(top, topClock); botStrip = strip(o, botClock); topHolder.append(topStrip); botHolder.append(botStrip);
    topClock.dataset.c = top; botClock.dataset.c = o;
    if (!board) board = new Board(boardHost, { orientation: o, set: state.prefs.pieces, coords: state.prefs.coords !== false, animate: state.prefs.animations !== false, interactive: false, legalTargets: (sq) => [...new Set(chess.moves({ square: sq, verbose: true }).map((m) => m.to))], onMove: onUserMove });
    else board.setOrientation(o);
  }
  async function onUserMove(from, to, promo) {
    if (!canMove()) return false;
    const uci = from + to + (promo || '');
    const mv = chess.move(uci); if (!mv) return false;
    soundForMove(mv, chess.inCheck()); sendWs({ t: 'move', id, uci }); refresh(); lastMoveAt = Date.now();
    return true;
  }
  let lastMoveAt = 0;
  const canMove = () => G && G.status === 'active' && mine() && mine() === chess.turnColor() && viewPly == null && !spectating;

  function refresh(animate = true) {
    const fen = viewPly == null ? chess.fen() : fenAt(viewPly); const hist = chess.history();
    const ucis = G.uci; const lastIdx = (viewPly ?? hist.length) - 1; const lm = lastIdx >= 0 && ucis[lastIdx] ? [ucis[lastIdx].slice(0, 2), ucis[lastIdx].slice(2, 4)] : null;
    const gg = new Chess(fen);
    board.setPosition(fen, { lastMove: lm, check: gg.inCheck() ? board.kingSquare(gg.turnColor()) : null, animate });
    board.setInteractive(canMove(), mine() || 'w'); board.o.movableColor = mine() || 'w';
    moveList(movesEl, hist, viewPly ?? hist.length, goto, G.startFen.split(' ')[1], parseInt(G.startFen.split(' ')[5]) || 1);
    const cap = captured(fen); const o = mine() === 'b' ? 'b' : 'w';
    const mkCap = (c) => cap[c] + (((c === 'w' ? cap.diff : -cap.diff) > 0) ? ` +${Math.abs(cap.diff)}` : '');
    botStrip.caps.textContent = mkCap(o); topStrip.caps.textContent = mkCap(o === 'w' ? 'b' : 'w');
    drawActions(); paintClocks();
  }
  function fenAt(n) { const g = new Chess(G.startFen); const hs = chess.history(); for (let i = 0; i < n && i < hs.length; i++) g.move(hs[i]); return g.fen(); }
  function goto(n) { const len = chess.ply; if (n == null || n >= len) viewPly = null; else viewPly = Math.max(0, n); refresh(false); }
  function paintClocks() {
    if (!G) return; const now = serverNow(); const c = [...clocks];
    if (running && G.status === 'active') c[turn === 'w' ? 0 : 1] = Math.max(0, c[turn === 'w' ? 0 : 1] - (now - clockAt));
    for (const el of [topClock, botClock]) { const k = el.dataset.c === 'w' ? 0 : 1; paintClock(el, c[k], G.status === 'active' && turn === el.dataset.c && (running || chess.ply < 2)); }
    const dl = G.firstMoveDeadline; if (G.status === 'active' && chess.ply < 2 && dl) { const left = Math.max(0, Math.ceil((dl - serverNow()) / 1000)); status.textContent = `${turn === 'w' ? 'White' : 'Black'} must move within ${left}s or the game is aborted.`; } else if (/must move within/.test(status.textContent)) status.textContent = '';
  }
  function drawActions() {
    clear(actions); if (!G) return; const m = mine();
    if (G.status === 'active' && m && !spectating) {
      if (chess.ply < 2) actions.append(h('button', { class: 'btn danger', onclick: () => sendWs({ t: 'abort', id }) }, 'Abort'));
      else {
        if (G.drawOffer && G.drawOffer !== m) actions.append(h('button', { class: 'btn primary', onclick: () => sendWs({ t: 'draw', id, kind: 'accept' }) }, '½ Accept draw'), h('button', { class: 'btn', onclick: () => sendWs({ t: 'draw', id, kind: 'decline' }) }, 'Decline'));
        else actions.append(h('button', { class: 'btn', disabled: G.drawOffer === m, onclick: () => { sendWs({ t: 'draw', id, kind: 'offer' }); toast('Draw offered'); } }, G.drawOffer === m ? 'Draw offered…' : '½ Offer draw'));
        if (G.canClaim) actions.append(h('button', { class: 'btn', onclick: () => sendWs({ t: 'draw', id, kind: 'claim' }) }, 'Claim draw (' + (G.canClaim === 'threefold' ? '3-fold' : '50-move') + ')'));
        actions.append(h('button', { class: 'btn danger', onclick: async () => { if (!state.prefs.confirmResign || await confirmBox('Resign game?', 'You will lose this game.', 'Resign')) sendWs({ t: 'resign', id }); } }, '⚑ Resign'));
      }
    }
    if (G.status === 'finished' || G.status === 'aborted') {
      if (m && !G.tournamentId && G.white.id && G.black.id) { const mr = G.rematch[m]; actions.append(h('button', { class: 'btn primary', disabled: mr, onclick: () => sendWs({ t: 'rematch', id }) }, mr ? 'Rematch requested…' : G.rematch[m === 'w' ? 'b' : 'w'] ? '↻ Accept rematch' : '↻ Rematch')); }
      actions.append(h('a', { class: 'btn', href: '#/analysis/' + id }, '🔍 Analyse'), h('button', { class: 'btn', onclick: async () => { const r = await fetch(`/api/games/${id}/pgn`); download(`rookery-${id}.pgn`, await r.text()); } }, '⬇ PGN'));
      if (G.tournamentId) actions.append(h('a', { class: 'btn', href: '#/tournaments/' + G.tournamentId }, '🏆 Tournament'));
    }
    if (m && G.status !== 'waiting') { const opp = m === 'w' ? G.black : G.white; if (opp.id) actions.append(h('button', { class: 'btn ghost small', onclick: () => reportDlg(opp.name) }, '⚠ Report')); }
    flip && null;
    actions.append(h('button', { class: 'btn ghost small', onclick: () => board.flip(), title: 'Flip board' }, '⇅ Flip'));
  }
  const flip = null;
  async function reportDlg(name) {
    const sel = h('select', null, ['cheating', 'abuse', 'spam', 'other'].map((r) => h('option', { value: r }, r))); const det = h('textarea', { rows: 3, maxLength: 500, placeholder: 'What happened?' });
    const m = modal('Report ' + name, h('div', null, h('label', { class: 'field' }, h('span', null, 'Reason'), sel), h('label', { class: 'field' }, h('span', null, 'Details'), det)), { actions: [h('button', { class: 'btn primary', onclick: async () => { try { const r = await post('/api/reports', { username: name, gameId: id, reason: sel.value, details: det.value }); toast(r.message, 'success'); m.close(); } catch (e) { toast(e.message, 'error'); } } }, 'Submit report')] });
  }
  function showEnd() {
    clear(banner); if (!G || (G.status !== 'finished' && G.status !== 'aborted')) return;
    const r = resultText(G.result, G.reason, mine()); const rc = G.ratingChange; let rt = null;
    if (rc && mine()) { const me = mine() === 'w' ? rc.white : rc.black; if (me.after != null) { const d = Math.round(me.after - me.before); rt = h('div', { class: d >= 0 ? 'win' : 'loss' }, `Rating ${Math.round(me.before)} → ${Math.round(me.after)} (${d >= 0 ? '+' : ''}${d})`); } }
    banner.append(h('div', { class: 'result-banner' }, h('h3', null, r.title), h('div', { class: 'muted' }, (G.result || '') + ' · ' + r.sub), rt));
  }
  function applyFull(g) {
    G = g; chess = new Chess(g.startFen); for (const s of g.moves) chess.move(s);
    clocks = g.clocks; running = g.clockRunning; turn = g.turn; clockAt = g.serverNow - 0; clockAt = serverNow();
    info.textContent = `${g.rated ? 'Rated' : 'Casual'} · ${fmtTc(g.tc.initial / 60 >= 1 ? g.tc.initial : g.tc.initial, g.tc.inc)} ${g.tc.initial >= 60 ? '' : ''}· ${g.cat}${g.private ? ' · private' : ''}${g.spectators ? ' · 👁 ' + g.spectators : ''}`;
    info.textContent = `${g.rated ? 'Rated' : 'Casual'} ${g.cat} · ${g.tc.initial / 60}+${g.tc.inc}${g.private ? ' · private' : ''}${g.spectators ? ' · 👁 ' + g.spectators : ''}`;
    if (g.status === 'waiting') { showWaiting(); return; } clear(waitBox);
    build(); refresh(false); showEnd(); if (g.status === 'active') status.textContent = ''; else status.textContent = '';
    ctx.setTitle(`${g.white.name} vs ${g.black.name}`);
  }
  function showWaiting() {
    clear(waitBox); const link = `${location.origin}/#/join/${G.inviteCode}`;
    waitBox.append(h('div', { class: 'card waiting' }, h('div', { class: 'spinner' }), h('div', null, h('strong', null, 'Waiting for your opponent…'), h('div', { class: 'muted small' }, 'Share this link. The first person to open it (while logged in) plays you.'), h('input', { readOnly: true, value: link, onclick: (e) => e.target.select(), 'aria-label': 'Invite link' })), h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(link); toast('Link copied', 'success'); } }, 'Copy'), h('button', { class: 'btn danger', onclick: () => { sendWs({ t: 'cancel_invite', id }); ctx.navigate('/play'); } }, 'Cancel')));
    build(); G.startFen && board && refresh(false);
  }
  const mine_ = (m) => m.id === id;
  unsubs.push(on('ws:game', (m) => { if (m.game.id !== id) return; spectating = !!m.spectating; pendingGet = false; applyFull(m.game); }));
  unsubs.push(on('ws:move', (m) => {
    if (!mine_(m) || !G) return;
    if (m.ply === chess.ply + 1) { const mv = chess.move(m.uci); if (!mv) { sendWs({ t: 'get', id }); return; } if (!(viewPly == null && lastMoveAt && Date.now() - lastMoveAt < 50)) soundForMove(mv, chess.inCheck()); }
    else if (m.ply <= chess.ply) { /* echo of our own optimistic move */ }
    else { sendWs({ t: 'get', id }); return; }
    G.uci = chess.historyUci(); G.moves = chess.history(); G.fen = m.fen; clocks = m.clocks; running = m.clockRunning; turn = m.turn; clockAt = serverNow(); G.canClaim = m.canClaim; G.drawOffer = null; refresh(viewPly == null);
  }));
  unsubs.push(on('ws:end', (m) => { if (!mine_(m) || !G) return; G.status = m.status; G.result = m.result; G.reason = m.reason; G.ratingChange = m.ratingChange; clocks = m.clocks || clocks; running = false; ended = true; play(m.reason === 'checkmate' || m.reason === 'resignation' ? 'end' : 'end'); showEnd(); refresh(false); status.textContent = ''; }));
  unsubs.push(on('ws:draw_offer', (m) => { if (!mine_(m) || !G) return; G.drawOffer = m.by; drawActions(); if (m.by !== mine()) toast('Your opponent offers a draw', 'info'); }));
  unsubs.push(on('ws:draw_declined', (m) => { if (!mine_(m) || !G) return; G.drawOffer = null; drawActions(); toast('Draw declined'); }));
  unsubs.push(on('ws:rematch', (m) => { if (!mine_(m) || !G) return; G.rematch = m.rematch; drawActions(); if (m.declined) toast('Rematch declined'); }));
  unsubs.push(on('ws:rematch_game', (m) => { if (mine_(m)) ctx.navigate('/game/' + m.newId); }));
  unsubs.push(on('ws:opponent_gone', (m) => { if (mine_(m)) { status.textContent = `Opponent disconnected — they have ${Math.round(m.ms / 1000)}s to return before forfeiting.`; } }));
  unsubs.push(on('ws:opponent_back', (m) => { if (mine_(m)) status.textContent = 'Opponent is back.'; }));
  unsubs.push(on('ws:spectators', (m) => { if (mine_(m) && G) { G.spectators = m.n; info.textContent = info.textContent.replace(/ · 👁 \d+/, '') + (m.n ? ' · 👁 ' + m.n : ''); } }));
  unsubs.push(on('ws:chat', (m) => { if (!mine_(m)) return; chatLog.append(h('div', null, h('b', null, m.from + ': '), m.text, m.room === 'spectators' ? h('span', { class: 'muted' }, ' (spectators)') : null)); chatLog.scrollTop = chatLog.scrollHeight; }));
  unsubs.push(on('ws:error', (m) => { if (m.ref === 'move' && G) { toast(m.error, 'error'); sendWs({ t: 'get', id }); } }));
  const load = () => sendWs({ t: G && !mine() ? 'watch' : 'get', id });
  // initial: use REST for finished/anonymous viewing, WS for live
  try {
    const { game: g } = await get('/api/games/' + id);
    if (g.status === 'finished' || g.status === 'aborted') { spectating = !g.myColor; applyFull(g); }
    else { applyFull(g); sendWs({ t: g.myColor ? 'get' : 'watch', id }); }
  } catch (e) { root.append(h('div', { class: 'card center' }, h('h2', null, 'Game not found'), h('p', { class: 'muted' }, e.message), h('a', { class: 'btn', href: '#/play' }, 'Back to play'))); return; }
  unsubs.push(on('ws:open', () => { if (G && G.status !== 'finished') sendWs({ t: mine() ? 'get' : 'watch', id }); }));
  const keyH = (e) => { if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return; if (e.key === 'ArrowLeft') goto((viewPly ?? chess.ply) - 1); else if (e.key === 'ArrowRight') goto((viewPly ?? chess.ply) + 1); else if (e.key === 'f') board.flip(); };
  window.addEventListener('keydown', keyH);
  tick = setInterval(paintClocks, 100);
  return () => { clearInterval(tick); unsubs.forEach((f) => f()); window.removeEventListener('keydown', keyH); sendWs({ t: 'unwatch', id }); board?.destroy(); };
}

export async function join(root, ctx) {
  ctx.setTitle('Join game');
  if (!ctx.requireLogin()) return;
  root.append(h('div', { class: 'card center' }, h('div', { class: 'spinner', style: { margin: '0 auto 12px' } }), h('p', null, 'Joining game…')));
  const u1 = on('ws:joined', (m) => ctx.navigate('/game/' + m.id, true)); const u2 = on('ws:error', (m) => { if (m.ref === 'join') { clear(root); root.append(h('div', { class: 'card center' }, h('h2', null, 'Cannot join'), h('p', { class: 'muted' }, m.error), h('a', { class: 'btn', href: '#/play' }, 'Play'))); } });
  const go = () => sendWs({ t: 'join', code: ctx.params.code }); if (!sendWs({ t: 'join', code: ctx.params.code })) { const u3 = on('ws:open', () => { go(); u3(); }); }
  return () => { u1(); u2(); };
}
