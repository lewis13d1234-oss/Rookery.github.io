import { h, clear, toast, confirmBox, promptBox, avatar, download, pickFile } from '../util.js';
import { profiles, activeProfile, updateProfile, addProfile, switchProfile, deleteProfile, peek, asUser, AVATARS, exportAll, importAll } from '../profiles.js';
import { ACH, earned } from './mygames.js';
import { LEVELS } from '/shared/engine.js';

const GLYPH = { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟︎' };
const flag = (cc) => (/^[A-Za-z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : '');
// Read an image file, centre-crop to a square and shrink to 160px so it stays small in localStorage.
async function photoFromFile(f) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) throw new Error('Choose a PNG, JPEG, WebP or GIF image.');
  if (f.size > 12 * 1024 * 1024) throw new Error('That image is too large (12 MB maximum).');
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That image could not be read.')); i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight); if (!side) throw new Error('That image could not be read.');
    const c = document.createElement('canvas'); c.width = c.height = 160; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 160, 160);
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 160, 160);
    return c.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}
function ratingChart() {
  let d = {}; try { d = JSON.parse(localStorage.getItem('rk_pz2') || '{}'); } catch {}
  const pts = (d.hist || []).map((x) => x.rating); if (pts.length < 2) return h('p', { class: 'muted' }, 'Solve a few rated puzzles to see your rating curve.');
  const W = 600, H = 150, P = 24, lo = Math.min(...pts) - 10, hi = Math.max(...pts) + 10; const x = (i) => P + (i / (pts.length - 1)) * (W - 2 * P), y = (v) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
  const svg = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="rating-chart" role="img" aria-label="Puzzle rating history"><path d="${pts.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/><text x="${P}" y="14" class="axis">${Math.round(hi)}</text><text x="${P}" y="${H - 6}" class="axis">${Math.round(lo)}</text></svg>`, 'image/svg+xml').documentElement;
  return svg;
}
export default async function profilePage(root, ctx) {
  ctx.setTitle('Profile');
  const box = h('div', { class: 'col' });
  const reload = () => { ctx.navigate('/profile'); };
  function draw() {
    clear(box); const p = activeProfile(); const st = peek(p.id); const got = earned();
    const name = h('input', { value: p.name, maxLength: 20, 'aria-label': 'Display name' }), bio = h('textarea', { rows: 3, maxLength: 160, placeholder: 'Tell people about your chess…' }), country = h('input', { value: p.country || '', maxLength: 2, placeholder: 'GB', 'aria-label': 'Country code', style: { width: '5em', textTransform: 'uppercase' } });
    bio.value = p.bio || '';
    const avRow = h('div', { class: 'row' }, AVATARS.map((a) => h('button', { class: 'btn' + (p.avatar === a ? ' primary' : ''), 'aria-label': 'Avatar ' + a, 'aria-pressed': p.avatar === a, style: { fontSize: '1.4rem', lineHeight: 1, padding: '6px 12px' }, onclick: () => { updateProfile(p.id, { avatar: a, photo: '' }); document.dispatchEvent(new Event('rk-profile')); draw(); } }, GLYPH[a])));
    const photoRow = h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => { const f = await pickFile('image/png,image/jpeg,image/webp,image/gif'); if (!f) return; try { updateProfile(p.id, { photo: await photoFromFile(f) }); toast('Photo updated', 'success'); document.dispatchEvent(new Event('rk-profile')); draw(); } catch (e) { toast(e.message, 'error'); } } }, '⬆ Upload photo'), p.photo ? h('button', { class: 'btn ghost', onclick: () => { updateProfile(p.id, { photo: '' }); document.dispatchEvent(new Event('rk-profile')); draw(); } }, 'Remove photo') : null, h('span', { class: 'muted small' }, 'Stays on this device. It is cropped to a square and shrunk.'));
    box.append(
      h('section', { class: 'card profile-head' }, avatar(asUser(p), 84), h('div', { class: 'grow' },
        h('h1', { class: 'profile-name' }, p.name, ' ', h('span', { title: p.country }, flag(p.country))), h('p', { class: p.bio ? '' : 'muted' }, p.bio || 'No bio yet.'),
        h('p', { class: 'muted small' }, 'Profile created ' + new Date(p.created).toLocaleDateString([], { dateStyle: 'medium' }) + ' · stored on this device only'))),
      h('section', { class: 'grid-4' }, [['Games', st.games], ['Puzzle rating', st.rating], ['Puzzles solved', st.solved], ['Achievements', got.length + '/' + ACH.length]].map(([t, v]) => h('div', { class: 'card stat' }, h('div', { class: 'muted small' }, t), h('div', { class: 'big' }, v)))),
      h('section', { class: 'card' }, h('h2', null, 'Puzzle rating'), ratingChart()),
      h('section', { class: 'card' }, h('h2', null, 'Achievements'), h('div', { class: 'ach-grid' }, ACH.filter((a) => got.includes(a[0])).map(([id, ic, n, d]) => h('div', { class: 'ach', title: d }, h('span', { class: 'ach-icon' }, ic), h('span', null, n))), got.length ? null : h('span', { class: 'muted' }, 'Play, solve puzzles and finish lessons to earn them. '), h('a', { href: '#/me' }, 'See all'))),
      h('section', { class: 'card' }, h('h2', null, 'Edit profile'), h('div', { class: 'field' }, h('span', null, 'Avatar'), avRow, photoRow), h('label', { class: 'field' }, h('span', null, 'Display name (2–20 characters)'), name), h('label', { class: 'field' }, h('span', null, 'Bio'), bio), h('label', { class: 'field' }, h('span', null, 'Country code (2 letters, optional)'), country),
        h('button', { class: 'btn primary', onclick: () => { const n = name.value.trim(); if (n.length < 2) return toast('Choose a name with at least 2 characters', 'error'); updateProfile(p.id, { name: n, bio: bio.value.trim(), country: country.value.trim().toUpperCase() }); toast('Profile saved', 'success'); document.dispatchEvent(new Event('rk-profile')); draw(); } }, 'Save profile')),
      h('section', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Players on this device'), h('button', { class: 'btn small primary', onclick: async () => { const n = await promptBox('New profile', 'Name for the new player', { okLabel: 'Create' }); if (n == null) return; const id = addProfile(n.trim().slice(0, 20)); switchProfile(id); location.reload(); } }, '+ Add player')),
        h('p', { class: 'muted small' }, 'Each player keeps their own games, puzzle rating, lesson progress and repertoires.'),
        profiles().map((q) => { const s = peek(q.id); return h('div', { class: 'row person' }, avatar(asUser(q), 34), h('div', { class: 'grow' }, h('strong', null, q.name, q.id === p.id ? ' (playing now)' : ''), h('div', { class: 'muted small' }, `${s.games} games · puzzle rating ${s.rating}`)),
          q.id === p.id ? null : h('button', { class: 'btn small', onclick: () => { switchProfile(q.id); location.reload(); } }, 'Switch'),
          profiles().length > 1 ? h('button', { class: 'btn small ghost', onclick: async () => { if (await confirmBox('Delete ' + q.name + '?', 'Their games, puzzle rating and progress on this device are removed.', 'Delete')) { const was = q.id === p.id; deleteProfile(q.id); if (was) location.reload(); else draw(); } } }, 'Delete') : null); })),
      h('section', { class: 'card' }, h('h2', null, 'Backup'), h('p', { class: 'muted' }, 'Everything is stored in this browser. Download a backup to move to another device or browser, or to keep a copy.'),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => download('rookery-backup.json', exportAll(), 'application/json') }, '⬇ Download backup'),
          h('button', { class: 'btn', onclick: async () => { const f = await pickFile('application/json,.json'); if (!f) return; try { const n = importAll(await f.text()); toast(`Restored ${n} items. Reloading…`, 'success'); setTimeout(() => location.reload(), 900); } catch (e) { toast(e.message, 'error'); } } }, '⬆ Restore backup'))));
  }
  draw(); root.append(box);
}
