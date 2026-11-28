import { h, $, clear, spinner, errorBox } from './util.js';
import { state, loadPrefs, applyPrefs, setPrefs, on } from './api.js';
import { initProfiles, activeProfile, asUser } from './profiles.js';
import { startIcons } from './icons.js';
import { startUpdateCheck, fetchPageBuild } from './update-check.js';
import { startI18n, getLang, setLang, languages } from './i18n.js';
import { installResume } from './resume.js';
import { avatar } from './util.js';
for (const m of ['append', 'prepend']) { const orig = Element.prototype[m]; Element.prototype[m] = function (...n) { return orig.apply(this, n.filter((x) => x != null && x !== false)); }; }
const ROUTES = [['/', 'home'], ['/play', 'computer'], ['/play/computer', 'computer'], ['/local', 'local'], ['/online', 'online'], ['/join/:code', 'online'], ['/admin', 'adminlocal'], ['/board', 'board'], ['/me', 'mygames'], ['/profile', 'profile'], ['/puzzles', 'puzzles'], ['/puzzles/:mode', 'puzzles', 'mode'], ['/learn', 'learn'], ['/learn/:id', 'learn', 'lesson'], ['/openings', 'openings'], ['/analysis', 'analysis'], ['/settings', 'settings']]
  .map(([p, mod, fn]) => { const keys = []; const re = new RegExp('^' + p.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'); return { re, keys, mod, fn }; });
const MODULES = { adminlocal: 'js/pages/admin-local.js', home: 'js/pages/home-static.js', computer: 'js/pages/computer.js', puzzles: 'js/pages/puzzles.js', learn: 'js/pages/learn.js', openings: 'js/pages/openings.js', analysis: 'js/pages/analysis.js', settings: 'js/pages/settings-static.js', local: 'js/pages/local-game.js', board: 'js/pages/board-page.js', online: 'js/pages/online-page.js', mygames: 'js/pages/mygames.js', profile: 'js/pages/profile-page.js' };
const NAV = [['/play', 'Play'], ['/local', '2 Players'], ['/online', 'Online'], ['/puzzles', 'Puzzles'], ['/learn', 'Learn'], ['/openings', 'Openings'], ['/board', 'Board'], ['/analysis', 'Analysis'], ['/me', 'My Games'], ['/profile', 'Profile'], ['/settings', 'Settings']];
let cleanup = null, view, navToken = 0;
export function navigate(path) { const t = '#' + path; if (location.hash === t) return route(); location.hash = path; }
async function route() {
  const token = ++navToken; const raw = location.hash.slice(1) || '/'; const [pathname, qs] = raw.split('?');
  const path = decodeURIComponent(pathname).replace(/\/+$/, '') || '/'; const query = Object.fromEntries(new URLSearchParams(qs || ''));
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const cleanups = []; clear(view); view.append(h('div', { class: 'page-loading' }, spinner()));
  let match = null; const params = {}; for (const r of ROUTES) { const m = r.re.exec(path); if (m) { match = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; } }
  for (const a of document.querySelectorAll('[data-nav]')) { const p = a.dataset.nav; a.classList.toggle('active', p === '/' ? path === '/' : path === p || path.startsWith(p + '/')); }
  document.title = 'Rookery — free chess for everyone'; window.scrollTo(0, 0); document.body.classList.remove('menu-open');
  const root = h('div', { class: 'page' });
  const ctx = { navigate, params, query, path, user: null, onCleanup: (fn) => cleanups.push(fn), setTitle: (t) => { document.title = t + ' · Rookery'; }, root, wide: (v = true) => root.classList.toggle('wide', v), requireLogin: () => true };
  try {
    if (!match) root.append(h('div', { class: 'card center' }, h('h1', null, 'Page not found'), h('a', { class: 'btn primary', href: '#/' }, 'Go home')));
    else { const mod = await window.__rk_import(MODULES[match.mod]); if (token !== navToken) return; const out = await (mod[match.fn || 'default'] || mod.default)(root, ctx); if (typeof out === 'function') cleanups.push(out); }
  } catch (e) { console.error(e); clear(root); root.append(errorBox(e.message || String(e))); }
  if (token !== navToken) { cleanups.forEach((f) => { try { f(); } catch {} }); return; }
  cleanup = () => cleanups.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  clear(view); view.append(root); root.classList.add('enter');
}
function boot() {
  initProfiles(); installResume(); state.prefs = loadPrefs(); applyPrefs(); const app = $('#app'); view = h('main', { id: 'view', tabindex: -1 });
  const themeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Toggle dark and light theme', onclick: () => setPrefs({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }) });
  const upd = () => { themeBtn.textContent = document.documentElement.dataset.theme === 'dark' ? '☀' : '☾'; }; upd(); on('prefs', upd);
  const chip = h('a', { class: 'profile-chip', href: '#/profile', title: 'Your profile' }); const paintChip = () => { clear(chip); const p = activeProfile(); chip.append(avatar(asUser(p), 28), h('span', { class: 'chip-name' }, p.name)); }; paintChip(); document.addEventListener('rk-profile', paintChip);
  const langSel = h('select', { class: 'lang-sel', 'aria-label': 'Language', onchange: () => setLang(langSel.value) }, Object.entries(languages).map(([k, v]) => h('option', { value: k, selected: k === getLang() }, v)));
  const links = h('nav', { class: 'main-nav', 'aria-label': 'Main' }, NAV.map(([p, l]) => h('a', { href: '#' + p, dataset: { nav: p } }, l)));
  const header = h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' }, h('button', { class: 'icon-btn burger', 'aria-label': 'Menu', onclick: () => document.body.classList.toggle('menu-open') }, '☰'),
    h('a', { class: 'brand', href: '#/' }, h('img', { src: window.__rk_logo, alt: '', width: 32, height: 32 }), h('span', null, 'Rookery')), links, h('div', { class: 'spacer' }), chip, langSel, themeBtn));
  const drawer = h('nav', { class: 'drawer', 'aria-label': 'Menu' }, NAV.map(([p, l]) => h('a', { href: '#' + p, dataset: { nav: p } }, l)));
  const tab = [['/', '⌂', 'Home'], ['/play', '♞', 'Play'], ['/puzzles', '🧩', 'Puzzles'], ['/learn', '📘', 'Learn'], ['/openings', '📖', 'Openings']];
  app.append(header, drawer, h('div', { class: 'scrim', onclick: () => document.body.classList.remove('menu-open') }), view,
    h('footer', { class: 'footer' }, h('div', null, h('strong', null, 'Rookery'), ' — chess for everyone. ', h('span', { class: 'free-badge' }, '100% free · no ads · no premium')), h('div', { class: 'muted' }, 'Standalone edition: runs entirely in your browser.')),
    h('nav', { class: 'tabbar', 'aria-label': 'Primary' }, tab.map(([p, i, l]) => h('a', { href: '#' + p, dataset: { nav: p } }, h('span', { class: 'ti' }, i), h('span', null, l)))));
  window.addEventListener('hashchange', route); route(); startIcons(app); startI18n(app); startUpdateCheck({ current: window.__rk_build, fetchLatest: fetchPageBuild });
}
boot();
