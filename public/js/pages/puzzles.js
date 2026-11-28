import { h, clear, toast, fmtClock, spinner } from '../util.js';
import { state, get, post } from '../api.js';
import { RB, sparkline, sleep, richText } from '../learn-common.js';
import { play } from '../sound.js';

const MODES = { rated: ['🎯', 'Rated training', 'Puzzles matched to your rating. Solve to gain rating.'], daily: ['📅', 'Daily puzzle', 'One new puzzle every day for everyone.'], streak: ['🔥', 'Streak', 'How many in a row can you solve?'], rush: ['⏱', 'Puzzle Rush', 'Solve as many as you can in 3 minutes. Three strikes and you are out.'], survival: ['🛡', 'Survival', 'Puzzles get harder. Three strikes — no clock.'] };
const THEMES = { mate: ['♚', 'Checkmate puzzles'], tactic: ['⚔', 'Tactics'], endgame: ['♙', 'Endgames'], opening: ['📖', 'Opening puzzles'] };

export default async function hub(root, ctx) {
  ctx.setTitle('Puzzles');
  root.append(h('h1', null, 'Puzzles'), h('p', { class: 'muted' }, 'Every puzzle has a verified solution, checked by the server. Free and unlimited — you can repeat them as often as you like.'));
  if (state.user) {
    try {
      const s = await get('/api/puzzles/stats'); const acc = s.attempts ? Math.round((s.solved / s.attempts) * 100) : 0;
      root.append(h('div', { class: 'card' }, h('div', { class: 'grid-4' }, stat(s.rating, 'Puzzle rating'), stat(s.solved, 'Solved'), stat(acc + '%', 'Accuracy'), stat(s.best.map((b) => `${b.mode} ${b.best}`).join(' · ') || '—', 'Best runs')), h('div', { style: { marginTop: '12px' } }, sparkline(s.history.map((x) => x.rating))),
        s.byKind.length ? h('div', { class: 'row small muted', style: { marginTop: '8px' } }, s.byKind.map((k) => h('span', { class: 'chip' }, `${k.kind}: ${k.s || 0}/${k.n}`))) : null));
    } catch {}
  } else root.append(h('div', { class: 'card' }, h('a', { href: '#/register' }, 'Create a free account'), ' to track your puzzle rating and progress. You can also solve puzzles without one (unrated).'));
  root.append(h('div', { class: 'section-title' }, h('h2', null, 'Modes')), h('div', { class: 'grid-3' }, Object.entries(MODES).map(([k, [i, t, d]]) => h('a', { class: 'card hover feature', href: '#/puzzles/' + k }, h('span', { class: 'ico' }, i), h('h3', { style: { margin: 0 } }, t), h('span', { class: 'muted' }, d)))),
    h('div', { class: 'section-title' }, h('h2', null, 'Themes')), h('div', { class: 'grid-4' }, Object.entries(THEMES).map(([k, [i, t]]) => h('a', { class: 'card hover feature', href: '#/puzzles/' + k }, h('span', { class: 'ico' }, i), h('h3', { style: { margin: 0 } }, t)))));
}
const stat = (v, l) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l));

