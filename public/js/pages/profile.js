import { h, clear, toast, modal, confirmBox, avatar, ago, fmtDate, CAT_ICON, cap, fmtTc, svgEl } from '../util.js';
import { state, get, post, del, sendWs, on } from '../api.js';

const CATS = ['bullet', 'blitz', 'rapid', 'classical', 'puzzle'];
const flag = (cc) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0))) : '');

function ratingChart(hist, cat) {
  const pts = hist.filter((p) => p.category === cat);
  if (pts.length < 2) return h('p', { class: 'muted' }, 'Play a few rated games in this category to see your rating curve.');
  const W = 600, H = 160, P = 24; const ys = pts.map((p) => p.rating); const lo = Math.min(...ys) - 10, hi = Math.max(...ys) + 10;
  const x = (i) => P + (i / (pts.length - 1)) * (W - 2 * P), y = (v) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join(' ');
  const el = svgEl(`<svg viewBox="0 0 ${W} ${H}" class="rating-chart" role="img" aria-label="Rating history for ${cat}"><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/><text x="${P}" y="14" class="axis">${Math.round(hi)}</text><text x="${P}" y="${H - 6}" class="axis">${Math.round(lo)}</text></svg>`);
  return el;
}

export default async function profile(root, ctx) {
  const name = ctx.params.name;
  ctx.setTitle(name);
  let d;
  try { d = await get('/api/users/' + encodeURIComponent(name)); } catch (e) { root.append(h('div', { class: 'card center' }, h('h1', null, 'Player not found'), h('p', { class: 'muted' }, e.message), h('a', { class: 'btn primary', href: '#/leaderboard' }, 'Browse players'))); return; }
  const u = d.user, me = state.user, mine = me && me.id === u.id;
  const actions = h('div', { class: 'row profile-actions' });
  const draw = () => {
    clear(actions);
    if (mine) { actions.append(h('a', { class: 'btn', href: '#/settings' }, '⚙ Edit profile')); return; }
    if (!me) { actions.append(h('a', { class: 'btn primary', href: '#/login?next=' + encodeURIComponent('/u/' + u.username) }, 'Log in to interact')); return; }
    const r = d.rel || {};
    if (r.friend) actions.append(h('button', { class: 'btn', onclick: async () => { await del('/api/friends/' + encodeURIComponent(u.username)); r.friend = false; toast('Removed from friends'); draw(); } }, '✓ Friends'));
    else if (r.pendingOut) actions.append(h('button', { class: 'btn', disabled: true }, 'Request sent'));
    else if (r.pendingIn) actions.append(h('button', { class: 'btn primary', onclick: async () => { await post('/api/friends/accept', { username: u.username }); r.pendingIn = false; r.friend = true; draw(); } }, 'Accept friend request'));
    else if (!r.blocked) actions.append(h('button', { class: 'btn primary', onclick: async () => { try { const x = await post('/api/friends/request', { username: u.username }); if (x.status === 'accepted') r.friend = true; else r.pendingOut = true; toast(x.status === 'accepted' ? 'You are now friends' : 'Friend request sent', 'success'); draw(); } catch (e) { toast(e.message, 'error'); } } }, '＋ Add friend'));
    if (!r.blocked) actions.append(h('a', { class: 'btn', href: '#/messages/' + encodeURIComponent(u.username) }, '✉ Message'), h('button', { class: 'btn', onclick: () => challenge(u) }, '⚔ Challenge'));
    actions.append(h('button', { class: 'btn ghost', onclick: async () => { if (r.blocked) { await del('/api/blocks/' + encodeURIComponent(u.username)); r.blocked = false; toast('Unblocked'); } else if (await confirmBox('Block ' + u.username + '?', 'They will not be able to message or challenge you, and any friendship is removed.', 'Block')) { await post('/api/blocks', { username: u.username }); r.blocked = true; r.friend = false; toast('Blocked'); } draw(); } }, r.blocked ? 'Unblock' : '🚫 Block'),
      h('button', { class: 'btn ghost', onclick: () => report(u) }, '⚑ Report'));
  };
  draw();

  const ratings = Object.fromEntries(d.ratings.map((r) => [r.category, r]));
  let cat = 'blitz'; const chartBox = h('div');
  const catTabs = h('div', { class: 'seg' }, CATS.map((c) => h('button', { class: c === cat ? 'active' : '', onclick: (e) => { cat = c; [...catTabs.children].forEach((b) => b.classList.toggle('active', b === e.currentTarget)); clear(chartBox); chartBox.append(ratingChart(d.ratingHistory, cat)); } }, cap(c))));
  chartBox.append(ratingChart(d.ratingHistory, cat));

  const gameRow = (g) => {
    const isW = g.white_id === u.id; const opp = isW ? g.black_name : g.white_name;
    const res = g.result === '1/2-1/2' ? 'draw' : (g.result === '1-0') === isW ? 'win' : 'loss';
    return h('a', { class: 'game-row', href: '#/game/' + g.id },
      h('span', { class: 'res ' + res }, res === 'win' ? '+' : res === 'loss' ? '−' : '='), h('span', { class: 'grow' }, (isW ? '○ ' : '● ') + (g.ai_level ? 'Computer (level ' + g.ai_level + ')' : opp)),
      h('span', { class: 'muted small' }, (CAT_ICON[g.category] || '') + ' ' + g.category + (g.rated ? ' · rated' : '')), h('span', { class: 'muted small' }, ago(g.created_at)));
  };

  root.append(
    h('section', { class: 'card profile-head' },
      avatar(u, 84),
      h('div', { class: 'grow' }, h('h1', { class: 'profile-name' }, u.username, ' ', h('span', { title: u.country }, flag(u.country)), u.role !== 'user' ? h('span', { class: 'pill' }, u.role) : null, h('span', { class: 'dot ' + (u.online ? 'on' : ''), title: u.online ? 'Online' : 'Offline' })),
        h('p', { class: u.bio ? '' : 'muted' }, u.bio || 'No bio yet.'),
        h('p', { class: 'muted small' }, 'Joined ' + new Date(u.created_at).toLocaleDateString([], { dateStyle: 'medium' }) + ' · ' + (u.online ? 'online now' : 'last seen ' + ago(u.last_seen))),
        u.status !== 'active' ? h('p', { class: 'loss' }, 'This account is ' + u.status + '.') : null, actions)),
    h('section', { class: 'grid-4 rating-cards' }, CATS.map((c) => { const r = ratings[c]; return h('div', { class: 'card stat' }, h('div', { class: 'muted small' }, CAT_ICON[c] + ' ' + cap(c)), h('div', { class: 'big' }, r ? Math.round(r.rating) : 1500, r && r.rd > 110 ? h('span', { class: 'muted small', title: 'Provisional rating' }, '?') : null), h('div', { class: 'muted small' }, r ? `${r.games} games · ${r.wins}W ${r.draws}D ${r.losses}L` : 'unrated')); })),
    h('section', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Rating history'), catTabs), chartBox),
    h('div', { class: 'grid-2' },
      h('section', { class: 'card' }, h('h2', null, 'Recent games'), d.recent.length ? h('div', { class: 'col' }, d.recent.map(gameRow)) : h('p', { class: 'muted' }, 'No games yet.')),
      h('div', { class: 'col' },
        h('section', { class: 'card' }, h('h2', null, 'Achievements ', h('span', { class: 'pill' }, d.achievements.length)), d.achievements.length ? h('div', { class: 'ach-grid' }, d.achievements.map((a) => h('div', { class: 'ach', title: a.description + ' — ' + fmtDate(a.ts) }, h('span', { class: 'ach-icon' }, a.icon || '🏅'), h('span', null, a.name)))) : h('p', { class: 'muted' }, 'None earned yet.')),
        h('section', { class: 'card' }, h('h2', null, 'Puzzles'), h('p', null, d.puzzles.solved, ' solved of ', d.puzzles.attempts, ' attempts')),
        d.clubs.length ? h('section', { class: 'card' }, h('h2', null, 'Clubs'), h('div', { class: 'row' }, d.clubs.map((c) => h('a', { class: 'chip', href: '#/clubs/' + c.id }, c.name)))) : null,
        d.friends.length ? h('section', { class: 'card' }, h('h2', null, 'Friends ', h('span', { class: 'pill' }, d.friends.length)), h('div', { class: 'row' }, d.friends.slice(0, 24).map((f) => h('a', { class: 'chip', href: '#/u/' + encodeURIComponent(f.username) }, avatar(f, 18), f.username)))) : null)));
}

function challenge(u) {
  const mins = h('input', { type: 'number', min: 1, max: 180, value: 5 }), inc = h('input', { type: 'number', min: 0, max: 60, value: 3 }), rated = h('input', { type: 'checkbox', checked: true });
  const m = modal('Challenge ' + u.username, h('div', null, h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', null, 'Minutes'), mins), h('label', { class: 'field' }, h('span', null, 'Increment (s)'), inc)), h('label', { class: 'check' }, rated, ' Rated game'), h('p', { class: 'muted small' }, 'They must be online to receive the challenge.')),
    { actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { const off = on('ws:challenge_sent', () => { toast('Challenge sent to ' + u.username, 'success'); off(); }); sendWs({ t: 'challenge', to: u.username, initial: Math.round(+mins.value * 60), inc: +inc.value, rated: rated.checked }); setTimeout(off, 3000); m.close(); } }, 'Send challenge')] });
}
function report(u) {
  const reason = h('select', null, [['cheating', 'Cheating / engine use'], ['abuse', 'Abuse or harassment'], ['spam', 'Spam'], ['inappropriate-name', 'Inappropriate name or avatar'], ['other', 'Other']].map(([v, l]) => h('option', { value: v }, l)));
  const details = h('textarea', { rows: 4, maxLength: 500, placeholder: 'What happened? (optional)' });
  const m = modal('Report ' + u.username, h('div', null, h('label', { class: 'field' }, h('span', null, 'Reason'), reason), h('label', { class: 'field' }, h('span', null, 'Details'), details)),
    { actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => { try { const r = await post('/api/reports', { username: u.username, reason: reason.value, details: details.value }); toast(r.message, 'success'); m.close(); } catch (e) { toast(e.message, 'error'); } } }, 'Submit report')] });
}
