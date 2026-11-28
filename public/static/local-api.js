// In-browser replacement for the Rookery REST API, used by the single-file GitHub Pages build.
// Puzzles are verified here with the same rules engine; progress is kept in localStorage.
import { Chess } from '/shared/chess.js';
import { mateMoves, longestDefence } from '/shared/engine.js';
import { LESSONS } from '/data/lessons.js';
import { trLesson } from './i18n-lessons.js';
import { getLang } from './i18n.js';
import PUZZLES from '/data/puzzles.json';
import { saveGame } from './pages/mygames.js';

const bad = (m) => Object.assign(new Error(m), { status: 400 });
const rid = () => Math.random().toString(36).slice(2, 10);
const attempts = new Map(), runs = new Map();
const pub = (p) => ({ id: p.id, fen: p.fen, kind: p.kind, themes: p.themes, rating: Math.round(p.rating), mate: p.mate, turn: p.fen.split(' ')[1] });
const STORE = 'rk_pz2';
const load = () => { try { return { rating: 1200, hist: [], attempts: 0, solved: 0, kinds: {}, best: {}, runs: {}, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { return { rating: 1200, hist: [], attempts: 0, solved: 0, kinds: {}, best: {}, runs: {} }; } };
const save = (d) => { try { localStorage.setItem(STORE, JSON.stringify(d)); } catch {} };
const seenKey = 'rk_pz_seen';
const seenList = () => { try { return JSON.parse(localStorage.getItem(seenKey) || '[]'); } catch { return []; } };
const markSeen = (id) => { try { localStorage.setItem(seenKey, JSON.stringify([...seenList().filter((x) => x !== id), id].slice(-150))); } catch {} };

function pick(kind, target, exclude = []) {
  const pool0 = PUZZLES.filter((p) => !kind || kind === 'all' || kind === 'any' || p.kind === kind);
  const skip = new Set([...seenList(), ...exclude]);
  const rank = (arr) => arr.slice().sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target)).slice(0, 8);
  let c = rank(pool0.filter((p) => !skip.has(p.id))); if (!c.length) c = rank(pool0);
  return c.length ? c[Math.floor(Math.random() * Math.min(c.length, 4))] : null;
}
function newAttempt(p, mode, runId) {
  const id = rid();
  attempts.set(id, { id, p, pos: new Chess(p.fen), step: 0, solverMoves: 0, hinted: false, done: false, mode, runId, solution: p.solution, alts: p.solutions || [p.solution[0]] });
  return id;
}
const mateOpts = (p) => (p.mate > 2 ? { checksOnlyAfterFirst: true } : {});

function finish(a, solved, out) {
  out.solved = solved; out.explanation = a.p.explanation; out.puzzleRating = Math.round(a.p.rating);
  markSeen(a.p.id); const d = load();
  d.attempts++; if (solved) d.solved++; const k = (d.kinds[a.p.kind] = d.kinds[a.p.kind] || { n: 0, s: 0 }); k.n++; if (solved) k.s++;
  if (!a.hinted && ['rated', 'daily', 'streak', 'survival'].includes(a.mode)) {
    const before = d.rating, exp = 1 / (1 + Math.pow(10, (a.p.rating - before) / 400)), K = d.hist.length < 20 ? 48 : 28;
    d.rating = Math.max(100, before + K * ((solved ? 1 : 0) - exp)); d.hist.push({ rating: Math.round(d.rating), ts: Date.now() }); if (d.hist.length > 100) d.hist.shift();
    out.ratingChange = { before: Math.round(before), after: Math.round(d.rating) };
  }
  save(d);
  if (['rated', 'daily', 'streak'].includes(a.mode)) { const key = 'rk_pz_streak'; const st = solved && !a.hinted ? (+localStorage.getItem(key) || 0) + 1 : 0; try { localStorage.setItem(key, st); } catch {} out.streak = st; }
  if (a.runId) { const run = runs.get(a.runId); if (run) { if (solved) run.score++; else run.strikes++; if (run.strikes >= 3 || (run.mode === 'rush' && Date.now() - run.t0 > run.limitMs + 2000)) endRun(run); out.run = { score: run.score, strikes: run.strikes, over: run.over, best: run.best }; } }
}
function bestOf(mode) { return load().best[mode] || 0; }
function endRun(run) { if (run.over) return; run.over = true; const d = load(); run.best = Math.max(d.best[run.mode] || 0, run.score); d.best[run.mode] = run.best; d.runs[run.mode] = (d.runs[run.mode] || 0) + 1; save(d); }

function lessonList() { return LESSONS.map((l) => ({ id: l.id, level: l.level, category: l.category, title: l.title, summary: l.summary, minutes: l.minutes, steps: l.steps.length, completed: false, step: 0 })); }

