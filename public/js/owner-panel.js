// Floating owner panel (bottom-left). Only created for the owner account; every action is also enforced and logged by the server.
import { h, clear, toast, confirmBox, cap } from './util.js';
import { state, get, post, on } from './api.js';

const KEY = 'rk_owner_panel'; let root = null, body = null, open = false, info = null;
const saved = () => { try { return localStorage.getItem(KEY) !== 'min'; } catch { return true; } };
const remember = (o) => { try { localStorage.setItem(KEY, o ? 'open' : 'min'); } catch { /* private mode */ } };

async function render() {
  clear(body); if (!open) return;
  try { info = await get('/api/owner/info'); } catch (e) { body.append(h('p', { class: 'muted small' }, e.message)); return; }
  const run = (fn, ok) => async () => { try { const r = await fn(); toast(typeof ok === 'function' ? ok(r) : ok || 'Done', 'success'); render(); } catch (e) { if (e.message !== 'Cancelled') toast(e.message, 'error'); } };
  const sure = async (title, text, label) => { if (!await confirmBox(title, text, label)) throw new Error('Cancelled'); };
  const who = h('input', { class: 'input', placeholder: 'username', 'aria-label': 'Username' }); const U = () => encodeURIComponent(who.value.trim());
  const cat = h('select', { 'aria-label': 'Rating category' }, info.categories.map((c) => h('option', { value: c }, cap(c)))); const rating = h('input', { class: 'input', type: 'number', min: 100, max: 3500, value: 1500, 'aria-label': 'Rating', style: { width: '6rem' } });
  const ach = h('select', { 'aria-label': 'Achievement' }, info.achievements.map((a) => h('option', { value: a.id }, a.name)));
  const msg = h('input', { class: 'input', maxlength: 200, placeholder: 'Announcement for everyone online', 'aria-label': 'Announcement' }); const unrated = h('input', { type: 'checkbox', id: 'own-unr' });
  const games = info.games.length ? info.games.map((g) => h('div', { class: 'op-game' }, h('div', { class: 'small' }, h('a', { href: '#/game/' + g.id }, `${g.white} v ${g.black}`), ` · ${g.tc} ${g.rated ? 'rated' : 'casual'} · ${g.plies} plies`),
    h('div', { class: 'row' }, [['1-0', '1-0', 'White wins'], ['0-1', '0-1', 'Black wins'], ['½', '1/2-1/2', 'Draw']].map(([l, r, name]) => h('button', { class: 'btn small', title: 'Force: ' + name, onclick: run(async () => { await sure('Force result: ' + name, `${g.white} v ${g.black} ends now as "adjudicated by the site owner".` + (unrated.checked ? ' Ratings will not change.' : ' Ratings will change as for a normal result.'), 'End game'); return post(`/api/owner/games/${g.id}/result`, { result: r, unrated: unrated.checked }); }, 'Game ended') }, l)),
      h('button', { class: 'btn small danger', onclick: run(async () => { await sure('Abort game', 'No result and no rating change.', 'Abort'); return post(`/api/owner/games/${g.id}/abort`); }, 'Game aborted') }, 'Abort')))) : [h('p', { class: 'muted small' }, 'No games in progress.')];
  body.append(
    h('div', { class: 'op-sec' }, h('strong', null, 'Games in progress'), ...games, h('label', { class: 'row small' }, unrated, h('span', null, 'Forced results keep ratings')),
      h('div', { class: 'row' }, h('button', { class: 'btn small danger', onclick: run(async () => { await sure('End ALL games?', 'Every game in progress is aborted with no result.', 'Abort all'); return post('/api/owner/games/abort-all'); }, (r) => `${r.aborted} games aborted`) }, 'Abort all'), h('button', { class: 'btn small ghost', onclick: render }, 'Refresh'))),
    h('div', { class: 'op-sec' }, h('strong', null, 'Player'), who,
      h('div', { class: 'row' }, cat, rating, h('button', { class: 'btn small', onclick: run(() => post(`/api/owner/users/${U()}/rating`, { category: cat.value, rating: Number(rating.value) }), 'Rating set') }, 'Set rating')),
      h('div', { class: 'row' }, ach, h('button', { class: 'btn small', onclick: run(() => post(`/api/owner/users/${U()}/achievements`, { id: ach.value }), (r) => r.granted ? 'Achievement granted' : 'They already have it') }, 'Grant'), h('button', { class: 'btn small', onclick: run(() => post(`/api/owner/users/${U()}/achievements`, { all: true }), (r) => `${r.granted} granted`) }, 'All')),
      h('button', { class: 'btn small danger', onclick: run(async () => { await sure('Sign out ' + who.value.trim() + '?', 'Ends their sessions and disconnects them. They can sign in again.', 'Sign out'); return post(`/api/owner/users/${U()}/kick`); }, 'Signed out') }, 'Sign out everywhere')),
    h('div', { class: 'op-sec' }, h('strong', null, 'Site'), msg,
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: run(async () => { const r = await post('/api/owner/broadcast', { text: msg.value }); msg.value = ''; return r; }, 'Announcement sent') }, 'Announce'), h('button', { class: 'btn small', title: 'Shows the "new version, refresh" bar to everyone online', onclick: run(() => post('/api/owner/refresh-all'), (r) => `Refresh prompt sent to ${r.online} online`) }, 'Ask all to refresh'), h('button', { class: 'btn small', onclick: run(() => post('/api/owner/backup-now'), (r) => r.ok ? 'Backup saved' : 'Backup failed: ' + (r.error || 'see logs')) }, 'Back up now')),
      h('p', { class: 'muted small' }, `Version ${info.build} \u00b7 all actions are in the audit log.`)));
}

function toggle(o) { open = o; remember(o); root.classList.toggle('min', !o); head.setAttribute('aria-expanded', String(o)); arrow.textContent = o ? '▾' : '▴'; render(); }
let head, arrow;
export function syncOwnerPanel() {
  const want = !!state.user?.owner;
  if (!want) { root?.remove(); root = null; return; }
  if (root) return;
  arrow = h('span', null, '▴'); head = h('button', { class: 'op-head', 'aria-expanded': 'false', onclick: () => toggle(!open) }, h('span', null, '★ Owner tools'), arrow);
  body = h('div', { class: 'op-body' }); root = h('aside', { class: 'owner-panel min', 'aria-label': 'Owner tools' }, head, body); document.body.append(root);
  toggle(saved());
}
export function startOwnerPanel() { syncOwnerPanel(); on('user', syncOwnerPanel); }
