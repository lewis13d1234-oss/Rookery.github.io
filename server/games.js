// Server-authoritative live games: clocks, move validation, draws, resign, rematch, spectators, matchmaking, chat.
import crypto from 'node:crypto';
import { Chess, START_FEN } from '../shared/chess.js';
import { q, tx } from './db.js';
import { send, sendUser, socketsOf, isOnline } from './hub.js';
import { categoryFor, getRating, rateGame, recordUnrated, checkGameAchievements, nameOf } from './core.js';
import { chatAllowed, cleanChat, vText } from './security.js';
import { analyseForFairPlay } from './fairplay.js';

export const live = new Map();         // id -> Game
const seeks = new Map();               // id -> seek
const challenges = new Map();          // id -> challenge
let endHook = () => {};
export const setEndHook = (fn) => { endHook = fn; };

const FIRST_MOVE_MS = 30_000;
const DISCONNECT_MS = 60_000;
const rid = (n = 6) => crypto.randomBytes(n).toString('base64url');
const colorIdx = { w: 0, b: 1 };

export function validTc(initial, inc) {
  initial = Number(initial); inc = Number(inc);
  if (!Number.isFinite(initial) || !Number.isFinite(inc)) return null;
  if (initial < 15 || initial > 10800 || inc < 0 || inc > 180) return null;
  if (initial < 30 && inc === 0 && initial < 15) return null;
  return { initial: Math.round(initial), inc: Math.round(inc) };
}

class Game {
  constructor(row) {
    this.id = row.id;
    this.white = { id: row.white_id, name: row.white_name };
    this.black = { id: row.black_id, name: row.black_name };
    this.tc = { initial: row.tc_initial, inc: row.tc_inc };
    this.cat = row.category; this.rated = !!row.rated; this.status = row.status;
    this.startFen = row.start_fen;
    this.chess = new Chess(row.start_fen);
    for (const s of JSON.parse(row.moves || '[]')) if (!this.chess.move(s)) throw new Error('corrupt game ' + row.id);
    this.clocks = JSON.parse(row.clocks); this.lastTick = Date.now();
    this.result = row.result; this.reason = row.reason;
    this.inviteCode = row.invite_code; this.private = !!row.private; this.tournamentId = row.tournament_id;
    this.drawOffer = null; this.rematch = { w: false, b: false }; this.spectators = new Set();
    this.timer = null; this.firstTimer = null; this.dc = {}; this.thinks = [[], []];
    this.createdAt = row.created_at; this.ratingChange = null; this.lastMoveAt = Date.now();
    if (row.white_rating_before != null) this.ratingChange = { white: { before: row.white_rating_before, after: row.white_rating_after }, black: { before: row.black_rating_before, after: row.black_rating_after } };
  }
  get ply() { return this.chess.ply; }
  get turn() { return this.chess.turn; } // 0 white, 1 black
  colorOf(uid) { return uid && uid === this.white.id ? 0 : uid && uid === this.black.id ? 1 : -1; }
  clockRunning() { return this.status === 'active' && this.ply >= 2; }
  liveClocks(now = Date.now()) {
    const c = [...this.clocks];
    if (this.clockRunning()) c[this.turn] = Math.max(0, c[this.turn] - (now - this.lastTick));
    return c;
  }
}

function ratingOf(uid, cat) { return uid ? Math.round(getRating(uid, cat).rating) : null; }

export function view(g, forUid = null) {
  const now = Date.now();
  return {
    id: g.id, status: g.status, tc: g.tc, cat: g.cat, rated: g.rated, private: g.private,
    white: { ...g.white, rating: ratingOf(g.white.id, g.cat), online: g.white.id ? isOnline(g.white.id) : false },
    black: { ...g.black, rating: ratingOf(g.black.id, g.cat), online: g.black.id ? isOnline(g.black.id) : false },
    startFen: g.startFen, fen: g.chess.fen(), moves: g.chess.history(), uci: g.chess.historyUci(),
    clocks: g.liveClocks(now), turn: g.turn ? 'b' : 'w', serverNow: now, clockRunning: g.clockRunning(),
    result: g.result, reason: g.reason, drawOffer: g.drawOffer, rematch: g.rematch, ratingChange: g.ratingChange,
    tournamentId: g.tournamentId, inviteCode: forUid && g.colorOf(forUid) >= 0 && g.status === 'waiting' ? g.inviteCode : undefined,
    spectators: g.spectators.size, canClaim: g.chess.claimableDraw(), check: g.chess.inCheck(),
    myColor: forUid ? ['w', 'b'][g.colorOf(forUid)] || null : null, firstMoveDeadline: g.ply < 2 && g.status === 'active' ? g.lastMoveAt + FIRST_MOVE_MS : null,
  };
}

