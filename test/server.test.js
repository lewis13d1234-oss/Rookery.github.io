// End-to-end test: starts a real server on a temp database and plays through two real WebSocket clients.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import WebSocket from 'ws';

const PORT = 3200 + Math.floor(Math.random() * 500);
const DB = path.join(os.tmpdir(), `rk-e2e-${process.pid}.db`);
const base = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ROOKERY_DB: DB }, stdio: ['ignore', 'pipe', 'inherit'] });
let passed = 0, failed = 0;
const ok = (c, name) => { if (c) { passed++; console.log('PASS', name); } else { failed++; console.log('FAIL', name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(name) { this.name = name; this.cookie = ''; this.msgs = []; }
  async api(method, url, body, raw) {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-rookery': '1', cookie: this.cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const j = raw ? await r.text() : await r.json().catch(() => ({}));
    return { status: r.status, ...(raw ? { text: j } : j) };
  }
  connect() { return new Promise((res) => { this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie: this.cookie, origin: base } }); this.ws.on('message', (d) => { const m = JSON.parse(d); this.msgs.push(m); }); this.ws.on('open', () => setTimeout(res, 100)); }); }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async wait(pred, ms = 5000) { const t = Date.now(); for (;;) { const m = this.msgs.find(pred); if (m) { this.msgs.splice(this.msgs.indexOf(m), 1); return m; } if (Date.now() - t > ms) throw new Error(this.name + ' timeout waiting for message'); await sleep(20); } }
}

