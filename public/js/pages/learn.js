import { h, clear, toast, spinner } from '../util.js';
import { state, get, post } from '../api.js';
import { RB, richText, sleep, norm } from '../learn-common.js';
import { play } from '../sound.js';
import { Chess, START_FEN } from '/shared/chess.js';
import { mateMoves, longestDefence } from '/shared/engine.js';

const LV = { beginner: '🌱 Beginner', intermediate: '🌿 Intermediate', advanced: '🌳 Advanced' };
const local = { get: () => { try { return JSON.parse(localStorage.getItem('rk_lessons') || '{}'); } catch { return {}; } }, set: (id, v) => { const d = local.get(); d[id] = { ...d[id], ...v }; try { localStorage.setItem('rk_lessons', JSON.stringify(d)); } catch {} } };

export default async function list(root, ctx) {
  ctx.setTitle('Lessons');
  const { lessons } = await get('/api/lessons'); const loc = local.get();
  const done = (l) => l.completed || loc[l.id]?.completed; const total = lessons.length, nDone = lessons.filter(done).length;
  root.append(h('h1', null, 'Learn chess'), h('p', { class: 'muted' }, 'Every lesson is free. Start at the beginning or jump to what you need.'), h('div', { class: 'card' }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('strong', null, `Your progress: ${nDone} of ${total} lessons`), state.user ? null : h('span', { class: 'muted small' }, 'Saved on this device — log in to keep it everywhere')), h('div', { class: 'progress', style: { marginTop: '8px' } }, h('i', { style: { width: (nDone / total * 100) + '%' } }))));
  for (const lv of ['beginner', 'intermediate', 'advanced']) {
    const inLv = lessons.filter((l) => l.level === lv); if (!inLv.length) continue;
    root.append(h('div', { class: 'section-title' }, h('h2', null, LV[lv])));
    const cats = [...new Set(inLv.map((l) => l.category))];
    for (const c of cats) root.append(h('h3', { class: 'muted', style: { margin: '14px 0 8px' } }, c), h('div', { class: 'grid-3' }, inLv.filter((l) => l.category === c).map((l) => h('a', { class: 'card hover lesson-card' + (done(l) ? ' done' : ''), href: '#/learn/' + l.id }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('h3', { style: { margin: 0 } }, l.title), done(l) ? h('span', { class: 'pill good' }, '✓ Done') : null), h('p', { class: 'muted small', style: { margin: '6px 0' } }, l.summary), h('div', { class: 'muted small' }, `${l.steps} steps · ${l.minutes} min`)))));
  }
}

