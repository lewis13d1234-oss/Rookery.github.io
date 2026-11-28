import { h, clear, toast, avatar, ago, userLink, spinner, errorBox } from '../util.js';
import { state, get, post, del, on, sendWs } from '../api.js';

export async function friends(root, ctx) {
  if (!ctx.requireLogin()) return;
  ctx.setTitle('Friends');
  const body = h('div', { class: 'col' });
  const add = h('input', { placeholder: 'Username', 'aria-label': 'Username to add', maxLength: 20, onkeydown: (e) => { if (e.key === 'Enter') send(); } });
  async function send() { const n = add.value.trim(); if (!n) return; try { const r = await post('/api/friends/request', { username: n }); toast(r.status === 'accepted' ? `You and ${n} are now friends` : 'Friend request sent', 'success'); add.value = ''; load(); } catch (e) { toast(e.message, 'error'); } }
  async function load() {
    let r; try { r = await get('/api/friends'); } catch (e) { clear(body); body.append(errorBox(e.message)); return; }
    clear(body);
    if (r.incoming.length) body.append(h('section', { class: 'card' }, h('h2', null, 'Friend requests ', h('span', { class: 'pill' }, r.incoming.length)), r.incoming.map((u) => h('div', { class: 'row person' }, avatar(u, 32), userLink(u.username), h('span', { class: 'spacer' }),
      h('button', { class: 'btn small primary', onclick: async () => { await post('/api/friends/accept', { username: u.username }); load(); } }, 'Accept'), h('button', { class: 'btn small', onclick: async () => { await del('/api/friends/' + encodeURIComponent(u.username)); load(); } }, 'Decline')))));
    body.append(h('section', { class: 'card' }, h('h2', null, 'Your friends ', h('span', { class: 'pill' }, r.friends.length)),
      r.friends.length ? r.friends.map((u) => h('div', { class: 'row person' }, avatar(u, 32), userLink(u.username), h('span', { class: 'dot ' + (u.online ? 'on' : ''), style: { margin: 0 } }), h('span', { class: 'muted small' }, u.online ? 'online' : 'seen ' + ago(u.lastSeen)), h('span', { class: 'spacer' }), h('span', { class: 'pill' }, '🔥 ' + u.blitz),
        h('a', { class: 'btn small', href: '#/messages/' + encodeURIComponent(u.username) }, '✉', u.unread ? h('span', { class: 'badge-n' }, u.unread) : null), h('button', { class: 'btn small ghost', onclick: async () => { await del('/api/friends/' + encodeURIComponent(u.username)); load(); } }, 'Remove'))) : h('p', { class: 'muted' }, 'No friends yet — add someone by username, or find players from the leaderboard.')));
    if (r.outgoing.length) body.append(h('section', { class: 'card' }, h('h2', null, 'Sent requests'), r.outgoing.map((u) => h('div', { class: 'row person' }, avatar(u, 28), userLink(u.username), h('span', { class: 'spacer' }), h('span', { class: 'muted small' }, 'pending'), h('button', { class: 'btn small ghost', onclick: async () => { await del('/api/friends/' + encodeURIComponent(u.username)); load(); } }, 'Cancel')))));
  }
  root.append(h('h1', null, '👥 Friends'), h('div', { class: 'card row' }, add, h('button', { class: 'btn primary', onclick: send }, 'Send friend request')), body);
  ctx.onCleanup(on('ws:friend_request', load)); load();
}

export async function messages(root, ctx) {
  if (!ctx.requireLogin()) return;
  ctx.setTitle('Messages');
  let active = ctx.params.name || null;
  const list = h('div', { class: 'thread-list' }), pane = h('div', { class: 'chat-pane' });
  const layout = h('div', { class: 'messages-layout' + (active ? ' open' : '') }, h('aside', { class: 'card flush' }, list), pane);
  async function loadThreads() {
    let r; try { r = await get('/api/messages/threads'); } catch { return; }
    clear(list);
    const th = r.threads.slice(); if (active && !th.some((t) => t.user.username === active)) th.unshift({ user: { username: active }, last: 'New conversation', ts: Date.now(), unread: 0 });
    if (!th.length) list.append(h('p', { class: 'muted pad' }, 'No conversations yet. Open a friend or player profile and press Message.'));
    for (const t of th) list.append(h('a', { class: 'thread' + (t.user.username === active ? ' active' : ''), href: '#/messages/' + encodeURIComponent(t.user.username) }, avatar(t.user, 36), h('div', { class: 'grow' }, h('strong', null, t.user.username), h('div', { class: 'muted small ellip' }, (t.mine ? 'You: ' : '') + t.last)), t.unread ? h('span', { class: 'badge-n' }, t.unread) : null));
  }
  let log, input;
  function bubble(m) { return h('div', { class: 'bubble ' + (m.mine ? 'mine' : 'theirs'), title: new Date(m.ts).toLocaleString() }, h('span', null, m.body)); }
  async function openThread() {
    clear(pane);
    if (!active) { pane.append(h('div', { class: 'center muted pad' }, 'Select a conversation')); return; }
    pane.append(spinner());
    try {
      const r = await get('/api/messages/with/' + encodeURIComponent(active)); clear(pane);
      log = h('div', { class: 'chat-log', 'aria-live': 'polite' }, r.messages.map(bubble));
      input = h('input', { placeholder: 'Write a message…', maxLength: 500, 'aria-label': 'Message', onkeydown: (e) => { if (e.key === 'Enter') send(); } });
      pane.append(h('div', { class: 'chat-head row' }, h('a', { class: 'btn small ghost back-btn', href: '#/messages' }, '←'), avatar(r.user, 28), userLink(r.user.username)), log, h('div', { class: 'row chat-input' }, input, h('button', { class: 'btn primary', onclick: send }, 'Send')));
      log.scrollTop = log.scrollHeight; loadThreads();
    } catch (e) { clear(pane); pane.append(errorBox(e.message)); }
  }
  async function send() {
    const text = input.value.trim(); if (!text) return;
    try { await post('/api/messages', { to: active, body: text }); input.value = ''; log.append(bubble({ mine: true, body: text, ts: Date.now() })); log.scrollTop = log.scrollHeight; loadThreads(); } catch (e) { toast(e.message, 'error'); }
  }
  ctx.onCleanup(on('ws:dm', (m) => { if (m.from === active && log) { log.append(bubble({ mine: false, body: m.body, ts: m.ts })); log.scrollTop = log.scrollHeight; get('/api/messages/with/' + encodeURIComponent(active)).catch(() => {}); } loadThreads(); }));
  root.append(h('h1', null, '✉ Messages'), layout); loadThreads(); openThread();
}
