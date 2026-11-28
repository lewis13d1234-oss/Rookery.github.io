import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { q, tx, db, DB_PATH, ROOT } from './db.js';
import * as S from './security.js';
import { HttpError, bad, vText, vInt } from './security.js';
import * as core from './core.js';
import * as hub from './hub.js';
import * as backup from './backup.js';
import * as G from './games.js';
import * as T from './tournaments.js';
import { Chess, START_FEN } from '../shared/chess.js';
import { mateMoves, longestDefence } from '../shared/engine.js';
import { verifyPuzzle } from '../shared/puzzlegen.js';
import { parsePgnGame } from '../shared/pgn.js';

export const routes = [];
const route = (method, pattern, opts, fn) => { if (typeof opts === 'function') { fn = opts; opts = {}; } const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'); routes.push({ method, re, keys, opts, fn }); };
const startedAt = Date.now();

const avatarUrl = (u) => !u.avatar ? null : u.avatar.startsWith('data:') ? `/api/avatar/${encodeURIComponent(u.username)}?v=${u.avatar.length}` : u.avatar;
// The owner is the account named in ROOKERY_ADMIN_USERNAME. Nobody else (including other admins) can ban, suspend, demote or reset it.
export const isOwner = (u) => { const o = (process.env.ROOKERY_ADMIN_USERNAME || '').trim().toLowerCase(); return !!(u && o && String(u.username).toLowerCase() === o); };
const pub = (u) => ({ id: u.id, username: u.username, avatar: avatarUrl(u), country: u.country, online: hub.isOnline(u.id), role: u.role, owner: isOwner(u) });
const nowMs = () => Date.now();
const userByName = (n) => { const u = q.get('SELECT * FROM users WHERE username=?', String(n || '')); if (!u) throw new HttpError(404, 'User not found'); return u; };
const blockedEither = (a, b) => !!q.get('SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)', a, b, b, a);
const active = (u) => { if (u.status !== 'active') throw new HttpError(403, u.status === 'banned' ? 'Your account is banned' : 'Your account is suspended' + (u.suspended_until ? ' until ' + new Date(u.suspended_until).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '')); };
const audit = (actor, action, target, detail) => q.run('INSERT INTO audit_log (actor_id,action,target,detail,ts) VALUES (?,?,?,?,?)', actor?.id ?? null, action, String(target ?? ''), detail ? String(detail).slice(0, 500) : null, nowMs());

// ---------------------------------------------------------------- mail (no SMTP dependency: outbox file + optional webhook)
export function sendMail(to, subject, text) {
  const dir = path.join(ROOT, 'data', 'outbox'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.txt`), `To: ${to}\nSubject: ${subject}\n\n${text}\n`);
  console.log(`[mail] to=${to} subject="${subject}" -> data/outbox/`);
  if (process.env.ROOKERY_MAIL_WEBHOOK) fetch(process.env.ROOKERY_MAIL_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, subject, text }) }).catch(() => {});
}

function fullUser(u) {
  return { ...pub(u), email: u.email, bio: u.bio, status: u.status, prefs: JSON.parse(u.prefs || '{}'), created_at: u.created_at, ratings: core.ratingsOf(u.id), achievements: q.all('SELECT achievement_id id, ts FROM user_achievements WHERE user_id=?', u.id) };
}

// ---------------------------------------------------------------- config
// Build id = hash of everything the browser loads, so it changes only when the site really changes (not on every restart).
const BUILD = (() => { const h = crypto.createHash('sha1'); const walk = (d) => { for (const n of fs.readdirSync(d).sort()) { const f = path.join(d, n); const st = fs.statSync(f); if (st.isDirectory()) walk(f); else { h.update(f.slice(ROOT.length)); h.update(fs.readFileSync(f)); } } }; try { walk(path.join(ROOT, 'public')); walk(path.join(ROOT, 'shared')); } catch {} return h.digest('hex').slice(0, 12); })();
route('GET', '/api/config', { auth: false }, () => ({ name: 'Rookery', free: true, build: BUILD, mail: process.env.ROOKERY_MAIL_WEBHOOK ? 'webhook' : 'outbox', cats: core.ALL_CATS }));

// ---------------------------------------------------------------- auth
route('GET', '/api/healthz', { auth: false }, () => ({ ok: true, backup: { enabled: backup.status.enabled, lastBackupAt: backup.status.lastBackupAt, error: backup.status.lastError ? 'see server logs' : null } }));
route('POST', '/api/auth/register', { auth: false, rl: ['reg', 5, 3600_000] }, ({ body, ip, ua, setCookie }) => {
  const username = S.vUsername(body.username), password = S.vPassword(body.password), email = S.vEmail(body.email);
  if (q.get('SELECT 1 FROM users WHERE username=?', username)) throw new HttpError(409, 'That username is taken');
  if (email && q.get('SELECT 1 FROM users WHERE email=?', email)) throw new HttpError(409, 'That email is already registered');
  const recovery = [1, 2, 3].map(() => crypto.randomBytes(2).toString('hex')).join('-');
  const now = nowMs();
  // On a public deployment set ROOKERY_ADMIN_USERNAME so only that username can become admin (otherwise the first account does).
  const adminName = (process.env.ROOKERY_ADMIN_USERNAME || '').trim().toLowerCase();
  const first = adminName ? username.toLowerCase() === adminName : q.get('SELECT COUNT(*) n FROM users').n === 0;
  const r = q.run('INSERT INTO users (username,email,pass_hash,recovery_hash,role,created_at,last_seen) VALUES (?,?,?,?,?,?,?)', username, email, S.hashPassword(password), S.hashPassword(recovery), first ? 'admin' : 'user', now, now);
  const id = Number(r.lastInsertRowid); core.ensureRatings(id);
  setCookie(S.createSession(id, ip, ua));
  return { user: fullUser(q.get('SELECT * FROM users WHERE id=?', id)), recoveryCode: recovery, firstUserIsAdmin: first };
});
route('POST', '/api/auth/login', { auth: false, rl: ['login', 20, 600_000] }, ({ body, ip, ua, setCookie }) => {
  const name = String(body.username || '');
  const u = q.get('SELECT * FROM users WHERE username=? OR email=?', name, name.toLowerCase());
  if (u?.locked_until > nowMs()) throw new HttpError(429, 'Too many failed attempts — account locked for a few minutes');
  const ok = S.verifyPassword(String(body.password || ''), u ? u.pass_hash : S.DUMMY_HASH);
  if (!u || !ok) {
    if (u) { const f = u.failed_logins + 1; q.run('UPDATE users SET failed_logins=?, locked_until=? WHERE id=?', f >= 8 ? 0 : f, f >= 8 ? nowMs() + 5 * 60_000 : null, u.id); }
    throw new HttpError(401, 'Incorrect username or password');
  }
  if (u.status === 'banned') throw new HttpError(403, 'This account has been banned' + (u.status_reason ? ': ' + u.status_reason : ''));
  q.run('UPDATE users SET failed_logins=0, locked_until=NULL, last_seen=? WHERE id=?', nowMs(), u.id);
  setCookie(S.createSession(u.id, ip, ua));
  return { user: fullUser(S.checkStanding(u)) };
});
route('POST', '/api/auth/logout', { auth: false }, ({ token, setCookie }) => { S.destroySession(token); setCookie(''); return { ok: true }; });
route('POST', '/api/auth/forgot', { auth: false, rl: ['forgot', 5, 3600_000] }, ({ body, origin }) => {
  const id = String(body.identifier || '').trim();
  const u = id ? q.get('SELECT * FROM users WHERE username=? OR email=?', id, id.toLowerCase()) : null;
  if (u?.email) {
    const tok = S.randToken(24);
    q.run('INSERT INTO reset_tokens (token_hash,user_id,expires_at) VALUES (?,?,?)', S.sha256(tok), u.id, nowMs() + 3600_000);
    sendMail(u.email, 'Reset your Rookery password', `Use this link within one hour:\n${origin}/#/reset/${tok}\n\nIf you did not ask for this, ignore this message.`);
  }
  return { ok: true, message: 'If that account has an email address, a reset link has been sent. You can also reset with your recovery code.' };
});
route('POST', '/api/auth/reset', { auth: false, rl: ['reset', 10, 3600_000] }, ({ body }) => {
  const pw = S.vPassword(body.password);
  let uid = null;
  if (body.token) {
    const r = q.get('SELECT * FROM reset_tokens WHERE token_hash=? AND used=0 AND expires_at>?', S.sha256(String(body.token)), nowMs());
    if (!r) throw bad('This reset link is invalid or has expired');
    q.run('UPDATE reset_tokens SET used=1 WHERE token_hash=?', r.token_hash); uid = r.user_id;
  } else {
    const u = q.get('SELECT * FROM users WHERE username=?', String(body.username || ''));
    const ok = S.verifyPassword(String(body.recoveryCode || '').toLowerCase().trim(), u?.recovery_hash || S.DUMMY_HASH);
    if (!u || !ok) throw bad('Username or recovery code is incorrect');
    uid = u.id;
  }
  q.run('UPDATE users SET pass_hash=?, failed_logins=0, locked_until=NULL WHERE id=?', S.hashPassword(pw), uid);
  q.run('DELETE FROM sessions WHERE user_id=?', uid);
  return { ok: true };
});

