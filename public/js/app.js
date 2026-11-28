import { h, $, clear, toast, avatar, spinner, errorBox, debounce } from './util.js';
import { state, get, post, refreshMe, loadPrefs, applyPrefs, setPrefs, connectWs, initGlobalHandlers, on, sendWs } from './api.js';

// Native append()/prepend() stringify null/false; make optional children (cond ? node : null) safe everywhere.
for (const m of ['append', 'prepend']) { const orig = Element.prototype[m]; Element.prototype[m] = function (...n) { return orig.apply(this, n.filter((x) => x != null && x !== false)); }; }

const ROUTES = [
  ['/', 'home'], ['/play', 'play'], ['/watch', 'play', 'watch'], ['/play/computer', 'computer'], ['/game/:id', 'game'], ['/join/:code', 'game', 'join'],
  ['/puzzles', 'puzzles'], ['/puzzles/:mode', 'puzzles', 'mode'], ['/learn', 'learn'], ['/learn/:id', 'learn', 'lesson'], ['/openings', 'openings'],
  ['/analysis', 'analysis'], ['/analysis/:id', 'analysis'], ['/u/:name', 'profile'], ['/leaderboard', 'leaderboard'],
  ['/friends', 'social', 'friends'], ['/messages', 'social', 'messages'], ['/messages/:name', 'social', 'messages'],
  ['/clubs', 'clubs'], ['/clubs/:id', 'clubs', 'club'], ['/tournaments', 'tournaments'], ['/tournaments/new', 'tournaments', 'create'], ['/tournaments/:id', 'tournaments', 'detail'],
  ['/settings', 'settings'], ['/login', 'auth', 'login'], ['/register', 'auth', 'register'], ['/forgot', 'auth', 'forgot'], ['/reset/:token', 'auth', 'reset'], ['/admin', 'admin'],
].map(([p, mod, fn]) => { const keys = []; const re = new RegExp('^' + p.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'); return { re, keys, mod, fn }; });

const NAV = [['/play', 'Play'], ['/puzzles', 'Puzzles'], ['/learn', 'Learn'], ['/openings', 'Openings'], ['/analysis', 'Analysis'], ['/tournaments', 'Tournaments'], ['/leaderboard', 'Leaderboards'], ['/clubs', 'Clubs']];
let cleanup = null, view, headerEl, navToken = 0;

export function navigate(path, replace = false) { const target = '#' + path; if (location.hash === target) return route(); if (replace) location.replace(target); else location.hash = path; }
const ctxBase = { navigate, get user() { return state.user; } };

async function route() {
  const token = ++navToken;
  const raw = location.hash.slice(1) || '/'; const [pathname, qs] = raw.split('?');
  const path = decodeURIComponent(pathname).replace(/\/+$/, '') || '/';
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const cleanups = [];
  clear(view); view.append(h('div', { class: 'page-loading' }, spinner()));
  let match = null, params = {};
  for (const r of ROUTES) { const m = r.re.exec(path); if (m) { match = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; } }
  highlightNav(path); document.title = 'Rookery — free chess for everyone'; window.scrollTo(0, 0);
  closeMenus();
  const root = h('div', { class: 'page' });
  const ctx = { ...ctxBase, params, query, path, onCleanup: (fn) => cleanups.push(fn), setTitle: (t) => { document.title = t + ' · Rookery'; }, root, wide: (v = true) => root.classList.toggle('wide', v), requireLogin: () => { if (state.user) return true; navigate('/login?next=' + encodeURIComponent(path)); return false; } };
  Object.defineProperty(ctx, 'user', { get: () => state.user });
  try {
    if (!match) { root.append(h('div', { class: 'card center' }, h('h1', null, 'Page not found'), h('p', null, 'That page does not exist.'), h('a', { class: 'btn primary', href: '#/' }, 'Go home'))); }
    else {
      const mod = await import(`/js/pages/${match.mod}.js`);
      if (token !== navToken) return;
      const fn = mod[match.fn || 'default'] || mod.default;
      const out = await fn(root, ctx);
      if (typeof out === 'function') cleanups.push(out);
    }
  } catch (e) { console.error(e); clear(root); root.append(errorBox(e.message || String(e))); }
  if (token !== navToken) { cleanups.forEach((f) => { try { f(); } catch {} }); return; }
  cleanup = () => cleanups.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  clear(view); view.append(root); root.classList.add('enter');
}

function highlightNav(path) {
  for (const a of document.querySelectorAll('[data-nav]')) { const p = a.dataset.nav; a.classList.toggle('active', p === '/' ? path === '/' : path === p || path.startsWith(p + '/') || (p === '/play' && (path.startsWith('/game') || path === '/watch'))); }
}
function closeMenus() { document.body.classList.remove('menu-open'); $('#user-menu')?.classList.remove('open'); }

function buildHeader() {
  const themeBtn = h('button', { class: 'icon-btn', id: 'theme-btn', 'aria-label': 'Toggle dark and light theme', title: 'Toggle theme', onclick: () => setPrefs({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }) });
  const upd = () => { themeBtn.textContent = document.documentElement.dataset.theme === 'dark' ? '☀' : '☾'; }; upd(); on('prefs', upd);
  const search = h('input', { type: 'search', placeholder: 'Find a player…', 'aria-label': 'Search players', class: 'search-input', autocomplete: 'off' });
  const results = h('div', { class: 'search-results', hidden: true });
  const doSearch = debounce(async () => {
    const t = search.value.trim(); if (t.length < 2) { results.hidden = true; return; }
    try { const { users } = await get('/api/users/search?q=' + encodeURIComponent(t)); clear(results); results.hidden = false; if (!users.length) results.append(h('div', { class: 'muted pad' }, 'No players found')); for (const u of users) results.append(h('a', { href: '#/u/' + encodeURIComponent(u.username), onclick: () => { results.hidden = true; search.value = ''; } }, avatar(u, 22), u.username, h('span', { class: 'dot ' + (u.online ? 'on' : '') }))); } catch {}
  }, 250);
  search.addEventListener('input', doSearch); document.addEventListener('click', (e) => { if (!e.target.closest('.search')) results.hidden = true; });
  const userBox = h('div', { class: 'user-box' });
  const renderUser = () => {
    clear(userBox);
    if (state.user) {
      const u = state.user; const menu = h('div', { id: 'user-menu', class: 'user-menu' },
        h('a', { href: '#/u/' + encodeURIComponent(u.username) }, 'Profile'), h('a', { href: '#/friends' }, 'Friends'), h('a', { href: '#/messages' }, 'Messages'), h('a', { href: '#/settings' }, 'Settings'),
        ['admin', 'mod'].includes(u.role) ? h('a', { href: '#/admin' }, 'Admin') : null,
        h('button', { onclick: async () => { await post('/api/auth/logout'); state.user = null; location.hash = '/'; location.reload(); } }, 'Log out'));
      userBox.append(h('button', { class: 'user-btn', 'aria-haspopup': 'true', onclick: (e) => { e.stopPropagation(); menu.classList.toggle('open'); } }, avatar(u, 28), h('span', { class: 'uname' }, u.username)), menu);
    } else userBox.append(h('a', { class: 'btn small', href: '#/login' }, 'Log in'), h('a', { class: 'btn small primary', href: '#/register' }, 'Sign up free'));
  };
  renderUser(); on('user', renderUser); document.addEventListener('click', () => $('#user-menu')?.classList.remove('open'));
  const links = h('nav', { class: 'main-nav', 'aria-label': 'Main' }, NAV.map(([p, l]) => h('a', { href: '#' + p, dataset: { nav: p } }, l)));
  return h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' },
    h('button', { class: 'icon-btn burger', 'aria-label': 'Menu', onclick: () => document.body.classList.toggle('menu-open') }, '☰'),
    h('a', { class: 'brand', href: '#/' }, h('img', { src: '/img/logo.svg', alt: '', width: 32, height: 32 }), h('span', null, 'Rookery')),
    links, h('div', { class: 'spacer' }), h('div', { class: 'search' }, search, results), themeBtn, userBox));
}

function buildTabbar() {
  const items = [['/', '⌂', 'Home'], ['/play', '♞', 'Play'], ['/puzzles', '🧩', 'Puzzles'], ['/learn', '📘', 'Learn'], ['/leaderboard', '🏆', 'Ranks']];
  return h('nav', { class: 'tabbar', 'aria-label': 'Primary' }, items.map(([p, i, l]) => h('a', { href: '#' + p, dataset: { nav: p } }, h('span', { class: 'ti' }, i), h('span', null, l))));
}

async function boot() {
  state.prefs = loadPrefs(); applyPrefs();
  const app = $('#app');
  view = h('main', { id: 'view', tabindex: -1 });
  headerEl = buildHeader();
  const drawer = h('nav', { class: 'drawer', 'aria-label': 'Menu' }, NAV.map(([p, l]) => h('a', { href: '#' + p, onclick: closeMenus, dataset: { nav: p } }, l)), h('a', { href: '#/watch', onclick: closeMenus }, 'Watch live games'), h('a', { href: '#/friends', onclick: closeMenus }, 'Friends'), h('a', { href: '#/settings', onclick: closeMenus }, 'Settings'));
  app.append(headerEl, drawer, h('div', { class: 'scrim', onclick: closeMenus }), view,
    h('footer', { class: 'footer' }, h('div', null, h('strong', null, 'Rookery'), ' — chess for everyone. ', h('span', { class: 'free-badge' }, '100% free · no ads · no premium'), ' Open source.'), h('div', { class: 'muted' }, h('a', { href: '#/play' }, 'Play'), ' · ', h('a', { href: '#/learn' }, 'Learn'), ' · ', h('a', { href: '#/analysis' }, 'Analysis'), ' · ', h('a', { href: '#/settings' }, 'Settings'))),
    buildTabbar());
  try { await refreshMe(); } catch (e) { console.warn(e); }
  initGlobalHandlers(navigate);
  connectWs();
  on('user', () => connectWs());
  window.addEventListener('hashchange', route);
  window.addEventListener('keydown', (e) => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); $('.search-input')?.focus(); } });
  route();
}
boot();
import('./update-check.js').then(({ startUpdateCheck }) => get('/api/config').then((c) => startUpdateCheck({ current: c.build, fetchLatest: async () => (await get('/api/config')).build }))).catch(() => {});
