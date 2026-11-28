import { h, clear, toast, spinner, errorBox, userLink, fmtDate, fmtClock, cap, promptBox, confirmBox, CAT_ICON } from '../util.js';
import { state, get, post, on, serverNow } from '../api.js';

const KIND = { arena: ['Arena', 'Play as many games as you can in a fixed time. Win streaks score double.'], swiss: ['Swiss', 'A fixed number of rounds; you are paired with players on a similar score.'], knockout: ['Knockout', 'Lose and you are out. Last player standing wins.'] };
const tcText = (tc) => `${tc.initial >= 60 ? tc.initial / 60 : tc.initial + 's'}+${tc.inc}`;
const statusPill = (s) => h('span', { class: 'pill st-' + s }, { running: '● Live', scheduled: 'Upcoming', finished: 'Finished', cancelled: 'Cancelled' }[s] || s);

export default async function tournaments(root, ctx) {
  ctx.setTitle('Tournaments');
  const body = h('div');
  root.append(h('div', { class: 'row' }, h('h1', { class: 'grow' }, '🏆 Tournaments'), h('a', { class: 'btn primary', href: '#/tournaments/new' }, '＋ Create tournament')), body);
  async function load() {
    try {
      const { tournaments: ts } = await get('/api/tournaments'); clear(body);
      const group = (title, items) => items.length ? h('section', { class: 'col' }, h('h2', null, title), h('div', { class: 'grid-3' }, items.map(card))) : null;
      const card = (t) => h('a', { class: 'card hover', href: '#/tournaments/' + t.id }, h('div', { class: 'row' }, h('h3', { class: 'grow', style: { margin: 0 } }, t.name, t.private ? ' 🔒' : ''), statusPill(t.status)),
        h('p', { class: 'muted small' }, `${KIND[t.kind]?.[0] || t.kind} · ${CAT_ICON[t.cat] || ''} ${tcText(t.tc)} · ${t.rated ? 'rated' : 'casual'}`), h('p', { class: 'small' }, t.status === 'scheduled' ? 'Starts ' + fmtDate(t.start_ts) : t.status === 'running' ? 'In progress' : 'Ended ' + fmtDate(t.end_ts || t.start_ts)),
        h('div', { class: 'row' }, h('span', { class: 'pill' }, '👥 ' + t.players), t.joined ? h('span', { class: 'pill' }, '✓ Joined') : null));
      body.append(group('Live now', ts.filter((t) => t.status === 'running')), group('Upcoming', ts.filter((t) => t.status === 'scheduled')), group('Recently finished', ts.filter((t) => ['finished', 'cancelled'].includes(t.status))));
      if (!ts.length) body.append(h('div', { class: 'card center muted' }, 'No tournaments yet — create the first one.'));
    } catch (e) { clear(body); body.append(errorBox(e.message)); }
  }
  ctx.onCleanup(on('ws:tournament_start', load)); load();
}

export async function create(root, ctx) {
  if (!ctx.requireLogin()) return;
  ctx.setTitle('Create tournament');
  const pad = (n) => String(n).padStart(2, '0'); const d0 = new Date(Date.now() + 10 * 60_000);
  const local = `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())}T${pad(d0.getHours())}:${pad(d0.getMinutes())}`;
  const f = { name: h('input', { maxLength: 60, placeholder: 'Friday Night Blitz' }), kind: h('select', null, Object.entries(KIND).map(([v, [l]]) => h('option', { value: v }, l))), mins: h('input', { type: 'number', min: 1, max: 60, value: 3 }), inc: h('input', { type: 'number', min: 0, max: 60, value: 2 }),
    start: h('input', { type: 'datetime-local', value: local }), rounds: h('input', { type: 'number', min: 1, max: 15, value: 5 }), dur: h('input', { type: 'number', min: 5, max: 360, value: 30 }), max: h('input', { type: 'number', min: 2, max: 512, value: 64 }),
    rated: h('input', { type: 'checkbox', checked: true }), priv: h('input', { type: 'checkbox' }) };
  const desc = h('p', { class: 'muted' }); const roundsF = h('label', { class: 'field' }, h('span', null, 'Rounds'), f.rounds), durF = h('label', { class: 'field' }, h('span', null, 'Duration (minutes)'), f.dur);
  const sync = () => { desc.textContent = KIND[f.kind.value][1]; roundsF.hidden = f.kind.value !== 'swiss'; durF.hidden = f.kind.value !== 'arena'; }; f.kind.onchange = sync; sync();
  const clubId = ctx.query.club ? Number(ctx.query.club) : null;
  root.append(h('h1', null, 'Create a tournament'), h('section', { class: 'card form-card' },
    h('label', { class: 'field' }, h('span', null, 'Name'), f.name), h('label', { class: 'field' }, h('span', null, 'Format'), f.kind), desc,
    h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', null, 'Minutes per side'), f.mins), h('label', { class: 'field' }, h('span', null, 'Increment (s)'), f.inc)),
    h('label', { class: 'field' }, h('span', null, 'Start time (your local time)'), f.start), roundsF, durF, h('label', { class: 'field' }, h('span', null, 'Max players'), f.max),
    h('label', { class: 'check' }, f.rated, ' Rated'), h('label', { class: 'check' }, f.priv, ' Private (invite code)'), clubId ? h('p', { class: 'muted' }, 'This will be a club tournament — only club members can join.') : null,
    h('button', { class: 'btn primary', onclick: async () => {
      try { const r = await post('/api/tournaments', { name: f.name.value, kind: f.kind.value, initial: Math.round(+f.mins.value * 60), inc: +f.inc.value, startTs: new Date(f.start.value).getTime(), rounds: +f.rounds.value, durationMin: +f.dur.value, maxPlayers: +f.max.value, rated: f.rated.checked, private: f.priv.checked, clubId });
        toast('Tournament created' + (r.joinCode ? ' — invite code ' + r.joinCode : ''), 'success', 8000); ctx.navigate('/tournaments/' + r.id); } catch (e) { toast(e.message, 'error'); } } }, 'Create tournament')));
}