// ---------------------------------------------------------------- me
route('GET', '/api/me', { auth: false }, ({ user }) => ({ user: user ? fullUser(user) : null }));
route('PUT', '/api/me', { auth: 'user', maxBody: 400_000 }, ({ user, body }) => {
  const bio = body.bio != null ? vText(body.bio, { max: 300, field: 'Bio' }) : user.bio;
  const country = body.country != null ? vText(String(body.country), { max: 2, field: 'Country' }).toUpperCase() : user.country;
  let avatar = user.avatar;
  if (body.avatar === null) avatar = null;
  else if (typeof body.avatar === 'string') {
    if (/^preset:[a-z0-9-]{1,20}$/.test(body.avatar)) avatar = body.avatar;
    else {
      const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.avatar);
      if (!m) throw bad('Avatar must be a PNG, JPEG or WebP image');
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 150_000) throw bad('Avatar must be under 150 KB');
      const magic = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] }[m[1]];
      if (!magic.every((b, i) => buf[i] === b)) throw bad('Image data does not match its type');
      avatar = body.avatar;
    }
  }
  let prefs = JSON.parse(user.prefs || '{}');
  if (body.prefs && typeof body.prefs === 'object') { const s = JSON.stringify(body.prefs); if (s.length > 4000) throw bad('Preferences too large'); prefs = body.prefs; }
  q.run('UPDATE users SET bio=?, country=?, avatar=?, prefs=? WHERE id=?', bio, country, avatar, JSON.stringify(prefs), user.id);
  return { user: fullUser(q.get('SELECT * FROM users WHERE id=?', user.id)) };
});
route('PUT', '/api/me/password', { auth: 'user', rl: ['pw', 10, 3600_000] }, ({ user, body, token, setCookie }) => {
  if (!S.verifyPassword(String(body.current || ''), user.pass_hash)) throw bad('Current password is incorrect');
  q.run('UPDATE users SET pass_hash=? WHERE id=?', S.hashPassword(S.vPassword(body.password)), user.id);
  q.run('DELETE FROM sessions WHERE user_id=? AND token_hash != ?', user.id, S.sha256(token));
  return { ok: true };
});
route('GET', '/api/avatar/:name', { auth: false }, ({ params, res }) => {
  const u = q.get('SELECT avatar FROM users WHERE username=?', params.name);
  const m = u?.avatar && /^data:(image\/[a-z]+);base64,(.+)$/.exec(u.avatar);
  if (!m) throw new HttpError(404, 'No avatar');
  return { __raw: Buffer.from(m[2], 'base64'), type: m[1], cache: 'public, max-age=3600' };
});

// ---------------------------------------------------------------- users & profiles
route('GET', '/api/users/search', { auth: false, rl: ['search', 60, 60_000] }, ({ query }) => {
  const t = String(query.q || '').replace(/[%_\\]/g, '').slice(0, 20); if (t.length < 2) return { users: [] };
  return { users: q.all("SELECT * FROM users WHERE username LIKE ? AND status != 'banned' ORDER BY username LIMIT 20", t + '%').map((u) => ({ ...pub(u), rating: Math.round(core.getRating(u.id, 'blitz').rating) })) };
});
route('GET', '/api/users/:name', { auth: false }, ({ params, user }) => {
  const u = userByName(params.name);
  let rel = null;
  if (user && user.id !== u.id) {
    const f = q.get('SELECT * FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)', user.id, u.id, u.id, user.id);
    rel = { friend: f?.status === 'accepted', pendingOut: f?.status === 'pending' && f.user_id === user.id, pendingIn: f?.status === 'pending' && f.friend_id === user.id, blocked: !!q.get('SELECT 1 FROM blocks WHERE user_id=? AND blocked_id=?', user.id, u.id) };
  }
  const recent = q.all("SELECT id,white_name,black_name,result,reason,category,rated,tc_initial,tc_inc,created_at,white_id,black_id,ai_level FROM games WHERE (white_id=? OR black_id=?) AND status='finished' ORDER BY created_at DESC LIMIT 20", u.id, u.id);
  const hist = q.all("SELECT category, rating, ts FROM rating_history WHERE user_id=? ORDER BY ts DESC LIMIT 200", u.id).reverse();
  const friends = q.all("SELECT u.* FROM friends f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? AND f.status='accepted' LIMIT 50", u.id).map(pub);
  const pz = q.get('SELECT COUNT(*) attempts, SUM(solved) solved FROM puzzle_attempts WHERE user_id=?', u.id);
  return {
    user: { ...pub(u), bio: u.bio, created_at: u.created_at, last_seen: u.last_seen, status: u.status }, rel, ratings: core.ratingsOf(u.id), recent, ratingHistory: hist, friends,
    achievements: q.all('SELECT a.*, ua.ts FROM user_achievements ua JOIN achievements a ON a.id=ua.achievement_id WHERE ua.user_id=? ORDER BY ua.ts', u.id),
    puzzles: { attempts: pz.attempts, solved: pz.solved || 0 }, tournaments: q.all("SELECT t.id,t.name,t.kind,tp.score FROM tournament_players tp JOIN tournaments t ON t.id=tp.tournament_id WHERE tp.user_id=? AND t.private=0 ORDER BY t.start_ts DESC LIMIT 10", u.id),
    clubs: q.all('SELECT c.id,c.name FROM club_members m JOIN clubs c ON c.id=m.club_id WHERE m.user_id=? AND c.private=0', u.id),
  };
});
route('GET', '/api/achievements', { auth: false }, ({ user }) => ({ achievements: q.all('SELECT * FROM achievements'), mine: user ? q.all('SELECT achievement_id id, ts FROM user_achievements WHERE user_id=?', user.id) : [] }));

// ---------------------------------------------------------------- games
route('GET', '/api/games/live', { auth: false }, () => ({ games: G.liveGames(30) }));
route('GET', '/api/games/mine/active', { auth: 'user' }, ({ user }) => ({ games: G.activeGamesOf(user.id).map((g) => ({ id: g.id, white: g.white.name, black: g.black.name })) }));
route('GET', '/api/games/:id', { auth: false }, ({ params, user }) => {
  const g = G.live.get(params.id) || G.restoreOne(params.id);
  if (!g) throw new HttpError(404, 'Game not found');
  if (g.status === 'waiting' && g.colorOf(user?.id) < 0) throw new HttpError(404, 'Game not found');
  const v = G.view(g, user?.id); const row = q.get('SELECT created_at, ai_level FROM games WHERE id=?', g.id);
  return { game: { ...v, createdAt: row.created_at } };
});
route('GET', '/api/games/:id/pgn', { auth: false }, ({ params }) => {
  const r = q.get('SELECT * FROM games WHERE id=?', params.id); if (!r) throw new HttpError(404, 'Game not found');
  return { __raw: Buffer.from(gamePgn(r)), type: 'application/x-chess-pgn; charset=utf-8', cache: 'no-cache', filename: `rookery-${r.id}.pgn` };
});
import { toPgn } from '../shared/pgn.js';
function gamePgn(r) {
  const res = r.result || '*';
  return toPgn({ headers: { Event: `Rookery ${r.rated ? 'rated' : 'casual'} ${r.category}`, Site: 'Rookery', Date: new Date(r.created_at).toISOString().slice(0, 10).replace(/-/g, '.'), White: r.white_name, Black: r.black_name, TimeControl: `${r.tc_initial}+${r.tc_inc}`, Termination: r.reason || '', ...(r.white_rating_before ? { WhiteElo: Math.round(r.white_rating_before), BlackElo: Math.round(r.black_rating_before) } : {}) }, moves: JSON.parse(r.moves), result: res, fen: r.start_fen });
}
route('GET', '/api/users/:name/games', { auth: false }, ({ params, query }) => {
  const u = userByName(params.name);
  const lim = Math.min(50, Number(query.limit) || 20), off = Math.max(0, Number(query.offset) || 0);
  const rows = q.all("SELECT id,white_name,black_name,white_id,black_id,result,reason,category,rated,tc_initial,tc_inc,created_at,ai_level,white_rating_before,black_rating_before FROM games WHERE (white_id=? OR black_id=?) AND status='finished' ORDER BY created_at DESC LIMIT ? OFFSET ?", u.id, u.id, lim, off);
  return { games: rows };
});
// Save a finished game vs the computer (client-played, so always unrated; replayed through the rules engine to validate)
route('POST', '/api/games/computer', { auth: 'user', rl: ['aigame', 60, 3600_000] }, ({ user, body }) => {
  active(user);
  const sans = Array.isArray(body.moves) ? body.moves.slice(0, 600).map(String) : null; if (!sans?.length) throw bad('No moves');
  const startFen = typeof body.fen === 'string' ? body.fen : START_FEN;
  let c; try { c = Chess.replay(sans, startFen); } catch { throw bad('Game contains an illegal move'); }
  const level = vInt(body.level, { min: 1, max: 6, field: 'Level' }); const color = body.color === 'b' ? 'b' : 'w';
  const st = c.status(); let result = ['1-0', '0-1', '1/2-1/2'].includes(body.result) ? body.result : '*'; let reason = String(body.reason || '').slice(0, 30);
  if (st.over) { result = st.result; reason = st.reason; } else if (result === '1-0' || result === '0-1') { if (!['resignation', 'timeout'].includes(reason)) throw bad('Result does not match the position'); const loser = result === '1-0' ? 'b' : 'w'; if (loser !== color) throw bad('Only the human player can resign or lose on time'); }
  const tcI = Math.max(0, Math.min(10800, Number(body.initial) || 0)), tcInc = Math.max(0, Math.min(180, Number(body.inc) || 0));
  const id = crypto.randomBytes(6).toString('base64url'); const lvl = ['', 'Beginner', 'Easy', 'Intermediate', 'Advanced', 'Expert', 'Maximum'][level];
  const human = user.username, cpu = `Computer (${lvl})`;
  q.run(`INSERT INTO games (id,white_id,black_id,white_name,black_name,ai_level,category,tc_initial,tc_inc,rated,status,result,reason,fen,start_fen,moves,clocks,created_at,ended_at) VALUES (?,?,?,?,?,?,?,?,?,0,'finished',?,?,?,?,?,?,?,?)`,
    id, color === 'w' ? user.id : null, color === 'b' ? user.id : null, color === 'w' ? human : cpu, color === 'w' ? cpu : human, level, core.categoryFor(tcI || 900, tcInc), tcI, tcInc, result, reason, c.fen(), startFen, JSON.stringify(c.history()), '[0,0]', nowMs(), nowMs());
  tx(() => { c.history().forEach((san, i) => q.run('INSERT INTO moves (game_id,ply,san,uci,fen_after) VALUES (?,?,?,?,?)', id, i + 1, san, '', '')); });
  const won = result === (color === 'w' ? '1-0' : '0-1');
  core.checkGameAchievements(user.id, { won, plies: c.ply, mate: reason === 'checkmate', vsAiLevel: level });
  return { id };
});

