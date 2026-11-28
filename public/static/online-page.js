// Play a friend over the internet with no server: a direct WebRTC connection between two browsers.
// The two players swap short invite/reply codes (paste them into any chat) to set the connection up.
import { h, clear, toast, confirmBox, download } from '../util.js';
import { state } from '../api.js';
import { Board } from '../board.js';
import { Chess, START_FEN } from '/shared/chess.js';
import { toPgn } from '/shared/pgn.js';
import { soundForMove, play } from '../sound.js';
import { moveList, captured, resultText, clockEl, paintClock } from '../game-ui.js';
import { saveGame } from './mygames.js';
import { activeProfile } from '../profiles.js';

const TCS = [['No clock', 0, 0], ['1+0', 60, 0], ['3+2', 180, 2], ['5+0', 300, 0], ['10+0', 600, 0], ['15+10', 900, 10]];
const ICE = () => window.__rk_ice || [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const b64 = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function pack(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'undefined') return 'RK0.' + b64(raw);
  const cs = new CompressionStream('deflate-raw'); const w = cs.writable.getWriter(); w.write(raw); w.close();
  return 'RK1.' + b64(new Uint8Array(await new Response(cs.readable).arrayBuffer()));
}
async function unpack(code) {
  const c = String(code).trim().replace(/\s+/g, ''); const m = /^RK([01])\.([A-Za-z0-9_-]+)$/.exec(c); if (!m) throw new Error('That does not look like a Rookery code. Copy the whole code, starting with RK.');
  let bytes = unb64(m[2]); if (m[1] === '1') { const ds = new DecompressionStream('deflate-raw'); const w = ds.writable.getWriter(); w.write(bytes); w.close(); bytes = new Uint8Array(await new Response(ds.readable).arrayBuffer()); }
  return JSON.parse(new TextDecoder().decode(bytes));
}
// Compact codes: only the few fields a data-channel connection needs (ICE login, DTLS fingerprint, candidates).
function squeeze(desc) {
  const L = desc.sdp.split(/\r?\n/); const g = (p) => (L.find((x) => x.startsWith(p)) || '').slice(p.length);
  const fp = g('a=fingerprint:sha-256 '); const fpBytes = fp ? Uint8Array.from(fp.split(':').map((h) => parseInt(h, 16))) : null; if (!fpBytes || fpBytes.length !== 32) throw new Error('unsupported');
  const c = []; for (const l of L) { if (!l.startsWith('a=candidate:')) continue; const t = l.slice(12).split(' '); if (t[2].toLowerCase() !== 'udp' || t[1] !== '1') continue; const o = [t[0], +t[3], t[4], +t[5], t[7]]; const ri = t.indexOf('raddr'); if (ri > 0) { o.push(t[ri + 1], +t[t.indexOf('rport') + 1]); } c.push(o); }
  c.sort((a, b) => b[1] - a[1]); if (!c.length) throw new Error('no candidates');
  return { t: desc.type === 'offer' ? 0 : 1, u: g('a=ice-ufrag:'), p: g('a=ice-pwd:'), f: b64(fpBytes), c: c.slice(0, 5) };
}
function inflate(o) {
  const fp = [...unb64(o.f)].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
  const sdp = ['v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', 'a=ice-ufrag:' + o.u, 'a=ice-pwd:' + o.p, 'a=fingerprint:sha-256 ' + fp, 'a=setup:' + (o.t === 0 ? 'actpass' : 'active'), 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144',
    ...o.c.map((k) => `a=candidate:${k[0]} 1 udp ${k[1]} ${k[2]} ${k[3]} typ ${k[4]}` + (k[5] ? ` raddr ${k[5]} rport ${k[6]}` : '')), ''].join('\r\n');
  return { type: o.t === 0 ? 'offer' : 'answer', sdp };
}

