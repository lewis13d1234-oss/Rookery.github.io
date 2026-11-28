import { h, clear } from '../util.js';
import { state, setPrefs, BOARDS } from '../api.js';
import { PIECE_SETS, pieceSvg } from '../pieces.js';
import { getLang, setLang, languages } from '../i18n.js';
import { play } from '../sound.js';
export default async function settings(root, ctx) {
  ctx.setTitle('Settings');
  const panel = h('div', { class: 'col' });
  const toggle = (label, key, dflt = false) => { const i = h('input', { type: 'checkbox', checked: state.prefs[key] === undefined ? dflt : !!state.prefs[key], onchange: () => setPrefs({ [key]: i.checked }) }); return h('label', { class: 'check setting' }, i, h('span', null, h('strong', null, label))); };
  const piece = (c, t, set) => { const s = h('span', { class: 'pv' }); s.append(new DOMParser().parseFromString(pieceSvg(c, t, set), 'image/svg+xml').documentElement); return s; };
  const draw = () => { clear(panel); panel.append(
    h('section', { class: 'card' }, h('h2', null, 'Theme'), h('div', { class: 'seg' }, [['dark', '☾ Dark'], ['light', '☀ Light'], ['system', '🖥 System']].map(([v, l]) => h('button', { class: state.prefs.theme === v ? 'active' : '', onclick: () => { setPrefs({ theme: v }); draw(); } }, l)))),
    h('section', { class: 'card' }, h('h2', null, 'Language'), h('select', { 'aria-label': 'Language', onchange: (e) => setLang(e.target.value) }, Object.entries(languages).map(([k, v]) => h('option', { value: k, selected: k === getLang() }, v))), h('p', { class: 'muted small' }, 'Menus, buttons and game controls are translated. Lessons are translated. Opening names, puzzle themes and some labels stay in English.')),
    h('section', { class: 'card' }, h('h2', null, 'Board'), h('div', { class: 'swatches' }, Object.entries(BOARDS).map(([id, [l, d, name]]) => h('button', { class: 'swatch' + (state.prefs.board === id ? ' active' : ''), 'aria-pressed': state.prefs.board === id, onclick: () => { setPrefs({ board: id }); draw(); } }, h('span', { class: 'mini-board', style: { background: `conic-gradient(${l} 25%, ${d} 0 50%, ${l} 0 75%, ${d} 0)`, backgroundSize: '50% 50%' } }), h('span', null, name))))),
    h('section', { class: 'card' }, h('h2', null, 'Pieces'), h('div', { class: 'swatches' }, Object.entries(PIECE_SETS).map(([id, name]) => h('button', { class: 'swatch' + (state.prefs.pieces === id ? ' active' : ''), 'aria-pressed': state.prefs.pieces === id, onclick: () => { setPrefs({ pieces: id }); draw(); } }, h('span', { class: 'piece-prev' }, piece('w', 'n', id), piece('b', 'q', id)), h('span', null, name))))),
    h('section', { class: 'card' }, h('h2', null, 'Display and sound'), toggle('Board coordinates', 'coords'), toggle('Piece animations', 'animations'), toggle('Premoves (queue a move on your opponent\'s turn)', 'premove', true), toggle('Sound effects', 'sound'), h('button', { class: 'btn small', onclick: () => play('move') }, '▶ Test sound')),
    h('p', { class: 'muted small' }, 'Settings are saved in this browser only.')); };
  draw(); root.append(h('h1', null, 'Settings'), panel);
}