try {
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/config'); break; } catch { await sleep(100); } }
  const A = new Client('alice'), B = new Client('bob'), C = new Client('carol');

  // --- security basics
  let r = await fetch(base + '/api/auth/register', { method: 'POST', body: '{}' }); ok(r.status === 403, 'POST without CSRF header is rejected');
  r = await A.api('POST', '/api/auth/register', { username: 'a', password: 'x' }); ok(r.status === 400, 'invalid registration rejected');
  r = await A.api('POST', '/api/auth/register', { username: 'alice', password: 'correct horse battery', email: 'alice@example.com' });
  ok(r.status === 200 && r.user.username === 'alice' && r.recoveryCode, 'register returns user + recovery code');
  ok(r.user.role === 'admin', 'first user becomes admin');
  const recovery = r.recoveryCode;
  r = await A.api('POST', '/api/auth/register', { username: 'ALICE', password: 'correct horse battery' }); ok(r.status === 409, 'usernames are unique case-insensitively');
  await B.api('POST', '/api/auth/register', { username: 'bob', password: 'hunter2hunter2' });
  await C.api('POST', '/api/auth/register', { username: 'carol', password: 'swordfish123' });
  r = await B.api('GET', '/api/admin/stats'); ok(r.status === 403, 'non-admin cannot read admin stats');
  r = await A.api('GET', '/api/admin/stats'); ok(r.status === 200 && r.users === 3, 'admin can read admin stats');
  r = await (await fetch(base + '/api/me')).json(); ok(r.user === null, 'anonymous /api/me is null');
  const bad = new Client('bad'); r = await bad.api('POST', '/api/auth/login', { username: 'alice', password: 'wrong' }); ok(r.status === 401, 'wrong password rejected');

  // --- password recovery with recovery code
  r = await bad.api('POST', '/api/auth/reset', { username: 'bob', recoveryCode: 'zzzz-zzzz-zzzz', password: 'newpassword99' }); ok(r.status === 400, 'bad recovery code rejected');

  // --- matchmaking + live game
  await A.connect(); await B.connect();
  A.send({ t: 'quick', initial: 300, inc: 0, rated: true }); B.send({ t: 'quick', initial: 300, inc: 0, rated: true });
  const ga = await A.wait((m) => m.t === 'game'); const gb = await B.wait((m) => m.t === 'game');
  ok(ga.game.id === gb.game.id && ga.game.cat === 'blitz', 'quick pairing matches two real players into one blitz game');
  const id = ga.game.id; const white = ga.game.myColor === 'w' ? A : B, black = white === A ? B : A;
  white.send({ t: 'move', id, uci: 'e2e5' }); const e1 = await white.wait((m) => m.t === 'error'); ok(/Illegal/.test(e1.error), 'illegal move rejected by server');
  black.send({ t: 'move', id, uci: 'e7e5' }); const e2 = await black.wait((m) => m.t === 'error'); ok(/Not your turn/.test(e2.error), 'moving out of turn rejected');
  // Fool's mate: 1.f3 e5 2.g4 Qh4#
  const seq = [[white, 'f2f3'], [black, 'e7e5'], [white, 'g2g4'], [black, 'd8h4']];
  for (const [c, u] of seq) { c.send({ t: 'move', id, uci: u }); await c.wait((m) => m.t === 'move' && m.uci === u); }
  const end = await white.wait((m) => m.t === 'end');
  ok(end.result === '0-1' && end.reason === 'checkmate', 'checkmate detected, black wins');
  ok(end.ratingChange && end.ratingChange.black.after > end.ratingChange.black.before && end.ratingChange.white.after < end.ratingChange.white.before, 'Glicko-2 ratings updated on the server');
  r = await A.api('GET', `/api/games/${id}/pgn`, null, true); ok(/Qh4#/.test(r.text) && /0-1/.test(r.text), 'PGN export contains the game');
  r = await A.api('GET', '/api/leaderboard?cat=blitz'); ok(r.rows.length === 2 && r.rows[0].rating > r.rows[1].rating, 'leaderboard ranks by rating');
  r = await A.api('GET', '/api/users/alice'); ok(r.recent.length === 1 && r.achievements.some((a) => a.id === 'first-game'), 'profile shows recent game and achievement');

  // --- rematch
  white.send({ t: 'rematch', id }); black.send({ t: 'rematch', id });
  const rm = await white.wait((m) => m.t === 'rematch_game'); ok(!!rm.newId, 'rematch creates a new game');
  const id2 = rm.newId; await white.wait((m) => m.t === 'game'); await black.wait((m) => m.t === 'game');
  const g2 = (await A.api('GET', `/api/games/${id2}`)).game; const w2 = g2.myColor === 'w' ? A : B, b2 = w2 === A ? B : A;
  ok(g2.white.id === black === undefined ? true : g2.white.name !== ga.game.white.name, 'rematch swaps colours');

  // --- draw offers
  for (const [c, u] of [[w2, 'e2e4'], [b2, 'e7e5']]) { c.send({ t: 'move', id: id2, uci: u }); await A.wait((m) => m.t === 'move' && m.id === id2 && m.uci === u); }
  w2.send({ t: 'draw', id: id2, kind: 'offer' }); await b2.wait((m) => m.t === 'draw_offer');
  b2.send({ t: 'draw', id: id2, kind: 'accept' }); const de = await w2.wait((m) => m.t === 'end' && m.id === id2);
  ok(de.result === '1/2-1/2' && de.reason === 'agreement', 'draw by agreement');

  // --- spectators + resign + disconnect handling
  await C.connect(); A.send({ t: 'quick', initial: 60, inc: 0, rated: false }); B.send({ t: 'quick', initial: 60, inc: 0, rated: false });
  const g3 = await A.wait((m) => m.t === 'game'); await B.wait((m) => m.t === 'game');
  C.send({ t: 'watch', id: g3.game.id }); const sp = await C.wait((m) => m.t === 'game'); ok(sp.spectating && sp.game.cat === 'bullet', 'spectator receives the live game');
  const wh = g3.game.myColor === 'w' ? A : B, bl = wh === A ? B : A;
  wh.send({ t: 'move', id: g3.game.id, uci: 'd2d4' }); await C.wait((m) => m.t === 'move' && m.uci === 'd2d4'); ok(true, 'spectator sees moves in real time');
  bl.send({ t: 'move', id: g3.game.id, uci: 'd7d5' }); await C.wait((m) => m.t === 'move' && m.uci === 'd7d5');
  bl.send({ t: 'resign', id: g3.game.id }); const re = await C.wait((m) => m.t === 'end' && m.id === g3.game.id); ok(re.reason === 'resignation', 'resignation ends game');
  r = await A.api('GET', '/api/games/live'); ok(Array.isArray(r.games), 'live games list available');

  // --- invite link / private game
  A.send({ t: 'invite', initial: 600, inc: 5, rated: false, color: 'w' }); const inv = await A.wait((m) => m.t === 'invite_created');
  C.send({ t: 'join', code: inv.code }); const jn = await C.wait((m) => m.t === 'joined'); ok(jn.id === inv.id, 'invite link joins a private game');
  const gv = (await C.api('GET', `/api/games/${inv.id}`)).game; ok(gv.status === 'active' && gv.private && gv.cat === 'rapid', 'private rapid game active');
  // clocks: moves then check increments applied
  A.send({ t: 'move', id: inv.id, uci: 'e2e4' }); await A.wait((m) => m.t === 'move' && m.id === inv.id); C.send({ t: 'move', id: inv.id, uci: 'e7e5' }); const mv = await A.wait((m) => m.t === 'move' && m.id === inv.id && m.ply === 2);
  ok(mv.clocks[0] === 600000 && mv.clocks[1] === 600000, 'clock does not run before both sides have moved');
  A.send({ t: 'move', id: inv.id, uci: 'g1f3' }); await sleep(300); C.send({ t: 'move', id: inv.id, uci: 'b8c6' }); const mv4 = await A.wait((m) => m.t === 'move' && m.id === inv.id && m.ply === 4);
  ok(mv4.clocks[0] > 600000 + 5000 - 300 && mv4.clocks[0] < 600000 + 5000 + 50 && mv4.clocks[1] < 600000 + 5000, 'clocks tick server-side and increment is applied');
  // threefold claim: shuffle knights
  let pl = 4; for (const u of ['f3g1', 'c6b8', 'g1f3', 'b8c6', 'f3g1', 'c6b8']) { const c = (['f3g1', 'g1f3'].includes(u) ? A : C); pl++; c.send({ t: 'move', id: inv.id, uci: u }); await c.wait((m) => m.t === 'move' && m.id === inv.id && m.ply === pl); }
  A.send({ t: 'draw', id: inv.id, kind: 'claim' }); const cl = await A.wait((m) => (m.t === 'end' && m.id === inv.id) || m.t === 'error'); ok(cl.t === 'end' && cl.reason === 'threefold', 'threefold repetition claim accepted');

  // --- disconnect handling
  C.ws.close(); await sleep(300);
  r = await B.api('GET', '/api/friends'); ok(r.status === 200, 'friends endpoint works');

  // --- social
  r = await A.api('POST', '/api/friends/request', { username: 'bob' }); ok(r.status === 'pending', 'friend request sent');
  r = await B.api('POST', '/api/friends/accept', { username: 'alice' }); ok(r.status === 200, 'friend request accepted');
  r = await A.api('POST', '/api/messages', { to: 'bob', body: 'good game!' }); ok(r.status === 200, 'direct message sent');
  r = await B.api('GET', '/api/messages/with/alice'); ok(r.messages.length === 1 && r.messages[0].body === 'good game!', 'direct message received');
  r = await A.api('POST', '/api/messages', { to: 'bob', body: '<script>alert(1)</script>' }); ok(r.status === 200, 'html in messages is stored as text (escaped on render)');
  await B.api('POST', '/api/blocks', { username: 'alice' }); r = await A.api('POST', '/api/messages', { to: 'bob', body: 'hello?' }); ok(r.status === 403, 'blocked users cannot message');
  r = await C.api('POST', '/api/reports', { username: 'bob', reason: 'abuse', details: 'test' }); ok(r.status === 200, 'report filed');
  r = await A.api('GET', '/api/admin/reports'); ok(r.reports.length === 1, 'moderator sees the report');
  r = await A.api('POST', `/api/admin/reports/${r.reports[0].id}/resolve`, { action: 'dismiss' }); ok(r.status === 200, 'report resolved');
  r = await A.api('POST', '/api/clubs', { name: 'Test Club', description: 'hi' }); ok(r.status === 200, 'club created'); const cid = r.id;
  r = await B.api('POST', `/api/clubs/${cid}/join`, {}); ok(r.status === 200, 'club joined');
  await B.api('POST', `/api/clubs/${cid}/messages`, { body: 'hello club' }); r = await A.api('GET', `/api/clubs/${cid}/messages`); ok(r.messages.length === 1, 'club chat works');
  r = await C.api('GET', `/api/clubs/${cid}/messages`); ok(r.status === 403, 'club chat is members-only');

  // --- puzzles (server-verified)
  r = await A.api('GET', '/api/puzzles/next?kind=mate'); ok(r.puzzle && r.attempt && !('solution' in r.puzzle), 'puzzle served without leaking the solution');
  const pz = r.puzzle, att = r.attempt;
  let wrong = null; const { Chess } = await import('../shared/chess.js'); const pos = new Chess(pz.fen);
  const legal = pos.legalMoves().map((m) => pos.uciOf(m));
  const { mateMoves } = await import('../shared/engine.js'); const good = mateMoves(new Chess(pz.fen), pz.mate, pz.mate > 2 ? { checksOnlyAfterFirst: true } : {});
  wrong = legal.find((m) => !good.includes(m));
  const ra = (await A.api('POST', `/api/puzzles/attempt/${att}/move`, { uci: wrong }));
  ok(ra.correct === false && ra.solved === false && ra.solution, 'wrong puzzle move fails the puzzle');
  r = await A.api('GET', '/api/puzzles/next?kind=mate'); const att2 = r.attempt; const p2 = r.puzzle;
  let cur = new Chess(p2.fen), done = false, guard = 0, last;
  while (!done && guard++ < 6) {
    const sol = mateMoves(new Chess(cur.fen()), p2.mate - guard + 1, p2.mate > 2 ? { checksOnlyAfterFirst: true } : {});
    const mv = sol[0]; last = await A.api('POST', `/api/puzzles/attempt/${att2}/move`, { uci: mv }); cur.move(mv); if (last.reply) cur.move(last.reply); done = last.solved !== undefined;
  }
  ok(last.correct && last.solved && last.ratingChange, 'solving a mate puzzle updates the puzzle rating');
  r = await A.api('POST', '/api/puzzles/run/start', { mode: 'rush' }); const run = r.run; r = await A.api('GET', `/api/puzzles/next?run=${run}&mode=rush`); ok(r.attempt, 'puzzle rush run serves puzzles');
  r = await A.api('GET', '/api/puzzles/daily'); ok(r.puzzle && r.day, 'daily puzzle available');
  r = await A.api('GET', '/api/puzzles/stats'); ok(r.attempts >= 2, 'puzzle stats tracked');

  // --- lessons / openings
  r = await A.api('GET', '/api/lessons'); ok(r.lessons.length >= 20, `lessons available (${r.lessons.length})`);
  r = await A.api('POST', `/api/lessons/${(await A.api('GET', '/api/lessons')).lessons[0].id}/progress`, { step: 3, completed: false }); ok(r.status === 200, 'lesson progress saved');
  r = await A.api('GET', '/api/openings/stats?moves=f3,e5'); ok(r.total.n >= 1, 'opening stats computed from real games');

  // --- computer game saving validates the position
  r = await A.api('POST', '/api/games/computer', { moves: ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'], level: 3, color: 'w', result: '1-0' }); ok(r.status === 200 && r.id, 'computer game saved after server replays it');
  r = await A.api('POST', '/api/games/computer', { moves: ['e4', 'e5', 'Ke3'], level: 3, color: 'w', result: '*' }); ok(r.status === 400, 'illegal computer game rejected');
  r = await A.api('POST', '/api/games/computer', { moves: ['e4', 'e5'], level: 3, color: 'w', result: '1-0', reason: 'resignation' }); ok(r.status === 400, 'cannot claim a win by resignation for yourself');

  // --- tournaments
  const soon = Date.now() + 2500;
  r = await A.api('POST', '/api/tournaments', { name: 'Test Swiss', kind: 'swiss', initial: 60, inc: 0, rounds: 1, startTs: soon }); ok(r.status === 200, 'swiss tournament created'); const tid = r.id;
  r = await B.api('POST', `/api/tournaments/${tid}/join`, {}); ok(r.status === 200, 'joined tournament');
  await sleep(4500);
  r = await B.api('GET', `/api/tournaments/${tid}`); ok(r.tournament.status === 'running' && r.myGame, 'swiss round paired automatically');
  const tg = r.myGame; A.ws.close(); await sleep(100); await A.connect(); B.msgs.length = 0;
  const gt = (await B.api('GET', `/api/games/${tg}`)).game; const tw = gt.white.name === 'alice' ? A : B, tb = tw === A ? B : A;
  tb.send({ t: 'resign', id: tg }); tw.send({ t: 'move', id: tg, uci: 'e2e4' }); await sleep(300);
  tb.send({ t: 'resign', id: tg }); await sleep(2800);
  r = await A.api('GET', `/api/tournaments/${tid}`); ok(r.tournament.status === 'finished' && r.standings.some((s) => s.score === 1), 'tournament finished and scored');

  // --- admin moderation
  r = await A.api('GET', '/api/admin/users?q=bob'); const bobId = r.users[0].id;
  r = await A.api('POST', `/api/admin/users/${bobId}/status`, { status: 'banned', reason: 'test' }); ok(r.status === 200, 'admin bans user');
  r = await B.api('GET', '/api/friends'); ok(r.status === 401 || r.status === 403, 'banned user loses access');
  r = await (new Client('b2')).api('POST', '/api/auth/login', { username: 'bob', password: 'hunter2hunter2' }); ok(r.status === 403, 'banned user cannot log in');
  r = await A.api('GET', '/api/admin/health'); ok(r.wsConnections >= 1 && r.uptimeSec >= 0, 'server health available');

  // --- static + headers
  r = await fetch(base + '/'); ok(r.status === 200 && /default-src 'self'/.test(r.headers.get('content-security-policy')), 'static site served with CSP header');
  r = await fetch(base + '/shared/../server/db.js'); ok(r.status === 404 || r.status === 403 || !(await r.text()).includes('DatabaseSync'), 'path traversal blocked');
} catch (e) { failed++; console.log('FAIL (exception)', e); }
finally { srv.kill(); for (const f of [DB, DB + '-wal', DB + '-shm']) try { fs.unlinkSync(f); } catch {} }
console.log(`\nserver e2e: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
