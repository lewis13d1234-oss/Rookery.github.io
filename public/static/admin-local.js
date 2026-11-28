// Hidden admin panel for THIS browser's Rookery data. It is not a security boundary: anyone with the device,
// the browser's developer tools or this file's source can bypass it. The passcode only keeps casual visitors out.
import { h, clear, toast, confirmBox, promptBox, download, pickFile } from '../util.js';
import { profiles, activeProfile, peek, deleteProfile, updateProfile, exportAll, importAll } from '../profiles.js';
import { Chess } from '/shared/chess.js';
const KEY = 'rk_admin', FAIL = 'rk_admin_fail', SESSION = 'rk_admin_ok', IDLE = 15 * 60_000;
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(s.match(/../g) || [], (x) => parseInt(x, 16));
async function hashPass(pass, salt) { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']); return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, k, 256)); }
const same = (a, b) => { let d = a.length ^ b.length; for (let i = 0; i < Math.min(a.length, b.length); i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const getRec = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
export async function setPasscode(pass) { const salt = crypto.getRandomValues(new Uint8Array(16)); localStorage.setItem(KEY, JSON.stringify({ salt: hex(salt), hash: await hashPass(pass, salt), made: Date.now() })); }
export async function checkPasscode(pass) { const r = getRec(); if (!r) return false; return same(await hashPass(pass, unhex(r.salt)), r.hash); }
const unlocked = () => { try { const t = +sessionStorage.getItem(SESSION); return t && Date.now() - t < IDLE; } catch { return false; } };
const touch = () => { try { sessionStorage.setItem(SESSION, String(Date.now())); } catch {} };
const fails = () => { try { return JSON.parse(localStorage.getItem(FAIL) || '{"n":0,"until":0}'); } catch { return { n: 0, until: 0 }; } };
const kb = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';

export default async function admin(root, ctx) {
  ctx.setTitle('Admin');
  const box = h('div', { class: 'col' }); root.append(h('h1', null, 'Admin panel'), box);
  const notice = h('div', { class: 'card', style: { borderColor: 'var(--accent)' } }, h('strong', null, 'Local tools only. '), 'This panel manages the data stored in this browser. Rookery has no server, so there are no accounts to administer and this is not real security: anyone with access to this device can still read or change the data.');
  if (!window.crypto?.subtle) { box.append(notice, h('div', { class: 'card' }, 'The passcode needs a secure page (https:// or a local file). Open the site over https to use the admin panel.')); return; }
  let idleTimer; const lock = () => { try { sessionStorage.removeItem(SESSION); } catch {} clearInterval(idleTimer); draw(); };
  function draw() { clear(box); if (!getRec()) return setup(); if (!unlocked()) return login(); touch(); panel(); }
  function setup() {
    const p1 = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'New passcode', placeholder: 'At least 8 characters' }), p2 = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'Repeat passcode', placeholder: 'Repeat it' });
    box.append(notice, h('section', { class: 'card form-card col' }, h('h2', null, 'Set a passcode'), h('p', { class: 'muted' }, 'Choose a passcode for this panel. It is stored only in this browser, as a salted hash. If you forget it, clearing the site’s data in your browser resets it (and removes everything else saved here).'), h('label', { class: 'field' }, h('span', null, 'Passcode'), p1), h('label', { class: 'field' }, h('span', null, 'Repeat passcode'), p2),
      h('button', { class: 'btn primary', onclick: async () => { if (p1.value.length < 8) return toast('Use at least 8 characters.', 'error'); if (p1.value !== p2.value) return toast('The two passcodes differ.', 'error'); await setPasscode(p1.value); touch(); toast('Passcode set', 'success'); draw(); } }, 'Save passcode')));
  }
  function login() {
    const p = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Passcode', onkeydown: (e) => { if (e.key === 'Enter') go(); } }); const msg = h('p', { class: 'loss', 'aria-live': 'polite' });
    async function go() { const f = fails(); if (Date.now() < f.until) { msg.textContent = `Too many attempts. Try again in ${Math.ceil((f.until - Date.now()) / 1000)} s.`; return; }
      if (await checkPasscode(p.value)) { try { localStorage.removeItem(FAIL); } catch {} touch(); draw(); return; }
      const n = f.n + 1; const until = n >= 5 ? Date.now() + Math.min(600, 30 * 2 ** (n - 5)) * 1000 : 0; try { localStorage.setItem(FAIL, JSON.stringify({ n, until })); } catch {} msg.textContent = until ? 'Too many attempts. Locked for a while.' : 'Wrong passcode.'; p.value = ''; }
    box.append(notice, h('section', { class: 'card form-card col' }, h('h2', null, 'Enter passcode'), h('label', { class: 'field' }, h('span', null, 'Passcode'), p), h('div', null, h('button', { class: 'btn primary', onclick: go }, 'Unlock')), msg));
    setTimeout(() => p.focus(), 50);
  }
  function usage() { const rows = []; let total = 0; for (let i = 0; i < localStorage.length; i++) { const k = Storage.prototype.key.call(localStorage, i); const v = Storage.prototype.getItem.call(localStorage, k) || ''; const bytes = (k.length + v.length) * 2; total += bytes; rows.push([k, bytes]); } rows.sort((a, b) => b[1] - a[1]); return { rows, total }; }
  function panel() {
    idleTimer = setInterval(() => { if (!unlocked()) { clearInterval(idleTimer); toast('Admin panel locked after 15 minutes idle.', 'info'); draw(); } }, 30_000); ctx.onCleanup(() => clearInterval(idleTimer));
    const act = activeProfile(); const ps = profiles(); const { rows, total } = usage();
    const stat = (n, l) => h('div', { class: 'card center' }, h('div', { style: { fontSize: '1.8rem', fontWeight: 700 } }, String(n)), h('div', { class: 'muted small' }, l));
    const infos = ps.map((p) => ({ p, i: peek(p.id) })); const games = infos.reduce((a, x) => a + x.i.games, 0);
    const profTable = h('table', { class: 'table' }, h('thead', null, h('tr', null, ['Player', 'Games', 'Puzzle rating', 'Solved', ''].map((t) => h('th', null, t)))), h('tbody', null, infos.map(({ p, i }) => h('tr', null, h('td', null, p.name, p.id === act.id ? h('span', { class: 'pill' }, 'active') : null), h('td', null, i.games), h('td', null, i.rating), h('td', null, i.solved),
      h('td', null, h('button', { class: 'btn small ghost', onclick: async () => { const n = await promptBox('Rename player', 'Name', { value: p.name }); if (n && n.trim()) { updateProfile(p.id, { name: n.trim().slice(0, 20) }); draw(); } } }, 'Rename'), ' ',
        h('button', { class: 'btn small ghost', disabled: ps.length < 2, onclick: async () => { if (await confirmBox('Delete ' + p.name + '?', 'This removes the player and all of their games, puzzle rating and progress from this browser.', 'Delete')) { deleteProfile(p.id); toast('Player deleted'); draw(); } } }, 'Delete'))))));
    const perftOut = h('p', { class: 'muted small mono' }); const diag = [['Browser', navigator.userAgent], ['Language', navigator.language], ['Screen', `${screen.width}×${screen.height} @${devicePixelRatio}x`], ['Secure context', String(isSecureContext)], ['Web Workers', String(typeof Worker !== 'undefined')], ['WebRTC (online play)', String(typeof RTCPeerConnection !== 'undefined')], ['CompressionStream', String(typeof CompressionStream !== 'undefined')], ['localStorage used', kb(total)], ['Network requests made by this page', 'none (single file, no server)']];
    box.append(notice,
      h('div', { class: 'grid-3' }, stat(ps.length, 'players'), stat(games, 'saved games'), stat(kb(total), 'browser storage used')),
      h('section', { class: 'card' }, h('h2', null, 'Players on this device'), h('div', { class: 'table-wrap' }, profTable)),
      h('section', { class: 'card col' }, h('h2', null, 'Data'), h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { download('rookery-backup-' + new Date().toISOString().slice(0, 10) + '.json', exportAll(), 'application/json'); } }, '⬇ Download full backup'),
        h('button', { class: 'btn', onclick: async () => { const f = await pickFile('application/json,.json'); if (!f) return; try { const n = importAll(await f.text()); toast(`Restored ${n} items. Reloading…`, 'success'); setTimeout(() => location.reload(), 800); } catch (e) { toast(e.message, 'error'); } } }, '⬆ Restore backup'),
        h('button', { class: 'btn danger', onclick: async () => { if (!await confirmBox('Erase everything?', 'This deletes every player, game, rating, setting and the admin passcode stored in this browser. Download a backup first. It cannot be undone.', 'Erase everything')) return; const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = Storage.prototype.key.call(localStorage, i); if (k && k.startsWith('rk_')) keys.push(k); } keys.forEach((k) => Storage.prototype.removeItem.call(localStorage, k)); try { sessionStorage.clear(); } catch {} location.hash = '/'; setTimeout(() => location.reload(), 100); } }, 'Erase all data')),
        h('p', { class: 'muted small' }, 'Backups never include the admin passcode.')),
      h('section', { class: 'card' }, h('h2', null, 'Storage by item'), h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, 'Key'), h('th', { class: 'num' }, 'Size'))), h('tbody', null, rows.slice(0, 14).map(([k, b]) => h('tr', null, h('td', { class: 'mono small' }, k), h('td', { class: 'num' }, kb(b)))))))),
      h('section', { class: 'card col' }, h('h2', null, 'Diagnostics'), h('table', { class: 'table' }, h('tbody', null, diag.map(([k, v]) => h('tr', null, h('td', { class: 'muted' }, k), h('td', { class: 'small', style: { overflowWrap: 'anywhere' } }, v))))),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { const t0 = performance.now(); const g = new Chess(); const n = g.perft(4); const ms = Math.round(performance.now() - t0); perftOut.textContent = `Rules check: perft(4) from the start position = ${n} (expected 197281) — ${n === 197281 ? 'PASS' : 'FAIL'} in ${ms} ms`; } }, 'Run rules self-test')), perftOut),
      h('section', { class: 'card col' }, h('h2', null, 'Server (Render)'),
        h('p', { class: 'muted small' }, 'Paste your Render address to open the real admin dashboard. Sign in there with the admin username you set in Render.'),
        (() => { const inp = h('input', { class: 'input', type: 'url', placeholder: 'https://your-app.onrender.com', 'aria-label': 'Server address', value: localStorage.getItem('rk_admin_server') || '' });
          const clean = () => { const v = inp.value.trim().replace(/\/+$/, ''); return /^https:\/\/[^\s/]+\.[^\s/]+$/.test(v) ? v : null; };
          return h('div', { class: 'col' }, inp, h('div', { class: 'row' },
            h('button', { class: 'btn', onclick: () => { const v = clean(); if (!v) return toast('Enter a full https:// address.', 'error'); localStorage.setItem('rk_admin_server', v); toast('Server address saved', 'success'); } }, 'Save address'),
            h('button', { class: 'btn', onclick: () => { const v = clean(); if (!v) return toast('Enter a full https:// address.', 'error'); localStorage.setItem('rk_admin_server', v); window.open(v + '/#/admin', '_blank', 'noopener'); } }, 'Open server admin'))); })()),
      h('section', { class: 'card col' }, h('h2', null, 'Security'), h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: lock }, 'Lock now'),
        h('button', { class: 'btn', onclick: async () => { const cur = await promptBox('Change passcode', 'Current passcode', { type: 'password' }); if (cur == null) return; if (!await checkPasscode(cur)) return toast('Wrong passcode.', 'error'); const n = await promptBox('Change passcode', 'New passcode (8+ characters)', { type: 'password' }); if (!n || n.length < 8) return toast('Use at least 8 characters.', 'error'); await setPasscode(n); toast('Passcode changed', 'success'); } }, 'Change passcode'),
        h('button', { class: 'btn ghost', onclick: async () => { const cur = await promptBox('Remove passcode', 'Current passcode', { type: 'password' }); if (cur == null) return; if (!await checkPasscode(cur)) return toast('Wrong passcode.', 'error'); localStorage.removeItem(KEY); lock(); toast('Passcode removed', 'success'); } }, 'Remove passcode')),
        h('p', { class: 'muted small' }, 'This page is not linked anywhere on the site. Its address is the site address followed by #/admin.')));
  }
  draw();
}
