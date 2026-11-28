// Floating owner panel (bottom-left). Only created for the owner account; every action is also enforced and logged by the server.
import { h, clear, toast, confirmBox, promptBox, cap } from './util.js';
import { state, get, post, on } from './api.js';

const KEY = 'rk_owner_panel'; let root = null, body = null, open = false, info = null;
const saved = () => { try { return localStorage.getItem(KEY) !== 'min'; } catch { return true; } };
const remember = (o) => { try { localStorage.setItem(KEY, o ? 'open' : 'min'); } catch { /* private mode */ } };

const sec = (title, openByDefault, ...kids) => { const d = h('details', { class: 'op-sec' }, h('summary', null, title), ...kids); d.open = (() => { try { const v = localStorage.getItem('rk_op_' + title); return v == null ? openByDefault : v === '1'; } catch { return openByDefault; } })(); d.addEventListener('toggle', () => { try { localStorage.setItem('rk_op_' + title, d.open ? '1' : '0'); } catch { /* ignore */ } }); return d; };
const ago = (t) => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'now' : m < 90 ? m + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };
let lookedUp = '';

async function render() {
  clear(body); if (!open) return;
  let info, st;
  try { [info, st] = await Promise.all([get('/api/owner/info'), get('/api/owner/stats')]); } catch (e) { body.append(h('p', { class: 'muted small' }, e.message)); return; }
  const run = (fn, ok) => async () => { try { const r = await fn(); toast(typeof ok === 'function' ? ok(r) : ok || 'Done', 'success'); render(); } catch (e) { if (e.message !== 'Cancelled') toast(e.message, 'error'); } };
  const sure = async (title, text, label) => { if (!await confirmBox(title, text, label)) throw new Error('Cancelled'); };
  const who = h('input', { class: 'input', placeholder: 'username', 'aria-label': 'Username', value: lookedUp }); const U = () => encodeURIComponent(who.value.trim());
  const cat = h('select', { 'aria-label': 'Rating category' }, info.categories.map((c) => h('option', { value: c }, cap(c)))); const rating = h('input', { class: 'input', type: 'number', min: 100, max: 3500, value: 1500, 'aria-label': 'Rating', style: { width: '6rem' } });
  const ach = h('select', { 'aria-label': 'Achievement' }, info.achievements.map((a) => h('option', { value: a.id }, a.name)));
  const msg = h('input', { class: 'input', maxlength: 200, placeholder: 'Announcement for everyone online', 'aria-label': 'Announcement' }); const unrated = h('input', { type: 'checkbox', id: 'own-unr' });
  const pinned = h('input', { class: 'input', maxlength: 200, placeholder: 'Message shown to everyone who opens the site', 'aria-label': 'Pinned message', value: st.pinned || '' });
  const card = h('div', { class: 'op-card small' });
  const lookup = async () => {
    clear(card); if (!who.value.trim()) return; lookedUp = who.value.trim();
    try {
      const u = await get(`/api/owner/users/${U()}`);
      card.append(h('div', null, h('strong', null, u.username), ` · ${u.owner ? 'owner' : u.role} · ${u.status}${u.reason ? ' (' + u.reason + ')' : ''} · ${u.online ? 'online' : 'seen ' + ago(u.last_seen)}`),
        h('div', { class: 'muted' }, `${u.email || 'no email'} · joined ${ago(u.created_at)} · ${u.games} games`), h('div', { class: 'muted' }, u.ratings.map((r) => `${r.category} ${r.rating}`).join(' · ')),
        u.owner ? h('div', { class: 'muted' }, 'Protected: owner') : h('div', { class: 'row' },
          u.status === 'active' ? h('button', { class: 'btn small danger', onclick: run(async () => { await sure('Ban ' + u.username + '?', 'They are signed out and cannot sign in.', 'Ban'); return post(`/api/admin/users/${u.id}/status`, { status: 'banned', reason: 'Banned by the owner' }); }, 'Banned') }, 'Ban') : h('button', { class: 'btn small', onclick: run(() => post(`/api/admin/users/${u.id}/status`, { status: 'active' }), 'Restored') }, 'Unban'),
          h('select', { 'aria-label': 'Role', onchange: (e) => run(() => post(`/api/admin/users/${u.id}/role`, { role: e.target.value }), 'Role updated')() }, ['user', 'mod', 'admin'].map((r) => h('option', { value: r, selected: r === u.role }, r))),
          h('button', { class: 'btn small', onclick: run(async () => { const n = await promptBox('Rename ' + u.username, 'New username'); if (n == null || !n.trim()) throw new Error('Cancelled'); lookedUp = n.trim(); return post(`/api/owner/users/${U()}/rename`, { username: n.trim() }); }, 'Renamed') }, 'Rename'),
          h('button', { class: 'btn small', onclick: run(async () => { await sure('Reset all ratings?', u.username + ' goes back to 1500 in every category.', 'Reset'); return post(`/api/owner/users/${U()}/reset-ratings`); }, 'Ratings reset') }, 'Reset ratings')));
    } catch (e) { card.append(h('span', { class: 'muted' }, e.message)); }
  };
  const games = info.games.length ? info.games.map((g) => h('div', { class: 'op-game' }, h('div', { class: 'small' }, h('a', { href: '#/game/' + g.id }, `${g.white} v ${g.black}`), ` · ${g.tc} ${g.rated ? 'rated' : 'casual'} · ${g.plies} plies`),
    h('div', { class: 'row' }, [['1-0', '1-0', 'White wins'], ['0-1', '0-1', 'Black wins'], ['½', '1/2-1/2', 'Draw']].map(([l, r, name]) => h('button', { class: 'btn small', title: 'Force: ' + name, onclick: run(async () => { await sure('Force result: ' + name, `${g.white} v ${g.black} ends now as "adjudicated by the site owner".` + (unrated.checked ? ' Ratings will not change.' : ' Ratings will change as for a normal result.'), 'End game'); return post(`/api/owner/games/${g.id}/result`, { result: r, unrated: unrated.checked }); }, 'Game ended') }, l)),
      h('button', { class: 'btn small danger', onclick: run(async () => { await sure('Abort game', 'No result and no rating change.', 'Abort'); return post(`/api/owner/games/${g.id}/abort`); }, 'Game aborted') }, 'Abort')))) : [h('p', { class: 'muted small' }, 'No games in progress.')];
  const stat = (k, v) => h('div', { class: 'op-stat' }, h('b', null, String(v)), h('span', null, k));
  body.append(
    h('div', { class: 'op-stats' }, stat('online', st.online), stat('live games', st.liveGames), stat('players', st.users), stat('new today', st.newToday), stat('games today', st.gamesToday), stat('database', st.dbKB + ' KB')),
    h('p', { class: 'muted small' }, `Version ${st.build} · up ${st.uptimeMin} min · backup ${st.backup.enabled ? (st.backup.error ? 'ERROR' : st.backup.last ? 'saved ' + ago(Date.parse(st.backup.last)) : 'on, waiting') : 'off'}`),
    sec('Games in progress', true, ...games, h('label', { class: 'row small' }, unrated, h('span', null, 'Forced results keep ratings')),
      h('div', { class: 'row' }, h('button', { class: 'btn small danger', onclick: run(async () => { await sure('End ALL games?', 'Every game in progress is aborted with no result.', 'Abort all'); return post('/api/owner/games/abort-all'); }, (r) => `${r.aborted} games aborted`) }, 'Abort all'), h('button', { class: 'btn small', onclick: run(() => post('/api/owner/seeks/clear'), (r) => `${r.cleared} lobby seeks cleared`) }, 'Clear lobby'), h('button', { class: 'btn small ghost', onclick: render }, 'Refresh'))),
    sec('Player', true, h('div', { class: 'row' }, who, h('button', { class: 'btn small', onclick: lookup }, 'Look up')), card,
      h('div', { class: 'row' }, cat, rating, h('button', { class: 'btn small', onclick: run(() => post(`/api/owner/users/${U()}/rating`, { category: cat.value, rating: Number(rating.value) }), 'Rating set') }, 'Set rating')),
      h('div', { class: 'row' }, ach, h('button', { class: 'btn small', onclick: run(() => post(`/api/owner/users/${U()}/achievements`, { id: ach.value }), (r) => r.granted ? 'Achievement granted' : 'They already have it') }, 'Grant'), h('button', { class: 'btn small', onclick: run(() => post(`/api/owner/users/${U()}/achievements`, { all: true }), (r) => `${r.granted} granted`) }, 'All')),
      h('button', { class: 'btn small danger', onclick: run(async () => { await sure('Sign out ' + who.value.trim() + '?', 'Ends their sessions and disconnects them. They can sign in again.', 'Sign out'); return post(`/api/owner/users/${U()}/kick`); }, 'Signed out') }, 'Sign out everywhere')),
    sec('Site', true, msg,
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: run(async () => { const r = await post('/api/owner/broadcast', { text: msg.value }); msg.value = ''; return r; }, 'Announcement sent') }, 'Announce'), h('button', { class: 'btn small', title: 'Shows the "new version, refresh" bar to everyone online', onclick: run(() => post('/api/owner/refresh-all'), (r) => `Refresh prompt sent to ${r.online} online`) }, 'Ask all to refresh')),
      pinned, h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: run(() => post('/api/owner/settings', { pinned: pinned.value }), () => (pinned.value.trim() ? 'Pinned message saved' : 'Pinned message cleared')) }, 'Save pinned message'), h('button', { class: 'btn small ghost', onclick: run(() => post('/api/owner/settings', { pinned: '' }), 'Pinned message cleared') }, 'Clear')),
      h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: st.signupsOpen, 'aria-label': 'Sign-ups open', onchange: (e) => run(() => post('/api/owner/settings', { signupsOpen: !!e.target.checked }), 'Sign-up setting saved')() }), h('span', null, 'New sign-ups are open')),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: run(() => post('/api/owner/backup-now'), (r) => r.ok ? 'Backup saved' : 'Backup failed: ' + (r.error || 'see logs')) }, 'Back up now')),
      h('p', { class: 'muted small' }, 'All actions are in the audit log.')));
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
