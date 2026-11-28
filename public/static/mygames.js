// "My Games": local game history, stats and achievements. Everything lives in this browser's localStorage.
import { h, clear, toast, confirmBox, download, ago } from '../util.js';
import { toPgn } from '/shared/pgn.js';
import { LEVELS } from '/shared/engine.js';
import { LESSONS } from '/data/lessons.js';

const KEY = 'rk_games';
export const listGames = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const put = (g) => { try { localStorage.setItem(KEY, JSON.stringify(g.slice(0, 200))); return true; } catch { return false; } };
export function saveGame(rec) { const all = listGames(); all.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ts: Date.now(), ...rec }); return put(all); }
const pz = () => { try { return JSON.parse(localStorage.getItem('rk_pz2') || '{}'); } catch { return {}; } };
const lessonsDone = () => { try { return Object.values(JSON.parse(localStorage.getItem('rk_lessons') || '{}')).filter((x) => x.completed).length; } catch { return 0; } };
const won = (g) => (g.mode === 'cpu' || g.mode === 'online') && g.result === (g.color === 'w' ? '1-0' : '0-1');

export const ACH = [
  ['first-game', '♟', 'First move', 'Finish a game', (c) => c.games >= 1],
  ['ten-games', '🎮', 'Regular', 'Finish 10 games', (c) => c.games >= 10],
  ['first-win', '🏆', 'First win', 'Beat the computer', (c) => c.wins >= 1],
  ['black-win', '♚', 'Dark side', 'Win as Black against the computer', (c) => c.list.some((g) => won(g) && g.color === 'b')],
  ['mate-win', '♛', 'Finisher', 'Checkmate the computer', (c) => c.list.some((g) => won(g) && g.reason === 'checkmate')],
  ['adv-win', '🔥', 'Giant killer', 'Beat Advanced (level 4) or stronger', (c) => c.list.some((g) => won(g) && g.level >= 4)],
  ['max-win', '👑', 'Unbeaten', 'Beat Maximum (level 6)', (c) => c.list.some((g) => won(g) && g.level === 6)],
  ['marathon', '⏳', 'Marathon', 'Play a game of 40+ moves', (c) => c.list.some((g) => g.moves.length >= 80)],
  ['online-1', '\ud83c\udf10', 'Connected', 'Finish a game against a friend online', (c) => c.list.some((g) => g.mode === 'online')],
  ['online-win', '\ud83e\udd1d', 'Good sport', 'Win an online game against a friend', (c) => c.list.some((g) => g.mode === 'online' && won(g))],
  ['two-player', '👥', 'Friendly game', 'Finish a two-player game', (c) => c.list.some((g) => g.mode === 'local')],
  ['puzzle-1', '🧩', 'Puzzler', 'Solve a puzzle', (c) => c.pz.solved >= 1],
  ['puzzle-25', '🧠', 'Puzzle fan', 'Solve 25 puzzles', (c) => c.pz.solved >= 25],
  ['puzzle-1400', '📈', 'Sharp eyes', 'Reach a puzzle rating of 1400', (c) => c.pz.rating >= 1400],
  ['rush-10', '⏱', 'Rush hour', 'Score 10 in Puzzle Rush', (c) => (c.pz.best?.rush || 0) >= 10],
  ['survive-8', '🛡', 'Survivor', 'Score 8 in Survival', (c) => (c.pz.best?.survival || 0) >= 8],
  ['lesson-1', '📘', 'Student', 'Complete a lesson', (c) => c.lessons >= 1],
  ['lesson-10', '🎓', 'Scholar', 'Complete 10 lessons', (c) => c.lessons >= 10],
  ['lesson-all', '🏛', 'Graduate', 'Complete every lesson', (c) => c.lessons >= LESSONS.length],
];
const ctxOf = () => { const list = listGames(); return { list, games: list.length, wins: list.filter(won).length, pz: pz(), lessons: lessonsDone() }; };
export const earned = () => { const c = ctxOf(); return ACH.filter((a) => a[4](c)).map((a) => a[0]); };

