import { h, clear, toast, tabs, download, pickFile, promptBox, confirmBox, debounce } from '../util.js';
import { state, get, post, del } from '../api.js';
import { RB, richText, sleep, norm } from '../learn-common.js';
import { OPENINGS, FEATURED, classify, nextBookMoves, matching } from '/shared/openings.js';
import { Chess, START_FEN } from '/shared/chess.js';
import { parsePgn, toPgn } from '/shared/pgn.js';

const LOCAL = 'rk_repertoires';
const repo = {
  async list() { if (state.user) return (await get('/api/repertoires')).repertoires; try { return JSON.parse(localStorage.getItem(LOCAL) || '[]'); } catch { return []; } },
  async save(r) { if (state.user) return post('/api/repertoires', r); const all = await this.list(); if (r.id) { const i = all.findIndex((x) => x.id === r.id); all[i] = { ...all[i], ...r }; } else { r.id = Date.now(); all.push(r); } localStorage.setItem(LOCAL, JSON.stringify(all)); return { id: r.id }; },
  async remove(id) { if (state.user) return del('/api/repertoires/' + id); localStorage.setItem(LOCAL, JSON.stringify((await this.list()).filter((x) => x.id !== id))); },
};
const fenOf = (sans) => Chess.replay(sans).fen();

export default async function openings(root, ctx) {
  ctx.setTitle('Opening explorer'); ctx.wide();
  let tab = 'explore'; const body = h('div'); let cleanup = () => {};
  const t = tabs([['explore', '🧭 Explorer'], ['trainer', '🎯 Trainer'], ['repertoire', '📚 Repertoire']], tab, (id) => { tab = id; show(); });
  root.append(h('h1', null, 'Opening explorer'), h('p', { class: 'muted' }, `${OPENINGS.length} openings and variations with ECO codes, ideas and move explanations. Free to use, no limits.`), t, body);
  const pre = ctx.query.line ? ctx.query.line.split(',') : null;
  function show() { cleanup(); clear(body); cleanup = ({ explore: explorer, trainer, repertoire }[tab])(body, ctx, pre) || (() => {}); }
  show(); return () => cleanup();
}

