// Basic, transparent fair-play heuristics. They only RAISE FLAGS for human moderators; nothing here auto-bans.
//  1. Superhuman consistency: very fast, near-constant move times over many moves.
//  2. Engine agreement: share of a player's moves equal to our depth-4 engine's top move (humans rarely exceed ~80%).
import { q } from './db.js';
import { Chess } from '../shared/chess.js';
import { Engine } from '../shared/engine.js';

const eng = new Engine();
const stdev = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
const tick = () => new Promise((r) => setImmediate(r));

export function flag(userId, gameId, kind, detail) {
  q.run('INSERT INTO fair_play_flags (user_id,game_id,kind,detail,ts) VALUES (?,?,?,?,?)', userId, gameId, kind, detail, Date.now());
  q.run('UPDATE users SET fair_flags = fair_flags + 1 WHERE id=?', userId);
}

export async function analyseForFairPlay(g) {
  for (const c of [0, 1]) {
    const uid = c ? g.black.id : g.white.id; if (!uid) continue;
    const th = g.thinks[c].slice(3);
    if (th.length >= 20 && g.tc.initial >= 180) {
      const mean = th.reduce((a, b) => a + b, 0) / th.length, sd = stdev(th);
      if (mean < 350) flag(uid, g.id, 'fast-moves', `avg think ${Math.round(mean)}ms over ${th.length} moves at ${g.tc.initial}+${g.tc.inc}`);
      else if (sd < 0.12 * mean && mean < 4000) flag(uid, g.id, 'uniform-timing', `think time sd ${Math.round(sd)}ms vs mean ${Math.round(mean)}ms over ${th.length} moves`);
    }
  }
  // engine agreement
  const ucis = g.chess.historyUci();
  const pos = new Chess(g.startFen);
  const stats = [{ n: 0, hit: 0 }, { n: 0, hit: 0 }];
  for (let i = 0; i < ucis.length && i < 120; i++) {
    const c = i % 2;
    if (i >= 12 && pos.legalMoves().length >= 4) {
      await tick();
      const r = eng.search(pos, { depth: 4, movetime: 40 });
      stats[c].n++; if (r.move === ucis[i]) stats[c].hit++;
    }
    pos.move(ucis[i]);
  }
  for (const c of [0, 1]) {
    const uid = c ? g.black.id : g.white.id;
    if (uid && stats[c].n >= 20 && stats[c].hit / stats[c].n >= 0.88) flag(uid, g.id, 'engine-match', `${stats[c].hit}/${stats[c].n} moves matched engine top choice`);
  }
}
