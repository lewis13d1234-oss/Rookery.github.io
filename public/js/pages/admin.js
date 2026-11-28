import { h, clear, toast, spinner, errorBox, userLink, fmtDate, ago, tabs, modal, confirmBox, promptBox, cap } from '../util.js';
import { state, get, post, put, del } from '../api.js';

const bars = (rows, label) => {
  if (!rows.length) return h('p', { class: 'muted' }, 'No data yet.');
  const max = Math.max(...rows.map((r) => r.n), 1);
  return h('div', { class: 'bars', role: 'img', 'aria-label': label }, rows.map((r) => h('div', { class: 'bar', title: `${r.d}: ${r.n}` }, h('div', { style: { height: Math.max(3, (r.n / max) * 100) + '%' } }), h('span', null, r.d.slice(5)))));
};

export default async function admin(root, ctx) {
  if (!ctx.requireLogin()) return;
  ctx.setTitle('Admin');
  const role = state.user.role;
  if (!['admin', 'mod'].includes(role)) { root.append(h('div', { class: 'card center' }, h('h1', null, 'Moderators only'), h('p', { class: 'muted' }, 'You do not have access to this page.'), h('a', { class: 'btn', href: '#/' }, 'Go home'))); return; }
  const isAdmin = role === 'admin'; const panel = h('div'); let refreshT;
  const wrap = (fn) => async () => { try { await fn(); } catch (e) { toast(e.message, 'error'); } };

  const views = {
    async overview() {
      const [s, hl] = await Promise.all([get('/api/admin/stats'), get('/api/admin/health')]);
      const stat = (l, v, href) => h(href ? 'a' : 'div', { class: 'card stat', href }, h('div', { class: 'muted small' }, l), h('div', { class: 'big' }, v));
      return h('div', { class: 'col' },
        h('div', { class: 'grid-4' }, stat('Users', s.users), stat('New today', s.newToday), stat('Active today', s.activeToday), stat('Online now', s.online), stat('Games played', s.games), stat('Games today', s.gamesToday), stat('Live games', s.live?.live ?? 0), stat('Clubs', s.clubs), stat('Puzzles', s.puzzles), stat('Puzzle attempts', s.puzzleAttempts), stat('Open reports', s.openReports), stat('Unreviewed flags', s.openFlags)),
        h('div', { class: 'grid-2' }, h('section', { class: 'card' }, h('h3', null, 'Sign-ups (14 days)'), bars(s.signups, 'Sign-ups per day')), h('section', { class: 'card' }, h('h3', null, 'Games (14 days)'), bars(s.gamesPerDay, 'Games per day'))),
        h('section', { class: 'card' }, h('h3', null, 'Server health'), h('div', { class: 'kv' }, [['Uptime', Math.floor(hl.uptimeSec / 3600) + 'h ' + Math.floor((hl.uptimeSec % 3600) / 60) + 'm'], ['Node', hl.node], ['Memory (RSS)', hl.rssMB + ' MB'], ['Heap', hl.heapMB + ' MB'], ['WebSocket connections', hl.wsConnections], ['Database size', hl.dbSizeMB + ' MB'], ['Event-loop lag', hl.eventLoopLagMs + ' ms']].map(([k, v]) => h('div', null, h('span', { class: 'muted' }, k), h('strong', null, v))))));
    },
    async users() {
      const input = h('input', { type: 'search', placeholder: 'Search username or email…', 'aria-label': 'Search users' }); const out = h('div');
      async function load() {
        const { users } = await get('/api/admin/users?q=' + encodeURIComponent(input.value.trim())); clear(out);
        out.append(h('div', { class: 'card flush table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, ['User', 'Email', 'Role', 'Status', 'Joined', 'Flags', ''].map((x) => h('th', null, x)))),
          h('tbody', null, users.map((u) => h('tr', null, h('td', null, userLink(u.username)), h('td', { class: 'small' }, u.email), h('td', null, u.owner ? 'owner' : u.role), h('td', null, h('span', { class: 'pill st-' + u.status }, u.status), u.status_reason ? h('div', { class: 'muted small' }, u.status_reason) : null), h('td', { class: 'small' }, ago(u.created_at)), h('td', null, u.fair_flags || 0),
            h('td', null, h('div', { class: 'row' }, u.id === state.user.id ? null : u.owner ? h('span', { class: 'muted small' }, 'Protected: owner') : [
              u.status === 'active' ? [h('button', { class: 'btn small', onclick: () => moderate(u, 'suspended') }, 'Suspend'), h('button', { class: 'btn small danger', onclick: () => moderate(u, 'banned') }, 'Ban')] : h('button', { class: 'btn small', onclick: () => moderate(u, 'active') }, 'Restore'),
              isAdmin ? h('button', { class: 'btn small ghost', onclick: wrap(async () => { const r = await post(`/api/admin/users/${u.id}/reset-link`); modal('Password reset link', h('div', null, h('p', null, 'Give this one-hour link to the user:'), h('input', { readOnly: true, value: r.link, onfocus: (e) => e.target.select() }))); }) }, 'Reset link') : null,
              isAdmin ? h('select', { 'aria-label': 'Role for ' + u.username, onchange: async (e) => { try { await post(`/api/admin/users/${u.id}/role`, { role: e.target.value }); toast('Role updated', 'success'); } catch (er) { toast(er.message, 'error'); load(); } } }, ['user', 'mod', 'admin'].map((r) => h('option', { value: r, selected: r === u.role }, r))) : null]))))))));
      }
      async function moderate(u, status) {
        let reason = '', days;
        if (status !== 'active') { reason = await promptBox((status === 'banned' ? 'Ban ' : 'Suspend ') + u.username, 'Reason (shown in the audit log)'); if (reason == null) return; }
        if (status === 'suspended') { days = await promptBox('Suspend ' + u.username, 'Days', { value: '3', type: 'number' }); if (days == null) return; }
        try { await post(`/api/admin/users/${u.id}/status`, { status, reason, days: Number(days) }); toast('Updated ' + u.username, 'success'); load(); } catch (e) { toast(e.message, 'error'); }
      }
      let t; input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); }); await load();
      return h('div', { class: 'col' }, input, out);
    },
    async reports() {
      let st = 'open'; const out = h('div', { class: 'col' });
      const seg = h('div', { class: 'seg' }, ['open', 'actioned', 'dismissed'].map((s) => h('button', { class: s === st ? 'active' : '', onclick: (e) => { st = s; [...seg.children].forEach((b) => b.classList.toggle('active', b === e.currentTarget)); load(); } }, cap(s))));
      async function resolve(r, action) { let days; if (action === 'suspend') { days = await promptBox('Suspend ' + r.target, 'Days', { value: '3', type: 'number' }); if (days == null) return; } try { await post(`/api/admin/reports/${r.id}/resolve`, { action, days: Number(days) || undefined }); toast('Report resolved', 'success'); load(); } catch (e) { toast(e.message, 'error'); } }
      async function load() {
        const { reports } = await get('/api/admin/reports?status=' + st); clear(out);
        if (!reports.length) out.append(h('div', { class: 'card muted center' }, 'No ' + st + ' reports.'));
        for (const r of reports) out.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('strong', null, '#' + r.id), h('span', { class: 'pill' }, r.reason), userLink(r.reporter || '?'), '→', userLink(r.target || '?'), h('span', { class: 'spacer' }), h('span', { class: 'muted small' }, ago(r.created_at))),
          r.details ? h('p', null, r.details) : null, r.game_id ? h('a', { class: 'small', href: '#/game/' + r.game_id }, 'View game ' + r.game_id) : null,
          st === 'open' ? h('div', { class: 'row' }, ['dismiss', 'warn', 'suspend', 'ban'].map((a) => h('button', { class: 'btn small' + (a === 'ban' ? ' danger' : ''), onclick: () => resolve(r, a) }, cap(a)))) : h('p', { class: 'muted small' }, r.note || '')));
      }
      await load(); return h('div', { class: 'col' }, seg, out);
    },
    async flags() {
      const out = h('div');
      async function load() {
        const { flags } = await get('/api/admin/flags'); clear(out);
        out.append(h('p', { class: 'muted' }, 'Automated fair-play heuristics. A flag is a prompt for human review, not proof of cheating — look at the game before acting.'));
        if (!flags.length) { out.append(h('div', { class: 'card muted center' }, 'No fair-play flags.')); return; }
        out.append(h('div', { class: 'card flush table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, ['Player', 'Signal', 'Details', 'Game', 'When', ''].map((x) => h('th', null, x)))),
          h('tbody', null, flags.map((f) => h('tr', { class: f.reviewed ? 'out' : '' }, h('td', null, userLink(f.username)), h('td', null, f.kind), h('td', { class: 'small' }, f.detail), h('td', null, f.game_id ? h('a', { href: '#/game/' + f.game_id }, 'open') : '—'), h('td', { class: 'small' }, ago(f.ts)),
            h('td', null, f.reviewed ? '✓' : h('button', { class: 'btn small', onclick: async () => { await post(`/api/admin/flags/${f.id}/review`); load(); } }, 'Mark reviewed'))))))));
      }
      await load(); return out;
    },
    async tournaments() {
      const { tournaments } = await get('/api/admin/tournaments');
      return h('div', { class: 'card flush table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, ['Name', 'Type', 'Status', 'Players', 'Start', ''].map((x) => h('th', null, x)))),
        h('tbody', null, tournaments.map((t) => h('tr', null, h('td', null, h('a', { href: '#/tournaments/' + t.id }, t.name)), h('td', null, t.kind), h('td', null, t.status), h('td', null, t.players), h('td', { class: 'small' }, fmtDate(t.start_ts)),
          h('td', null, ['scheduled', 'running'].includes(t.status) ? h('button', { class: 'btn small danger', onclick: async (e) => { if (await confirmBox('Cancel tournament?', t.name, 'Cancel it')) { await post(`/api/admin/tournaments/${t.id}/cancel`); toast('Cancelled'); show('tournaments'); } } }, 'Cancel') : null))))));
    },
    async puzzles() {
      if (!isAdmin) return h('p', { class: 'muted' }, 'Administrators only.');
      const { puzzles, total } = await get('/api/admin/puzzles?limit=60');
      const fen = h('input', { placeholder: 'FEN (side to move plays the first solution move)' }), sol = h('input', { placeholder: 'Solution in UCI, e.g. e2e4 e7e5 g1f3' }), kind = h('select', null, ['tactic', 'mate', 'endgame', 'opening'].map((k) => h('option', null, k))), mate = h('input', { type: 'number', min: 1, max: 6, placeholder: 'Mate in (optional)' }), rating = h('input', { type: 'number', value: 1500 }), expl = h('input', { placeholder: 'Explanation shown after solving' });
      return h('div', { class: 'col' }, h('section', { class: 'card' }, h('h3', null, 'Add a puzzle'), h('p', { class: 'muted small' }, 'Every puzzle is verified by the rules engine before it is saved: all moves must be legal, and a “mate in N” must really be forced.'),
        h('div', { class: 'col' }, fen, sol, h('div', { class: 'row' }, kind, mate, rating), expl, h('button', { class: 'btn primary', onclick: async () => { try { await post('/api/admin/puzzles', { fen: fen.value.trim(), solution: sol.value.trim(), kind: kind.value, mate: mate.value || null, rating: +rating.value, explanation: expl.value }); toast('Puzzle added', 'success'); show('puzzles'); } catch (e) { toast(e.message, 'error'); } } }, 'Verify and add'))),
        h('section', { class: 'card flush table-wrap' }, h('table', { class: 'table' }, h('caption', { class: 'pad muted small', style: { textAlign: 'left' } }, `${total} puzzles (latest ${puzzles.length})`), h('thead', null, h('tr', null, ['ID', 'Kind', 'Rating', 'Solved', 'Enabled', ''].map((x) => h('th', null, x)))),
          h('tbody', null, puzzles.map((p) => h('tr', null, h('td', null, p.id), h('td', null, p.kind), h('td', null, p.rating), h('td', null, `${p.solved}/${p.plays}`), h('td', null, p.enabled ? 'yes' : 'no'),
            h('td', null, h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: async () => { await post(`/api/admin/puzzles/${p.id}/toggle`); show('puzzles'); } }, p.enabled ? 'Disable' : 'Enable'), h('button', { class: 'btn small danger', onclick: async () => { if (await confirmBox('Delete puzzle?', p.id, 'Delete')) { await del('/api/admin/puzzles/' + p.id); show('puzzles'); } } }, 'Delete')))))))));
    },
    async lessons() {
      if (!isAdmin) return h('p', { class: 'muted' }, 'Administrators only.');
      const { lessons } = await get('/api/admin/lessons');
      return h('div', { class: 'card flush table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, ['Lesson', 'Level', 'Steps', 'Published', ''].map((x) => h('th', null, x)))),
        h('tbody', null, lessons.map((l) => h('tr', null, h('td', null, h('a', { href: '#/learn/' + l.id }, l.title)), h('td', null, l.level), h('td', null, l.steps.length), h('td', null, l.published ? 'yes' : 'no'),
          h('td', null, h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: async () => { const v = await promptBox('Edit title', 'Lesson title', { value: l.title }); if (v == null) return; try { await put('/api/admin/lessons/' + l.id, { title: v }); show('lessons'); } catch (e) { toast(e.message, 'error'); } } }, 'Rename'), h('button', { class: 'btn small', onclick: async () => { try { await put('/api/admin/lessons/' + l.id, { published: !l.published }); show('lessons'); } catch (e) { toast(e.message, 'error'); } } }, l.published ? 'Unpublish' : 'Publish'))))))));
    },
    async owner() {
      if (!state.user.owner) return h('p', { class: 'muted' }, 'Owner only.');
      const info = await get('/api/owner/info'); const out = h('div', { class: 'col' });
      const run = (fn, ok) => async () => { try { const r = await fn(); toast(typeof ok === 'function' ? ok(r) : ok || 'Done', 'success'); show('owner'); } catch (e) { if (e.message !== 'Cancelled') toast(e.message, 'error'); } };
      const field = (label, el) => h('label', { class: 'field' }, h('span', null, label), el);
      const who = h('input', { class: 'input', placeholder: 'username', 'aria-label': 'Username' });
      const cat = h('select', { 'aria-label': 'Rating category' }, info.categories.map((c) => h('option', { value: c }, cap(c)))); const rating = h('input', { class: 'input', type: 'number', min: 100, max: 3500, value: 1500, 'aria-label': 'Rating' });
      const ach = h('select', { 'aria-label': 'Achievement' }, info.achievements.map((a) => h('option', { value: a.id }, a.name)));
      const msg = h('input', { class: 'input', maxlength: 200, placeholder: 'Message to everyone online', 'aria-label': 'Announcement' }); const unrated = h('input', { type: 'checkbox', id: 'own-unr' });
      const gameRows = info.games.length ? info.games.map((g) => h('tr', null, h('td', null, h('a', { href: '#/game/' + g.id }, g.id)), h('td', null, g.white + ' v ' + g.black), h('td', { class: 'small' }, `${g.tc} ${g.rated ? 'rated' : 'casual'}, ${g.plies} plies${g.private ? ', private' : ''}`),
        h('td', null, h('div', { class: 'row' }, [['White wins', '1-0'], ['Black wins', '0-1'], ['Draw', '1/2-1/2']].map(([l, r]) => h('button', { class: 'btn small', onclick: run(async () => { if (!await confirmBox('Force result: ' + l, `Game ${g.id} (${g.white} v ${g.black}) ends now. Players will see "adjudicated by the site owner".` + (unrated.checked ? ' Ratings will not change.' : ' Ratings will change as for a normal result.'), 'End game')) throw new Error('Cancelled'); return post(`/api/owner/games/${g.id}/result`, { result: r, unrated: unrated.checked }); }, 'Game ended') }, l)),
          h('button', { class: 'btn small danger', onclick: run(async () => { if (!await confirmBox('Abort game', 'No result, no rating change.', 'Abort')) throw new Error('Cancelled'); return post(`/api/owner/games/${g.id}/abort`); }, 'Game aborted') }, 'Abort'))))) : [h('tr', null, h('td', { colspan: 4, class: 'muted' }, 'No games in progress.'))];
      out.append(
        h('section', { class: 'card col' }, h('h2', null, 'Games in progress'), h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, ['Game', 'Players', 'Info', 'Force'].map((x) => h('th', null, x)))), h('tbody', null, gameRows))),
          h('label', { class: 'row' }, unrated, h('span', null, 'Forced results do not change ratings')),
          h('div', { class: 'row' }, h('button', { class: 'btn danger', onclick: run(async () => { if (!await confirmBox('End ALL games?', 'Every game in progress is aborted with no result. Use before maintenance.', 'Abort all')) throw new Error('Cancelled'); return post('/api/owner/games/abort-all'); }, (r) => `${r.aborted} games aborted`) }, 'Abort all games'), h('button', { class: 'btn ghost', onclick: () => show('owner') }, 'Refresh'))),
        h('section', { class: 'card col' }, h('h2', null, 'Player tools'), field('Username', who),
          h('div', { class: 'row' }, field('Category', cat), field('Rating', rating), h('button', { class: 'btn', onclick: run(() => post(`/api/owner/users/${encodeURIComponent(who.value.trim())}/rating`, { category: cat.value, rating: Number(rating.value) }), 'Rating set') }, 'Set rating')),
          h('div', { class: 'row' }, field('Achievement', ach), h('button', { class: 'btn', onclick: run(() => post(`/api/owner/users/${encodeURIComponent(who.value.trim())}/achievements`, { id: ach.value }), (r) => r.granted ? 'Achievement granted' : 'They already have it') }, 'Grant'), h('button', { class: 'btn', onclick: run(() => post(`/api/owner/users/${encodeURIComponent(who.value.trim())}/achievements`, { all: true }), (r) => `${r.granted} achievements granted`) }, 'Grant all')),
          h('div', { class: 'row' }, h('button', { class: 'btn danger', onclick: run(async () => { if (!await confirmBox('Sign out ' + who.value.trim() + '?', 'Ends their sessions and disconnects them. They can sign in again.', 'Sign out')) throw new Error('Cancelled'); return post(`/api/owner/users/${encodeURIComponent(who.value.trim())}/kick`); }, 'Signed out') }, 'Sign out everywhere'))),
        h('section', { class: 'card col' }, h('h2', null, 'Site'), field('Announcement', msg),
          h('div', { class: 'row' }, h('button', { class: 'btn', onclick: run(async () => { const r = await post('/api/owner/broadcast', { text: msg.value }); msg.value = ''; return r; }, 'Announcement sent') }, 'Send to everyone online'),
            h('button', { class: 'btn', onclick: run(() => post('/api/owner/backup-now'), (r) => r.ok ? 'Backup saved' : 'Backup failed: ' + (r.error || 'see logs')) }, 'Back up now')),
          h('p', { class: 'muted small' }, 'Every owner action is written to the audit log. Forced results are shown to players as adjudicated by the site owner.')));
      return out;
    },
    async audit() {
      if (!isAdmin) return h('p', { class: 'muted' }, 'Administrators only.');
      const { log } = await get('/api/admin/audit');
      return h('div', { class: 'card flush table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, ['When', 'Actor', 'Action', 'Target', 'Note'].map((x) => h('th', null, x)))),
        h('tbody', null, log.map((a) => h('tr', null, h('td', { class: 'small' }, fmtDate(a.ts || a.created_at)), h('td', null, a.actor), h('td', null, a.action), h('td', null, a.target), h('td', { class: 'small' }, a.note || a.detail || ''))))));
    },
  };
  const items = [['overview', 'Overview'], ['users', 'Users'], ['reports', 'Reports'], ['flags', 'Fair play'], ['tournaments', 'Tournaments'], ...(isAdmin ? [['puzzles', 'Puzzles'], ['lessons', 'Lessons'], ['audit', 'Audit log']] : []), ...(state.user.owner ? [['owner', 'Owner tools']] : [])];
  let token = 0;
  async function show(id) { const my = ++token; clear(panel); panel.append(spinner()); try { const el = await views[id](); if (my !== token) return; clear(panel); panel.append(el); } catch (e) { if (my !== token) return; clear(panel); panel.append(errorBox(e.message)); } }
  root.append(h('h1', null, '🛡 Admin dashboard'), h('p', { class: 'muted' }, 'Signed in as ' + (state.user.owner ? 'owner' : role) + '.'), tabs(items, 'overview', show), panel);
  ctx.onCleanup(() => clearTimeout(refreshT));
  show('overview');
}