// ---------------------------------------------------------------- opening stats from games played on the platform
route('GET', '/api/openings/stats', { auth: false, rl: ['ostats', 120, 60_000] }, ({ query }) => {
  const prefix = String(query.moves || '').split(',').filter(Boolean).slice(0, 30);
  const like = '[' + prefix.map((m) => JSON.stringify(m)).join(',');
  const esc = like.replace(/[\\%_]/g, '\\$&') + (prefix.length ? ',%' : '%');
  const rows = q.all("SELECT moves, result FROM games WHERE status='finished' AND result IN ('1-0','0-1','1/2-1/2') AND start_fen=? AND moves LIKE ? ESCAPE '\\' LIMIT 20000", START_FEN, esc);
  const total = { w: 0, d: 0, b: 0, n: 0 }, next = {};
  for (const r of rows) {
    let mv; try { mv = JSON.parse(r.moves); } catch { continue; }
    if (mv.length <= prefix.length) continue;
    const k = r.result === '1-0' ? 'w' : r.result === '0-1' ? 'b' : 'd';
    total[k]++; total.n++;
    const s = mv[prefix.length]; next[s] = next[s] || { san: s, w: 0, d: 0, b: 0, n: 0 }; next[s][k]++; next[s].n++;
  }
  return { total, next: Object.values(next).sort((a, b) => b.n - a.n).slice(0, 12), source: 'Rookery games' };
});
route('GET', '/api/repertoires', { auth: 'user' }, ({ user }) => ({ repertoires: q.all('SELECT * FROM repertoires WHERE user_id=? ORDER BY updated_at DESC', user.id).map((r) => ({ ...r, lines: JSON.parse(r.lines) })) }));
route('POST', '/api/repertoires', { auth: 'user' }, ({ user, body }) => {
  const name = vText(body.name, { min: 1, max: 60, field: 'Name' }); const color = body.color === 'b' ? 'b' : 'w';
  const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 200).map((l) => { const mv = (Array.isArray(l) ? l : []).slice(0, 80).map(String); try { Chess.replay(mv); } catch { throw bad('A repertoire line contains an illegal move'); } return mv; });
  if (body.id) { const r = q.run('UPDATE repertoires SET name=?, color=?, lines=?, updated_at=? WHERE id=? AND user_id=?', name, color, JSON.stringify(lines), nowMs(), body.id, user.id); if (!Number(r.changes)) throw new HttpError(404, 'Not found'); return { id: body.id }; }
  if (q.get('SELECT COUNT(*) n FROM repertoires WHERE user_id=?', user.id).n >= 50) throw bad('Repertoire limit reached (50)');
  return { id: Number(q.run('INSERT INTO repertoires (user_id,name,color,lines,updated_at) VALUES (?,?,?,?,?)', user.id, name, color, JSON.stringify(lines), nowMs()).lastInsertRowid) };
});
route('DELETE', '/api/repertoires/:id', { auth: 'user' }, ({ user, params }) => { q.run('DELETE FROM repertoires WHERE id=? AND user_id=?', params.id, user.id); return { ok: true }; });

// ---------------------------------------------------------------- puzzles (solutions are verified on the server)
const attempts = new Map(); // attemptId -> state
const runs = new Map();     // runId -> state
const streaks = new Map();  // userId -> current streak
setInterval(() => { const cut = nowMs() - 3600_000; for (const [k, a] of attempts) if (a.t < cut) attempts.delete(k); for (const [k, r] of runs) if (r.t < cut) runs.delete(k); }, 600_000).unref();
const pzPublic = (p) => ({ id: p.id, fen: p.fen, kind: p.kind, themes: JSON.parse(p.themes), rating: Math.round(p.rating), mate: p.mate, turn: p.fen.split(' ')[1] });