// Binary codes (RK4): the smallest form. Layout: flags, ufrag, pwd, 32-byte DTLS fingerprint, then up to 3 IP candidates.
const PRIO = [2130706431, 1694498815, 16777215, 1862270975], TYPES = ['host', 'srflx', 'relay', 'prflx'];
const ipv4 = (s) => { const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s); return m && m.slice(1).every((x) => +x < 256) ? m.slice(1).map(Number) : null; };
function ipv6(s) { if (!/^[0-9a-fA-F:]+$/.test(s) || !s.includes(':')) return null; const [a, b = null] = s.split('::'); if (s.split('::').length > 2) return null; const A = a ? a.split(':') : [], B = b ? b.split(':') : []; const miss = 8 - A.length - B.length; if ((b === null && miss !== 0) || miss < 0) return null; const w = [...A, ...Array(b === null ? 0 : miss).fill('0'), ...B]; if (w.length !== 8 || w.some((x) => x.length > 4)) return null; return w.flatMap((x) => { const v = parseInt(x, 16); return [v >> 8, v & 255]; }); }
function binPack(o) {
  const cands = o.c.map((k) => ({ k, ti: TYPES.indexOf(k[4]), ip: ipv4(k[2]) || ipv6(k[2]) })).filter((x) => x.ti >= 0 && x.ip).sort((a, b) => (a.ti === 1 ? 0 : a.ti === 0 ? 1 : 2) - (b.ti === 1 ? 0 : b.ti === 0 ? 1 : 2)).slice(0, 3);
  if (!cands.length) throw new Error('no ip candidates'); const te = new TextEncoder(); const u = te.encode(o.u), pw = te.encode(o.p); if (u.length > 255 || pw.length > 255) throw new Error('long');
  const out = [o.t | (cands.length << 1), u.length, ...u, pw.length, ...pw, ...unb64(o.f)];
  for (const { k, ti, ip } of cands) out.push(ti | (ip.length === 16 ? 4 : 0), k[3] >> 8, k[3] & 255, ...ip);
  return 'RK4.' + b64(Uint8Array.from(out));
}
function binUnpack(b) {
  const td = new TextDecoder(); let i = 0; const f = b[i++], t = f & 1, n = (f >> 1) & 7; const ul = b[i++]; const u = td.decode(b.slice(i, i + ul)); i += ul; const pl = b[i++]; const pw = td.decode(b.slice(i, i + pl)); i += pl;
  const fp = b.slice(i, i + 32); i += 32; if (fp.length !== 32 || !n) throw new Error('bad code'); const c = [];
  for (let k = 0; k < n; k++) { const ty = b[i++], port = (b[i++] << 8) | b[i++], v6 = ty & 4, len = v6 ? 16 : 4, raw = b.slice(i, i + len); i += len; if (raw.length !== len) throw new Error('bad code');
    const ip = v6 ? Array.from({ length: 8 }, (_, j) => ((raw[2 * j] << 8) | raw[2 * j + 1]).toString(16)).join(':') : [...raw].join('.'); const tn = TYPES[ty & 3];
    c.push([String(k + 1), PRIO[ty & 3] - k, ip, port, tn, ...(tn === 'srflx' || tn === 'prflx' ? ['0.0.0.0', 0] : [])]); }
  return { t, u, p: pw, f: b64(fp), c };
}
async function packDesc(desc, compat) {
  if (!compat) { try { return binPack(squeeze(desc)); } catch {} }
  if (!compat) { try { const raw = new TextEncoder().encode(JSON.stringify(squeeze(desc))); if (typeof CompressionStream !== 'undefined') { const cs = new CompressionStream('deflate-raw'); const w = cs.writable.getWriter(); w.write(raw); w.close(); return 'RK2.' + b64(new Uint8Array(await new Response(cs.readable).arrayBuffer())); } return 'RK3.' + b64(raw); } catch {} }
  return pack({ v: 1, d: desc.toJSON ? desc.toJSON() : desc });
}
async function unpackDesc(code) {
  const c = String(code).trim().replace(/\s+/g, ''); const m = /^RK([234])\.([A-Za-z0-9_-]+)$/.exec(c);
  if (!m) return (await unpack(code)).d;
  if (m[1] === '4') return inflate(binUnpack(unb64(m[2])));
  let bytes = unb64(m[2]); if (m[1] === '2') { const ds = new DecompressionStream('deflate-raw'); const w = ds.writable.getWriter(); w.write(bytes); w.close(); bytes = new Uint8Array(await new Response(ds.readable).arrayBuffer()); }
  return inflate(JSON.parse(new TextDecoder().decode(bytes)));
}
function gathered(pc) { return new Promise((res) => { if (pc.iceGatheringState === 'complete') return res(); const done = () => { pc.removeEventListener('icegatheringstatechange', chk); res(); }; const chk = () => { if (pc.iceGatheringState === 'complete') done(); }; pc.addEventListener('icegatheringstatechange', chk); setTimeout(done, 5000); }); }