export async function lesson(root, ctx) {
  const { lesson: L, progress } = await get('/api/lessons/' + ctx.params.id); ctx.setTitle(L.title); ctx.wide();
  let idx = Math.min(progress?.step || local.get()[L.id]?.step || 0, L.steps.length - 1); if (progress?.completed) idx = 0;
  let rb = null, dead = false;
  const host = h('div'), panel = h('div', { class: 'card lesson-panel' }), bar = h('div', { class: 'progress' }, h('i')), nav = h('div', { class: 'row' });
  root.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('a', { href: '#/learn' }, '← All lessons'), h('span', { class: 'muted small' }, `${L.level} · ${L.category}`)), h('h1', { style: { fontSize: '1.8rem' } }, L.title), bar,
    h('div', { class: 'game-layout lesson-layout' }, h('div', { class: 'board-col fill' }, host), h('div', { class: 'side-panel' }, panel)));
  const save = (step, completed) => { local.set(L.id, { step, completed: completed || local.get()[L.id]?.completed }); if (state.user) post(`/api/lessons/${L.id}/progress`, { step, completed: !!completed }).catch(() => {}); };
  function board(fen, { movable = 'none', onMove } = {}) {
    const orient = fen.split(' ')[1] === 'b' && movable !== 'none' ? 'b' : (rb?.board.o.orientation || 'w');
    if (rb) { rb.board.destroy(); rb.g = null; rb = null; } clear(host);
    rb = new RB(host, { fen, orientation: orient, movable: movable === 'none' ? 'w' : movable, interactive: movable !== 'none', onUserMove: onMove }); return rb;
  }
  async function show() {
    if (dead) return; const s = L.steps[idx]; bar.firstChild.style.width = (idx / L.steps.length * 100) + '%'; clear(panel); clear(nav);
    panel.append(h('div', { class: 'muted small' }, `Step ${idx + 1} of ${L.steps.length}`));
    const next = (label = 'Continue →') => h('button', { class: 'btn primary', onclick: advance }, label);
    if (s.type === 'text') {
      const b = board(s.fen || START_FEN); if (s.marks) b.board.setHints(s.marks);
      panel.append(h('h2', null, s.title), h('p', { class: 'lesson-body' }, richText(s.body)), h('div', { class: 'row' }, idx > 0 ? h('button', { class: 'btn', onclick: () => { idx--; show(); } }, '← Back') : null, next(idx === L.steps.length - 1 ? 'Finish ✓' : 'Continue →')));
      return;
    }
    panel.append(h('h2', null, s.prompt)); const fb = h('div', { class: 'lesson-fb' }), acts = h('div', { class: 'row' }); panel.append(fb, acts);
    let solved = false; const hintBtn = s.hint ? h('button', { class: 'btn ghost small', onclick: () => { fb.className = 'lesson-fb'; fb.textContent = '💡 ' + s.hint; } }, '💡 Hint') : null;
    const win = (extra) => { solved = true; play('right'); fb.className = 'lesson-fb ok'; clear(fb); fb.append('✓ Correct! ', s.explain ? richText(s.explain) : '', extra || ''); clear(acts); acts.append(next(idx === L.steps.length - 1 ? 'Finish ✓' : 'Next →')); if (rb) rb.board.setInteractive(false); };
    const lose = (t) => { play('wrong'); fb.className = 'lesson-fb bad'; fb.textContent = t || 'Not quite — try again.'; };
    if (s.kind === 'move') {
      board(s.fen, { movable: s.fen.split(' ')[1], onMove: async (f, t, p) => { const u = f + t + (p || ''); if (s.solutions.includes(u)) { rb.apply(u); win(); return true; } lose(); return false; } });
      acts.append(hintBtn);
    } else if (s.kind === 'reach') {
      const b = board(s.fen); const g = new Chess(s.fen); const targets = new Set(g.moves({ square: s.square, verbose: true }).map((m) => m.to)); const picked = new Set();
      b.board.setHints([s.square]); host.addEventListener('pointerdown', (e) => { if (solved) return; const sq = b.board.sqAt(e); if (!sq || sq === s.square) return; picked.has(sq) ? picked.delete(sq) : picked.add(sq); b.board.setHints([s.square, ...picked]); fb.textContent = `${picked.size} of ${targets.size} squares selected`; fb.className = 'lesson-fb'; });
      acts.append(h('button', { class: 'btn primary', onclick: () => { const ok = picked.size === targets.size && [...picked].every((x) => targets.has(x)); if (ok) win(); else { const miss = [...targets].filter((x) => !picked.has(x)).length, wrong = [...picked].filter((x) => !targets.has(x)).length; lose(`${wrong ? wrong + ' square(s) are not legal. ' : ''}${miss ? miss + ' legal square(s) missing.' : ''}`); } } }, 'Check'), hintBtn, h('button', { class: 'btn ghost small', onclick: () => { picked.clear(); b.board.setHints([s.square]); fb.textContent = ''; } }, 'Clear'));
    } else if (s.kind === 'mate') {
      let made = 0, busy = false; const side = s.fen.split(' ')[1];
      board(s.fen, { movable: side, onMove: async (f, t, p) => {
        if (busy) return false; const u = f + t + (p || ''); const good = mateMoves(new Chess(rb.g.fen()), s.n - made); if (!good.includes(u)) { lose(s.n - made === 1 ? 'That does not deliver checkmate. Look for a check the king cannot escape.' : 'That does not force mate in the remaining moves — try again.'); return false; }
        busy = true; rb.apply(u); made++; if (rb.g.isCheckmate()) { win(); busy = false; return true; }
        await sleep(450); const r = longestDefence(rb.g, s.n - made); if (r) rb.apply(r); fb.className = 'lesson-fb ok'; fb.textContent = '✓ Good — keep going, mate is still forced.'; busy = false; return true; } });
      acts.append(hintBtn, h('button', { class: 'btn ghost small', onclick: () => { made = 0; board(s.fen, {}); show(); } }, '↺ Reset'));
    } else if (s.kind === 'choice') {
      board(s.fen || START_FEN); host.classList.add('dim');
      for (let i = 0; i < s.options.length; i++) acts.append(h('button', { class: 'btn block choice', style: { textAlign: 'left' }, onclick: (e) => { if (solved) return; if (i === s.answer) { e.target.classList.add('right'); win(); } else { e.target.classList.add('wrong'); e.target.disabled = true; lose('Not quite — pick another answer.'); } } }, s.options[i]));
      acts.className = 'col';
    } else if (s.kind === 'line') {
      const moves = s.moves.split(' '); let k = 0; const side = s.side;
      const b = board(START_FEN, { movable: side, onMove: async (f, t, p) => {
        const probe = new Chess(rb.g.fen()); const mv = probe.move({ from: f, to: t, promotion: p }); if (!mv) return false;
        if (norm(mv.san) !== norm(moves[k])) { lose(`Not the line — the book move here is ${moves[k]}.`); return false; }
        rb.apply({ from: f, to: t, promotion: p }); k++; fb.className = 'lesson-fb'; fb.textContent = `${k} / ${moves.length} moves`; await botMoves(); return true; } });
      b.board.setOrientation(side);
      async function botMoves() { while (k < moves.length && rb.g.turnColor() !== side) { await sleep(450); rb.apply(moves[k]); k++; } if (k >= moves.length) win(); else { rb.board.setInteractive(true, side); } }
      acts.append(hintBtn, h('button', { class: 'btn ghost small', onclick: show }, '↺ Restart')); await botMoves();
    }
    if (!solved) acts.append(h('button', { class: 'btn ghost small', onclick: () => { clear(fb); fb.className = 'lesson-fb'; fb.textContent = 'Skipped — you can come back to this later.'; advance(); } }, 'Skip'));
  }
  function advance() { if (idx >= L.steps.length - 1) return finish(); idx++; save(idx, false); show(); }
  function finish() {
    save(L.steps.length - 1, true); bar.firstChild.style.width = '100%'; play('win'); if (rb) { rb.board.destroy(); rb = null; clear(host); } clear(panel);
    panel.append(h('h2', null, '🎉 Lesson complete!'), h('p', null, L.title + ' is done.'), h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '#/learn' }, 'More lessons'), h('button', { class: 'btn', onclick: () => { idx = 0; show(); } }, 'Review')));
  }
  await show();
  return () => { dead = true; rb?.destroy(); };
}