function pickPuzzle(user, kind, target, exclude = []) {
  const kinds = { mate: ['mate'], tactic: ['tactic'], endgame: ['endgame'], opening: ['opening'] }[kind];
  let where = 'enabled=1'; const args = [];
  if (kinds) { where += ' AND kind=?'; args.push(kinds[0]); }
  const doneIds = user ? q.all('SELECT DISTINCT puzzle_id FROM puzzle_attempts WHERE user_id=? ORDER BY id DESC LIMIT 400', user.id).map((r) => r.puzzle_id) : [];
  const skip = [...new Set([...doneIds, ...exclude])];
  const pool = (useSkip) => q.all(`SELECT * FROM puzzles WHERE ${where}${useSkip && skip.length ? ` AND id NOT IN (${skip.map(() => '?').join(',')})` : ''} ORDER BY ABS(rating-?) LIMIT 8`, ...args, ...(useSkip ? skip : []), target);
  let c = pool(true); if (!c.length) c = pool(false);
  return c.length ? c[Math.floor(Math.random() * Math.min(c.length, 4))] : null;
}
function newAttempt(user, p, mode, runId) {
  const id = crypto.randomBytes(8).toString('base64url');
  attempts.set(id, { id, p, uid: user?.id || null, pos: new Chess(p.fen), step: 0, solverMoves: 0, hinted: false, done: false, mode, runId: runId || null, t: nowMs(), startedAt: nowMs(), solution: JSON.parse(p.solution), alts: JSON.parse(p.solutions) });
  return id;
}
route('GET', '/api/puzzles/next', { auth: false, rl: ['pznext', 200, 60_000] }, ({ user, query }) => {
  const mode = ['rated', 'rush', 'survival', 'streak', 'practice'].includes(query.mode) ? query.mode : 'rated';
  let run = null, target = user ? core.getRating(user.id, 'puzzle').rating : 1200;
  if (query.run) { run = runs.get(query.run); if (!run || (user?.id ?? null) !== run.uid) throw bad('Unknown run'); if (run.over) throw bad('Run is over'); target = run.mode === 'rush' ? 700 + run.score * 70 : 800 + run.score * 90; }
  const p = pickPuzzle(user, query.kind, target, run ? run.seen : []);
  if (!p) throw new HttpError(404, 'No puzzles available');
  if (run) run.seen.push(p.id);
  return { puzzle: pzPublic(p), attempt: newAttempt(user, p, run ? run.mode : mode, run?.id) };
});
route('GET', '/api/puzzles/daily', { auth: false }, ({ user }) => {
  const day = new Date().toISOString().slice(0, 10);
  const all = q.all("SELECT * FROM puzzles WHERE enabled=1 AND kind IN ('tactic','mate','endgame') ORDER BY id");
  const h = crypto.createHash('sha256').update('rookery-daily-' + day).digest().readUInt32BE(0);
  const p = all[h % all.length];
  const solvedToday = user ? !!q.get("SELECT 1 FROM puzzle_attempts WHERE user_id=? AND puzzle_id=? AND mode='daily' AND solved=1 AND ts>?", user.id, p.id, Date.parse(day)) : false;
  return { puzzle: pzPublic(p), attempt: newAttempt(user, p, 'daily'), day, solvedToday };
});
route('POST', '/api/puzzles/attempt/:id/hint', { auth: false }, ({ params }) => {
  const a = attempts.get(params.id); if (!a || a.done) throw bad('Attempt not found');
  a.hinted = true;
  const exp = a.p.mate ? mateMoves(a.pos, a.p.mate - a.solverMoves, a.p.mate > 2 ? { checksOnlyAfterFirst: true } : {})[0] : (a.step === 0 ? a.alts[0] : a.solution[a.step]);
  return { from: exp.slice(0, 2) };
});
route('POST', '/api/puzzles/attempt/:id/move', { auth: false, rl: ['pzmove', 300, 60_000] }, ({ params, body, user }) => {
  const a = attempts.get(params.id); if (!a || a.done) throw bad('Attempt not found or already finished');
  if (a.uid !== (user?.id ?? null)) throw new HttpError(403, 'Not your attempt');
  const uci = String(body.uci || ''); if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw bad('Bad move');
  const { p, pos } = a; let ok;
  if (p.mate) ok = mateMoves(pos, p.mate - a.solverMoves, p.mate > 2 ? { checksOnlyAfterFirst: a.solverMoves >= 0 } : {}).includes(uci);
  else ok = (a.step === 0 ? a.alts : [a.solution[a.step]]).includes(uci);
  if (!pos.move(uci)) throw bad('Illegal move');
  const out = { correct: !!ok };
  if (ok) {
    a.solverMoves++;
    if (p.mate) {
      if (pos.isCheckmate()) a.done = true;
      else { const r = longestDefence(pos, p.mate - a.solverMoves); out.reply = r; pos.move(r); }
    } else {
      // when the solver took an alternative first move the stored continuation no longer applies
      if (a.step === 0 && uci !== a.solution[0]) a.done = true;
      else if (a.step + 1 >= a.solution.length) a.done = true;
      else { out.reply = a.solution[a.step + 1]; pos.move(out.reply); a.step += 2; if (a.step >= a.solution.length) a.done = true; }
    }
    if (a.done) finishAttempt(a, true, out, user);
  } else { a.done = true; finishAttempt(a, false, out, user); out.solution = a.p.mate ? mateMoves(new Chess(p.fen), p.mate, p.mate > 2 ? { checksOnlyAfterFirst: true } : {})[0] : a.solution[0]; }
  return out;
});
function finishAttempt(a, solved, out, user) {
  const p = q.get('SELECT * FROM puzzles WHERE id=?', a.p.id);
  out.solved = solved; out.explanation = p.explanation; out.puzzleRating = Math.round(p.rating);
  if (!user) return;
  const counted = !a.hinted && ['rated', 'daily', 'rush', 'survival', 'streak'].includes(a.mode);
  let rc = null;
  if (counted && a.mode !== 'rush') rc = core.ratePuzzle(user.id, p, solved);
  q.run('INSERT INTO puzzle_attempts (user_id,puzzle_id,mode,solved,rating_before,rating_after,ms,ts) VALUES (?,?,?,?,?,?,?,?)', user.id, p.id, a.mode, solved ? 1 : 0, rc?.before ?? null, rc?.after ?? null, nowMs() - a.startedAt, nowMs());
  if (rc) out.ratingChange = { before: Math.round(rc.before), after: Math.round(rc.after) };
  if (solved) core.checkPuzzleAchievements(user.id);
  if (a.mode === 'streak' || a.mode === 'rated') {
    const s = solved && !a.hinted ? (streaks.get(user.id) || 0) + 1 : 0; streaks.set(user.id, s); out.streak = s;
    if (s >= 10) core.award(user.id, 'puzzle-streak-10');
    if (!solved) { const prev = a._streakBefore; }
  }
  if (a.runId) {
    const run = runs.get(a.runId);
    if (run) { if (solved) run.score++; else run.strikes++; const lim = run.mode === 'rush' ? 3 : 3; if (run.strikes >= lim || (run.mode === 'rush' && nowMs() - run.t0 > run.limitMs + 2000)) endRun(run); out.run = { score: run.score, strikes: run.strikes, over: run.over, best: run.best }; }
  }
}
function endRun(run) {
  if (run.over) return; run.over = true;
  if (run.uid) { const prev = q.get('SELECT MAX(score) m FROM puzzle_runs WHERE user_id=? AND mode=?', run.uid, run.mode).m || 0; run.best = Math.max(prev, run.score); q.run('INSERT INTO puzzle_runs (user_id,mode,score,ts) VALUES (?,?,?,?)', run.uid, run.mode, run.score, nowMs()); if (run.mode === 'rush' && run.score >= 20) core.award(run.uid, 'rush-20'); }
}
route('POST', '/api/puzzles/run/start', { auth: false }, ({ user, body }) => {
  const mode = body.mode === 'survival' ? 'survival' : 'rush';
  const run = { id: crypto.randomBytes(6).toString('base64url'), uid: user?.id ?? null, mode, score: 0, strikes: 0, seen: [], t: nowMs(), t0: nowMs(), limitMs: mode === 'rush' ? 180_000 : 0, over: false, best: 0 };
  runs.set(run.id, run);
  return { run: run.id, mode, limitMs: run.limitMs, strikesAllowed: 3, best: user ? q.get('SELECT MAX(score) m FROM puzzle_runs WHERE user_id=? AND mode=?', user.id, mode).m || 0 : 0 };
});
route('POST', '/api/puzzles/run/:id/end', { auth: false }, ({ params, user }) => {
  const run = runs.get(params.id); if (!run || run.uid !== (user?.id ?? null)) throw bad('Unknown run');
  endRun(run); return { score: run.score, best: run.best, strikes: run.strikes };
});
route('GET', '/api/puzzles/stats', { auth: 'user' }, ({ user }) => {
  const a = q.get('SELECT COUNT(*) n, SUM(solved) s, AVG(ms) ms FROM puzzle_attempts WHERE user_id=?', user.id);
  const byKind = q.all('SELECT p.kind, COUNT(*) n, SUM(a.solved) s FROM puzzle_attempts a JOIN puzzles p ON p.id=a.puzzle_id WHERE a.user_id=? GROUP BY p.kind', user.id);
  const hist = q.all("SELECT rating, ts FROM rating_history WHERE user_id=? AND category='puzzle' ORDER BY ts DESC LIMIT 100", user.id).reverse();
  const best = q.all('SELECT mode, MAX(score) best, COUNT(*) runs FROM puzzle_runs WHERE user_id=? GROUP BY mode', user.id);
  const recent = q.all('SELECT puzzle_id, mode, solved, ts FROM puzzle_attempts WHERE user_id=? ORDER BY id DESC LIMIT 20', user.id);
  return { rating: Math.round(core.getRating(user.id, 'puzzle').rating), attempts: a.n, solved: a.s || 0, avgMs: Math.round(a.ms || 0), byKind, history: hist, best, recent, streak: streaks.get(user.id) || 0, totalPuzzles: q.get('SELECT COUNT(*) n FROM puzzles WHERE enabled=1').n };
});

// ---------------------------------------------------------------- lessons
route('GET', '/api/lessons', { auth: false }, ({ user }) => {
  const prog = user ? new Map(q.all('SELECT * FROM lesson_progress WHERE user_id=?', user.id).map((r) => [r.lesson_id, r])) : new Map();
  return { lessons: q.all('SELECT id,level,category,title,summary,minutes,steps FROM lessons WHERE published=1 ORDER BY sort').map((l) => ({ ...l, steps: JSON.parse(l.steps).length, completed: !!prog.get(l.id)?.completed, step: prog.get(l.id)?.step || 0 })) };
});
route('GET', '/api/lessons/:id', { auth: false }, ({ params, user }) => {
  const l = q.get('SELECT * FROM lessons WHERE id=? AND published=1', params.id); if (!l) throw new HttpError(404, 'Lesson not found');
  const pr = user ? q.get('SELECT * FROM lesson_progress WHERE user_id=? AND lesson_id=?', user.id, l.id) : null;
  return { lesson: { ...l, steps: JSON.parse(l.steps) }, progress: pr || null };
});
route('POST', '/api/lessons/:id/progress', { auth: 'user' }, ({ params, body, user }) => {
  const l = q.get('SELECT * FROM lessons WHERE id=?', params.id); if (!l) throw new HttpError(404, 'Lesson not found');
  const n = JSON.parse(l.steps).length; const step = vInt(body.step, { min: 0, max: n, field: 'Step' }); const done = body.completed && step >= n - 1 ? 1 : 0;
  q.run('INSERT INTO lesson_progress (user_id,lesson_id,step,completed,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id,lesson_id) DO UPDATE SET step=MAX(step,excluded.step), completed=MAX(completed,excluded.completed), updated_at=excluded.updated_at', user.id, l.id, step, done, nowMs());
  if (done) { core.award(user.id, 'lesson-1'); const left = q.get("SELECT COUNT(*) n FROM lessons l WHERE level='beginner' AND published=1 AND NOT EXISTS (SELECT 1 FROM lesson_progress p WHERE p.lesson_id=l.id AND p.user_id=? AND p.completed=1)", user.id).n; if (!left) core.award(user.id, 'lesson-all-beginner'); }
  return { ok: true };
});