export async function mode(root, ctx) {
  const m = ctx.params.mode; ctx.wide();
  const isRun = m === 'rush' || m === 'survival'; const kind = THEMES[m] ? m : 'any'; const apiMode = THEMES[m] ? 'practice' : m;
  ctx.setTitle(MODES[m]?.[1] || THEMES[m]?.[1] || 'Puzzles');
  if (!MODES[m] && !THEMES[m]) { root.append(h('div', { class: 'card center' }, h('h2', null, 'Unknown puzzle mode'), h('a', { href: '#/puzzles' }, 'Back'))); return; }
  let rb, att = null, pz = null, run = null, over = false, busy = false, hinted = false, solvedFlag = false, dead = false, t0 = 0, timer = null, score = 0, strikes = 0, streak = 0;
  const host = h('div'), msg = h('div', { class: 'pz-msg' }), info = h('div'), actions = h('div', { class: 'controls' }), runBox = h('div', { class: 'card runbox' });
  root.append(h('div', { class: 'game-layout' }, h('div', { class: 'board-col fill' }, host), h('div', { class: 'side-panel' }, h('div', { class: 'card' }, h('a', { href: '#/puzzles', class: 'small' }, '← Puzzles'), h('h2', { style: { margin: '6px 0' } }, (MODES[m] || ['', THEMES[m]?.[1]])[1]), msg, info), isRun ? runBox : null, h('div', { class: 'card' }, actions))));
  if (!state.user) info.append(h('div', { class: 'muted small' }, 'Playing unrated — log in to track rating and stats.'));
  const clear_ = () => { clear(msg); clear(info); if (!state.user) info.append(h('div', { class: 'muted small' }, 'Playing unrated — log in to track rating and stats.')); };

  async function startRun() { try { run = await post('/api/puzzles/run/start', { mode: m }); t0 = Date.now(); score = 0; strikes = 0; paintRun(); if (m === 'rush') timer = setInterval(tick, 200); await next(); } catch (e) { toast(e.message, 'error'); } }
  function paintRun() { clear(runBox); runBox.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, stat(score, 'Score'), m === 'rush' ? stat(fmtClock(Math.max(0, run.limitMs - (Date.now() - t0)), false), 'Time left') : stat(run.best, 'Best'), stat('✗'.repeat(strikes) + '○'.repeat(3 - strikes), 'Strikes'))); }
  function tick() { if (over) return; paintRun(); if (Date.now() - t0 >= run.limitMs) endRun(); }
  async function endRun() {
    if (over) return; over = true; clearInterval(timer); let r = { score, best: run?.best || 0 }; try { r = await post(`/api/puzzles/run/${run.run}/end`, {}); } catch {}
    clear(actions); clear(msg); play('end'); msg.append(h('div', { class: 'result-banner' }, h('h3', null, `Final score: ${r.score}`), h('div', { class: 'muted' }, state.user ? `Your best ${m}: ${r.best}` : 'Log in to save your scores.'))); actions.append(h('button', { class: 'btn primary', onclick: () => location.reload() }, '↻ Play again'), h('a', { class: 'btn', href: '#/puzzles' }, 'Back to puzzles')); if (rb) rb.board.setInteractive(false);
  }
  async function next() {
    if (dead) return; busy = true; over && !isRun && (over = false); solvedFlag = false; hinted = false; clear_(); clear(actions);
    try {
      const d = m === 'daily' ? await get('/api/puzzles/daily') : await get(`/api/puzzles/next?kind=${kind}&mode=${apiMode}${run ? '&run=' + run.run : ''}`);
      pz = d.puzzle; att = d.attempt; const o = pz.turn;
      if (!rb) rb = new RB(host, { fen: pz.fen, orientation: o, movable: o, onUserMove }); else { rb.load(pz.fen, o); rb.board.setInteractive(true, o); }
      rb.board.setInteractive(true, o); msg.textContent = ''; msg.append(h('div', { class: 'pz-turn' }, h('span', { class: 'sq-ico ' + o }), `${o === 'w' ? 'White' : 'Black'} to move — find the ${pz.mate ? 'checkmate in ' + pz.mate : 'best move'}.`));
      if (d.solvedToday) info.append(h('div', { class: 'pill good' }, 'You already solved today\'s puzzle — you can replay it for fun.'));
      drawActions();
    } catch (e) { msg.textContent = e.message; if (run) endRun(); }
    busy = false;
  }
  function drawActions() { clear(actions); if (!solvedFlag && !over) actions.append(h('button', { class: 'btn', onclick: hint }, '💡 Hint'), isRun ? null : h('button', { class: 'btn ghost', onclick: next }, 'Skip')); if (isRun && !over) actions.append(h('button', { class: 'btn danger', onclick: endRun }, 'End run')); }
  async function hint() { if (!att || over || solvedFlag) return; try { const r = await post(`/api/puzzles/attempt/${att}/hint`, {}); hinted = true; rb.board.setHints([r.from]); info.append(h('div', { class: 'muted small' }, 'Hint used — this puzzle will not change your rating.')); } catch (e) { toast(e.message, 'error'); } }
  async function onUserMove(from, to, promo) {
    if (busy || over || solvedFlag) return false; busy = true; rb.board.setHints([]); const uci = from + to + (promo || '');
    const mv = rb.apply(uci); if (!mv) { busy = false; return false; }
    let out; try { out = await post(`/api/puzzles/attempt/${att}/move`, { uci }); } catch (e) { rb.undo(); toast(e.message, 'error'); busy = false; return true; }
    if (out.correct) {
      play('right'); if (out.reply) { await sleep(350); rb.apply(out.reply); }
      if (out.solved) await finishPuzzle(out, true); else { msg.textContent = ''; msg.append(h('div', { class: 'good-txt' }, '✓ Correct — keep going.')); }
    } else { play('wrong'); await sleep(250); rb.undo(); await finishPuzzle(out, false); }
    busy = false; return true;
  }
  async function finishPuzzle(out, ok) {
    solvedFlag = true; clear(msg); rb.board.setInteractive(false);
    if (out.run) { score = out.run.score; strikes = out.run.strikes; run.best = out.run.best || run.best; paintRun(); }
    const lines = [h('div', { class: ok ? 'pz-ok' : 'pz-bad' }, ok ? '✓ Puzzle solved!' : '✗ Not the best move.')];
    if (out.ratingChange) { const d = out.ratingChange.after - out.ratingChange.before; lines.push(h('div', { class: d >= 0 ? 'win' : 'loss' }, `Rating ${out.ratingChange.before} → ${out.ratingChange.after} (${d >= 0 ? '+' : ''}${d})`)); }
    if (out.streak != null) lines.push(h('div', { class: 'pill accent' }, '🔥 Streak: ' + out.streak));
    msg.append(...lines); clear(info);
    info.append(h('div', { class: 'muted small' }, `Puzzle rating ${out.puzzleRating} · ${pz.themes.join(', ')}`), out.explanation ? h('p', { style: { marginTop: '8px' } }, richText(out.explanation)) : null);
    if (!ok && out.solution) { const f = out.solution.slice(0, 2), t = out.solution.slice(2, 4); rb.board.setArrows([{ from: f, to: t }]); info.append(h('div', { class: 'small' }, 'The solution started with ', h('strong', null, out.solution.slice(0, 2) + '→' + out.solution.slice(2, 4)), '.')); }
    clear(actions);
    if (isRun) { if (out.run?.over) return endRun(); await sleep(ok ? 500 : 1400); return next(); }
    actions.append(h('button', { class: 'btn primary', onclick: next }, 'Next puzzle →'), m !== 'daily' ? null : h('a', { class: 'btn', href: '#/puzzles' }, 'Back'));
  }
  if (isRun) {
    root.querySelector('.board-col').prepend(); runBox.append(h('p', { class: 'muted' }, MODES[m][2]), h('button', { class: 'btn primary large', onclick: () => { startRun(); } }, 'Start'));
    // preview board while waiting
    rb = new RB(host, { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', interactive: false });
  } else await next();
  return () => { dead = true; clearInterval(timer); rb?.destroy(); if (run && !over) post(`/api/puzzles/run/${run.run}/end`, {}).catch(() => {}); };
}