export default async function mygames(root, ctx) {
  ctx.setTitle('My games');
  const c = ctxOf(); const got = new Set(ACH.filter((a) => a[4](c)).map((a) => a[0]));
  const cpu = c.list.filter((g) => g.mode === 'cpu'); const w = cpu.filter(won).length, d = cpu.filter((g) => g.result === '1/2-1/2').length, l = cpu.length - w - d;
  const stat = (v, t) => h('div', { class: 'card stat' }, h('div', { class: 'muted small' }, t), h('div', { class: 'big' }, v));
  const listBox = h('div', { class: 'col' });
  const pgnOf = (g) => toPgn({ headers: { Event: g.mode === 'cpu' ? 'Rookery vs computer' : g.mode === 'online' ? 'Rookery online friendly' : 'Rookery two-player game', White: g.white, Black: g.black, Date: new Date(g.ts).toISOString().slice(0, 10).replace(/-/g, '.') }, moves: g.moves, result: g.result });
  const draw = () => {
    clear(listBox); const all = listGames();
    if (!all.length) { listBox.append(h('p', { class: 'muted' }, 'No finished games yet. ', h('a', { href: '#/play' }, 'Play the computer'), ' or ', h('a', { href: '#/local' }, 'a friend on this device'), '.')); return; }
    for (const g of all) {
      const res = g.mode !== 'local' ? (g.result === '1/2-1/2' ? 'draw' : won(g) ? 'win' : 'loss') : 'draw';
      listBox.append(h('div', { class: 'game-row' }, h('span', { class: 'res ' + res }, g.mode !== 'local' ? (res === 'win' ? '+' : res === 'loss' ? '−' : '=') : '•'), h('span', { class: 'grow' }, `${g.white} vs ${g.black}`), h('span', { class: 'muted small' }, `${g.result} · ${Math.ceil(g.moves.length / 2)} moves · ${ago(g.ts)}`),
        h('button', { class: 'btn small', onclick: () => { try { sessionStorage.setItem('rk_analyse_pgn', pgnOf(g)); } catch {} location.hash = '/analysis'; } }, '🔍'), h('button', { class: 'btn small', title: 'Download PGN', onclick: () => download('rookery-game.pgn', pgnOf(g)) }, '⬇'),
        h('button', { class: 'btn small ghost', title: 'Delete', onclick: async () => { if (await confirmBox('Delete this game?', `${g.white} vs ${g.black}`, 'Delete')) { put(listGames().filter((x) => x.id !== g.id)); draw(); } } }, '✕')));
    }
  };
  draw();
  const byLevel = LEVELS.map((lv) => { const gs = cpu.filter((g) => g.level === lv.id); return gs.length ? h('div', { class: 'row small' }, h('strong', { style: { width: '110px' } }, lv.name), `${gs.filter(won).length}W ${gs.filter((g) => g.result === '1/2-1/2').length}D ${gs.length - gs.filter(won).length - gs.filter((g) => g.result === '1/2-1/2').length}L`) : null; });
  root.append(h('h1', null, 'My games'), h('p', { class: 'muted' }, 'Saved in this browser only. Clearing site data removes them, so download a PGN of anything you want to keep.'),
    h('div', { class: 'grid-4' }, stat(c.games, 'Games finished'), stat(`${w}W ${d}D ${l}L`, 'Vs computer'), stat(Math.round(c.pz.rating || 1200), 'Puzzle rating'), stat(`${got.size}/${ACH.length}`, 'Achievements')),
    byLevel.some(Boolean) ? h('section', { class: 'card' }, h('h2', null, 'By computer level'), byLevel) : null,
    h('section', { class: 'card' }, h('h2', null, 'Achievements'), h('div', { class: 'ach-grid' }, ACH.map(([id, ic, name, desc]) => h('div', { class: 'ach' + (got.has(id) ? '' : ' locked'), title: desc, style: got.has(id) ? {} : { opacity: .45 } }, h('span', { class: 'ach-icon' }, got.has(id) ? ic : '🔒'), h('span', null, name, h('span', { class: 'muted small block' }, desc)))))),
    h('section', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Game history'), c.list.length ? h('button', { class: 'btn small ghost', onclick: async () => { if (await confirmBox('Delete all saved games?', 'This cannot be undone.', 'Delete all')) { put([]); draw(); } } }, 'Clear all') : null), listBox));
}