export default async function online(root, ctx) {
  ctx.setTitle('Play a friend online'); ctx.wide();
  let pc = null, dc = null, cleanupGame = () => {}, dead = false;
  const me = activeProfile().name;
  const close = () => { try { dc && dc.close(); } catch {} try { pc && pc.close(); } catch {} pc = dc = null; };
  function lobby() {
    close(); cleanupGame(); clear(root);
    let tcIdx = 2, color = 'r'; const tcBox = h('div', { class: 'seg' }), colBox = h('div', { class: 'seg' });
    const draw = () => { clear(tcBox); TCS.forEach(([t], i) => tcBox.append(h('button', { class: tcIdx === i ? 'active' : '', onclick: () => { tcIdx = i; draw(); } }, t))); clear(colBox); [['w', '♔ White'], ['r', 'Random'], ['b', '♚ Black']].forEach(([c, t]) => colBox.append(h('button', { class: color === c ? 'active' : '', onclick: () => { color = c; draw(); } }, t))); }; draw();
    const hostOut = h('div'), joinOut = h('div'); const compat = h('input', { type: 'checkbox' }); const base = () => location.href.split('#')[0];
    const copyBox = (label, code, btn = 'Copy code') => { const ta = h('textarea', { readOnly: true, rows: 4, class: 'mono code-box', 'aria-label': label }); ta.value = code; return h('div', { class: 'col' }, h('strong', null, label), ta, h('div', { class: 'row' }, h('button', { class: 'btn small primary', onclick: async () => { try { await navigator.clipboard.writeText(code); toast('Copied', 'success'); } catch { ta.select(); toast('Press Ctrl+C to copy', 'info'); } } }, btn))); };
    async function create() {
      clear(hostOut); hostOut.append(h('p', { class: 'muted' }, 'Creating invite…'));
      try {
        close(); pc = new RTCPeerConnection({ iceServers: ICE() }); dc = pc.createDataChannel('chess'); const mine = color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : color; const [, initial, inc] = TCS[tcIdx];
        wire(pc, dc, { host: true, mine, initial, inc });
        await pc.setLocalDescription(await pc.createOffer()); await gathered(pc);
        const code = await packDesc(pc.localDescription, compat.checked); const link = base() + '#/join/' + code; const ans = h('textarea', { rows: 4, class: 'mono code-box', placeholder: 'Paste your friend’s reply code here', 'aria-label': 'Reply code' });
        let connecting = false; const connect = async () => { if (connecting || !pc) return; connecting = true; try { await pc.setRemoteDescription(await unpackDesc(ans.value)); hostOut.append(h('p', { class: 'muted' }, 'Connecting…')); } catch (e) { connecting = false; toast(e.message, 'error'); } };
        clear(hostOut); hostOut.append(h('div', { class: 'col' }, copyBox('1. Send this invite link to your friend', link, 'Copy invite link'), h('p', { class: 'muted small' }, 'They open it, press Join, and send you a short reply code. (Link not working for them? Send the code alone: ', h('code', { class: 'mono' }, code.slice(0, 12) + '\u2026'), ' \u2014 they can paste it on the Online page.)'), h('strong', null, '2. Paste the reply code they send back'), ans, h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: async () => { try { const t = await navigator.clipboard.readText(); if (!t) throw new Error('empty'); ans.value = t; connect(); } catch { toast('Paste it into the box instead (long-press or Ctrl+V).', 'info'); ans.focus(); } } }, 'Paste reply code'), h('button', { class: 'btn', onclick: connect }, 'Connect')), h('p', { class: 'muted small' }, 'It connects by itself as soon as the code is pasted.')));
        ans.addEventListener('input', () => { if (/RK\d\.[A-Za-z0-9_-]{60,}/.test(ans.value.replace(/\s+/g, ''))) connect(); });
      } catch (e) { clear(hostOut); hostOut.append(h('p', { class: 'loss' }, 'Could not create an invite: ' + e.message)); }
    }
    async function join(text) {
      clear(joinOut); try {
        const od = await unpackDesc(text.includes('#/join/') ? text.slice(text.indexOf('#/join/') + 7) : text); close(); pc = new RTCPeerConnection({ iceServers: ICE() }); pc.ondatachannel = (e) => { dc = e.channel; wire(pc, dc, { host: false }); };
        await pc.setRemoteDescription(od); await pc.setLocalDescription(await pc.createAnswer()); await gathered(pc);
        const code = await packDesc(pc.localDescription, compat.checked); try { navigator.clipboard.writeText(code).catch(() => {}); } catch {} joinOut.append(copyBox('Send this reply code back to your friend', code, 'Copy reply code'), h('p', { class: 'muted' }, 'Keep this page open. The game starts as soon as your friend pastes your reply.'));
      } catch (e) { joinOut.append(h('p', { class: 'loss' }, e.message)); }
    }
    const joinIn = h('textarea', { rows: 4, class: 'mono code-box', placeholder: 'Paste the invite link or code your friend sent you', 'aria-label': 'Invite code' });
    root.append(h('h1', null, 'Play a friend online'), h('p', { class: 'muted' }, 'A direct connection between your two browsers: no server, no account. Send your friend a link, they send a short code back, and you are playing. Friendly games only (not rated).'),
      h('div', { class: 'grid-2' },
        h('section', { class: 'card' }, h('h2', null, 'Create a game'), h('h3', null, 'You play'), colBox, h('h3', { style: { marginTop: '14px' } }, 'Clock'), tcBox, h('div', { style: { margin: '16px 0' } }, h('button', { class: 'btn primary large', onclick: create }, 'Create invite link')), hostOut),
        h('section', { class: 'card' }, h('h2', null, 'Join a game'), joinIn, h('div', { style: { margin: '12px 0' } }, h('button', { class: 'btn primary large', onclick: () => join(joinIn.value) }, 'Join')), joinOut)),
      h('label', { class: 'check small' }, compat, ' Compatibility mode (longer codes; try this if a friend on an unusual browser cannot connect)'), h('p', { class: 'muted small' }, 'Works on most home and mobile networks. A few strict corporate networks block direct connections; if it will not connect, try another network. Both players need this page open.'));
  }
  function wire(pc, ch, cfg) {
    let started = false;
    pc.onconnectionstatechange = () => { if (['failed'].includes(pc.connectionState) && !started) { toast('Could not connect. Check both codes were copied completely, or try another network.', 'error', 8000); } };
    ch.onopen = () => { if (cfg.host) ch.send(JSON.stringify({ t: 'start', hostColor: cfg.mine, initial: cfg.initial, inc: cfg.inc, name: me })); };
    ch.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (!started && m.t === 'start' && !cfg.host) { started = true; ch.send(JSON.stringify({ t: 'hi', name: me })); startGame(ch, { mine: m.hostColor === 'w' ? 'b' : 'w', initial: m.initial, inc: m.inc, oppName: String(m.name || 'Opponent').slice(0, 20) }); } else if (!started && m.t === 'hi' && cfg.host) { started = true; startGame(ch, { mine: cfg.mine, initial: cfg.initial, inc: cfg.inc, oppName: String(m.name || 'Opponent').slice(0, 20), first: true }); } };
  }
  function startGame(ch, o) {
    clear(root); const sendNow = (m) => { try { ch.send(JSON.stringify(m)); } catch {} };
    const chess = new Chess(START_FEN); let over = null, clocks = [o.initial * 1000, o.initial * 1000], last = Date.now(), viewPly = null, board, timer, saved = false, drawOffered = false, goneAt = 0, msgCount = 0, mine = o.mine;
    const topClock = clockEl(), botClock = clockEl(), host = h('div'), movesEl = h('div', { class: 'moves' }), banner = h('div'), actions = h('div', { class: 'controls' }), turnEl = h('strong'), chatLog = h('div', { class: 'chat-log', style: { maxHeight: '160px', minHeight: '80px' }, 'aria-live': 'polite' }), chatIn = h('input', { placeholder: 'Message…', maxLength: 300, 'aria-label': 'Chat message', onkeydown: (e) => { if (e.key === 'Enter') say(); } }), status = h('div', { class: 'muted small' });
    const top = h('div'), bot = h('div'); const names = () => ({ w: mine === 'w' ? me : o.oppName, b: mine === 'b' ? me : o.oppName });
    const strip = (c, clk) => h('div', { class: 'pstrip row', style: { justifyContent: 'space-between', padding: '6px 0' } }, h('strong', null, (c === 'w' ? '♔ ' : '♚ ') + names()[c] + (c === mine ? ' (you)' : '')), clk);
    const strips = () => { clear(top); clear(bot); const bottom = board.o.orientation, tc = bottom === 'w' ? 'b' : 'w'; top.append(strip(tc, topClock)); bot.append(strip(bottom, botClock)); };
    root.append(h('div', { class: 'game-layout' }, h('div', { class: 'board-col' }, top, host, bot), h('div', { class: 'side-panel' }, h('div', { class: 'card' }, turnEl, h('div', { class: 'muted small' }, (o.initial ? `Clock ${o.initial / 60}+${o.inc}` : 'No clock') + ' · friendly game'), status), banner, h('div', { class: 'card' }, h('div', { class: 'panel-title' }, 'Moves'), movesEl), h('div', { class: 'card' }, actions), h('div', { class: 'card' }, h('div', { class: 'panel-title' }, 'Chat'), chatLog, h('div', { class: 'row chat-input' }, chatIn, h('button', { class: 'btn primary', onclick: say }, 'Send'))))));
    board = new Board(host, { orientation: mine, set: state.prefs.pieces, coords: state.prefs.coords !== false, animate: state.prefs.animations !== false, interactive: true, movableColor: mine, legalTargets: (sq) => [...new Set(chess.moves({ square: sq, verbose: true }).map((m) => m.to))], onMove: onUser }); strips();
    const fenAt = (n) => { const g = new Chess(START_FEN); chess.history().slice(0, n).forEach((s) => g.move(s)); return g.fen(); };
    const goto = (n) => { viewPly = n == null || n >= chess.ply ? null : Math.max(0, n); refresh(false); };
    function refresh(animate = true) {
      const fen = viewPly == null ? chess.fen() : fenAt(viewPly); const hist = chess.history(), uci = chess.historyUci(), li = (viewPly ?? hist.length) - 1, g = new Chess(fen);
      board.setPosition(fen, { lastMove: li >= 0 ? [uci[li].slice(0, 2), uci[li].slice(2, 4)] : null, check: g.inCheck() ? board.kingSquare(g.turnColor()) : null, animate });
      board.setInteractive(!over && viewPly == null && chess.turnColor() === mine, mine);
      board.o.canPremove = !over && viewPly == null && chess.turnColor() !== mine && state.prefs.premove !== false; if (!board.o.canPremove && chess.turnColor() !== mine) board.clearPremove(); moveList(movesEl, hist, viewPly ?? hist.length, goto);
      turnEl.textContent = over ? 'Game over' : chess.turnColor() === mine ? 'Your move' : `${names()[chess.turnColor()]} to move`; drawActions();
    }
    function paint() {
      const c = [...clocks], now = Date.now();
      if (o.initial && !over && chess.ply >= 2) { const i = chess.turn; c[i] = Math.max(0, c[i] - (now - last)); if (c[i] <= 0) { const loser = i === 0 ? 'w' : 'b'; return end(loser === 'w' ? '0-1' : '1-0', 'timeout', true); } }
      const b = board.o.orientation; for (const [el, col] of [[topClock, b === 'w' ? 'b' : 'w'], [botClock, b]]) { if (!o.initial) { el.textContent = '∞'; continue; } paintClock(el, c[col === 'w' ? 0 : 1], !over && chess.turnColor() === col && chess.ply >= 2); }
      if (goneAt && !over) status.textContent = `Opponent disconnected ${Math.round((now - goneAt) / 1000)}s ago`;
    }
    const pgn = () => toPgn({ headers: { Event: 'Rookery online friendly', White: names().w, Black: names().b }, moves: chess.history(), result: over?.result || '*' });
    function end(result, reason, tell) {
      if (over) return; over = { result, reason }; clearInterval(timer); if (tell) sendNow({ t: 'end', result, reason });
      const r = resultText(result, reason, mine); clear(banner); banner.append(h('div', { class: 'card result-banner' }, h('h3', null, r.title), h('div', { class: 'muted' }, `${result} · ${r.sub}`))); play(result === '1/2-1/2' ? 'end' : result === (mine === 'w' ? '1-0' : '0-1') ? 'win' : 'end');
      if (chess.ply > 0 && !saved) { saved = true; saveGame({ mode: 'online', result, reason, moves: chess.history(), white: names().w, black: names().b, color: mine }); }
      refresh(false);
    }
    function drawActions() {
      clear(actions);
      if (!over) {
        actions.append(h('button', { class: 'btn', disabled: drawOffered || chess.ply < 2, onclick: () => { drawOffered = true; sendNow({ t: 'draw', a: 'offer' }); toast('Draw offered', 'info'); drawActions(); } }, drawOffered ? '½ Draw offered' : '½ Offer draw'),
          h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Resign?', 'Your opponent wins this game.', 'Resign')) end(mine === 'w' ? '0-1' : '1-0', 'resignation', true); } }, '⚑ Resign'));
        if (goneAt && Date.now() - goneAt > 20000) actions.append(h('button', { class: 'btn primary', onclick: () => end(mine === 'w' ? '1-0' : '0-1', 'abandonment', false) }, 'Claim win (opponent left)'));
      } else actions.append(h('button', { class: 'btn primary', onclick: () => sendNow({ t: 'rematch', a: 'offer' }) || toast('Rematch offered', 'info') }, '↻ Rematch'), h('button', { class: 'btn', onclick: () => { try { sessionStorage.setItem('rk_analyse_pgn', pgn()); } catch {} location.hash = '/analysis'; } }, '🔍 Analyse'), h('button', { class: 'btn', onclick: () => download('rookery-online.pgn', pgn()) }, '⬇ PGN'), h('button', { class: 'btn ghost', onclick: () => lobby() }, 'Leave'));
      actions.append(h('button', { class: 'btn ghost small', onclick: () => { board.flip(); strips(); paint(); } }, '⇅ Flip'));
    }
    function apply(uci, left) {
      const mv = chess.move(uci); if (!mv) { toast('Your opponent sent an illegal move; the connection has been closed.', 'error'); ch.close(); return false; }
      const mover = 1 - chess.turn; if (o.initial && typeof left === 'number' && chess.ply >= 3) clocks[mover] = Math.max(0, Math.min(left, clocks[mover] + 1000 * (o.inc + 5))); last = Date.now();
      return mv;
    }
    function onUser(from, to, promo) {
      if (over || viewPly != null || chess.turnColor() !== mine) return false; const mv = chess.move({ from, to, promotion: promo }); if (!mv) return false;
      const now = Date.now(); if (o.initial && chess.ply >= 3) clocks[1 - chess.turn] = Math.max(0, clocks[1 - chess.turn] - (now - last)) + o.inc * 1000; last = now;
      sendNow({ t: 'move', uci: mv.lan, left: clocks[1 - chess.turn] }); after(mv); return true;
    }
    function after(mv) { soundForMove(mv, chess.inCheck()); drawOffered = false; const st = chess.status(); refresh(); if (st.over) { board.clearPremove(); end(st.result, st.reason, false); } else if (mv.color !== mine) { const pm = board.takePremove(); if (pm) setTimeout(() => { if (!over) onUser(pm.from, pm.to, pm.promo); }, 60); } }
    function say() { const t = chatIn.value.trim().slice(0, 300); if (!t) return; sendNow({ t: 'chat', body: t }); line(me, t, true); chatIn.value = ''; }
    function line(who, text, own) { chatLog.append(h('div', { class: 'club-line' }, h('strong', null, who), ' ', h('span', null, text))); chatLog.scrollTop = chatLog.scrollHeight; if (!own) play('notify'); }
    ch.onmessage = async (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; } if (++msgCount > 2000) return;
      if (m.t === 'move') { if (over || chess.turnColor() === mine) return; const mv = apply(String(m.uci), Number(m.left)); if (mv) { viewPly = null; after(mv); } }
      else if (m.t === 'chat') line(o.oppName, String(m.body || '').slice(0, 300), false)
      else if (m.t === 'end') { if (!over && ['resignation', 'timeout', 'agreement', 'abandonment'].includes(m.reason) && ['1-0', '0-1', '1/2-1/2'].includes(m.result)) end(m.result, m.reason, false); }
      else if (m.t === 'draw') { if (m.a === 'offer' && !over) { if (await confirmBox('Draw offered', o.oppName + ' offers a draw.', 'Accept')) { sendNow({ t: 'draw', a: 'accept' }); end('1/2-1/2', 'agreement', false); } else sendNow({ t: 'draw', a: 'decline' }); } else if (m.a === 'accept' && drawOffered) end('1/2-1/2', 'agreement', false); else if (m.a === 'decline') { drawOffered = false; toast('Draw declined', 'info'); drawActions(); } }
      else if (m.t === 'rematch') { if (!over) return; if (m.a === 'offer') { if (await confirmBox('Rematch?', o.oppName + ' wants a rematch (colours swap).', 'Play')) { sendNow({ t: 'rematch', a: 'accept' }); restart(); } } else if (m.a === 'accept') restart(); }
    };
    function restart() { clearInterval(timer); window.removeEventListener('keydown', kh); board.destroy(); startGame(ch, { ...o, mine: mine === 'w' ? 'b' : 'w' }); }
    ch.onclose = () => { if (!over) { goneAt = Date.now(); status.textContent = 'Opponent disconnected'; toast('Your opponent disconnected.', 'info'); } };
    const kh = (e) => { if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return; if (e.key === 'ArrowLeft') goto((viewPly ?? chess.ply) - 1); else if (e.key === 'ArrowRight') goto((viewPly ?? chess.ply) + 1); };
    window.addEventListener('keydown', kh); timer = setInterval(paint, 100); refresh(false);
    cleanupGame = () => { clearInterval(timer); window.removeEventListener('keydown', kh); try { board.destroy(); } catch {} };
  }
  lobby(); if (ctx.params.code) { const ta = root.querySelector('textarea[aria-label="Invite code"]'); if (ta) { ta.value = ctx.params.code; root.querySelector('button.large:last-of-type'); [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Join')?.click(); } }
  return () => { dead = true; cleanupGame(); close(); };
}
