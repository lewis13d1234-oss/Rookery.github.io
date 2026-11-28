// Ratings, time-control categories and achievements. All rating maths happens here, on the server.
import { q, tx } from './db.js';
import { update as glicko, decay, DEFAULTS } from '../shared/glicko2.js';
import { sendUser } from './hub.js';

export const CATEGORIES = ['bullet', 'blitz', 'rapid', 'classical'];
export const ALL_CATS = [...CATEGORIES, 'puzzle'];

/** initial seconds + 40 × increment (the usual estimated-duration rule) */
export function categoryFor(initialSec, incSec) {
  const t = initialSec + 40 * incSec;
  if (t < 180) return 'bullet';
  if (t < 480) return 'blitz';
  if (t < 1500) return 'rapid';
  return 'classical';
}

export function ensureRatings(uid) {
  const now = Date.now();
  for (const c of ALL_CATS) q.run('INSERT OR IGNORE INTO ratings (user_id,category,rating,rd,vol,updated_at) VALUES (?,?,?,?,?,?)', uid, c, DEFAULTS.rating, DEFAULTS.rd, DEFAULTS.vol, now);
}
export const getRating = (uid, cat) => { ensureRatings(uid); return q.get('SELECT * FROM ratings WHERE user_id=? AND category=?', uid, cat); };
export const ratingsOf = (uid) => { ensureRatings(uid); return q.all('SELECT category, rating, rd, games, wins, losses, draws FROM ratings WHERE user_id=?', uid); };

function applied(p, now) { const idle = (now - p.updated_at) / 864e5; return decay({ rating: p.rating, rd: p.rd, vol: p.vol }, Math.floor(idle / 7)); }

/** Update both players after a rated game. score is white's score (1, .5, 0). Returns before/after for each. */
export function rateGame(whiteId, blackId, cat, score) {
  const now = Date.now();
  return tx(() => {
    const w = getRating(whiteId, cat), b = getRating(blackId, cat);
    const pw = applied(w, now), pb = applied(b, now);
    const nw = glicko(pw, [{ rating: pb.rating, rd: pb.rd, score }]);
    const nb = glicko(pb, [{ rating: pw.rating, rd: pw.rd, score: 1 - score }]);
    const save = (uid, row, n, s) => {
      q.run(`UPDATE ratings SET rating=?, rd=?, vol=?, games=games+1, wins=wins+?, losses=losses+?, draws=draws+?, updated_at=? WHERE user_id=? AND category=?`,
        n.rating, n.rd, n.vol, s === 1 ? 1 : 0, s === 0 ? 1 : 0, s === 0.5 ? 1 : 0, now, uid, cat);
      q.run('INSERT INTO rating_history (user_id,category,rating,delta,ref,ts) VALUES (?,?,?,?,?,?)', uid, cat, n.rating, n.rating - row.rating, 'game', now);
    };
    save(whiteId, w, nw, score); save(blackId, b, nb, 1 - score);
    return { white: { before: w.rating, after: nw.rating }, black: { before: b.rating, after: nb.rating } };
  });
}
/** Unrated games still count towards W/L/D record but not rating. */
export function recordUnrated(uid, cat, s) {
  ensureRatings(uid);
  q.run('UPDATE ratings SET games=games+1, wins=wins+?, losses=losses+?, draws=draws+? WHERE user_id=? AND category=?', s === 1 ? 1 : 0, s === 0 ? 1 : 0, s === 0.5 ? 1 : 0, uid, cat);
}

/** Puzzle rating update (user vs puzzle); the puzzle's own rating drifts slightly too. */
export function ratePuzzle(uid, puzzle, solved) {
  const now = Date.now();
  const r = getRating(uid, 'puzzle');
  const p = applied(r, now);
  const n = glicko(p, [{ rating: puzzle.rating, rd: puzzle.rd ?? 200, score: solved ? 1 : 0 }]);
  const rating = Math.max(100, n.rating);
  q.run('UPDATE ratings SET rating=?, rd=?, vol=?, games=games+1, wins=wins+?, losses=losses+?, updated_at=? WHERE user_id=? AND category=?', rating, Math.max(60, n.rd), n.vol, solved ? 1 : 0, solved ? 0 : 1, now, uid, 'puzzle');
  q.run('INSERT INTO rating_history (user_id,category,rating,delta,ref,ts) VALUES (?,?,?,?,?,?)', uid, 'puzzle', rating, rating - r.rating, 'puzzle:' + puzzle.id, now);
  const delta = Math.max(-8, Math.min(8, (solved ? -1 : 1) * Math.abs(r.rating - puzzle.rating) / 60 - (solved ? 1 : -1)));
  q.run('UPDATE puzzles SET rating = MAX(300, rating + ?), plays = plays+1, solved = solved + ? WHERE id=?', delta, solved ? 1 : 0, puzzle.id);
  return { before: r.rating, after: rating };
}

// ---------------- achievements ----------------
export function award(uid, id) {
  if (!uid) return false;
  const r = q.run('INSERT OR IGNORE INTO user_achievements (user_id,achievement_id,ts) VALUES (?,?,?)', uid, id, Date.now());
  if (Number(r.changes)) {
    const a = q.get('SELECT * FROM achievements WHERE id=?', id);
    if (a) sendUser(uid, { t: 'achievement', achievement: a });
    return true;
  }
  return false;
}

export function checkGameAchievements(uid, { won, drew, plies, oppRating, myRating, vsAiLevel, mate }) {
  if (!uid) return;
  award(uid, 'first-game');
  if (won) {
    award(uid, 'first-win');
    const w = q.get(`SELECT COUNT(*) n FROM games WHERE status='finished' AND ((white_id=? AND result='1-0') OR (black_id=? AND result='0-1'))`, uid, uid).n;
    if (w >= 10) award(uid, 'ten-wins');
    if (mate && plies <= 40) award(uid, 'checkmate-fast');
    if (vsAiLevel && vsAiLevel >= 5) award(uid, 'beat-ai-expert');
    if (oppRating && myRating && oppRating - myRating >= 200) award(uid, 'upset');
  }
  const top = q.get('SELECT MAX(rating) m FROM ratings WHERE user_id=? AND category != ? AND games >= 5', uid, 'puzzle');
  if (top?.m >= 1600) award(uid, 'rating-1600');
  if (top?.m >= 1800) award(uid, 'rating-1800');
}
export function checkPuzzleAchievements(uid) {
  const n = q.get('SELECT COUNT(*) n FROM puzzle_attempts WHERE user_id=? AND solved=1', uid).n;
  if (n >= 10) award(uid, 'puzzle-10');
  if (n >= 100) award(uid, 'puzzle-100');
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, avatar: u.avatar || null, country: u.country || '', role: u.role };
}
export function nameOf(uid) { return q.get('SELECT username FROM users WHERE id=?', uid)?.username || '?'; }