export async function detail(root, ctx) {
  const id = ctx.params.id; ctx.setTitle('Tournament');
  const box = h('div'); root.append(box);
  async function load() {
    let d; try { d = await get('/api/tournaments/' + id); } catch (e) { clear(box); box.append(h('div', { class: 'card center' }, h('h1', null, 'Tournament not found'), h('a', { class: 'btn', href: '#/tournaments' }, 'All tournaments'))); return; }
    const t = d.tournament; ctx.setTitle(t.name); clear(box);
    const mine = state.user && d.standings.find((p) => p.userId === state.user.id);
    const join = async () => { let code; if (t.private && t.creatorId !== state.user?.id) { code = await promptBox('Invite code', 'Enter the tournament invite code'); if (code == null) return; } try { await post(`/api/tournaments/${id}/join`, { code }); toast('You joined the tournament', 'success'); load(); } catch (e) { toast(e.message, 'error'); } };
    const clock = h('span', { class: 'pill' });
    const tick = () => { const now = serverNow(); clock.textContent = t.status === 'scheduled' ? 'Starts in ' + fmtClock(t.start_ts - now, false) : t.status === 'running' ? (t.kind === 'arena' && t.end_ts ? 'Ends in ' + fmtClock(t.end_ts - now, false) : 'Round ' + (t.currentRound || 1) + (t.rounds ? ' / ' + t.rounds : '')) : ''; };
    tick(); const iv = setInterval(tick, 1000); detail._iv && clearInterval(detail._iv); detail._iv = iv;
    box.append(h('section', { class: 'card' }, h('div', { class: 'row' }, h('h1', { class: 'grow', style: { margin: 0 } }, t.name, t.private ? ' 🔒' : ''), statusPill(t.status), clock),
      h('p', { class: 'muted' }, `${KIND[t.kind][0]} · ${tcText(t.tc)} (${t.cat}) · ${t.rated ? 'rated' : 'casual'} · starts ${fmtDate(t.start_ts)}` + (t.durationMin ? ` · ${t.durationMin} min` : '') + (t.rounds ? ` · ${t.rounds} rounds` : '')), h('p', { class: 'small' }, KIND[t.kind][1]),
      t.joinCode ? h('p', null, 'Invite code: ', h('code', null, t.joinCode)) : null,
      h('div', { class: 'row' },
        d.myGame ? h('a', { class: 'btn primary', href: '#/game/' + d.myGame }, '♞ Go to your game') : null,
        !state.user ? h('a', { class: 'btn primary', href: '#/login?next=' + encodeURIComponent('/tournaments/' + id) }, 'Log in to join') : d.joined ? h('button', { class: 'btn', disabled: t.status === 'finished', onclick: async () => { await post(`/api/tournaments/${id}/leave`); toast(t.status === 'scheduled' ? 'You left' : 'You withdrew'); load(); } }, t.status === 'scheduled' ? 'Leave' : 'Withdraw') : ['scheduled', 'running'].includes(t.status) && (t.kind === 'arena' || t.status === 'scheduled') ? h('button', { class: 'btn primary', onclick: join }, 'Join') : null)),
      h('div', { class: 'grid-2' },
        h('section', { class: 'card' }, h('h2', null, 'Standings'), d.standings.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Player'), h('th', { class: 'num' }, 'Score'), h('th', { class: 'num' }, 'Games'), t.kind === 'swiss' ? h('th', { class: 'num' }, 'TB') : null)),
          h('tbody', null, d.standings.map((p) => h('tr', { class: (p.withdrawn || p.eliminated ? 'out ' : '') + (p.userId === state.user?.id ? 'me' : '') }, h('td', null, p.rank), h('td', null, userLink(p.username), p.streak >= 2 ? ' 🔥' : '', p.eliminated ? h('span', { class: 'muted small' }, ' (out)') : null, p.withdrawn ? h('span', { class: 'muted small' }, ' (withdrew)') : null), h('td', { class: 'num' }, p.score), h('td', { class: 'num' }, p.games), t.kind === 'swiss' ? h('td', { class: 'num' }, p.tiebreak) : null))))) : h('p', { class: 'muted' }, 'No players yet.')),
        h('section', { class: 'card' }, h('h2', null, 'Games'), d.games.length ? h('div', { class: 'col' }, d.games.slice(0, 40).map((g) => h('a', { class: 'game-row', href: '#/game/' + g.game_id }, h('span', { class: 'muted small' }, 'R' + g.round), h('span', { class: 'grow' }, `${g.white || '—'} vs ${g.black || '—'}`), h('span', { class: 'pill' }, g.status === 'active' ? '● live' : g.result || '—')))) : h('p', { class: 'muted' }, 'No games yet.'))));
  }
  ctx.onCleanup(() => clearInterval(detail._iv));
  for (const ev of ['ws:tournament_start', 'ws:tournament_update', 'ws:tournament_game', 'ws:game_end', 'ws:tournament_end']) ctx.onCleanup(on(ev, () => setTimeout(load, 400)));
  const poll = setInterval(load, 15000); ctx.onCleanup(() => clearInterval(poll));
  await load();
}
