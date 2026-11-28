import { h, clear, toast, avatar, tabs, pickFile, confirmBox } from '../util.js';
import { state, get, put, post, del, setPrefs, refreshMe, BOARDS, BACKGROUNDS, PROFILE_THEMES, DEFAULT_PREFS } from '../api.js';
import { PIECE_SETS, pieceSvg } from '../pieces.js';
import { play } from '../sound.js';

const SOUND_PACKS = { wood: 'Wooden', soft: 'Soft', arcade: 'Arcade', none: 'Silent' };

function toggle(label, key, hint) {
  const inp = h('input', { type: 'checkbox', checked: !!state.prefs[key], onchange: () => setPrefs({ [key]: inp.checked }) });
  return h('label', { class: 'check setting' }, inp, h('span', null, h('strong', null, label), hint ? h('span', { class: 'muted small block' }, hint) : null));
}

export default async function settings(root, ctx) {
  if (!ctx.requireLogin()) return;
  ctx.setTitle('Settings');
  const panel = h('div');
  const sections = {
    appearance() {
      const swatch = (id, [l, d, name]) => h('button', { class: 'swatch' + (state.prefs.board === id ? ' active' : ''), title: name, 'aria-label': 'Board ' + name, 'aria-pressed': state.prefs.board === id, onclick: () => { setPrefs({ board: id }); show('appearance'); } },
        h('span', { class: 'mini-board', style: { background: `conic-gradient(${l} 25%, ${d} 0 50%, ${l} 0 75%, ${d} 0)`, backgroundSize: '50% 50%' } }), h('span', null, name));
      const pieceOpt = (id, name) => h('button', { class: 'swatch' + (state.prefs.pieces === id ? ' active' : ''), 'aria-pressed': state.prefs.pieces === id, onclick: () => { setPrefs({ pieces: id }); show('appearance'); } }, h('span', { class: 'piece-prev', innerHTML: '' }, pieceNode('w', 'n', id), pieceNode('b', 'q', id)), h('span', null, name));
      const bg = (id, name) => h('button', { class: 'swatch' + (state.prefs.bg === id ? ' active' : ''), 'aria-pressed': state.prefs.bg === id, onclick: () => { setPrefs({ bg: id }); show('appearance'); } }, h('span', { class: 'bg-prev', dataset: { bg: id } }), h('span', null, name));
      const th = (id, [c, name]) => h('button', { class: 'swatch' + (state.prefs.profileTheme === id ? ' active' : ''), 'aria-pressed': state.prefs.profileTheme === id, onclick: () => { setPrefs({ profileTheme: id }); show('appearance'); } }, h('span', { class: 'color-prev', style: { background: c } }), h('span', null, name));
      const themeSeg = h('div', { class: 'seg' }, [['dark', '☾ Dark'], ['light', '☀ Light'], ['system', '🖥 System']].map(([v, l]) => h('button', { class: state.prefs.theme === v ? 'active' : '', onclick: () => { setPrefs({ theme: v }); show('appearance'); } }, l)));
      return [h('section', { class: 'card' }, h('h2', null, 'Theme'), themeSeg),
        h('section', { class: 'card' }, h('h2', null, 'Board'), h('div', { class: 'swatches' }, Object.entries(BOARDS).map(([i, v]) => swatch(i, v)))),
        h('section', { class: 'card' }, h('h2', null, 'Pieces'), h('div', { class: 'swatches' }, Object.entries(PIECE_SETS).map(([i, n]) => pieceOpt(i, n)))),
        h('section', { class: 'card' }, h('h2', null, 'Background'), h('div', { class: 'swatches' }, Object.entries(BACKGROUNDS).map(([i, n]) => bg(i, n)))),
        h('section', { class: 'card' }, h('h2', null, 'Accent colour'), h('div', { class: 'swatches' }, Object.entries(PROFILE_THEMES).map(([i, v]) => th(i, v)))),
        h('section', { class: 'card' }, h('h2', null, 'Display'), toggle('Board coordinates', 'coords'), toggle('Highlight legal moves and last move', 'highlight'), toggle('Piece animations', 'animations', 'Turn off for reduced motion'))];
    },
    sound() {
      const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: state.prefs.volume, 'aria-label': 'Volume', oninput: () => setPrefs({ volume: +vol.value }, false), onchange: () => { setPrefs({ volume: +vol.value }); play('move'); } });
      const packs = h('div', { class: 'seg' }, Object.entries(SOUND_PACKS).map(([v, l]) => h('button', { class: state.prefs.soundPack === v ? 'active' : '', onclick: () => { setPrefs({ soundPack: v }); show('sound'); setTimeout(() => play('capture'), 50); } }, l)));
      return [h('section', { class: 'card' }, h('h2', null, 'Sound'), toggle('Sound effects', 'sound'), h('label', { class: 'field' }, h('span', null, 'Volume'), vol), h('div', { class: 'field' }, h('span', null, 'Sound pack'), packs),
        h('div', { class: 'row' }, ['move', 'capture', 'check', 'castle', 'notify'].map((k) => h('button', { class: 'btn small', onclick: () => play(k) }, '▶ ' + k))))];
    },
    gameplay() { return [h('section', { class: 'card' }, h('h2', null, 'Gameplay'), toggle('Auto-queen promotions', 'autoQueen', 'Promote to a queen without asking'), toggle('Confirm before resigning', 'confirmResign'))]; },
    profile() {
      const bio = h('textarea', { rows: 4, maxLength: 300, value: state.user.bio || '' }); const country = h('input', { maxLength: 2, value: state.user.country || '', placeholder: 'GB', style: { width: '5em', textTransform: 'uppercase' } });
      const av = h('div', { class: 'row' });
      const drawAv = () => { clear(av); av.append(avatar(state.user, 72), h('div', { class: 'col' },
        h('div', { class: 'row' }, ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'].map((p) => h('button', { class: 'btn small', 'aria-label': 'Use ' + p + ' avatar', onclick: () => saveAvatar('preset:' + p) }, { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' }[p]))),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: upload }, 'Upload image'), h('button', { class: 'btn small ghost', onclick: () => saveAvatar(null) }, 'Remove')))); };
      async function saveAvatar(v) { try { await put('/api/me', { avatar: v }); await refreshMe(); drawAv(); toast('Avatar updated', 'success'); } catch (e) { toast(e.message, 'error'); } }
      async function upload() { const f = await pickFile('image/png,image/jpeg,image/webp'); if (!f) return; if (f.size > 100_000) return toast('Choose an image under 100 KB', 'error'); const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }); saveAvatar(data); }
      drawAv();
      return [h('section', { class: 'card' }, h('h2', null, 'Profile'), h('div', { class: 'field' }, h('span', null, 'Avatar'), av), h('label', { class: 'field' }, h('span', null, 'Bio'), bio), h('label', { class: 'field' }, h('span', null, 'Country code (2 letters)'), country),
        h('button', { class: 'btn primary', onclick: async () => { try { await put('/api/me', { bio: bio.value, country: country.value.trim() || '' }); await refreshMe(); toast('Profile saved', 'success'); } catch (e) { toast(e.message, 'error'); } } }, 'Save profile'))];
    },
    account() {
      const cur = h('input', { type: 'password', autocomplete: 'current-password' }), nw = h('input', { type: 'password', autocomplete: 'new-password' });
      const blocked = h('div', { class: 'col' }, h('span', { class: 'muted' }, 'Loading…'));
      get('/api/friends').then((r) => { clear(blocked); if (!r.blocked.length) blocked.append(h('span', { class: 'muted' }, 'You have not blocked anyone.')); for (const b of r.blocked) blocked.append(h('div', { class: 'row' }, h('a', { href: '#/u/' + encodeURIComponent(b.username) }, b.username), h('button', { class: 'btn small', onclick: async (e) => { await del('/api/blocks/' + encodeURIComponent(b.username)); e.target.closest('.row').remove(); } }, 'Unblock'))); }).catch(() => {});
      return [h('section', { class: 'card' }, h('h2', null, 'Account'), h('p', { class: 'muted' }, 'Signed in as ', h('strong', null, state.user.username), ' · ', state.user.email),
        h('h3', null, 'Change password'), h('label', { class: 'field' }, h('span', null, 'Current password'), cur), h('label', { class: 'field' }, h('span', null, 'New password (8+ characters)'), nw),
        h('button', { class: 'btn primary', onclick: async () => { try { await put('/api/me/password', { current: cur.value, password: nw.value }); cur.value = nw.value = ''; toast('Password changed. Other devices were signed out.', 'success'); } catch (e) { toast(e.message, 'error'); } } }, 'Change password')),
        h('section', { class: 'card' }, h('h2', null, 'Blocked players'), blocked),
        h('section', { class: 'card' }, h('h2', null, 'Reset preferences'), h('button', { class: 'btn', onclick: async () => { if (await confirmBox('Reset preferences?', 'Theme, board, pieces and sound go back to defaults.', 'Reset')) { setPrefs({ ...DEFAULT_PREFS }); toast('Preferences reset'); show('appearance'); } } }, 'Restore defaults'))];
    },
  };
  function pieceNode(c, t, set) { const s = h('span', { class: 'pv' }); s.append(new DOMParser().parseFromString(pieceSvg(c, t, set), 'image/svg+xml').documentElement); return s; }
  let current = ctx.query.tab || 'appearance';
  function show(id) { current = id; clear(panel); panel.append(h('div', { class: 'col' }, sections[id]())); }
  root.append(h('h1', null, 'Settings'), h('p', { class: 'muted' }, 'Changes save automatically to your account and apply on every device.'),
    tabs([['appearance', 'Appearance'], ['sound', 'Sound'], ['gameplay', 'Gameplay'], ['profile', 'Profile'], ['account', 'Account']], current, show), panel);
  show(sections[current] ? current : 'appearance');
}
