// SQLite via Node's built-in node:sqlite (no external DB server needed). All queries are parameterised.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LESSONS } from '../data/lessons.js';
import { restore } from './backup.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(here, '..');
export const DB_PATH = process.env.ROOKERY_DB || path.join(ROOT, 'data', 'rookery.db');
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

await restore(DB_PATH); // no-op unless ROOKERY_BACKUP_REPO / ROOKERY_BACKUP_TOKEN are set
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');

export const q = {
  get: (sql, ...p) => db.prepare(sql).get(...p),
  all: (sql, ...p) => db.prepare(sql).all(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
};
export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function migrate(log = () => {}) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const dir = path.join(here, 'migrations');
  const done = new Set(q.all('SELECT name FROM schema_migrations').map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    tx(() => { db.exec(fs.readFileSync(path.join(dir, f), 'utf8')); q.run('INSERT INTO schema_migrations VALUES (?,?)', f, Date.now()); });
    log('applied migration ' + f);
  }
}

export const ACHIEVEMENTS = [
  ['first-game', 'First Move', 'Finish your first game.', '♙'],
  ['first-win', 'Taste of Victory', 'Win a game.', '🏆'],
  ['ten-wins', 'Ten Wins', 'Win ten games.', '🔟'],
  ['beat-ai-expert', 'Machine Breaker', 'Beat the Expert (or stronger) computer.', '🤖'],
  ['checkmate-fast', 'Quick Strike', 'Checkmate in 20 moves or fewer.', '⚡'],
  ['puzzle-10', 'Puzzle Apprentice', 'Solve 10 puzzles.', '🧩'],
  ['puzzle-100', 'Puzzle Master', 'Solve 100 puzzles.', '🧠'],
  ['puzzle-streak-10', 'On a Roll', 'Solve 10 puzzles in a row.', '🔥'],
  ['rush-20', 'Rush Hour', 'Score 20 in Puzzle Rush.', '⏱'],
  ['lesson-1', 'Student', 'Complete a lesson.', '📘'],
  ['lesson-all-beginner', 'Graduate', 'Complete every beginner lesson.', '🎓'],
  ['rating-1600', 'Rising Star', 'Reach a 1600 rating in any time control.', '⭐'],
  ['rating-1800', 'Expert Player', 'Reach an 1800 rating in any time control.', '🌟'],
  ['first-friend', 'Friendly', 'Make a friend.', '🤝'],
  ['join-club', 'Clubhouse', 'Join a club.', '🏠'],
  ['tournament-play', 'Competitor', 'Play in a tournament.', '🎯'],
  ['tournament-win', 'Champion', 'Win a tournament.', '👑'],
  ['upset', 'Giant Killer', 'Beat a player rated 200+ points above you.', '🗡'],
];

export function seed(log = () => {}) {
  tx(() => {
    for (const [id, name, description, icon] of ACHIEVEMENTS)
      q.run('INSERT INTO achievements (id,name,description,icon) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, icon=excluded.icon', id, name, description, icon);
    // lessons: insert any that are missing (admin edits to existing rows are preserved)
    LESSONS.forEach((l, i) => q.run('INSERT OR IGNORE INTO lessons (id,level,category,title,summary,minutes,steps,sort) VALUES (?,?,?,?,?,?,?,?)',
      l.id, l.level, l.category, l.title, l.summary, l.minutes || 5, JSON.stringify(l.steps), i));
    const pf = path.join(ROOT, 'data', 'puzzles.json');
    if (fs.existsSync(pf)) {
      const list = JSON.parse(fs.readFileSync(pf, 'utf8'));
      let n = 0;
      for (const p of list) {
        const r = q.run('INSERT OR IGNORE INTO puzzles (id,fen,kind,solution,solutions,themes,rating,mate,explanation,opening) VALUES (?,?,?,?,?,?,?,?,?,?)',
          p.id, p.fen, p.kind, JSON.stringify(p.solution), JSON.stringify(p.solutions || [p.solution[0]]), JSON.stringify(p.themes || []),
          p.rating || 1500, p.mate ?? null, p.explanation || '', p.opening ? JSON.stringify(p.opening) : null);
        n += Number(r.changes);
      }
      if (n) log(`seeded ${n} puzzles`);
    }
  });
}

export function init(log = () => {}) { migrate(log); seed(log); }