export async function localApi(method, url, body = {}) {
  const [path, qs] = url.split('?'); const query = Object.fromEntries(new URLSearchParams(qs || '')); let m;
  if (path === '/api/me') return { user: null };
  if (path === '/api/config') return { name: 'Rookery', free: true, static: true };
  if (path === '/api/lessons') return { lessons: lessonList() };
  if ((m = path.match(/^\/api\/lessons\/([^/]+)$/))) { const l = LESSONS.find((x) => x.id === decodeURIComponent(m[1])); if (!l) throw Object.assign(new Error('Lesson not found'), { status: 404 }); return { lesson: trLesson(l, getLang()), progress: null }; }
  if (path.startsWith('/api/lessons/') && path.endsWith('/progress')) return { ok: true };
  if (path === '/api/games/computer') { const lv = Number(body.level) || 1; saveGame({ mode: 'cpu', level: lv, color: body.color, result: body.result, reason: body.reason, moves: body.moves || [], white: body.color === 'w' ? window.__rkName() : 'Computer', black: body.color === 'b' ? window.__rkName() : 'Computer' }); return { ok: true }; }
  if (path === '/api/games/live') return { games: [] };
  if (path === '/api/openings/stats') return { total: { w: 0, d: 0, b: 0, n: 0 }, next: [], source: 'none' };
  if (path === '/api/puzzles/stats') { const d = load(); return { rating: Math.round(d.rating), attempts: d.attempts, solved: d.solved, avgMs: 0, byKind: Object.entries(d.kinds).map(([kind, v]) => ({ kind, n: v.n, s: v.s })), history: d.hist, best: Object.entries(d.best).map(([mode, best]) => ({ mode, best, runs: d.runs[mode] || 0 })), recent: [], streak: +localStorage.getItem('rk_pz_streak') || 0, totalPuzzles: PUZZLES.length }; }
  if (path === '/api/puzzles/next') {
    let run = null, target = load().rating; const mode = ['rated', 'rush', 'survival', 'streak', 'practice'].includes(query.mode) ? query.mode : 'rated';
    if (query.run) { run = runs.get(query.run); if (!run || run.over) throw bad('Run is over'); target = run.mode === 'rush' ? 700 + run.score * 70 : 800 + run.score * 90; }
    const p = pick(query.kind, target, run ? run.seen : []); if (!p) throw Object.assign(new Error('No puzzles available'), { status: 404 });
    if (run) run.seen.push(p.id);
    return { puzzle: pub(p), attempt: newAttempt(p, run ? run.mode : mode, run?.id) };
  }
  if (path === '/api/puzzles/daily') {
    const day = new Date().toISOString().slice(0, 10); const all = PUZZLES.filter((p) => ['tactic', 'mate', 'endgame'].includes(p.kind)).sort((a, b) => (a.id < b.id ? -1 : 1));
    let hsh = 2166136261; for (const ch of 'rookery-daily-' + day) { hsh ^= ch.charCodeAt(0); hsh = Math.imul(hsh, 16777619) >>> 0; }
    const p = all[hsh % all.length]; return { puzzle: pub(p), attempt: newAttempt(p, 'daily'), day, solvedToday: false };
  }
  if ((m = path.match(/^\/api\/puzzles\/attempt\/([^/]+)\/hint$/))) {
    const a = attempts.get(m[1]); if (!a || a.done) throw bad('Attempt not found'); a.hinted = true;
    const exp = a.p.mate ? mateMoves(a.pos, a.p.mate - a.solverMoves, mateOpts(a.p))[0] : (a.step === 0 ? a.alts[0] : a.solution[a.step]); return { from: exp.slice(0, 2) };
  }
  if ((m = path.match(/^\/api\/puzzles\/attempt\/([^/]+)\/move$/))) {
    const a = attempts.get(m[1]); if (!a || a.done) throw bad('Attempt not found or already finished');
    const uci = String(body.uci || ''); if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw bad('Bad move');
    const { p, pos } = a; let ok;
    if (p.mate) ok = mateMoves(pos, p.mate - a.solverMoves, mateOpts(p)).includes(uci); else ok = (a.step === 0 ? a.alts : [a.solution[a.step]]).includes(uci);
    if (!pos.move(uci)) throw bad('Illegal move');
    const out = { correct: !!ok };
    if (ok) {
      a.solverMoves++;
      if (p.mate) { if (pos.isCheckmate()) a.done = true; else { const r = longestDefence(pos, p.mate - a.solverMoves); out.reply = r; pos.move(r); } }
      else if (a.step === 0 && uci !== a.solution[0]) a.done = true;
      else if (a.step + 1 >= a.solution.length) a.done = true;
      else { out.reply = a.solution[a.step + 1]; pos.move(out.reply); a.step += 2; if (a.step >= a.solution.length) a.done = true; }
      if (a.done) finish(a, true, out);
    } else { a.done = true; finish(a, false, out); out.solution = p.mate ? mateMoves(new Chess(p.fen), p.mate, mateOpts(p))[0] : a.solution[0]; }
    return out;
  }
  if (path === '/api/puzzles/run/start') { const mode = body.mode === 'survival' ? 'survival' : 'rush'; const run = { id: rid(), mode, score: 0, strikes: 0, seen: [], t0: Date.now(), limitMs: mode === 'rush' ? 180000 : 0, over: false, best: 0 }; runs.set(run.id, run); return { run: run.id, mode, limitMs: run.limitMs, strikesAllowed: 3, best: bestOf(mode) }; }
  if ((m = path.match(/^\/api\/puzzles\/run\/([^/]+)\/end$/))) { const run = runs.get(m[1]); if (!run) throw bad('Unknown run'); endRun(run); return { score: run.score, best: run.best, strikes: run.strikes }; }
  const e = new Error('This feature needs the full Rookery server and is not available in the offline version.'); e.status = 404; throw e;
}
