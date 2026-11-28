// Tournaments: arena (timed, continuous pairing), swiss (fixed rounds), knockout (single elimination).
import crypto from 'node:crypto';
import { q, tx } from './db.js';
import { createGame, setEndHook, live, validTc } from './games.js';
import { isOnline, sendUser } from './hub.js';
import { categoryFor, getRating, award } from './core.js';

const KINDS = ['arena', 'swiss', 'knockout'];

export function createTournament(creator, o) {
  const tc = validTc(o.initial, o.inc); if (!tc) throw new Error('Invalid time control');
  if (!KINDS.includes(o.kind)) throw new Error('Unknown tournament type');
  const start = Number(o.startTs) || Date.now() + 5 * 60_000;
  if (start < Date.now() - 60_000 || start > Date.now() + 90 * 864e5) throw new Error('Start time must be within the next 90 days');
  const rounds = o.kind === 'swiss' ? Math.min(15, Math.max(1, Number(o.rounds) || 5)) : null;
  const dur = o.kind === 'arena' ? Math.min(360, Math.max(5, Number(o.durationMin) || 30)) : null;
  const max = Math.min(512, Math.max(2, Number(o.maxPlayers) || 128));
  const code = o.private ? crypto.randomBytes(4).toString('hex') : null;
  if (o.clubId) {
    const m = q.get('SELECT role FROM club_members WHERE club_id=? AND user_id=?', o.clubId, creator.id);
    if (!m || m.role === 'member') { if (creator.role === 'user') throw new Error('Only club owners and admins can create club tournaments'); }
  }
  const r = q.run(`INSERT INTO tournaments (name,kind,tc_initial,tc_inc,category,rated,rounds,duration_min,start_ts,private,join_code,club_id,creator_id,max_players,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    o.name, o.kind, tc.initial, tc.inc, categoryFor(tc.initial, tc.inc), o.rated === false ? 0 : 1, rounds, dur, start, code ? 1 : 0, code, o.clubId || null, creator.id, max, Date.now());
  return Number(r.lastInsertRowid);
}

export function canJoin(t, user, code) {
  if (t.status === 'finished' || t.status === 'cancelled') throw new Error('Tournament is over');
  if (t.kind !== 'arena' && t.status !== 'scheduled') throw new Error('Registration closed — this tournament has already started');
  if (t.club_id && !q.get('SELECT 1 FROM club_members WHERE club_id=? AND user_id=?', t.club_id, user.id)) throw new Error('Only club members can join');
  if (t.private && t.join_code !== code && t.creator_id !== user.id) throw new Error('This tournament needs an invite code');
  const n = q.get('SELECT COUNT(*) n FROM tournament_players WHERE tournament_id=? AND withdrawn=0', t.id).n;
  if (n >= t.max_players) throw new Error('Tournament is full');
}
export function joinTournament(t, user, code) {
  canJoin(t, user, code);
  const ex = q.get('SELECT * FROM tournament_players WHERE tournament_id=? AND user_id=?', t.id, user.id);
  if (ex) q.run('UPDATE tournament_players SET withdrawn=0 WHERE tournament_id=? AND user_id=?', t.id, user.id);
  else q.run('INSERT INTO tournament_players (tournament_id,user_id,rating_at_join,joined_at) VALUES (?,?,?,?)', t.id, user.id, getRating(user.id, t.category).rating, Date.now());
}
export function leaveTournament(t, user) {
  if (t.status === 'scheduled') q.run('DELETE FROM tournament_players WHERE tournament_id=? AND user_id=?', t.id, user.id);
  else q.run('UPDATE tournament_players SET withdrawn=1 WHERE tournament_id=? AND user_id=?', t.id, user.id);
}

export function standings(tid) {
  const t = q.get('SELECT * FROM tournaments WHERE id=?', tid);
  const ps = q.all(`SELECT tp.*, u.username FROM tournament_players tp JOIN users u ON u.id=tp.user_id WHERE tp.tournament_id=?`, tid);
  const scoreOf = new Map(ps.map((p) => [p.user_id, p.score]));
  const gs = q.all('SELECT white_id, black_id, result FROM tournament_games WHERE tournament_id=? AND game_id IS NOT NULL AND result IS NOT NULL', tid);
  const opp = new Map();
  for (const g of gs) { if (g.white_id && g.black_id) { (opp.get(g.white_id) || opp.set(g.white_id, []).get(g.white_id)).push(g.black_id); (opp.get(g.black_id) || opp.set(g.black_id, []).get(g.black_id)).push(g.white_id); } }
  const rows = ps.map((p) => ({ userId: p.user_id, username: p.username, score: p.score, games: p.games, rating: Math.round(p.rating_at_join || 1500), withdrawn: !!p.withdrawn, eliminated: !!p.eliminated, streak: p.streak, tiebreak: Math.round((opp.get(p.user_id) || []).reduce((s, o) => s + (scoreOf.get(o) || 0), 0) * 10) / 10 }));
  rows.sort((a, b) => b.score - a.score || b.tiebreak - a.tiebreak || b.rating - a.rating);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return { tournament: t, players: rows };
}

// ---------------------------------------------------------------- pairing helpers
function inTournamentGame(uid, tid) {
  return !!q.get(`SELECT 1 FROM tournament_games tg JOIN games g ON g.id=tg.game_id WHERE tg.tournament_id=? AND g.status='active' AND (g.white_id=? OR g.black_id=?)`, tid, uid, uid);
}
const played = (tid, a, b) => q.get('SELECT 1 FROM tournament_games WHERE tournament_id=? AND game_id IS NOT NULL AND ((white_id=? AND black_id=?) OR (white_id=? AND black_id=?))', tid, a, b, b, a);
function colorBalance(tid, uid) { // white games minus black games
  const w = q.get('SELECT COUNT(*) n FROM tournament_games WHERE tournament_id=? AND white_id=? AND game_id IS NOT NULL', tid, uid).n;
  const b = q.get('SELECT COUNT(*) n FROM tournament_games WHERE tournament_id=? AND black_id=? AND game_id IS NOT NULL', tid, uid).n;
  return w - b;
}
function startPair(t, a, b, round) {
  let w = a, bl = b;
  if (colorBalance(t.id, a) > colorBalance(t.id, b) || (colorBalance(t.id, a) === colorBalance(t.id, b) && Math.random() < 0.5)) { w = b; bl = a; }
  const name = (id) => q.get('SELECT username FROM users WHERE id=?', id).username;
  const g = createGame({ white: { id: w, name: name(w) }, black: { id: bl, name: name(bl) }, tc: { initial: t.tc_initial, inc: t.tc_inc }, rated: !!t.rated, tournamentId: t.id, private: !!t.private });
  q.run('INSERT INTO tournament_games (tournament_id,game_id,round,white_id,black_id) VALUES (?,?,?,?,?)', t.id, g.id, round, w, bl);
  for (const uid of [w, bl]) { award(uid, 'tournament-play'); sendUser(uid, { t: 'tournament_game', tournamentId: t.id, id: g.id }); }
}

function activePlayers(t) { return q.all('SELECT * FROM tournament_players WHERE tournament_id=? AND withdrawn=0 AND eliminated=0', t.id); }

function pairSwiss(t, round) {
  const ps = activePlayers(t).sort((a, b) => b.score - a.score || (b.rating_at_join - a.rating_at_join));
  const pool = [...ps];
  if (pool.length % 2) { // bye: lowest-ranked player without a bye yet
    const idx = [...pool.keys()].reverse().find((i) => !pool[i].had_bye) ?? pool.length - 1;
    const [b] = pool.splice(idx, 1);
    q.run('UPDATE tournament_players SET had_bye=1, score=score+1 WHERE tournament_id=? AND user_id=?', t.id, b.user_id);
    q.run("INSERT INTO tournament_games (tournament_id,game_id,round,white_id,black_id,result) VALUES (?,?,?,?,?,'1-0')", t.id, null, round, b.user_id, null);
  }
  while (pool.length) {
    const a = pool.shift();
    let j = pool.findIndex((p) => !played(t.id, a.user_id, p.user_id));
    if (j < 0) j = 0;
    const [b] = pool.splice(j, 1);
    startPair(t, a.user_id, b.user_id, round);
  }
}

function seedOrder(size) { let s = [1]; while (s.length < size) { const n = s.length * 2 + 1; s = s.flatMap((x) => [x, n - x]); } return s; }

function startKnockout(t) {
  const ps = q.all('SELECT * FROM tournament_players WHERE tournament_id=? AND withdrawn=0 ORDER BY rating_at_join DESC, joined_at', t.id);
  ps.forEach((p, i) => q.run('UPDATE tournament_players SET seed=? WHERE tournament_id=? AND user_id=?', i + 1, t.id, p.user_id));
  let size = 2; while (size < ps.length) size *= 2;
  const order = seedOrder(size);
  for (let i = 0; i < size; i += 2) {
    const a = ps[order[i] - 1], b = ps[order[i + 1] - 1];
    if (a && b) startPair(t, a.user_id, b.user_id, 1);
    else { const w = a || b; q.run("INSERT INTO tournament_games (tournament_id,game_id,round,white_id,black_id,result) VALUES (?,?,?,?,?,'1-0')", t.id, null, 1, w.user_id, null); q.run('UPDATE tournament_players SET score=score+1 WHERE tournament_id=? AND user_id=?', t.id, w.user_id); }
  }
}

function knockoutMatches(tid, round) { // [{key, a, b, winner, draws, pending}]
  const rows = q.all('SELECT * FROM tournament_games WHERE tournament_id=? AND round=? ORDER BY id', tid, round);
  const m = new Map();
  for (const r of rows) {
    const key = [r.white_id, r.black_id || 0].sort().join('-');
    const x = m.get(key) || { key, a: r.white_id, b: r.black_id, winner: null, draws: 0, pending: false, last: r };
    if (!r.black_id) x.winner = r.white_id;
    else if (r.game_id && r.result == null) x.pending = true;
    else if (r.result === '1-0' && !r.game_id) x.winner = r.white_id; // forced result row
    else if (r.result === '1-0') x.winner = r.white_id;
    else if (r.result === '0-1') x.winner = r.black_id;
    else if (r.result === '1/2-1/2') x.draws++;
    x.last = r; m.set(key, x);
  }
  return [...m.values()];
}

function advanceKnockout(t) {
  const round = t.current_round;
  const ms = knockoutMatches(t.id, round);
  if (ms.some((m) => m.pending)) return;
  let progressed = false;
  for (const m of ms) {
    if (m.winner) continue;
    if (m.draws >= 3) { // after three draws the higher seed advances
      const sa = q.get('SELECT seed FROM tournament_players WHERE tournament_id=? AND user_id=?', t.id, m.a).seed, sb = q.get('SELECT seed FROM tournament_players WHERE tournament_id=? AND user_id=?', t.id, m.b).seed;
      const w = sa < sb ? m.a : m.b, l = w === m.a ? m.b : m.a;
      q.run("INSERT INTO tournament_games (tournament_id,game_id,round,white_id,black_id,result) VALUES (?,?,?,?,?,'1-0')", t.id, null, round, w, l);
      progressed = true; continue;
    }
    // replay with colours swapped
    const prev = m.last; startPair(t, prev.black_id, prev.white_id, round); // startPair balances colours itself
    progressed = true;
  }
  if (progressed) return advanceKnockout(q.get('SELECT * FROM tournaments WHERE id=?', t.id));
  const winners = ms.map((m) => m.winner);
  const losers = ms.filter((m) => m.b).map((m) => (m.winner === m.a ? m.b : m.a));
  for (const l of losers) q.run('UPDATE tournament_players SET eliminated=1 WHERE tournament_id=? AND user_id=?', t.id, l);
  for (const w of winners) if (ms.find((m) => m.winner === w).b) q.run('UPDATE tournament_players SET score=score+1 WHERE tournament_id=? AND user_id=?', t.id, w);
  if (winners.length === 1) return finishTournament(t);
  q.run('UPDATE tournaments SET current_round=? WHERE id=?', round + 1, t.id);
  const t2 = q.get('SELECT * FROM tournaments WHERE id=?', t.id);
  for (let i = 0; i < winners.length; i += 2) startPair(t2, winners[i], winners[i + 1], round + 1);
}

function finishTournament(t) {
  q.run("UPDATE tournaments SET status='finished', end_ts=? WHERE id=?", Date.now(), t.id);
  const top = standings(t.id).players[0];
  if (top) award(top.userId, 'tournament-win');
  for (const p of q.all('SELECT user_id FROM tournament_players WHERE tournament_id=?', t.id)) sendUser(p.user_id, { t: 'tournament_end', tournamentId: t.id, name: t.name });
}

// ---------------------------------------------------------------- end-of-game hook
setEndHook((g) => {
  if (!g.tournamentId) return;
  const t = q.get('SELECT * FROM tournaments WHERE id=?', g.tournamentId); if (!t) return;
  const row = q.get('SELECT * FROM tournament_games WHERE game_id=?', g.id); if (!row) return;
  const res = g.result === '*' ? '1/2-1/2' : g.result;
  q.run('UPDATE tournament_games SET result=? WHERE id=?', res, row.id);
  const pts = (uid, won, drew) => {
    const p = q.get('SELECT * FROM tournament_players WHERE tournament_id=? AND user_id=?', t.id, uid); if (!p) return;
    let add = 0, streak = 0;
    if (t.kind === 'arena') { const dbl = p.streak >= 2; if (won) { add = dbl ? 4 : 2; streak = p.streak + 1; } else if (drew) { add = dbl ? 2 : 1; } }
    else if (t.kind === 'swiss') add = won ? 1 : drew ? 0.5 : 0;
    q.run('UPDATE tournament_players SET score=score+?, games=games+1, streak=? WHERE tournament_id=? AND user_id=?', add, streak, t.id, uid);
  };
  if (g.reason === 'aborted') { q.run('DELETE FROM tournament_games WHERE id=?', row.id); return; }
  pts(row.white_id, res === '1-0', res === '1/2-1/2'); pts(row.black_id, res === '0-1', res === '1/2-1/2');
  if (t.kind === 'knockout') setTimeout(() => { try { advanceKnockout(q.get('SELECT * FROM tournaments WHERE id=?', t.id)); } catch (e) { console.error(e); } }, 1500);
});

// ---------------------------------------------------------------- scheduler
export function tick() {
  const now = Date.now();
  for (const t of q.all("SELECT * FROM tournaments WHERE status='scheduled' AND start_ts<=?", now)) {
    const n = q.get('SELECT COUNT(*) n FROM tournament_players WHERE tournament_id=? AND withdrawn=0', t.id).n;
    if (n < 2 && t.kind !== 'arena') { q.run("UPDATE tournaments SET status='cancelled' WHERE id=?", t.id); continue; }
    q.run("UPDATE tournaments SET status='running', current_round=1, end_ts=? WHERE id=?", t.kind === 'arena' ? now + t.duration_min * 60_000 : null, t.id);
    const t2 = q.get('SELECT * FROM tournaments WHERE id=?', t.id);
    tx(() => { if (t.kind === 'swiss') pairSwiss(t2, 1); else if (t.kind === 'knockout') startKnockout(t2); });
    for (const p of q.all('SELECT user_id FROM tournament_players WHERE tournament_id=?', t.id)) sendUser(p.user_id, { t: 'tournament_start', tournamentId: t.id, name: t.name });
  }
  for (const t of q.all("SELECT * FROM tournaments WHERE status='running'")) {
    const busy = q.get(`SELECT COUNT(*) n FROM tournament_games tg JOIN games g ON g.id=tg.game_id WHERE tg.tournament_id=? AND g.status='active'`, t.id).n;
    if (t.kind === 'arena') {
      if (now >= t.end_ts) { if (!busy) finishTournament(t); continue; }
      const idle = activePlayers(t).filter((p) => isOnline(p.user_id) && !inTournamentGame(p.user_id, t.id) && !live.get && true)
        .filter((p) => ![...live.values()].some((g) => g.status === 'active' && !g.tournamentId && g.colorOf(p.user_id) >= 0))
        .sort((a, b) => b.score - a.score);
      while (idle.length >= 2) {
        const a = idle.shift();
        let j = idle.findIndex((p) => { const last = q.get('SELECT white_id, black_id FROM tournament_games WHERE tournament_id=? AND game_id IS NOT NULL AND (white_id=? OR black_id=?) ORDER BY id DESC LIMIT 1', t.id, a.user_id, a.user_id); return !(last && (last.white_id === p.user_id || last.black_id === p.user_id)); });
        if (j < 0) { if (now - (a.joined_at || 0) < 15_000 && idle.length < 3) continue; j = 0; }
        const [b] = idle.splice(j, 1);
        startPair(t, a.user_id, b.user_id, 0);
      }
    } else if (t.kind === 'swiss') {
      if (busy) continue;
      const pending = q.get('SELECT COUNT(*) n FROM tournament_games WHERE tournament_id=? AND round=? AND game_id IS NOT NULL AND result IS NULL', t.id, t.current_round).n;
      if (pending) continue;
      if (t.current_round >= t.rounds) { finishTournament(t); continue; }
      q.run('UPDATE tournaments SET current_round=current_round+1 WHERE id=?', t.id);
      tx(() => pairSwiss(q.get('SELECT * FROM tournaments WHERE id=?', t.id), t.current_round + 1));
    } else if (t.kind === 'knockout') {
      if (!busy && !q.get('SELECT 1 FROM tournament_games WHERE tournament_id=? AND game_id IS NOT NULL AND result IS NULL', t.id)) {
        const ms = knockoutMatches(t.id, t.current_round);
        if (ms.length && ms.every((m) => m.winner)) { /* waiting for advance via hook */ try { advanceKnockout(t); } catch (e) { console.error(e); } }
      }
    }
  }
}
setInterval(() => { try { tick(); } catch (e) { console.error('tournament tick', e); } }, 2000).unref();
export const listActive = () => q.all("SELECT t.*, (SELECT COUNT(*) FROM tournament_players p WHERE p.tournament_id=t.id AND p.withdrawn=0) players FROM tournaments t WHERE status IN ('scheduled','running') ORDER BY start_ts");