function explorer(body, ctx, preset) {
  let sans = preset || []; let rb; let dead = false;
  const host = h('div'), nameEl = h('h2', { style: { margin: 0 } }), ecoEl = h('span', { class: 'pill accent' }), ideaEl = h('p'), noteEl = h('p', { class: 'note' }), bookEl = h('div', { class: 'col', style: { gap: '6px' } }), statsEl = h('div'), listEl = h('div', { class: 'list opening-list' }), movesEl = h('div', { class: 'line-moves' });
  const search = h('input', { type: 'search', placeholder: 'Search by name or ECO (e.g. B90, Sicilian)…', 'aria-label': 'Search openings' });
  const featured = h('div', { class: 'row' }, FEATURED.map((eco) => { const o = OPENINGS.find((x) => x.eco === eco); return h('button', { class: 'btn small', onclick: () => load(o.moves) }, o.family); }));
  const lineStr = () => sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + s).join(' ');
  rb = new RB(host, { fen: START_FEN, onUserMove: (f, tt, p) => { const mv = rb.apply({ from: f, to: tt, promotion: p }); if (!mv) return false; sans.push(mv.san); update(false); return true; } });
  body.append(h('div', { class: 'game-layout' }, h('div', { class: 'board-col fill' }, host, h('div', { class: 'row', style: { marginTop: '10px', justifyContent: 'center' } }, h('button', { class: 'btn', onclick: () => { if (sans.length) { sans.pop(); rb.undo(); update(); } } }, '◀ Back'), h('button', { class: 'btn', onclick: () => load([]) }, '⟲ Reset'), h('button', { class: 'btn', onclick: () => rb.board.flip() }, '⇅ Flip'), h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(lineStr()); toast('Line copied'); } }, '📋 Copy'))),
    h('div', { class: 'side-panel' }, h('div', { class: 'card' }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, nameEl, ecoEl), movesEl, ideaEl, noteEl), h('div', { class: 'card' }, h('p', { class: 'panel-title' }, 'Book moves'), bookEl), h('div', { class: 'card' }, h('p', { class: 'panel-title' }, 'Results in games on Rookery'), statsEl), h('div', { class: 'card' }, h('p', { class: 'panel-title' }, 'Popular openings'), featured, h('div', { style: { height: '10px' } }), search, listEl))));
  function load(line) { sans = [...line]; rb.load(START_FEN); for (const s of sans) rb.g.move(s); rb.sync(null, false); update(); }
  async function update() {
    if (dead) return; const o = classify(sans); const exact = o && o.moves.length === sans.length;
    nameEl.textContent = o ? o.name : sans.length ? 'Unlisted line' : 'Starting position'; ecoEl.textContent = o ? o.eco : '—'; ecoEl.hidden = !o;
    clear(movesEl); movesEl.append(sans.length ? lineStr() : 'Play a move on the board, or pick an opening below.');
    ideaEl.textContent = o?.idea || ''; const idx = sans.length - 1; const m = o && o.notes[idx] ? o.notes[idx] : (matching(sans).find((x) => x.notes[idx])?.notes[idx] || ''); noteEl.textContent = m ? `${sans[idx]}: ${m}` : '';
    clear(bookEl); const nb = nextBookMoves(sans); if (!nb.length) bookEl.append(h('span', { class: 'muted small' }, 'End of the book for this line.'));
    for (const b of nb.slice(0, 8)) bookEl.append(h('button', { class: 'btn small block book', onclick: () => { const mv = rb.apply(b.san); if (mv) { sans.push(b.san); update(); } } }, h('strong', null, b.san), h('span', { class: 'muted small' }, ' ' + [...new Set(b.openings.map((x) => x.name))].slice(0, 2).join(' · '))));
    drawList(); rb.board.setArrows([]);
    try { const s = await get('/api/openings/stats?moves=' + encodeURIComponent(sans.join(','))); drawStats(s); } catch {}
  }
  function drawStats(s) {
    clear(statsEl); const n = s.total.n; if (n < 5) { statsEl.append(h('p', { class: 'muted small' }, n ? `Only ${n} game(s) so far — not enough to be meaningful.` : 'No games from this position have been played on this site yet.')); return; }
    const bar = (x) => h('div', { class: 'wdl' }, h('i', { class: 'w', style: { width: x.w / x.n * 100 + '%' } }, Math.round(x.w / x.n * 100) + '%'), h('i', { class: 'd', style: { width: x.d / x.n * 100 + '%' } }), h('i', { class: 'b', style: { width: x.b / x.n * 100 + '%' } }, Math.round(x.b / x.n * 100) + '%'));
    statsEl.append(h('div', { class: 'small muted' }, `${n} games`), bar(s.total), ...s.next.slice(0, 6).map((x) => h('div', { class: 'row small', style: { gap: '8px', flexWrap: 'nowrap', marginTop: '6px' } }, h('strong', { style: { width: '48px' } }, x.san), h('span', { class: 'muted', style: { width: '46px' } }, x.n), h('div', { style: { flex: 1 } }, bar(x)))));
  }
  function drawList() { clear(listEl); const q = search.value.trim().toLowerCase(); const items = (q ? OPENINGS.filter((o) => o.name.toLowerCase().includes(q) || o.eco.toLowerCase().startsWith(q)) : matching(sans)).slice(0, 40); if (!items.length) listEl.append(h('div', { class: 'muted pad' }, 'No openings match.')); for (const o of items) listEl.append(h('a', { href: 'javascript:void(0)', class: 'op-row', onclick: (e) => { e.preventDefault(); load(o.moves); } }, h('span', { class: 'chip' }, o.eco), h('span', null, o.name))); }
  search.addEventListener('input', debounce(drawList, 150));
  update(); return () => { dead = true; rb.destroy(); };
}