// ---------------------------------------------------------------- leaderboards
route('GET', '/api/leaderboard', { auth: false }, ({ query, user }) => {
  const cat = core.ALL_CATS.includes(query.cat) ? query.cat : 'blitz';
  const period = ['all', 'day', 'week', 'month'].includes(query.period) ? query.period : 'all';
  const scope = query.scope === 'friends' && user ? 'friends' : 'global';
  const since = nowMs() - { day: 864e5, week: 7 * 864e5, month: 30 * 864e5 }[period];
  const fr = scope === 'friends' ? `AND (u.id=${Number(user.id)} OR u.id IN (SELECT friend_id FROM friends WHERE user_id=${Number(user.id)} AND status='accepted'))` : '';
  let rows;
  if (period === 'all') rows = q.all(`SELECT u.id,u.username,u.avatar,u.country,r.rating,r.rd,r.games,r.wins,r.losses,r.draws FROM ratings r JOIN users u ON u.id=r.user_id WHERE r.category=? AND r.games>0 AND u.status!='banned' ${fr} ORDER BY r.rating DESC LIMIT 100`, cat);
  else rows = q.all(`SELECT u.id,u.username,u.avatar,u.country,r.rating,r.rd,r.games,r.wins,r.losses,r.draws, SUM(h.delta) gain, COUNT(*) played FROM rating_history h JOIN users u ON u.id=h.user_id JOIN ratings r ON r.user_id=u.id AND r.category=h.category WHERE h.category=? AND h.ts>? AND u.status!='banned' ${fr} GROUP BY u.id ORDER BY gain DESC LIMIT 100`, cat, since);
  return { cat, period, scope, rows: rows.map((r, i) => ({ rank: i + 1, id: r.id, username: r.username, avatar: avatarUrl(r), country: r.country, rating: Math.round(r.rating), provisional: r.rd > 110, games: r.games, wins: r.wins, losses: r.losses, draws: r.draws, gain: r.gain != null ? Math.round(r.gain) : undefined, played: r.played, online: hub.isOnline(r.id) })) };
});

// ---------------------------------------------------------------- friends / blocks / messages / reports
route('GET', '/api/friends', { auth: 'user' }, ({ user }) => {
  const rows = q.all('SELECT u.*, f.status, f.user_id requester FROM friends f JOIN users u ON u.id = CASE WHEN f.user_id=? THEN f.friend_id ELSE f.user_id END WHERE f.user_id=? OR f.friend_id=?', user.id, user.id, user.id);
  const unread = new Map(q.all('SELECT from_id, COUNT(*) n FROM messages WHERE to_id=? AND read=0 GROUP BY from_id', user.id).map((r) => [r.from_id, r.n]));
  return {
    friends: rows.filter((r) => r.status === 'accepted').map((r) => ({ ...pub(r), blitz: Math.round(core.getRating(r.id, 'blitz').rating), unread: unread.get(r.id) || 0, lastSeen: r.last_seen })),
    incoming: rows.filter((r) => r.status === 'pending' && r.requester !== user.id).map(pub), outgoing: rows.filter((r) => r.status === 'pending' && r.requester === user.id).map(pub),
    blocked: q.all('SELECT u.* FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=?', user.id).map(pub),
  };
});
route('POST', '/api/friends/request', { auth: 'user', rl: ['freq', 30, 3600_000] }, ({ user, body }) => {
  active(user); const o = userByName(body.username);
  if (o.id === user.id) throw bad('You cannot friend yourself'); if (blockedEither(user.id, o.id)) throw bad('Unable to send request to this user');
  const ex = q.get('SELECT * FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)', user.id, o.id, o.id, user.id);
  if (ex?.status === 'accepted') throw bad('Already friends');
  if (ex && ex.user_id === o.id) { q.run("UPDATE friends SET status='accepted' WHERE user_id=? AND friend_id=?", o.id, user.id); core.award(user.id, 'first-friend'); core.award(o.id, 'first-friend'); return { status: 'accepted' }; }
  if (!ex) q.run("INSERT INTO friends (user_id,friend_id,status,created_at) VALUES (?,?,'pending',?)", user.id, o.id, nowMs());
  hub.sendUser(o.id, { t: 'friend_request', from: user.username });
  return { status: 'pending' };
});
route('POST', '/api/friends/accept', { auth: 'user' }, ({ user, body }) => {
  const o = userByName(body.username);
  const r = q.run("UPDATE friends SET status='accepted' WHERE user_id=? AND friend_id=? AND status='pending'", o.id, user.id);
  if (!Number(r.changes)) throw bad('No pending request from that user');
  core.award(user.id, 'first-friend'); core.award(o.id, 'first-friend'); hub.sendUser(o.id, { t: 'notice', text: `${user.username} accepted your friend request` });
  return { ok: true };
});
route('DELETE', '/api/friends/:name', { auth: 'user' }, ({ user, params }) => { const o = userByName(params.name); q.run('DELETE FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)', user.id, o.id, o.id, user.id); return { ok: true }; });
route('POST', '/api/blocks', { auth: 'user' }, ({ user, body }) => { const o = userByName(body.username); if (o.id === user.id) throw bad('You cannot block yourself'); q.run('INSERT OR IGNORE INTO blocks (user_id,blocked_id,created_at) VALUES (?,?,?)', user.id, o.id, nowMs()); q.run('DELETE FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)', user.id, o.id, o.id, user.id); return { ok: true }; });
route('DELETE', '/api/blocks/:name', { auth: 'user' }, ({ user, params }) => { q.run('DELETE FROM blocks WHERE user_id=? AND blocked_id=?', user.id, userByName(params.name).id); return { ok: true }; });
route('GET', '/api/messages/threads', { auth: 'user' }, ({ user }) => {
  const rows = q.all(`SELECT u.*, m.body, m.ts, m.from_id, (SELECT COUNT(*) FROM messages x WHERE x.to_id=? AND x.from_id=u.id AND x.read=0) unread FROM messages m JOIN users u ON u.id = CASE WHEN m.from_id=? THEN m.to_id ELSE m.from_id END WHERE m.id IN (SELECT MAX(id) FROM messages WHERE club_id IS NULL AND game_id IS NULL AND (from_id=? OR to_id=?) GROUP BY CASE WHEN from_id=? THEN to_id ELSE from_id END) ORDER BY m.ts DESC`, user.id, user.id, user.id, user.id, user.id);
  return { threads: rows.map((r) => ({ user: pub(r), last: r.body, ts: r.ts, mine: r.from_id === user.id, unread: r.unread })) };
});
route('GET', '/api/messages/with/:name', { auth: 'user' }, ({ user, params }) => {
  const o = userByName(params.name);
  const rows = q.all('SELECT id,from_id,body,ts FROM messages WHERE club_id IS NULL AND game_id IS NULL AND ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?)) ORDER BY id DESC LIMIT 100', user.id, o.id, o.id, user.id).reverse();
  q.run('UPDATE messages SET read=1 WHERE to_id=? AND from_id=?', user.id, o.id);
  return { user: pub(o), messages: rows.map((m) => ({ id: m.id, mine: m.from_id === user.id, body: m.body, ts: m.ts })) };
});
route('POST', '/api/messages', { auth: 'user', rl: ['dm', 40, 60_000] }, ({ user, body }) => {
  active(user); const o = userByName(body.to); const text = S.cleanChat(vText(body.body, { min: 1, max: 500, field: 'Message' }));
  if (blockedEither(user.id, o.id)) throw new HttpError(403, 'You cannot message this user');
  const ok = S.chatAllowed(user.id, text); if (!ok.ok) throw new HttpError(429, ok.reason);
  const id = Number(q.run('INSERT INTO messages (from_id,to_id,body,ts) VALUES (?,?,?,?)', user.id, o.id, text, nowMs()).lastInsertRowid);
  hub.sendUser(o.id, { t: 'dm', from: user.username, body: text, ts: nowMs(), id });
  return { id };
});
route('POST', '/api/reports', { auth: 'user', rl: ['report', 10, 3600_000] }, ({ user, body }) => {
  const o = userByName(body.username); if (o.id === user.id) throw bad('You cannot report yourself');
  const reason = ['cheating', 'abuse', 'spam', 'inappropriate-name', 'other'].includes(body.reason) ? body.reason : 'other';
  const id = Number(q.run('INSERT INTO reports (reporter_id,target_id,game_id,reason,details,created_at) VALUES (?,?,?,?,?,?)', user.id, o.id, body.gameId ? String(body.gameId).slice(0, 20) : null, reason, vText(body.details || '', { max: 500, field: 'Details' }), nowMs()).lastInsertRowid);
  return { id, message: 'Thanks — a moderator will review your report.' };
});