function emit(g, msg) {
  if (g.white.id) sendUser(g.white.id, msg);
  if (g.black.id) sendUser(g.black.id, msg);
  for (const ws of g.spectators) send(ws, msg);
}

// ---------------------------------------------------------------- creation / persistence
export function createGame({ white, black, tc, rated, tournamentId = null, private: priv = false, status = 'active', startFen = START_FEN }) {
  const cat = categoryFor(tc.initial, tc.inc);
  const id = rid(6);
  const code = status === 'waiting' ? rid(5) : null;
  const ms = tc.initial * 1000;
  if (rated && (!white?.id || !black?.id)) rated = false;
  const wr = white?.id ? getRating(white.id, cat).rating : null, br = black?.id ? getRating(black.id, cat).rating : null;
  q.run(`INSERT INTO games (id,white_id,black_id,white_name,black_name,category,tc_initial,tc_inc,rated,status,fen,start_fen,clocks,invite_code,private,tournament_id,white_rating_before,black_rating_before,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, white?.id ?? null, black?.id ?? null, white?.name || '?', black?.name || '?', cat, tc.initial, tc.inc, rated ? 1 : 0, status, startFen, startFen, JSON.stringify([ms, ms]), code, priv ? 1 : 0, tournamentId, wr, br, Date.now());
  const g = new Game(q.get('SELECT * FROM games WHERE id=?', id));
  live.set(id, g);
  if (status === 'active') startGame(g);
  return g;
}

function startGame(g) {
  g.status = 'active'; g.lastTick = Date.now(); g.lastMoveAt = Date.now();
  q.run("UPDATE games SET status='active', last_tick=? WHERE id=?", Date.now(), g.id);
  armFirstMove(g);
  for (const uid of [g.white.id, g.black.id]) { if (uid) { dropSeeksOf(uid); } }
  emit(g, { t: 'game_start', id: g.id });
  for (const uid of [g.white.id, g.black.id]) if (uid) sendUser(uid, { t: 'game', game: view(g, uid) });
}

function armFirstMove(g) {
  clearTimeout(g.firstTimer);
  if (g.ply >= 2 || g.status !== 'active') return;
  g.lastMoveAt = Date.now();
  g.firstTimer = setTimeout(() => {
    if (g.status !== 'active' || g.ply >= 2) return;
    const loser = g.turn; // side that failed to move
    if (g.tournamentId) finish(g, loser ? '1-0' : '0-1', 'no-show');
    else finish(g, '*', 'aborted');
  }, FIRST_MOVE_MS);
}

function armClock(g) {
  clearTimeout(g.timer);
  if (!g.clockRunning()) return;
  const left = g.clocks[g.turn] - (Date.now() - g.lastTick);
  g.timer = setTimeout(() => timeout(g), Math.max(0, left) + 30);
}

function hasMatingMaterial(chess, color) {
  let minors = 0, other = false, enemyPieces = 0;
  for (const row of chess.board()) for (const p of row) {
    if (!p) continue;
    if (p.color === color) { if (['p', 'r', 'q'].includes(p.type)) other = true; else if (['n', 'b'].includes(p.type)) minors++; }
    else if (p.type !== 'k') enemyPieces++;
  }
  return other || minors >= 2 || (minors === 1 && enemyPieces > 0);
}

function timeout(g) {
  if (g.status !== 'active') return;
  const c = g.turn;
  const left = g.clocks[c] - (Date.now() - g.lastTick);
  if (left > 50) return armClock(g);
  const winnerColor = c ? 'w' : 'b';
  if (!hasMatingMaterial(g.chess, winnerColor)) finish(g, '1/2-1/2', 'timeout-insufficient');
  else finish(g, c ? '1-0' : '0-1', 'timeout');
}

// ---------------------------------------------------------------- moves
function playMove(g, uid, uci) {
  if (g.status !== 'active') throw new Error('Game is not active');
  const c = g.colorOf(uid);
  if (c < 0) throw new Error('You are not a player in this game');
  if (c !== g.turn) throw new Error('Not your turn');
  if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error('Bad move format');
  const now = Date.now();
  let think = now - (g.ply >= 2 ? g.lastTick : g.lastMoveAt);
  if (g.clockRunning()) {
    const left = g.clocks[c] - (now - g.lastTick);
    if (left <= 0) { g.clocks[c] = 0; timeout(g); return; }
    g.clocks[c] = left + g.tc.inc * 1000;
  }
  const mv = g.chess.move(uci);
  if (!mv) throw new Error('Illegal move');
  g.lastTick = now; g.lastMoveAt = now; g.thinks[c].push(think);
  g.drawOffer = null;
  const ply = g.ply;
  q.run('INSERT INTO moves (game_id,ply,san,uci,fen_after,think_ms,clock_ms) VALUES (?,?,?,?,?,?,?)', g.id, ply, mv.san, uci, g.chess.fen(), think, Math.round(g.clocks[c]));
  q.run('UPDATE games SET fen=?, moves=?, clocks=?, last_tick=? WHERE id=?', g.chess.fen(), JSON.stringify(g.chess.history()), JSON.stringify(g.clocks), now, g.id);
  emit(g, { t: 'move', id: g.id, san: mv.san, uci, fen: g.chess.fen(), ply, clocks: g.liveClocks(now), turn: g.turn ? 'b' : 'w', check: g.chess.inCheck(), canClaim: g.chess.claimableDraw(), serverNow: now, clockRunning: g.clockRunning() });
  const st = g.chess.status();
  if (st.over) return finish(g, st.result, st.reason);
  if (g.ply === 1) armFirstMove(g); else { clearTimeout(g.firstTimer); }
  armClock(g);
}

export function finish(g, result, reason) {
  if (g.status === 'finished' || g.status === 'aborted') return;
  clearTimeout(g.timer); clearTimeout(g.firstTimer); for (const t of Object.values(g.dc)) clearTimeout(t); g.dc = {};
  const aborted = reason === 'aborted';
  g.status = aborted ? 'aborted' : 'finished'; g.result = result; g.reason = reason; g.drawOffer = null;
  if (g.clockRunning() || g.ply >= 2) g.clocks = g.liveClocks();
  const now = Date.now();
  if (!aborted && g.white.id && g.black.id) {
    const score = result === '1-0' ? 1 : result === '0-1' ? 0 : 0.5;
    try {
      if (g.rated && g.ply >= 2) g.ratingChange = rateGame(g.white.id, g.black.id, g.cat, score);
      else { recordUnrated(g.white.id, g.cat, score); recordUnrated(g.black.id, g.cat, 1 - score); }
    } catch (e) { console.error('rating error', e); }
  }
  const rc = g.ratingChange;
  q.run('UPDATE games SET status=?, result=?, reason=?, fen=?, moves=?, clocks=?, ended_at=?, white_rating_after=?, black_rating_after=? WHERE id=?',
    g.status, result, reason, g.chess.fen(), JSON.stringify(g.chess.history()), JSON.stringify(g.clocks), now, rc?.white.after ?? null, rc?.black.after ?? null, g.id);
  emit(g, { t: 'end', id: g.id, status: g.status, result, reason, ratingChange: rc, clocks: g.clocks });
  if (!aborted) {
    const mate = reason === 'checkmate';
    for (const [c, p, o] of [[0, g.white, g.black], [1, g.black, g.white]]) {
      if (!p.id) continue;
      const won = result === (c ? '0-1' : '1-0');
      try { checkGameAchievements(p.id, { won, drew: result === '1/2-1/2', plies: g.ply, mate, oppRating: rc ? (c ? rc.white.before : rc.black.before) : null, myRating: rc ? (c ? rc.black.before : rc.white.before) : null }); } catch {}
    }
    if (g.rated && g.ply >= 20) setImmediate(() => analyseForFairPlay(g).catch(() => {}));
  }
  try { endHook(g); } catch (e) { console.error('end hook', e); }
  setTimeout(() => { if (live.get(g.id) === g && !g.spectators.size) live.delete(g.id); }, 10 * 60_000).unref();
}

// ---------------------------------------------------------------- actions
function myGame(ws, id) {
  const g = live.get(id) || restoreOne(id);
  if (!g) throw new Error('Game not found');
  return g;
}
export function restoreOne(id) {
  const row = q.get('SELECT * FROM games WHERE id=?', id);
  if (!row) return null;
  try { const g = new Game(row); if (row.status === 'finished' || row.status === 'aborted') { live.set(id, g); setTimeout(() => { if (live.get(id) === g && !g.spectators.size) live.delete(id); }, 10 * 60_000).unref(); } return g; } catch { return null; }
}

export function restoreActive() {
  for (const row of q.all("SELECT * FROM games WHERE status IN ('active','waiting')")) {
    try {
      const g = new Game(row);
      if (row.status === 'waiting' && Date.now() - row.created_at > 30 * 60_000) { q.run("UPDATE games SET status='aborted', reason='expired' WHERE id=?", row.id); continue; }
      live.set(g.id, g);
      if (g.status === 'active') { g.lastTick = Date.now(); armClock(g); armFirstMove(g); }
    } catch (e) { console.error('restore failed', row.id, e.message); }
  }
}

function actionDraw(g, uid, kind) {
  if (g.status !== 'active') throw new Error('Game is not active');
  const c = g.colorOf(uid); if (c < 0) throw new Error('Not a player');
  const col = ['w', 'b'][c];
  if (kind === 'offer') {
    if (g.ply < 2) throw new Error('Too early to offer a draw');
    if (g.drawOffer && g.drawOffer !== col) return finish(g, '1/2-1/2', 'agreement');
    if (g.drawOffer === col) return;
    g.drawOffer = col;
    emit(g, { t: 'draw_offer', id: g.id, by: col });
  } else if (kind === 'accept') {
    if (!g.drawOffer || g.drawOffer === col) throw new Error('No draw offer to accept');
    finish(g, '1/2-1/2', 'agreement');
  } else if (kind === 'decline') {
    if (!g.drawOffer || g.drawOffer === col) return;
    g.drawOffer = null; emit(g, { t: 'draw_declined', id: g.id });
  } else if (kind === 'claim') {
    const why = g.chess.claimableDraw();
    if (!why) throw new Error('No draw can be claimed right now (needs threefold repetition or 50 moves without capture/pawn move)');
    finish(g, '1/2-1/2', why === 'threefold' ? 'threefold' : 'fifty');
  }
}

function actionRematch(g, uid, accept) {
  if (g.status !== 'finished' && g.status !== 'aborted') throw new Error('Game is not finished');
  if (g.tournamentId) throw new Error('No rematches in tournament games');
  const c = g.colorOf(uid); if (c < 0) throw new Error('Not a player');
  const other = c ? g.white.id : g.black.id;
  if (!other) throw new Error('Opponent unavailable');
  if (!accept) { g.rematch = { w: false, b: false }; emit(g, { t: 'rematch', id: g.id, rematch: g.rematch, declined: true }); return; }
  g.rematch[['w', 'b'][c]] = true;
  emit(g, { t: 'rematch', id: g.id, rematch: g.rematch });
  if (g.rematch.w && g.rematch.b) {
    if (activeGameOf(g.white.id, g.id) || activeGameOf(g.black.id, g.id)) throw new Error('A player already has a game in progress');
    const ng = createGame({ white: g.black, black: g.white, tc: g.tc, rated: g.rated, private: g.private });
    g.rematch = { w: false, b: false };
    emit(g, { t: 'rematch_game', id: g.id, newId: ng.id });
  }
}

export function activeGameOf(uid, exceptId = null) {
  for (const g of live.values()) if (g.status === 'active' && g.id !== exceptId && !g.tournamentId && g.colorOf(uid) >= 0) return g;
  return null;
}
export const activeGamesOf = (uid) => [...live.values()].filter((g) => g.status === 'active' && g.colorOf(uid) >= 0);

// ---------------------------------------------------------------- matchmaking
function dropSeeksOf(uid) {
  let changed = false;
  for (const [id, s] of seeks) if (s.userId === uid) { seeks.delete(id); changed = true; }
  if (changed) broadcastSeeks();
}
export const publicSeeks = () => [...seeks.values()].filter((s) => !s.auto).map((s) => ({ id: s.id, user: s.name, userId: s.userId, rating: s.rating, tc: s.tc, rated: s.rated, color: s.color, cat: s.cat }));
const lobbyListeners = new Set();
export function clearSeeks() { const n = seeks.size; seeks.clear(); broadcastSeeks(); return n; }
export function broadcastSeeks() { const m = { t: 'seeks', seeks: publicSeeks() }; for (const ws of lobbyListeners) send(ws, m); }

function pairUp(a, b, tc, rated, colorPref) {
  let wh = a, bl = b;
  if (colorPref === 'w') { wh = a; bl = b; } else if (colorPref === 'b') { wh = b; bl = a; } else if (Math.random() < 0.5) { wh = b; bl = a; }
  dropSeeksOf(a.userId); dropSeeksOf(b.userId);
  return createGame({ white: { id: wh.userId, name: wh.name }, black: { id: bl.userId, name: bl.name }, tc, rated });
}

function blocked(a, b) { return !!q.get('SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)', a, b, b, a); }

export function runMatchmaking() {
  const now = Date.now();
  const autos = [...seeks.values()].filter((s) => s.auto);
  for (let i = 0; i < autos.length; i++) {
    const a = autos[i]; if (!seeks.has(a.id)) continue;
    for (let j = i + 1; j < autos.length; j++) {
      const b = autos[j]; if (!seeks.has(b.id) || a.userId === b.userId) continue;
      if (a.cat !== b.cat || a.tc.initial !== b.tc.initial || a.tc.inc !== b.tc.inc || a.rated !== b.rated) continue;
      const window = 100 + Math.floor((Math.min(now - a.created, now - b.created)) / 1000) * 25;
      if (Math.abs(a.rating - b.rating) > window) continue;
      if (blocked(a.userId, b.userId)) continue;
      pairUp(a, b, a.tc, a.rated, 'random'); break;
    }
  }
  for (const [id, c] of challenges) if (c.expires < now) { challenges.delete(id); sendUser(c.from, { t: 'challenge_expired', id }); }
}
setInterval(runMatchmaking, 1000).unref();
setInterval(() => { // expire unjoined invite games
  for (const g of live.values()) if (g.status === 'waiting' && Date.now() - g.createdAt > 30 * 60_000) { g.status = 'aborted'; g.reason = 'expired'; q.run("UPDATE games SET status='aborted', reason='expired' WHERE id=?", g.id); live.delete(g.id); }
}, 60_000).unref();

// ---------------------------------------------------------------- socket lifecycle
export function onOpen(ws) {
  if (!ws.user) return;
  for (const g of live.values()) {
    const c = g.colorOf(ws.user.id);
    if (c < 0 || g.status !== 'active') continue;
    const key = ['w', 'b'][c];
    if (g.dc[key]) { clearTimeout(g.dc[key]); delete g.dc[key]; emit(g, { t: 'opponent_back', id: g.id, color: key }); }
    send(ws, { t: 'resume', id: g.id });
  }
}
export function onClose(ws) {
  lobbyListeners.delete(ws);
  for (const g of g_spectated(ws)) { g.spectators.delete(ws); emit(g, { t: 'spectators', id: g.id, n: g.spectators.size }); }
  if (!ws.user || isOnline(ws.user.id)) return;
  dropSeeksOf(ws.user.id);
  for (const [id, c] of challenges) if (c.from === ws.user.id) challenges.delete(id);
  for (const g of live.values()) {
    const c = g.colorOf(ws.user.id);
    if (c < 0 || g.status !== 'active') continue;
    const key = ['w', 'b'][c];
    if (g.dc[key]) continue;
    emit(g, { t: 'opponent_gone', id: g.id, color: key, ms: DISCONNECT_MS });
    g.dc[key] = setTimeout(() => {
      delete g.dc[key];
      if (g.status !== 'active') return;
      if (g.ply < 2) return finish(g, g.tournamentId ? (c ? '1-0' : '0-1') : '*', g.tournamentId ? 'abandoned' : 'aborted');
      finish(g, c ? '1-0' : '0-1', 'abandoned');
    }, DISCONNECT_MS);
  }
}
function g_spectated(ws) { return [...live.values()].filter((g) => g.spectators.has(ws)); }

// ---------------------------------------------------------------- message dispatch
export function handle(ws, m) {
  const uid = ws.user?.id;
  const needUser = () => { if (!uid) throw new Error('Log in to do that'); if (ws.user.status === 'banned' || ws.user.status === 'suspended') throw new Error('Your account is restricted'); };
  switch (m.t) {
    case 'lobby': lobbyListeners.add(ws); return send(ws, { t: 'seeks', seeks: publicSeeks() });
    case 'lobby_leave': lobbyListeners.delete(ws); return;
    case 'seek': case 'quick': {
      needUser();
      const tc = validTc(m.initial, m.inc); if (!tc) throw new Error('Invalid time control');
      if (activeGameOf(uid)) throw new Error('Finish your current game first');
      dropSeeksOf(uid);
      const cat = categoryFor(tc.initial, tc.inc);
      const s = { id: rid(4), userId: uid, name: ws.user.username, rating: Math.round(getRating(uid, cat).rating), tc, cat, rated: !!m.rated, color: ['w', 'b'].includes(m.color) ? m.color : 'random', auto: m.t === 'quick', created: Date.now() };
      seeks.set(s.id, s);
      send(ws, { t: 'seek_ok', id: s.id, auto: s.auto });
      broadcastSeeks();
      if (s.auto) runMatchmaking();
      return;
    }
    case 'cancel_seek': needUser(); dropSeeksOf(uid); return send(ws, { t: 'seek_cancelled' });
    case 'accept_seek': {
      needUser();
      const s = seeks.get(m.id); if (!s) throw new Error('That challenge is no longer available');
      if (s.userId === uid) throw new Error('You cannot accept your own challenge');
      if (activeGameOf(uid)) throw new Error('Finish your current game first');
      if (blocked(uid, s.userId)) throw new Error('You cannot play this user');
      const me = { userId: uid, name: ws.user.username };
      pairUp(s, me, s.tc, s.rated, s.color);
      return;
    }
    case 'challenge': {
      needUser();
      const tc = validTc(m.initial, m.inc); if (!tc) throw new Error('Invalid time control');
      const target = q.get('SELECT id, username, status FROM users WHERE username=?', String(m.to || ''));
      if (!target || target.id === uid) throw new Error('Choose another player to challenge');
      if (blocked(uid, target.id)) throw new Error('You cannot challenge this user');
      if (!isOnline(target.id)) throw new Error(`${target.username} is offline — create an invite link instead`);
      const c = { id: rid(4), from: uid, fromName: ws.user.username, to: target.id, tc, rated: !!m.rated, color: ['w', 'b'].includes(m.color) ? m.color : 'random', expires: Date.now() + 5 * 60_000 };
      challenges.set(c.id, c);
      sendUser(target.id, { t: 'challenge', id: c.id, from: c.fromName, tc, rated: c.rated, color: c.color });
      return send(ws, { t: 'challenge_sent', id: c.id, to: target.username });
    }
    case 'challenge_accept': {
      needUser();
      const c = challenges.get(m.id); if (!c || c.to !== uid) throw new Error('Challenge expired');
      if (activeGameOf(uid) || activeGameOf(c.from)) throw new Error('A player already has a game in progress');
      challenges.delete(c.id);
      pairUp({ userId: c.from, name: c.fromName }, { userId: uid, name: ws.user.username }, c.tc, c.rated, c.color);
      return;
    }
    case 'challenge_decline': { const c = challenges.get(m.id); if (c && c.to === uid) { challenges.delete(c.id); sendUser(c.from, { t: 'challenge_declined', id: c.id, by: ws.user.username }); } return; }
    case 'invite': {
      needUser();
      const tc = validTc(m.initial, m.inc); if (!tc) throw new Error('Invalid time control');
      if (activeGameOf(uid)) throw new Error('Finish your current game first');
      const me = { id: uid, name: ws.user.username }, open = { id: null, name: 'Waiting for opponent…' };
      const col = ['w', 'b'].includes(m.color) ? m.color : Math.random() < 0.5 ? 'w' : 'b';
      const g = createGame({ white: col === 'w' ? me : open, black: col === 'w' ? open : me, tc, rated: !!m.rated, private: true, status: 'waiting' });
      return send(ws, { t: 'invite_created', id: g.id, code: g.inviteCode });
    }
    case 'join': {
      needUser();
      const code = String(m.code || '');
      const g = [...live.values()].find((x) => x.status === 'waiting' && x.inviteCode === code);
      if (!g) throw new Error('That invite link is invalid or has expired');
      if (g.colorOf(uid) >= 0) return send(ws, { t: 'joined', id: g.id });
      if (activeGameOf(uid)) throw new Error('Finish your current game first');
      const creator = g.white.id || g.black.id;
      if (blocked(uid, creator)) throw new Error('You cannot join this game');
      const me = { id: uid, name: ws.user.username };
      if (g.white.id) g.black = me; else g.white = me;
      q.run('UPDATE games SET white_id=?, black_id=?, white_name=?, black_name=? WHERE id=?', g.white.id, g.black.id, g.white.name, g.black.name, g.id);
      if (g.rated) { q.run('UPDATE games SET white_rating_before=?, black_rating_before=? WHERE id=?', getRating(g.white.id, g.cat).rating, getRating(g.black.id, g.cat).rating, g.id); }
      startGame(g);
      return send(ws, { t: 'joined', id: g.id });
    }
    case 'cancel_invite': { const g = live.get(m.id); if (g && g.status === 'waiting' && g.colorOf(uid) >= 0) { q.run("UPDATE games SET status='aborted', reason='cancelled' WHERE id=?", g.id); live.delete(g.id); } return; }
    case 'get': {
      const g = myGame(ws, m.id);
      if (g.status === 'waiting' && g.colorOf(uid) < 0) throw new Error('This game has not started');
      return send(ws, { t: 'game', game: view(g, uid) });
    }
    case 'watch': {
      const g = myGame(ws, m.id);
      if (g.status === 'waiting') throw new Error('Game has not started');
      if (g.colorOf(uid) < 0) { g.spectators.add(ws); emit(g, { t: 'spectators', id: g.id, n: g.spectators.size }); }
      return send(ws, { t: 'game', game: view(g, uid), spectating: g.colorOf(uid) < 0 });
    }
    case 'unwatch': { const g = live.get(m.id); if (g) { g.spectators.delete(ws); emit(g, { t: 'spectators', id: g.id, n: g.spectators.size }); } return; }
    case 'move': { needUser(); const g = myGame(ws, m.id); playMove(g, uid, m.uci); return; }
    case 'resign': {
      needUser(); const g = myGame(ws, m.id); const c = g.colorOf(uid);
      if (c < 0 || g.status !== 'active') throw new Error('Cannot resign');
      return g.ply < 2 && !g.tournamentId ? finish(g, '*', 'aborted') : finish(g, c ? '1-0' : '0-1', 'resignation');
    }
    case 'abort': { needUser(); const g = myGame(ws, m.id); if (g.colorOf(uid) < 0 || g.status !== 'active' || g.ply >= 2) throw new Error('Can only abort before both players have moved'); if (g.tournamentId) throw new Error('Cannot abort a tournament game'); return finish(g, '*', 'aborted'); }
    case 'draw': { needUser(); return actionDraw(myGame(ws, m.id), uid, m.kind); }
    case 'rematch': { needUser(); return actionRematch(myGame(ws, m.id), uid, m.accept !== false); }
    case 'chat': {
      needUser();
      const g = myGame(ws, m.id);
      const text = cleanChat(vText(m.text, { min: 1, max: 200, field: 'Message' }));
      const ok = chatAllowed(uid, text); if (!ok.ok) throw new Error(ok.reason);
      const c = g.colorOf(uid);
      const msg = { t: 'chat', id: g.id, from: ws.user.username, text, ts: Date.now(), room: c >= 0 ? 'players' : 'spectators' };
      if (c >= 0) {
        q.run('INSERT INTO messages (from_id,game_id,body,ts) VALUES (?,?,?,?)', uid, g.id, text, msg.ts);
        const other = c ? g.white.id : g.black.id;
        send(ws, msg);
        if (other && !blocked(uid, other)) sendUser(other, msg);
        for (const s of g.spectators) send(s, msg);
      } else { if (!g.spectators.has(ws)) throw new Error('Join the game as a spectator first'); for (const s of g.spectators) send(s, msg); }
      return;
    }
    default: throw new Error('Unknown message type');
  }
}

export function liveGames(limit = 30) {
  return [...live.values()].filter((g) => g.status === 'active' && !g.private && g.white.id && g.black.id)
    .map((g) => ({ id: g.id, white: g.white.name, black: g.black.name, wr: ratingOf(g.white.id, g.cat), br: ratingOf(g.black.id, g.cat), tc: g.tc, cat: g.cat, fen: g.chess.fen(), plies: g.ply, spectators: g.spectators.size, rated: g.rated }))
    .sort((a, b) => (b.wr + b.br) - (a.wr + a.br)).slice(0, limit);
}
export function stats() { return { live: [...live.values()].filter((g) => g.status === 'active').length, seeks: seeks.size, waiting: [...live.values()].filter((g) => g.status === 'waiting').length }; }
export { Game, nameOf };
