// REST client, session/preferences store and the shared WebSocket connection.
import { toast } from './util.js';
import { configureSound, play } from './sound.js';

export const state = { user: null, prefs: {}, ws: null, wsReady: false, listeners: new Map(), config: null, offset: 0 };

export async function api(method, url, body) {
  let r;
  try { r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Rookery': '1' }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new Error('Cannot reach the server. Check your connection.'); }
  let data = {}; try { data = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(data.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
  return data;
}
export const get = (u) => api('GET', u); export const post = (u, b = {}) => api('POST', u, b); export const put = (u, b = {}) => api('PUT', u, b); export const del = (u) => api('DELETE', u);

// ---------------- preferences (stored on the account when logged in, always mirrored in localStorage)
export const DEFAULT_PREFS = { theme: 'dark', board: 'ember', pieces: 'rook', sound: true, volume: 0.5, soundPack: 'wood', animations: true, bg: 'none', profileTheme: 'ember', coords: true, highlight: true, autoQueen: false, confirmResign: true };
export const BOARDS = {
  ember: ['#ead9b7', '#a8693f', 'Ember'], walnut: ['#f0d9b5', '#b58863', 'Walnut'], moss: ['#eeeed2', '#769656', 'Moss'], slate: ['#dee3e6', '#8ca2ad', 'Slate'],
  ice: ['#e8f1f8', '#6b93b8', 'Ice'], rose: ['#f6e4e4', '#c27a8a', 'Rose'], midnight: ['#8c92ad', '#3b4166', 'Midnight'], sand: ['#f4ead2', '#c9a15b', 'Sand'],
  violet: ['#e6def2', '#8466b3', 'Violet'], mono: ['#e5e5e5', '#8a8a8a', 'Monochrome'], neon: ['#2a3a3a', '#16211f', 'Neon'], coral: ['#ffe5d0', '#e0805a', 'Coral'],
  forest: ['#dfe8d0', '#4f7a4a', 'Forest'], ocean: ['#d6ecf2', '#2f7f9c', 'Ocean'], ruby: ['#f3dcdc', '#a02c3c', 'Ruby'], graphite: ['#c9ccd1', '#4b4f58', 'Graphite'],
  gold: ['#f6e7b4', '#b8902c', 'Gold'], sunset: ['#ffe1b8', '#d5603a', 'Sunset'], mint: ['#e2f6ee', '#4fb08a', 'Mint'], candy: ['#fde3f1', '#c46aa2', 'Candy'],
  lava: ['#3a2a28', '#7a2f1c', 'Lava'], paper: ['#fbfaf5', '#b9b6a8', 'Paper'], night: ['#556078', '#1e2536', 'Night'], lavender: ['#efe9fb', '#9c8bd0', 'Lavender'], cat: ['#f7e8d0', '#c8955f', 'Cat (paw prints)'],
};
export const BACKGROUNDS = { none: 'Plain', dusk: 'Dusk gradient', felt: 'Green felt', paper: 'Paper', grid: 'Blueprint grid', aurora: 'Aurora' };
export const PROFILE_THEMES = { ember: ['#e0a33e', 'Ember'], teal: ['#2ba7a0', 'Teal'], crimson: ['#d4495a', 'Crimson'], indigo: ['#6b78e5', 'Indigo'], forest: ['#5aa05a', 'Forest'], orchid: ['#b86fd1', 'Orchid'] };

export function loadPrefs() { let p = {}; try { p = JSON.parse(localStorage.getItem('rk_prefs') || '{}'); } catch {} return { ...DEFAULT_PREFS, ...p }; }
export function applyPrefs(p = state.prefs) {
  const r = document.documentElement; const t = p.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : p.theme;
  r.dataset.theme = t; r.dataset.board = p.board || ''; const b = BOARDS[p.board] || BOARDS.ember; r.style.setProperty('--sq-light', b[0]); r.style.setProperty('--sq-dark', b[1]);
  r.dataset.bg = p.bg; r.dataset.noanim = p.animations ? '0' : '1'; r.style.setProperty('--accent', (PROFILE_THEMES[p.profileTheme] || PROFILE_THEMES.ember)[0]);
  configureSound({ enabled: p.sound, volume: p.volume, pack: p.soundPack });
}
export function setPrefs(patch, save = true) {
  state.prefs = { ...state.prefs, ...patch }; try { localStorage.setItem('rk_prefs', JSON.stringify(state.prefs)); } catch {}
  applyPrefs(); emit('prefs', state.prefs);
  if (save && state.user) put('/api/me', { prefs: state.prefs }).catch(() => {});
}

export async function refreshMe() {
  const { user } = await get('/api/me');
  state.user = user;
  if (user?.prefs && Object.keys(user.prefs).length) { state.prefs = { ...DEFAULT_PREFS, ...user.prefs }; try { localStorage.setItem('rk_prefs', JSON.stringify(state.prefs)); } catch {} applyPrefs(); }
  emit('user', user); return user;
}

// ---------------- event bus
export function on(type, fn) { if (!state.listeners.has(type)) state.listeners.set(type, new Set()); state.listeners.get(type).add(fn); return () => state.listeners.get(type).delete(fn); }
export function emit(type, data) { for (const fn of state.listeners.get(type) || []) { try { fn(data); } catch (e) { console.error(e); } } }

// ---------------- websocket with auto-reconnect (+ server time offset for clocks)
let backoff = 500, pingT;
export function connectWs() {
  if (state.ws && state.ws.readyState <= 1) return;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  state.ws = ws;
  ws.onopen = () => { state.wsReady = true; backoff = 500; emit('ws:open'); clearInterval(pingT); pingT = setInterval(() => sendWs({ t: 'ping', c: Date.now() }), 15000); sendWs({ t: 'ping', c: Date.now() }); };
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.serverNow && m.t !== 'move') state.offset = m.serverNow - Date.now();
    if (m.t === 'pong') { const rtt = Date.now() - m.c; state.offset = m.serverNow + rtt / 2 - Date.now(); state.rtt = rtt; }
    emit('ws:' + m.t, m); emit('ws', m);
  };
  ws.onclose = () => { state.wsReady = false; emit('ws:close'); clearInterval(pingT); setTimeout(connectWs, backoff); backoff = Math.min(8000, backoff * 1.7); };
  ws.onerror = () => {};
}
export function sendWs(m) { if (state.ws?.readyState === 1) { state.ws.send(JSON.stringify(m)); return true; } return false; }
export function reconnectWs() { try { state.ws?.close(); } catch {} setTimeout(connectWs, 50); }
export const serverNow = () => Date.now() + state.offset;

// global notifications
export function initGlobalHandlers(navigate) {
  on('ws:achievement', (m) => { toast(`🏅 Achievement unlocked: ${m.achievement.name}`, 'success', 6000); play('right'); });
  on('ws:notice', (m) => toast(m.text, 'info', 6000));
  on('ws:friend_request', (m) => { toast(`${m.from} sent you a friend request`, 'info', 6000); play('notify'); });
  on('ws:dm', (m) => { if (!location.hash.startsWith('#/messages')) { toast(`✉ ${m.from}: ${m.body.slice(0, 60)}`, 'info', 5000); play('notify'); } });
  on('ws:challenge', (m) => {
    play('notify');
    const box = document.createElement('div'); box.className = 'toast info in challenge';
    const txt = document.createElement('span'); txt.textContent = `${m.from} challenges you to ${m.rated ? 'rated' : 'casual'} ${Math.round(m.tc.initial / 60 * 10) / 10}+${m.tc.inc}`;
    const a = document.createElement('button'); a.className = 'btn small primary'; a.textContent = 'Accept'; a.onclick = () => { sendWs({ t: 'challenge_accept', id: m.id }); box.remove(); };
    const d = document.createElement('button'); d.className = 'btn small'; d.textContent = 'Decline'; d.onclick = () => { sendWs({ t: 'challenge_decline', id: m.id }); box.remove(); };
    box.append(txt, a, d); (document.querySelector('.toasts') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toasts' }))).append(box); setTimeout(() => box.remove(), 60000);
  });
  on('ws:challenge_declined', (m) => toast(`${m.by} declined your challenge`, 'info'));
  on('ws:game_start', () => {});
  on('ws:game', (m) => { if (m.game && !m.spectating && m.game.status === 'active' && !location.hash.includes(m.game.id) && !location.hash.startsWith('#/play/computer') && !location.hash.startsWith('#/analysis')) navigate('/game/' + m.game.id); });
  on('ws:joined', (m) => navigate('/game/' + m.id));
  on('ws:resume', (m) => { if (!location.hash.includes(m.id)) toast('You have a game in progress', 'info'); });
  on('ws:tournament_game', (m) => { toast('Your tournament game is starting!', 'success'); navigate('/game/' + m.id); });
  on('ws:tournament_start', (m) => toast(`Tournament "${m.name}" has started`, 'info', 6000));
  on('ws:error', (m) => { if (!m.ref || !['move'].includes(m.ref)) toast(m.error, 'error'); });
}