function trainer(body, ctx) {
  let rb; let dead = false; let k = 0, mistakes = 0, side = 'w', line = null, busy = false;
  const host = h('div'), fb = h('div', { class: 'lesson-fb' }), sel = h('select', null, OPENINGS.map((o, i) => h('option', { value: i }, `${o.eco} ${o.name} (${Math.ceil(o.moves.length / 2)} moves)`))), sideSel = h('select', null, h('option', { value: 'w' }, 'I play White'), h('option', { value: 'b' }, 'I play Black'));
  sel.value = String(OPENINGS.findIndex((o) => o.eco === 'C50')); const score = h('div', { class: 'muted' });
  rb = new RB(host, { fen: START_FEN, interactive: false, onUserMove: async (f, t, p) => {
    if (busy || !line) return false; const probe = new Chess(rb.g.fen()); const mv = probe.move({ from: f, to: t, promotion: p }); if (!mv) return false;
    if (norm(mv.san) !== norm(line.moves[k])) { mistakes++; fb.className = 'lesson-fb bad'; fb.textContent = `✗ Not the book move. The line continues ${line.moves[k]}.`; rb.board.setHints([]); const probe2 = new Chess(rb.g.fen()); const bm = probe2.move(line.moves[k]); if (bm) rb.board.setArrows([{ from: bm.from, to: bm.to }]); updScore(); return false; }
    rb.board.setArrows([]); rb.apply({ from: f, to: t, promotion: p }); k++; fb.className = 'lesson-fb ok'; fb.textContent = '✓ Book move'; updScore(); await bot(); return true; } });
  const updScore = () => { score.textContent = `Move ${Math.min(k + 1, line?.moves.length || 0)} of ${line?.moves.length || 0} · mistakes: ${mistakes}`; };
  async function bot() { busy = true; while (!dead && k < line.moves.length && rb.g.turnColor() !== side) { await sleep(500); rb.apply(line.moves[k]); k++; } busy = false; if (k >= line.moves.length) { fb.className = 'lesson-fb ok'; fb.textContent = mistakes ? `Line complete with ${mistakes} mistake(s). Try again for a clean run!` : '🎉 Perfect — you played the whole line without a mistake!'; rb.board.setInteractive(false); } else rb.board.setInteractive(true, side); updScore(); const o = line; const note = o.notes[k - 1]; if (note && !fb.textContent.startsWith('✗')) fb.append(h('div', { class: 'small muted' }, note)); }
  async function start() { line = OPENINGS[+sel.value]; side = sideSel.value; k = 0; mistakes = 0; rb.load(START_FEN, side); rb.board.setInteractive(false); fb.textContent = ''; fb.className = 'lesson-fb'; updScore(); await bot(); }
  body.append(h('div', { class: 'game-layout' }, h('div', { class: 'board-col fill' }, host), h('div', { class: 'side-panel' }, h('div', { class: 'card' }, h('h3', null, 'Opening trainer'), h('p', { class: 'muted' }, 'Pick a line and a side. You play your moves from memory; the computer plays the book replies and flags any deviation.'), h('label', { class: 'field' }, h('span', null, 'Opening'), sel), h('label', { class: 'field' }, h('span', null, 'Side'), sideSel), h('button', { class: 'btn primary', onclick: start }, '▶ Start training'), h('div', { style: { marginTop: '12px' } }, score), fb, line ? null : null, h('div', { class: 'small muted', id: 'idea' })))));
  sel.addEventListener('change', () => { const o = OPENINGS[+sel.value]; body.querySelector('#idea').textContent = o.idea; }); body.querySelector('#idea').textContent = OPENINGS[+sel.value].idea;
  return () => { dead = true; rb.destroy(); };
}

