import { h, clear, toast, modal, fmtTc, CAT_ICON, avatar } from '../util.js';
import { state, get, on, sendWs } from '../api.js';
import { Board } from '../board.js';

const PRESETS = [['bullet', [[60, 0], [60, 1], [120, 1]]], ['blitz', [[180, 0], [180, 2], [300, 0]]], ['rapid', [[600, 0], [600, 5], [900, 10]]], ['classical', [[1800, 0], [1800, 20], [3600, 0]]]];
const label = (i, inc) => `${i < 60 ? i + 's' : i / 60 + ''}${i < 60 ? '' : ''}+${inc}`.replace(/^(\d+)\+/, (m, a) => (i >= 60 ? `${i / 60}+` : m));

export default async function play(root, ctx) {
  ctx.setTitle('Play chess');
  let rated = !!state.user; const unsubs = []; let waiting = null;
  const status = h('div', { class: 'seek-status' });
  const ratedBox = h('div', { class: 'seg' });
  const setRated = (v) => { rated = v; [...ratedBox.children].forEach((b, i) => b.classList.toggle('active', (i === 0) === v)); };
  ratedBox.append(h('button', { onclick: () => setRated(true) }, 'Rated'), h('button', { onclick: () => setRated(false) }, 'Casual')); setRated(rated);
  const need = () => { if (!state.user) { toast('Log in to play online — it is free', 'info'); ctx.navigate('/login?next=' + encodeURIComponent('/play')); return false; } return true; };
  const quick = (i, inc) => { if (!need()) return; sendWs({ t: 'quick', initial: i, inc, rated }); showWaiting(`Finding an opponent for ${label(i, inc)}…`); };
  function showWaiting(text) {
    clear(status); waiting = true;
    status.append(h('div', { class: 'card waiting' }, h('div', { class: 'spinner' }), h('div', null, h('strong', null, text), h('div', { class: 'muted small' }, 'Matched with players of a similar rating. The search widens the longer you wait.')), h('button', { class: 'btn', onclick: () => { sendWs({ t: 'cancel_seek' }); } }, 'Cancel')));
  }
  unsubs.push(on('ws:seek_cancelled', () => { clear(status); waiting = false; }));
  unsubs.push(on('ws:error', () => { clear(status); waiting = false; }));
  const grid = h('div', { class: 'tc-groups' }, PRESETS.map(([cat, list]) => h('div', { class: 'card' }, h('h3', null, CAT_ICON[cat] + ' ', cat[0].toUpperCase() + cat.slice(1), state.user ? h('span', { class: 'pill', style: { float: 'right' } }, Math.round(state.user.ratings.find((r) => r.category === cat)?.rating || 1500)) : null), h('div', { class: 'tc-btns' }, list.map(([i, inc]) => h('button', { class: 'btn tc', onclick: () => quick(i, inc) }, label(i, inc)))))));
  // custom
  const cm = h('input', { type: 'number', min: 1, max: 180, value: 10, 'aria-label': 'Minutes' }), ci = h('input', { type: 'number', min: 0, max: 180, value: 0, 'aria-label': 'Increment seconds' });
  const custom = h('div', { class: 'card' }, h('h3', null, '⚙ Custom time control'), h('div', { class: 'row' }, h('label', { class: 'field', style: { margin: 0 } }, h('span', null, 'Minutes'), cm), h('label', { class: 'field', style: { margin: 0 } }, h('span', null, 'Increment (s)'), ci)),
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn primary', onclick: () => quick(Math.round(+cm.value * 60), +ci.value) }, 'Quick match'),
      h('button', { class: 'btn', onclick: () => { if (need()) { sendWs({ t: 'seek', initial: Math.round(+cm.value * 60), inc: +ci.value, rated }); toast('Challenge posted to the lobby'); } } }, 'Post to lobby'),
      h('button', { class: 'btn', onclick: () => { if (!need()) return; sendWs({ t: 'invite', initial: Math.round(+cm.value * 60), inc: +ci.value, rated: false, color: 'random' }); } }, '🔗 Invite link')));
  unsubs.push(on('ws:invite_created', (m) => { ctx.navigate('/game/' + m.id); }));
  // friend challenge
  const fr = h('input', { placeholder: 'Username', 'aria-label': 'Friend username' });
  const challenge = h('div', { class: 'card' }, h('h3', null, '⚔ Challenge a player'), h('div', { class: 'row' }, fr, h('button', { class: 'btn', onclick: () => { if (!need() || !fr.value.trim()) return; sendWs({ t: 'challenge', to: fr.value.trim(), initial: Math.round(+cm.value * 60), inc: +ci.value, rated }); } }, 'Send challenge')), h('p', { class: 'muted small' }, 'Uses the custom time control above. The player must be online — otherwise create an invite link.'));
  unsubs.push(on('ws:challenge_sent', (m) => toast('Challenge sent to ' + m.to, 'success')));
  // lobby
  const lobby = h('div', { class: 'list' });
  const drawLobby = (seeks) => { clear(lobby); const others = seeks; if (!others.length) lobby.append(h('div', { class: 'empty' }, 'No open challenges right now.')); for (const s of others) lobby.append(h('div', null, h('a', { class: 'ulink', href: '#/u/' + s.user }, s.user), h('span', { class: 'muted' }, `(${s.rating})`), h('span', { class: 'chip' }, CAT_ICON[s.cat] + ' ' + label(s.tc.initial, s.tc.inc)), h('span', { class: 'chip' }, s.rated ? 'Rated' : 'Casual'), h('span', { class: 'spacer' }), s.userId === state.user?.id ? h('button', { class: 'btn small', onclick: () => sendWs({ t: 'cancel_seek' }) }, 'Withdraw') : h('button', { class: 'btn small primary', onclick: () => { if (need()) sendWs({ t: 'accept_seek', id: s.id }); } }, 'Accept'))); };
  unsubs.push(on('ws:seeks', (m) => drawLobby(m.seeks))); drawLobby([]);
  const start = () => sendWs({ t: 'lobby' }); start(); unsubs.push(on('ws:open', start));
  // resume
  const resume = h('div');
  if (state.user) get('/api/games/mine/active').then(({ games }) => { for (const g of games) resume.append(h('a', { class: 'card hover resume', href: '#/game/' + g.id }, h('strong', null, '▶ Resume your game'), ` ${g.white} vs ${g.black}`)); }).catch(() => {});
  root.append(h('h1', null, 'Play'), resume, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('p', { class: 'muted', style: { margin: 0 } }, 'Real-time games against real people. Free, always.'), ratedBox), status, grid,
    h('div', { class: 'grid-2', style: { marginTop: '16px' } }, custom, challenge),
    h('div', { class: 'grid-2', style: { marginTop: '16px' } },
      h('div', { class: 'card' }, h('h3', null, '🤖 Play the computer'), h('p', { class: 'muted' }, 'Six strength levels, hints, takebacks and unlimited games — no account needed.'), h('a', { class: 'btn primary', href: '#/play/computer' }, 'Play vs computer')),
      h('div', { class: 'card flush' }, h('div', { style: { padding: '16px 18px 0' } }, h('h3', null, '📣 Open challenges')), lobby)));
  return () => { unsubs.forEach((f) => f()); sendWs({ t: 'lobby_leave' }); if (waiting) sendWs({ t: 'cancel_seek' }); };
}