// ---------------------------------------------------------------- clubs
const clubRole = (cid, uid) => q.get('SELECT role FROM club_members WHERE club_id=? AND user_id=?', cid, uid)?.role || null;
route('GET', '/api/clubs', { auth: false }, ({ query, user }) => {
  const t = String(query.q || '').replace(/[%_\\]/g, '').slice(0, 30);
  const rows = q.all(`SELECT c.id,c.name,c.description,c.private,c.created_at,(SELECT COUNT(*) FROM club_members m WHERE m.club_id=c.id) members FROM clubs c WHERE (c.private=0 ${user ? 'OR c.id IN (SELECT club_id FROM club_members WHERE user_id=' + Number(user.id) + ')' : ''}) AND c.name LIKE ? ORDER BY members DESC LIMIT 50`, '%' + t + '%');
  return { clubs: rows, mine: user ? q.all('SELECT club_id FROM club_members WHERE user_id=?', user.id).map((r) => r.club_id) : [] };
});
route('POST', '/api/clubs', { auth: 'user', rl: ['club', 5, 86400_000] }, ({ user, body }) => {
  active(user); const name = vText(body.name, { min: 3, max: 40, field: 'Club name' }), description = vText(body.description || '', { max: 400, field: 'Description' });
  if (q.get('SELECT 1 FROM clubs WHERE name=?', name)) throw new HttpError(409, 'A club with that name already exists');
  const priv = body.private ? 1 : 0;
  const id = tx(() => { const id = Number(q.run('INSERT INTO clubs (name,description,owner_id,private,join_code,created_at) VALUES (?,?,?,?,?,?)', name, description, user.id, priv, priv ? crypto.randomBytes(4).toString('hex') : null, nowMs()).lastInsertRowid); q.run("INSERT INTO club_members (club_id,user_id,role,joined_at) VALUES (?,?,'owner',?)", id, user.id, nowMs()); return id; });
  core.award(user.id, 'join-club'); return { id };
});
route('GET', '/api/clubs/:id', { auth: false }, ({ params, user }) => {
  const c = q.get('SELECT * FROM clubs WHERE id=?', params.id); if (!c) throw new HttpError(404, 'Club not found');
  const role = user ? clubRole(c.id, user.id) : null; if (c.private && !role) throw new HttpError(404, 'Club not found');
  const members = q.all('SELECT u.*, m.role FROM club_members m JOIN users u ON u.id=m.user_id WHERE m.club_id=? ORDER BY CASE m.role WHEN \'owner\' THEN 0 WHEN \'admin\' THEN 1 ELSE 2 END, u.username LIMIT 200', c.id);
  return { club: { id: c.id, name: c.name, description: c.description, private: !!c.private, created_at: c.created_at, joinCode: role === 'owner' || role === 'admin' ? c.join_code : undefined }, role, members: members.map((m) => ({ ...pub(m), role: m.role })), tournaments: q.all('SELECT id,name,kind,status,start_ts,tc_initial,tc_inc FROM tournaments WHERE club_id=? ORDER BY start_ts DESC LIMIT 20', c.id) };
});
route('POST', '/api/clubs/:id/join', { auth: 'user' }, ({ params, user, body }) => {
  active(user); const c = q.get('SELECT * FROM clubs WHERE id=?', params.id); if (!c) throw new HttpError(404, 'Club not found');
  if (c.private && c.join_code !== String(body.code || '')) throw new HttpError(403, 'This club needs an invite code');
  q.run("INSERT OR IGNORE INTO club_members (club_id,user_id,role,joined_at) VALUES (?,?,'member',?)", c.id, user.id, nowMs()); core.award(user.id, 'join-club'); return { ok: true };
});
route('POST', '/api/clubs/:id/leave', { auth: 'user' }, ({ params, user }) => { const r = clubRole(params.id, user.id); if (r === 'owner') throw bad('Owners cannot leave — delete the club or transfer it first'); q.run('DELETE FROM club_members WHERE club_id=? AND user_id=?', params.id, user.id); return { ok: true }; });
route('POST', '/api/clubs/:id/kick', { auth: 'user' }, ({ params, user, body }) => { const r = clubRole(params.id, user.id); if (!['owner', 'admin'].includes(r)) throw new HttpError(403, 'Not allowed'); const o = userByName(body.username); if (clubRole(params.id, o.id) === 'owner') throw bad('Cannot remove the owner'); q.run('DELETE FROM club_members WHERE club_id=? AND user_id=?', params.id, o.id); return { ok: true }; });
route('POST', '/api/clubs/:id/promote', { auth: 'user' }, ({ params, user, body }) => { if (clubRole(params.id, user.id) !== 'owner') throw new HttpError(403, 'Only the owner can do that'); const o = userByName(body.username); q.run("UPDATE club_members SET role=? WHERE club_id=? AND user_id=? AND role!='owner'", body.admin === false ? 'member' : 'admin', params.id, o.id); return { ok: true }; });
route('DELETE', '/api/clubs/:id', { auth: 'user' }, ({ params, user }) => { if (clubRole(params.id, user.id) !== 'owner' && user.role !== 'admin') throw new HttpError(403, 'Only the owner can delete a club'); q.run('DELETE FROM clubs WHERE id=?', params.id); return { ok: true }; });
route('GET', '/api/clubs/:id/messages', { auth: 'user' }, ({ params, user }) => {
  if (!clubRole(params.id, user.id)) throw new HttpError(403, 'Members only');
  const rows = q.all('SELECT m.id,m.body,m.ts,u.username FROM messages m JOIN users u ON u.id=m.from_id WHERE m.club_id=? ORDER BY m.id DESC LIMIT 100', params.id).reverse();
  return { messages: rows };
});
route('POST', '/api/clubs/:id/messages', { auth: 'user', rl: ['clubmsg', 40, 60_000] }, ({ params, user, body }) => {
  active(user); if (!clubRole(params.id, user.id)) throw new HttpError(403, 'Members only');
  const text = S.cleanChat(vText(body.body, { min: 1, max: 400, field: 'Message' })); const ok = S.chatAllowed(user.id, text); if (!ok.ok) throw new HttpError(429, ok.reason);
  const ts = nowMs(); const id = Number(q.run('INSERT INTO messages (from_id,club_id,body,ts) VALUES (?,?,?,?)', user.id, params.id, text, ts).lastInsertRowid);
  for (const m of q.all('SELECT user_id FROM club_members WHERE club_id=? AND user_id!=?', params.id, user.id)) hub.sendUser(m.user_id, { t: 'club_msg', clubId: Number(params.id), from: user.username, body: text, ts, id });
  return { id };
});

// ---------------------------------------------------------------- tournaments
route('GET', '/api/tournaments', { auth: false }, ({ user }) => {
  const mine = user ? new Set(q.all('SELECT tournament_id FROM tournament_players WHERE user_id=? AND withdrawn=0', user.id).map((r) => r.tournament_id)) : new Set();
  const rows = q.all(`SELECT t.*, (SELECT COUNT(*) FROM tournament_players p WHERE p.tournament_id=t.id AND p.withdrawn=0) players, (SELECT username FROM users WHERE id=t.creator_id) creator FROM tournaments t WHERE (t.private=0 ${user ? 'OR t.creator_id=' + Number(user.id) + ' OR t.id IN (SELECT tournament_id FROM tournament_players WHERE user_id=' + Number(user.id) + ')' : ''}) AND (t.status IN ('scheduled','running') OR t.start_ts > ?) ORDER BY CASE t.status WHEN 'running' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, t.start_ts DESC LIMIT 60`, nowMs() - 14 * 864e5);
  return { tournaments: rows.map((t) => ({ id: t.id, name: t.name, kind: t.kind, status: t.status, start_ts: t.start_ts, end_ts: t.end_ts, tc: { initial: t.tc_initial, inc: t.tc_inc }, cat: t.category, rated: !!t.rated, rounds: t.rounds, durationMin: t.duration_min, players: t.players, private: !!t.private, club_id: t.club_id, creator: t.creator, joined: mine.has(t.id) })) };
});
route('POST', '/api/tournaments', { auth: 'user', rl: ['tcreate', 10, 3600_000] }, ({ user, body }) => {
  active(user);
  const name = vText(body.name, { min: 3, max: 60, field: 'Name' });
  try { const id = T.createTournament(user, { ...body, name, clubId: body.clubId ? Number(body.clubId) : null }); const t = q.get('SELECT * FROM tournaments WHERE id=?', id); if (!body.clubId || true) T.joinTournament(t, user, t.join_code); return { id, joinCode: t.join_code }; }
  catch (e) { throw e instanceof HttpError ? e : bad(e.message); }
});
route('GET', '/api/tournaments/:id', { auth: false }, ({ params, user }) => {
  const t = q.get('SELECT * FROM tournaments WHERE id=?', params.id); if (!t) throw new HttpError(404, 'Tournament not found');
  const joined = user ? q.get('SELECT * FROM tournament_players WHERE tournament_id=? AND user_id=?', t.id, user.id) : null;
  if (t.private && !joined && t.creator_id !== user?.id && user?.role !== 'admin') { /* visible by id to those with the link, but without code cannot join */ }
  const st = T.standings(t.id);
  const games = q.all(`SELECT tg.round, tg.game_id, tg.result, tg.white_id, tg.black_id, (SELECT username FROM users WHERE id=tg.white_id) white, (SELECT username FROM users WHERE id=tg.black_id) black, g.status FROM tournament_games tg LEFT JOIN games g ON g.id=tg.game_id WHERE tg.tournament_id=? ORDER BY tg.id DESC LIMIT 300`, t.id);
  const myGame = user ? games.find((g) => g.status === 'active' && (g.white_id === user.id || g.black_id === user.id)) : null;
  return { tournament: { id: t.id, name: t.name, kind: t.kind, status: t.status, start_ts: t.start_ts, end_ts: t.end_ts, tc: { initial: t.tc_initial, inc: t.tc_inc }, cat: t.category, rated: !!t.rated, rounds: t.rounds, currentRound: t.current_round, durationMin: t.duration_min, private: !!t.private, club_id: t.club_id, maxPlayers: t.max_players, joinCode: t.creator_id === user?.id ? t.join_code : undefined, creatorId: t.creator_id, serverNow: nowMs() }, standings: st.players, games, joined: !!joined && !joined.withdrawn, myGame: myGame?.game_id || null };
});
route('POST', '/api/tournaments/:id/join', { auth: 'user' }, ({ params, user, body }) => { active(user); const t = q.get('SELECT * FROM tournaments WHERE id=?', params.id); if (!t) throw new HttpError(404, 'Tournament not found'); try { T.joinTournament(t, user, String(body.code || '')); } catch (e) { throw bad(e.message); } return { ok: true }; });
route('POST', '/api/tournaments/:id/leave', { auth: 'user' }, ({ params, user }) => { const t = q.get('SELECT * FROM tournaments WHERE id=?', params.id); if (!t) throw new HttpError(404, 'Not found'); T.leaveTournament(t, user); return { ok: true }; });

