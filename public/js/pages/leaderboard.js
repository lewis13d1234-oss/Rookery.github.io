import { h, clear, spinner, avatar, cap, CAT_ICON, errorBox } from '../util.js';
import { state, get } from '../api.js';

const CATS = ['bullet', 'blitz', 'rapid', 'classical', 'puzzle'];
const PERIODS = [['all', 'All time'], ['month', 'This month'], ['week', 'This week'], ['day', 'Today']];

export default async function leaderboard(root, ctx) {
  ctx.setTitle('Leaderboards');
  const q = { cat: CATS.includes(ctx.query.cat) ? ctx.query.cat : 'blitz', period: 'all', scope: 'global' };
  const body = h('div');
  const seg = (items, key) => { const el = h('div', { class: 'seg' }, items.map(([v, l]) => h('button', { class: q[key] === v ? 'active' : '', onclick: () => { q[key] = v; [...el.children].forEach((b, i) => b.classList.toggle('active', items[i][0] === v)); load(); } }, l))); return el; };
  const periodNote = h('p', { class: 'muted small' });
  async function load() {
    clear(body); body.append(spinner());
    try {
      const r = await get(`/api/leaderboard?cat=${q.cat}&period=${q.period}&scope=${q.scope}`);
      clear(body);
      const gains = q.period !== 'all';
      periodNote.textContent = gains ? 'Ranked by total rating gained over the period (from rated games).' : 'Ranked by Glicko-2 rating. A “?” marks a provisional rating (few games played).';
      if (!r.rows.length) { body.append(h('div', { class: 'card center muted' }, 'No ranked players here yet. ', h('a', { href: '#/play' }, 'Play a rated game'), ' to appear.')); return; }
      body.append(h('div', { class: 'card flush table-wrap' }, h('table', { class: 'table lb' },
        h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Player'), h('th', { class: 'num' }, 'Rating'), gains ? h('th', { class: 'num' }, 'Gain') : null, h('th', { class: 'num' }, 'Games'), h('th', { class: 'num hide-sm' }, 'W / D / L'))),
        h('tbody', null, r.rows.map((p) => h('tr', { class: state.user && p.id === state.user.id ? 'me' : '' },
          h('td', null, p.rank <= 3 ? ['🥇', '🥈', '🥉'][p.rank - 1] : p.rank),
          h('td', null, h('a', { class: 'row ulink', href: '#/u/' + encodeURIComponent(p.username) }, avatar(p, 26), p.username, h('span', { class: 'dot ' + (p.online ? 'on' : '') }))),
          h('td', { class: 'num' }, p.rating, p.provisional ? '?' : ''), gains ? h('td', { class: 'num ' + (p.gain >= 0 ? 'win' : 'loss') }, (p.gain >= 0 ? '+' : '') + p.gain) : null,
          h('td', { class: 'num' }, gains ? p.played : p.games), h('td', { class: 'num hide-sm muted' }, `${p.wins} / ${p.draws} / ${p.losses}`)))))));
    } catch (e) { clear(body); body.append(errorBox(e.message)); }
  }
  const scopeItems = [['global', 'Everyone'], ...(state.user ? [['friends', 'Friends']] : [])];
  root.append(h('h1', null, '🏆 Leaderboards'), h('div', { class: 'row filters' }, seg(CATS.map((c) => [c, CAT_ICON[c] + ' ' + cap(c)]), 'cat'), seg(PERIODS, 'period'), scopeItems.length > 1 ? seg(scopeItems, 'scope') : null), periodNote, body);
  load();
}