export async function watch(root, ctx) {
  ctx.setTitle('Watch live games');
  const box = h('div', { class: 'grid-3' }); let timer, boards = [];
  async function load() { try { const { games } = await get('/api/games/live'); boards.forEach((b) => b.destroy()); boards = []; clear(box); if (!games.length) box.append(h('div', { class: 'card empty' }, 'No public games are being played right now.')); for (const g of games) { const host = h('div', { class: 'mini-board' }); box.append(h('a', { class: 'card hover', href: '#/game/' + g.id }, host, h('div', { class: 'row', style: { justifyContent: 'space-between', marginTop: '8px' } }, h('strong', null, `${g.white} (${g.wr})`), h('strong', null, `${g.black} (${g.br})`)), h('div', { class: 'muted small' }, `${CAT_ICON[g.cat]} ${label(g.tc.initial, g.tc.inc)} · ${g.rated ? 'rated' : 'casual'} · ${g.spectators} watching`))); boards.push(new Board(host, { fen: g.fen, coords: false, set: state.prefs.pieces })); } } catch (e) { toast(e.message, 'error'); } }
  await load(); timer = setInterval(load, 5000);
  root.append(h('h1', null, 'Watch live'), h('p', { class: 'muted' }, 'Public games in progress, strongest first. Click one to spectate.'), box);
  return () => { clearInterval(timer); boards.forEach((b) => b.destroy()); };
}