// ---------------------------------------------------------------- admin / moderation
const needMod = (u) => { if (!['admin', 'mod'].includes(u.role)) throw new HttpError(403, 'Moderators only'); };
const needAdmin = (u) => { if (u.role !== 'admin') throw new HttpError(403, 'Administrators only'); };
// ---------------------------------------------------------------- owner tools (owner only, all logged in the audit log)
const needOwner = (u) => { if (!isOwner(u)) throw new HttpError(403, 'Owner only'); };
const liveGame = (id) => { const g = G.live.get(String(id)); if (!g || g.status !== 'active') throw new HttpError(404, 'That game is not in progress'); return g; };
route('GET', '/api/owner/info', { auth: 'user' }, ({ user }) => {
  needOwner(user);
  return { categories: core.ALL_CATS, achievements: q.all('SELECT id, name FROM achievements ORDER BY id'), games: [...G.live.values()].filter((g) => g.status === 'active').map((g) => ({ id: g.id, white: g.white.name, black: g.black.name, tc: g.tc, cat: g.cat, plies: g.ply, rated: !!g.rated, private: !!g.private, spectators: g.spectators.size })) };
});
route('POST', '/api/owner/games/:id/result', { auth: 'user' }, ({ user, params, body }) => {
  needOwner(user); const g = liveGame(params.id); if (!['1-0', '0-1', '1/2-1/2'].includes(body.result)) throw bad('Invalid result');
  if (body.unrated) g.rated = false; // result stands, ratings do not move
  G.finish(g, body.result, 'adjudicated by the site owner'); audit(user, 'owner:result', g.id, body.result + (body.unrated ? ' (ratings unchanged)' : '')); return { ok: true };
});
route('POST', '/api/owner/games/:id/abort', { auth: 'user' }, ({ user, params }) => { needOwner(user); const g = liveGame(params.id); G.finish(g, '*', 'aborted'); audit(user, 'owner:abort', g.id); return { ok: true }; });
route('POST', '/api/owner/games/abort-all', { auth: 'user' }, ({ user }) => { needOwner(user); let n = 0; for (const g of [...G.live.values()]) if (g.status === 'active') { G.finish(g, '*', 'aborted'); n++; } audit(user, 'owner:abort-all', n + ' games'); return { ok: true, aborted: n }; });
route('POST', '/api/owner/users/:name/rating', { auth: 'user' }, ({ user, params, body }) => {
  needOwner(user); const t = userByName(params.name); const cat = String(body.category); if (!core.ALL_CATS.includes(cat)) throw bad('Unknown category');
  const r = Math.round(Number(body.rating)); if (!Number.isFinite(r) || r < 100 || r > 3500) throw bad('Rating must be between 100 and 3500');
  core.ensureRatings(t.id); q.run('UPDATE ratings SET rating=?, updated_at=? WHERE user_id=? AND category=?', r, nowMs(), t.id, cat); audit(user, 'owner:rating', t.username, cat + ' = ' + r); return { ok: true };
});
route('POST', '/api/owner/users/:name/achievements', { auth: 'user' }, ({ user, params, body }) => {
  needOwner(user); const t = userByName(params.name); let n = 0;
  if (body.all) { for (const a of q.all('SELECT id FROM achievements')) if (core.award(t.id, a.id)) n++; } else { if (!q.get('SELECT 1 FROM achievements WHERE id=?', String(body.id))) throw bad('Unknown achievement'); if (core.award(t.id, String(body.id))) n++; }
  audit(user, 'owner:achievements', t.username, body.all ? 'all' : body.id); return { ok: true, granted: n };
});
route('POST', '/api/owner/users/:name/kick', { auth: 'user' }, ({ user, params }) => {
  needOwner(user); const t = userByName(params.name); if (t.id === user.id) throw bad('Not yourself'); q.run('DELETE FROM sessions WHERE user_id=?', t.id);
  let n = 0; for (const ws of hub.all) if (ws.user && ws.user.id === t.id) { try { ws.close(4000, 'signed out by the owner'); } catch {} n++; } audit(user, 'owner:kick', t.username); return { ok: true, connections: n };
});
route('POST', '/api/owner/broadcast', { auth: 'user' }, ({ user, body }) => { needOwner(user); const text = vText(body.text, { min: 1, max: 200, field: 'Message' }); hub.broadcast({ t: 'announce', text }); audit(user, 'owner:broadcast', '', text); return { ok: true }; });
route('POST', '/api/owner/backup-now', { auth: 'user' }, async ({ user }) => { needOwner(user); if (!backup.enabled) throw bad('Backups are not configured'); const done = await backup.snapshot(db, DB_PATH, true); return { ok: done, lastBackupAt: backup.status.lastBackupAt, error: backup.status.lastError }; });
route('GET', '/api/admin/stats', { auth: 'user' }, ({ user }) => {
  needMod(user); const day = nowMs() - 864e5;
  const c = (sql, ...a) => q.get(sql, ...a).n;
  return {
    users: c('SELECT COUNT(*) n FROM users'), newToday: c('SELECT COUNT(*) n FROM users WHERE created_at>?', day), activeToday: c('SELECT COUNT(*) n FROM users WHERE last_seen>?', day), online: hub.onlineIds().length,
    games: c("SELECT COUNT(*) n FROM games WHERE status='finished'"), gamesToday: c("SELECT COUNT(*) n FROM games WHERE status='finished' AND created_at>?", day), live: G.stats(),
    puzzles: c('SELECT COUNT(*) n FROM puzzles'), puzzleAttempts: c('SELECT COUNT(*) n FROM puzzle_attempts'), lessons: c('SELECT COUNT(*) n FROM lessons'), clubs: c('SELECT COUNT(*) n FROM clubs'),
    tournaments: c("SELECT COUNT(*) n FROM tournaments WHERE status IN ('scheduled','running')"), openReports: c("SELECT COUNT(*) n FROM reports WHERE status='open'"), openFlags: c('SELECT COUNT(*) n FROM fair_play_flags WHERE reviewed=0'),
    signups: q.all("SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') d, COUNT(*) n FROM users WHERE created_at>? GROUP BY d ORDER BY d", nowMs() - 14 * 864e5), gamesPerDay: q.all("SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') d, COUNT(*) n FROM games WHERE created_at>? GROUP BY d ORDER BY d", nowMs() - 14 * 864e5),
  };
});
route('GET', '/api/admin/health', { auth: 'user' }, ({ user }) => {
  needMod(user); const m = process.memoryUsage();
  let dbSize = 0; try { dbSize = fs.statSync(DB_PATH).size; } catch {}
  return { uptimeSec: Math.round((nowMs() - startedAt) / 1000), node: process.version, rssMB: Math.round(m.rss / 1048576), heapMB: Math.round(m.heapUsed / 1048576), wsConnections: hub.all.size, onlineUsers: hub.onlineIds().length, games: G.stats(), dbSizeMB: Math.round(dbSize / 1048576 * 100) / 100, eventLoopLagMs: globalThis.__lag || 0, time: nowMs() };
});
route('GET', '/api/admin/users', { auth: 'user' }, ({ user, query }) => {
  needMod(user); const t = String(query.q || '').replace(/[%_\\]/g, '');
  return { users: q.all("SELECT id,username,email,role,status,suspended_until,status_reason,created_at,last_seen,fair_flags FROM users WHERE username LIKE ? OR email LIKE ? ORDER BY created_at DESC LIMIT 100", '%' + t + '%', '%' + t + '%').map((u) => ({ ...u, owner: isOwner(u) })) };
});
route('POST', '/api/admin/users/:id/status', { auth: 'user' }, ({ user, params, body }) => {
  needMod(user); const t = q.get('SELECT * FROM users WHERE id=?', params.id); if (!t) throw new HttpError(404, 'User not found');
  if (isOwner(t)) throw new HttpError(403, 'The owner cannot be moderated');
  if (t.role === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Cannot moderate administrators'); if (t.id === user.id) throw bad('You cannot moderate yourself');
  const status = ['active', 'suspended', 'banned'].includes(body.status) ? body.status : null; if (!status) throw bad('Invalid status');
  const until = status === 'suspended' ? nowMs() + Math.min(365, Math.max(0.01, Number(body.days) || 1)) * 864e5 : null;
  q.run('UPDATE users SET status=?, suspended_until=?, status_reason=? WHERE id=?', status, until, vText(body.reason || '', { max: 200, field: 'Reason' }), t.id);
  if (status !== 'active') q.run('DELETE FROM sessions WHERE user_id=?', t.id);
  audit(user, 'status:' + status, t.username, body.reason); return { ok: true };
});
route('POST', '/api/admin/users/:id/role', { auth: 'user' }, ({ user, params, body }) => { needAdmin(user); if (!['user', 'mod', 'admin'].includes(body.role)) throw bad('Invalid role'); if (Number(params.id) === user.id) throw bad('Cannot change your own role'); if (isOwner(q.get('SELECT username FROM users WHERE id=?', params.id))) throw new HttpError(403, 'The owner\'s role cannot be changed'); q.run('UPDATE users SET role=? WHERE id=?', body.role, params.id); audit(user, 'role:' + body.role, params.id); return { ok: true }; });
route('POST', '/api/admin/users/:id/reset-link', { auth: 'user' }, ({ user, params, origin }) => { needAdmin(user); if (isOwner(q.get('SELECT username FROM users WHERE id=?', params.id)) && !isOwner(user)) throw new HttpError(403, 'Only the owner can reset the owner\'s password'); const tok = S.randToken(24); q.run('INSERT INTO reset_tokens (token_hash,user_id,expires_at) VALUES (?,?,?)', S.sha256(tok), params.id, nowMs() + 3600_000); audit(user, 'reset-link', params.id); return { link: `${origin}/#/reset/${tok}` }; });
route('GET', '/api/admin/reports', { auth: 'user' }, ({ user, query }) => { needMod(user); const st = ['open', 'actioned', 'dismissed'].includes(query.status) ? query.status : 'open'; return { reports: q.all('SELECT r.*, (SELECT username FROM users WHERE id=r.reporter_id) reporter, (SELECT username FROM users WHERE id=r.target_id) target FROM reports r WHERE status=? ORDER BY created_at DESC LIMIT 100', st) }; });
route('POST', '/api/admin/reports/:id/resolve', { auth: 'user' }, ({ user, params, body }) => {
  needMod(user); const r = q.get('SELECT * FROM reports WHERE id=?', params.id); if (!r) throw new HttpError(404, 'Report not found');
  const action = ['dismiss', 'warn', 'suspend', 'ban'].includes(body.action) ? body.action : 'dismiss';
  if (action === 'suspend' || action === 'ban') { const t = q.get('SELECT * FROM users WHERE id=?', r.target_id); if (isOwner(t)) throw new HttpError(403, 'The owner cannot be moderated'); if (t.role === 'admin') throw new HttpError(403, 'Cannot moderate administrators'); q.run('UPDATE users SET status=?, suspended_until=?, status_reason=? WHERE id=?', action === 'ban' ? 'banned' : 'suspended', action === 'suspend' ? nowMs() + (Number(body.days) || 3) * 864e5 : null, 'Report #' + r.id + ': ' + r.reason, t.id); q.run('DELETE FROM sessions WHERE user_id=?', t.id); }
  if (action === 'warn') hub.sendUser(r.target_id, { t: 'notice', text: 'A moderator has warned you about your conduct. Please play fair and be respectful.' });
  q.run('UPDATE reports SET status=?, resolved_by=?, note=?, resolved_at=? WHERE id=?', action === 'dismiss' ? 'dismissed' : 'actioned', user.id, vText(body.note || '', { max: 300, field: 'Note' }), nowMs(), r.id);
  audit(user, 'report:' + action, r.id); return { ok: true };
});
route('GET', '/api/admin/flags', { auth: 'user' }, ({ user }) => { needMod(user); return { flags: q.all('SELECT f.*, u.username FROM fair_play_flags f JOIN users u ON u.id=f.user_id ORDER BY reviewed, ts DESC LIMIT 100') }; });
route('POST', '/api/admin/flags/:id/review', { auth: 'user' }, ({ user, params }) => { needMod(user); q.run('UPDATE fair_play_flags SET reviewed=1 WHERE id=?', params.id); return { ok: true }; });
route('GET', '/api/admin/tournaments', { auth: 'user' }, ({ user }) => { needMod(user); return { tournaments: q.all('SELECT t.*, (SELECT COUNT(*) FROM tournament_players p WHERE p.tournament_id=t.id) players FROM tournaments t ORDER BY start_ts DESC LIMIT 100') }; });
route('POST', '/api/admin/tournaments/:id/cancel', { auth: 'user' }, ({ user, params }) => { needMod(user); q.run("UPDATE tournaments SET status='cancelled' WHERE id=? AND status IN ('scheduled','running')", params.id); audit(user, 'tournament-cancel', params.id); return { ok: true }; });
route('GET', '/api/admin/puzzles', { auth: 'user' }, ({ user, query }) => { needAdmin(user); return { puzzles: q.all('SELECT id,fen,kind,rating,mate,enabled,plays,solved,themes FROM puzzles ORDER BY rowid DESC LIMIT ? OFFSET ?', Math.min(200, Number(query.limit) || 50), Number(query.offset) || 0), total: q.get('SELECT COUNT(*) n FROM puzzles').n }; });
route('POST', '/api/admin/puzzles', { auth: 'user' }, ({ user, body }) => {
  needAdmin(user);
  const p = { id: 'u' + crypto.randomBytes(4).toString('hex'), fen: String(body.fen || ''), kind: ['mate', 'tactic', 'endgame', 'opening'].includes(body.kind) ? body.kind : 'tactic', solution: (Array.isArray(body.solution) ? body.solution : String(body.solution || '').split(/\s+/)).filter(Boolean).map(String), mate: body.mate ? Number(body.mate) : null, rating: Math.max(400, Math.min(3000, Number(body.rating) || 1500)), explanation: vText(body.explanation || '', { max: 600, field: 'Explanation' }), themes: [] };
  if (!p.solution.length) throw bad('Solution moves required (UCI, e.g. e2e4 e7e5)');
  const err = verifyPuzzle(p); if (err) throw bad('Puzzle failed verification: ' + err);
  q.run('INSERT INTO puzzles (id,fen,kind,solution,solutions,themes,rating,mate,explanation) VALUES (?,?,?,?,?,?,?,?,?)', p.id, p.fen, p.kind, JSON.stringify(p.solution), JSON.stringify([p.solution[0]]), JSON.stringify([p.kind]), p.rating, p.mate, p.explanation);
  audit(user, 'puzzle-add', p.id); return { id: p.id };
});
route('POST', '/api/admin/puzzles/:id/toggle', { auth: 'user' }, ({ user, params }) => { needAdmin(user); q.run('UPDATE puzzles SET enabled=1-enabled WHERE id=?', params.id); return { ok: true }; });
route('DELETE', '/api/admin/puzzles/:id', { auth: 'user' }, ({ user, params }) => { needAdmin(user); q.run('DELETE FROM puzzles WHERE id=?', params.id); audit(user, 'puzzle-delete', params.id); return { ok: true }; });
route('GET', '/api/admin/lessons', { auth: 'user' }, ({ user }) => { needAdmin(user); return { lessons: q.all('SELECT id,level,category,title,summary,minutes,published,sort,steps FROM lessons ORDER BY sort').map((l) => ({ ...l, steps: JSON.parse(l.steps) })) }; });
route('PUT', '/api/admin/lessons/:id', { auth: 'user', maxBody: 400_000 }, ({ user, params, body }) => {
  needAdmin(user); const l = q.get('SELECT * FROM lessons WHERE id=?', params.id); if (!l) throw new HttpError(404, 'Lesson not found');
  const steps = body.steps ?? JSON.parse(l.steps); if (!Array.isArray(steps) || !steps.length) throw bad('Steps must be a non-empty array');
  q.run('UPDATE lessons SET title=?, summary=?, level=?, category=?, minutes=?, published=?, steps=? WHERE id=?', vText(body.title ?? l.title, { min: 1, max: 100, field: 'Title' }), vText(body.summary ?? l.summary, { max: 300, field: 'Summary' }), body.level ?? l.level, body.category ?? l.category, vInt(body.minutes ?? l.minutes, { min: 1, max: 120 }), body.published === false ? 0 : 1, JSON.stringify(steps), l.id);
  audit(user, 'lesson-edit', l.id); return { ok: true };
});
route('GET', '/api/admin/audit', { auth: 'user' }, ({ user }) => { needAdmin(user); return { log: q.all('SELECT a.*, (SELECT username FROM users WHERE id=a.actor_id) actor FROM audit_log a ORDER BY id DESC LIMIT 100') }; });