function repertoire(body, ctx) {
  let dead = false; const wrap = h('div'); body.append(wrap);
  async function draw() {
    if (dead) return; clear(wrap); let list = []; try { list = await repo.list(); } catch (e) { wrap.append(h('div', { class: 'card error-box' }, e.message)); return; }
    wrap.append(h('div', { class: 'card' }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('div', null, h('h3', { style: { margin: 0 } }, 'Your repertoires'), h('div', { class: 'muted small' }, state.user ? 'Saved to your account.' : 'Saved on this device only — log in to keep them everywhere.')), h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: create }, '+ New repertoire'), h('button', { class: 'btn', onclick: importPgn }, '⬆ Import PGN')))));
    if (!list.length) wrap.append(h('div', { class: 'card empty' }, 'No repertoires yet. Create one, then add lines from the Explorer tab ("Copy" a line and paste it here) or import a PGN.'));
    for (const r of list) wrap.append(card(r));
  }
  async function create() { const name = await promptBox('New repertoire', 'Name', { okLabel: 'Create' }); if (!name) return; await repo.save({ name, color: 'w', lines: [] }); draw(); }
  async function importPgn() {
    const f = await pickFile('.pgn,.txt'); let text = f ? await f.text() : await promptBox('Paste PGN', 'PGN text', { textarea: true, okLabel: 'Import' }); if (!text) return;
    const { games, errors } = parsePgn(text); if (!games.length) return toast('No valid games found' + (errors[0] ? ': ' + errors[0] : ''), 'error');
    const lines = games.map((g) => g.moves.slice(0, 40)); const color = games[0].headers.Orientation === 'Black' ? 'b' : 'w';
    await repo.save({ name: (f?.name || 'Imported').replace(/\.\w+$/, '').slice(0, 50), color, lines }); toast(`Imported ${lines.length} line(s)` + (errors.length ? `, ${errors.length} skipped` : ''), 'success'); draw();
  }
  function card(r) {
    const lines = r.lines || []; const view = h('div', { class: 'col', style: { gap: '4px' } });
    const refresh = () => { clear(view); if (!lines.length) view.append(h('span', { class: 'muted small' }, 'No lines yet.')); lines.forEach((l, i) => view.append(h('div', { class: 'row small', style: { gap: '8px', flexWrap: 'nowrap' } }, h('span', { class: 'mono', style: { flex: 1 } }, l.map((s, j) => (j % 2 === 0 ? `${j / 2 + 1}.` : '') + s).join(' ')), h('a', { href: '#/openings?line=' + l.join(',') }, 'Open'), h('button', { class: 'icon-btn', 'aria-label': 'Remove line', onclick: async () => { lines.splice(i, 1); await repo.save({ ...r, lines }); refresh(); } }, '✕')))); };
    refresh();
    return h('div', { class: 'card', style: { marginTop: '12px' } }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('h3', { style: { margin: 0 } }, r.name, ' ', h('span', { class: 'pill' }, r.color === 'w' ? 'White' : 'Black')), h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: async () => { const t = await promptBox('Add a line', 'Moves in SAN, e.g. 1. e4 e5 2. Nf3 Nc6', { okLabel: 'Add' }); if (!t) return; const { games } = parsePgn(t.replace(/\n/g, ' ')); const mv = games[0]?.moves; if (!mv?.length) return toast('Could not read those moves — check they are legal', 'error'); lines.push(mv); await repo.save({ ...r, lines }); refresh(); } }, '+ Line'),
      h('button', { class: 'btn small', onclick: () => { r.color = r.color === 'w' ? 'b' : 'w'; repo.save({ ...r, lines }).then(draw); } }, 'Swap colour'),
      h('button', { class: 'btn small', disabled: !lines.length, onclick: () => drill(r, lines) }, '🎯 Drill'),
      h('button', { class: 'btn small', disabled: !lines.length, onclick: () => download((r.name || 'repertoire').replace(/\W+/g, '_') + '.pgn', lines.map((l, i) => toPgn({ headers: { Event: r.name, Round: String(i + 1), Orientation: r.color === 'w' ? 'White' : 'Black' }, moves: l, result: '*' })).join('\n')) }, '⬇ PGN'),
      h('button', { class: 'btn small danger', onclick: async () => { if (await confirmBox('Delete repertoire?', r.name, 'Delete')) { await repo.remove(r.id); draw(); } } }, 'Delete'))), h('div', { style: { marginTop: '10px' } }, view));
  }
  function drill(r, lines) { // reuse the trainer engine on a custom line chosen at random
    const l = lines[Math.floor(Math.random() * lines.length)]; clear(body); const o = { eco: 'REP', name: r.name, moves: l, idea: 'Drilling a random line from your repertoire.', notes: {} };
    OPENINGS.push(o); const stop = trainer(body, ctx); const sel = body.querySelector('select'); sel.value = String(OPENINGS.length - 1); body.querySelector('select:nth-of-type(2)') ; const sides = body.querySelectorAll('select')[1]; sides.value = r.color; body.querySelector('.btn.primary').click(); body.prepend(h('button', { class: 'btn small', onclick: () => { stop(); OPENINGS.pop(); clear(body); body.append(wrap); draw(); } }, '← Back to repertoires')); cleanupDrill = () => { stop(); const i = OPENINGS.indexOf(o); if (i >= 0) OPENINGS.splice(i, 1); };
  }
  let cleanupDrill = null; draw();
  return () => { dead = true; cleanupDrill?.(); };
}
