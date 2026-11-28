import { h, clear, toast, avatar, ago, userLink, spinner, errorBox, confirmBox, promptBox, modal, fmtDate, cap } from '../util.js';
import { state, get, post, del, on } from '../api.js';

export default async function clubs(root, ctx) {
  ctx.setTitle('Clubs');
  const list = h('div', { class: 'grid-3' }); const search = h('input', { type: 'search', placeholder: 'Search clubs…', 'aria-label': 'Search clubs' });
  let timer;
  async function load() {
    clear(list); list.append(spinner());
    try {
      const r = await get('/api/clubs?q=' + encodeURIComponent(search.value.trim())); clear(list);
      if (!r.clubs.length) list.append(h('p', { class: 'muted' }, 'No clubs found. Why not start one?'));
      for (const c of r.clubs) list.append(h('a', { class: 'card hover club-card', href: '#/clubs/' + c.id }, h('h3', null, c.name, c.private ? ' 🔒' : ''), h('p', { class: 'muted' }, c.description || 'No description.'), h('div', { class: 'row' }, h('span', { class: 'pill' }, '👥 ' + c.members), r.mine.includes(c.id) ? h('span', { class: 'pill' }, '✓ Member') : null)));
    } catch (e) { clear(list); list.append(errorBox(e.message)); }
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  root.append(h('div', { class: 'row' }, h('h1', { class: 'grow' }, '🏰 Clubs'), h('button', { class: 'btn primary', onclick: createClub }, '＋ Create a club')), search, list);
  function createClub() {
    if (!ctx.requireLogin()) return;
    const name = h('input', { maxLength: 40 }), desc = h('textarea', { rows: 3, maxLength: 400 }), priv = h('input', { type: 'checkbox' });
    const m = modal('Create a club', h('div', null, h('label', { class: 'field' }, h('span', null, 'Name (3–40 characters)'), name), h('label', { class: 'field' }, h('span', null, 'Description'), desc), h('label', { class: 'check' }, priv, ' Private (invite code required to join)')),
      { actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => { try { const r = await post('/api/clubs', { name: name.value, description: desc.value, private: priv.checked }); m.close(); ctx.navigate('/clubs/' + r.id); } catch (e) { toast(e.message, 'error'); } } }, 'Create')] });
  }
  load();
}

export async function club(root, ctx) {
  const id = ctx.params.id; let d;
  try { d = await get('/api/clubs/' + id); } catch (e) { root.append(h('div', { class: 'card center' }, h('h1', null, 'Club not found'), h('p', { class: 'muted' }, e.message), h('a', { class: 'btn', href: '#/clubs' }, 'All clubs'))); return; }
  const c = d.club; ctx.setTitle(c.name); const staff = ['owner', 'admin'].includes(d.role);
  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg, 'success'); ctx.navigate('/clubs/' + id); } catch (e) { toast(e.message, 'error'); } };
  const buttons = h('div', { class: 'row' });
  if (!state.user) buttons.append(h('a', { class: 'btn primary', href: '#/login?next=' + encodeURIComponent('/clubs/' + id) }, 'Log in to join'));
  else if (!d.role) buttons.append(h('button', { class: 'btn primary', onclick: async () => { let code; if (c.private) { code = await promptBox('Invite code', 'Enter the club invite code'); if (code == null) return; } act(() => post(`/api/clubs/${id}/join`, { code }), 'Welcome to the club!'); } }, 'Join club'));
  else {
    if (d.role !== 'owner') buttons.append(h('button', { class: 'btn', onclick: () => act(() => post(`/api/clubs/${id}/leave`), 'You left the club') }, 'Leave'));
    if (staff) buttons.append(h('a', { class: 'btn', href: '#/tournaments/new?club=' + id }, '🏆 Club tournament'));
    if (d.role === 'owner') buttons.append(h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Delete club?', 'This deletes the club, its members list and chat. This cannot be undone.', 'Delete')) { await del('/api/clubs/' + id); toast('Club deleted'); ctx.navigate('/clubs'); } } }, 'Delete club'));
  }
  const members = h('div', { class: 'col' }, d.members.map((m) => h('div', { class: 'row person' }, avatar(m, 28), userLink(m.username), m.role !== 'member' ? h('span', { class: 'pill' }, m.role) : null, h('span', { class: 'spacer' }),
    d.role === 'owner' && m.role !== 'owner' ? h('button', { class: 'btn small ghost', onclick: () => act(() => post(`/api/clubs/${id}/promote`, { username: m.username, admin: m.role !== 'admin' })) }, m.role === 'admin' ? 'Demote' : 'Make admin') : null,
    staff && m.role !== 'owner' && m.username !== state.user?.username ? h('button', { class: 'btn small ghost', onclick: async () => { if (await confirmBox('Remove ' + m.username + '?', 'They will be removed from the club.', 'Remove')) act(() => post(`/api/clubs/${id}/kick`, { username: m.username })); } }, 'Remove') : null)));
  // chat
  let chat = null;
  if (d.role) {
    const log = h('div', { class: 'chat-log', 'aria-live': 'polite' }); const input = h('input', { placeholder: 'Message the club…', maxLength: 400, 'aria-label': 'Club message', onkeydown: (e) => { if (e.key === 'Enter') send(); } });
    const line = (m) => h('div', { class: 'club-line' }, h('strong', null, m.username || m.from), ' ', h('span', null, m.body), ' ', h('span', { class: 'muted small' }, ago(m.ts)));
    const r = await get(`/api/clubs/${id}/messages`).catch(() => ({ messages: [] })); r.messages.forEach((m) => log.append(line(m))); setTimeout(() => { log.scrollTop = log.scrollHeight; });
    async function send() { const t = input.value.trim(); if (!t) return; try { await post(`/api/clubs/${id}/messages`, { body: t }); input.value = ''; log.append(line({ username: state.user.username, body: t, ts: Date.now() })); log.scrollTop = log.scrollHeight; } catch (e) { toast(e.message, 'error'); } }
    ctx.onCleanup(on('ws:club_msg', (m) => { if (m.clubId === Number(id)) { log.append(line(m)); log.scrollTop = log.scrollHeight; } }));
    chat = h('section', { class: 'card' }, h('h2', null, 'Club chat'), log, h('div', { class: 'row chat-input' }, input, h('button', { class: 'btn primary', onclick: send }, 'Send')));
  }
  root.append(h('section', { class: 'card' }, h('h1', null, c.name, c.private ? ' 🔒' : ''), h('p', null, c.description || 'No description.'), h('p', { class: 'muted small' }, 'Founded ' + new Date(c.created_at).toLocaleDateString() + ' · ' + d.members.length + ' members'),
    c.joinCode ? h('p', null, 'Invite code: ', h('code', null, c.joinCode)) : null, buttons),
    h('div', { class: 'grid-2' }, h('div', { class: 'col' }, chat || h('section', { class: 'card muted' }, 'Join the club to read and post in the club chat.'),
      h('section', { class: 'card' }, h('h2', null, 'Tournaments'), d.tournaments.length ? d.tournaments.map((t) => h('a', { class: 'game-row', href: '#/tournaments/' + t.id }, h('span', { class: 'grow' }, t.name), h('span', { class: 'pill' }, t.kind), h('span', { class: 'muted small' }, t.status))) : h('p', { class: 'muted' }, 'No club tournaments yet.'))),
      h('section', { class: 'card' }, h('h2', null, 'Members'), members)));
}
