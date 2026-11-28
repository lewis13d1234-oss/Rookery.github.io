// Builds a single self-contained index.html (GitHub Pages friendly): no server, no network, no build tools.
// Usage: node scripts/build-static.js [outfile]
import crypto from 'node:crypto';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const P = (...a) => path.join(ROOT, ...a);
const FILES = {
  'shared/chess.js': 'shared/chess.js', 'shared/engine.js': 'shared/engine.js', 'shared/openings.js': 'shared/openings.js', 'shared/pgn.js': 'shared/pgn.js', 'data/lessons.js': 'data/lessons.js',
  'js/util.js': 'public/js/util.js', 'js/update-check.js': 'public/js/update-check.js', 'js/board.js': 'public/js/board.js', 'js/pieces.js': 'public/js/pieces.js', 'js/sound.js': 'public/js/sound.js', 'js/learn-common.js': 'public/js/learn-common.js', 'js/game-ui.js': 'public/js/game-ui.js',
  'js/engine-client.js': 'public/js/engine-client.js', 'js/api.js': 'public/js/api.js', 'js/engine-worker.js': 'public/js/engine-worker.js',
  'js/pages/computer.js': 'public/js/pages/computer.js', 'js/pages/puzzles.js': 'public/js/pages/puzzles.js', 'js/pages/learn.js': 'public/js/pages/learn.js', 'js/pages/openings.js': 'public/js/pages/openings.js', 'js/pages/analysis.js': 'public/js/pages/analysis.js',
  'static/home-static.js': 'public/static/home-static.js', 'static/settings-static.js': 'public/static/settings-static.js', 'static/local-game.js': 'public/static/local-game.js', 'static/mygames.js': 'public/static/mygames.js', 'static/profile-page.js': 'public/static/profile-page.js', 'static/profiles.js': 'public/static/profiles.js', 'static/icons.js': 'public/static/icons.js', 'static/i18n.js': 'public/static/i18n.js', 'static/admin-local.js': 'public/static/admin-local.js', 'static/i18n-lessons.js': 'public/static/i18n-lessons.js', 'static/resume.js': 'public/static/resume.js', 'static/board-page.js': 'public/static/board-page.js', 'static/online-page.js': 'public/static/online-page.js', 'js/local-api.js': 'public/static/local-api.js', 'js/app-static.js': 'public/static/app-static.js',
};
const resolve = (from, spec) => (spec.startsWith('/') ? spec.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(from), spec)));
// home-static / settings-static live in js/pages for relative-import purposes
const ALIAS = { 'static/home-static.js': 'js/pages/home-static.js', 'static/settings-static.js': 'js/pages/settings-static.js', 'static/local-game.js': 'js/pages/local-game.js', 'static/mygames.js': 'js/pages/mygames.js', 'static/profile-page.js': 'js/pages/profile-page.js', 'static/profiles.js': 'js/profiles.js', 'static/icons.js': 'js/icons.js', 'static/i18n.js': 'js/i18n.js', 'static/admin-local.js': 'js/pages/admin-local.js', 'static/i18n-lessons.js': 'js/i18n-lessons.js', 'static/resume.js': 'js/resume.js', 'static/board-page.js': 'js/pages/board-page.js', 'static/online-page.js': 'js/pages/online-page.js' };
const idOf = (k) => ALIAS[k] || k;

function patch(id, s) {
  if (id === 'js/api.js') {
    s = s.replace(/export async function api\([\s\S]*?\n  return data;\n\}/, 'export async function api(method, url, body) { return localApi(method, url, body === undefined ? {} : body); }');
    s = s.replace('export function connectWs() {', 'export function connectWs() { return;').replace("import { toast } from './util.js';", "import { toast } from './util.js';\nimport { localApi } from './local-api.js';");
    if (!s.includes('localApi(method')) throw new Error('api.js patch failed');
  }
  if (id === 'js/engine-client.js') { const before = s; s = s.replace("new Worker('/js/engine-worker.js', { type: 'module' })", "new Worker(URL.createObjectURL(new Blob([window.__rk_worker_src], { type: 'text/javascript' })))"); if (s === before) throw new Error('engine-client patch failed'); }
  if (id === 'js/pages/puzzles.js') s = s.split('Playing unrated — log in to track rating and stats.').join('Practice mode — puzzles are not rated in the standalone edition.');
  const swap = (a, b) => { if (!s.includes(a)) return; s = s.split(a).join(b); };
  swap('checked by the server', 'checked by the rules engine');
  swap("h('a', { href: '#/register' }, 'Create a free account'), ' to track your puzzle rating and progress. You can also solve puzzles without one (unrated).'", "'Puzzles in the standalone edition are unrated practice. Your best Rush and Survival scores are saved on this device.'");
  swap("'Log in to save your scores.'", "'Best scores are saved on this device.'");
  swap(' — log in to keep it everywhere', ' in this browser'); swap('Saved on this device only — log in to keep them everywhere.', 'Saved in this browser only. Use Export to keep a copy.');
  if (id === 'js/pages/analysis.js') { const a = 'state.user && G.headers.Black === state.user.username'; if (!s.includes(a)) throw new Error('analysis patch failed'); s = s.replace(a, 'G.headers.Black === window.__rkName()'); }
  if (id === 'js/pages/computer.js') {
    const rep = (a, c) => { if (!s.includes(a)) throw new Error('computer resume patch failed: ' + a.slice(0, 40)); s = s.replace(a, c); };
    rep('const chess = new Chess(START_FEN);', 'const chess = new Chess(START_FEN); if (o.resume) for (const m of o.resume.moves) chess.move(m);');
    rep('clocks = [o.initial * 1000, o.initial * 1000]', 'clocks = o.resume ? o.resume.clocks : [o.initial * 1000, o.initial * 1000]');
    rep('soundForMove(mv, chess.inCheck()); hintArrow', 'soundForMove(mv, chess.inCheck()); window.__rkSaveCpu(o, chess.history(), clocks); hintArrow');
    rep("if (over) return; over = { result, reason }; token++;", "if (over) return; over = { result, reason }; window.__rkClearCpu(); token++;");
    rep('root.append(setup);\n  let cleanup = () => {};', "root.append(window.__rkResumeCard((r) => { clear(root); cleanup = playGame(root, ctx, { ...r.opts, resume: r, again: () => { cleanup(); clear(root); root.append(setup); } }); }), setup);\n  let cleanup = () => {};");
    rep('for (let i = 0; i < n; i++) chess.undo(); viewPly = null;', 'for (let i = 0; i < n; i++) chess.undo(); window.__rkSaveCpu(o, chess.history(), clocks); viewPly = null;');
    s = s.split('avatar(state.user || { username: \'You\' }, 34)').join('avatar(window.__rkUser(), 34)').replace(/state\.user\?\.username \|\| '(You|Human)'/g, "window.__rkName()"); if (/state\.user\?\.username/.test(s)) throw new Error('computer name patch failed'); const a = 'if (state.user && chess.ply > 0 && !saved)'; if (!s.includes(a)) throw new Error('computer patch failed'); s = s.replace(a, 'if (chess.ply > 0 && !saved)').replace("'Game saved to your profile.'", "'Saved to My Games.'"); }
  if (id === 'js/pages/puzzles.js') { s = s.replace("  if (state.user) {\n    try {", "  if (true) {\n    try {").split("'Practice mode — puzzles are not rated in the standalone edition.'").join("'Your puzzle rating is saved in this browser.'"); if (!s.includes('if (true)')) throw new Error('puzzles hub patch failed'); }
  return s;
}
function compile(id, src) {
  const exp = []; let code = src;
  const imp = (names, spec) => `const ${names} = __req(${JSON.stringify(resolve(id, spec))});`;
  code = code.replace(/^import\s+\{([^}]*)\}\s+from\s+'([^']+)';?[ \t]*$/gm, (_, n, spec) => imp('{' + n.replace(/\s+as\s+/g, ': ') + '}', spec));
  code = code.replace(/^import\s+(\w+)\s+from\s+'([^']+)';?[ \t]*$/gm, (_, n, spec) => `const ${n} = __req(${JSON.stringify(resolve(id, spec))}).default;`);
  code = code.replace(/^export default (async function|function) (\w+)/gm, (_, k, n) => { exp.push(['default', n]); return `${k} ${n}`; });
  code = code.replace(/(^|[;}][ \t]*)export (async function|function|class) (\w+)/gm, (_, pre, k, n) => { exp.push([n, n]); return `${pre}${k} ${n}`; });
  code = code.replace(/(^|[;}][ \t]*)export (const|let) ([A-Za-z_$][\w$]*)/gm, (_, pre, k, n) => { exp.push([n, n]); return `${pre}${k} ${n}`; });
  code = code.replace(/^export \{([^}]*)\};?[ \t]*$/gm, (_, n) => { n.split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => exp.push([x, x])); return ''; });
  // multi-name `export const A = .., B = ..` is not used; verify nothing ESM is left
  if (/(^|[;}])\s*(import|export)\s/m.test(code.replace(/\/\/.*$/gm, ''))) throw new Error('unconverted import/export in ' + id + ': ' + code.match(/^\s*(import|export)\s.*$/m)[0].slice(0, 100));
  const seen = new Set(); const tail = exp.filter(([k]) => !seen.has(k) && seen.add(k)).map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(', ');
  return `__defs[${JSON.stringify(id)}] = function (__req, __exports) {\n${code}\nObject.assign(__exports, { ${tail} });\n};\n`;
}
const RUNTIME = `const __defs = {}, __cache = {};\nfunction __req(id) { if (__cache[id]) return __cache[id]; const f = __defs[id]; if (!f) throw new Error('missing module ' + id); const ex = (__cache[id] = {}); f(__req, ex); return ex; }\n`;
function bundle(ids) {
  const done = new Set(); let out = '';
  const add = (id) => { if (done.has(id)) return; done.add(id); };
  const all = Object.entries(FILES).filter(([k]) => ids.includes(idOf(k)) || ids === '*');
  for (const [k, f] of all) { const id = idOf(k); out += compile(id, patch(id, fs.readFileSync(P(f), 'utf8'))); }
  return out;
}
const puzzles = fs.readFileSync(P('data/puzzles.json'), 'utf8').trim();
const virtual = `__defs["data/puzzles.json"] = function (__req, __exports) { __exports.default = ${puzzles}; };\n`;
const workerIds = ['shared/chess.js', 'shared/engine.js', 'js/engine-worker.js'];
const workerSrc = RUNTIME + bundle(workerIds).replace(/self\.onmessage/, 'self.onmessage') + `__req('js/engine-worker.js');\n`;
const mainIds = Object.keys(FILES).map(idOf).filter((i) => i !== 'js/engine-worker.js');
const esc = (s) => s.replace(/<\/(script)/gi, '<\\/$1');
const css = ['app', 'pages-play', 'pages-learn', 'pages-social'].map((n) => fs.readFileSync(P('public/css', n + '.css'), 'utf8')).join('\n');
const logo = 'data:image/svg+xml;base64,' + fs.readFileSync(P('public/img/logo.svg')).toString('base64');
const main = RUNTIME + virtual + bundle(mainIds) + `window.__rk_import = (id) => __req(id);\n__req('js/app-static.js');\n`;
// Pure-ASCII output: immune to any wrong charset guess by a host, viewer or download tool.
const asciiJs = (t) => t.replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const asciiCss = (t) => t.replace(/[\u0080-\u{10ffff}]/gu, (c) => '\\' + c.codePointAt(0).toString(16) + ' ');
const asciiHtml = (t) => t.replace(/[\u0080-\u{10ffff}]/gu, (c) => '&#' + c.codePointAt(0) + ';');
const build = crypto.createHash('sha1').update(main).update(css).update(workerSrc).digest('hex').slice(0, 12);
const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Rookery &#8212; free chess for everyone</title>
<meta name="description" content="Rookery: free chess in your browser. Play the computer, solve puzzles, take lessons, explore openings and analyse games. No ads, no sign-up.">
<meta name="theme-color" content="#14161c">
<meta name="rk-build" content="${build}">
<link rel="icon" href="${logo}">
<style>
${asciiCss(css)}
</style>
<script>try{var p=JSON.parse(localStorage.getItem('rk_prefs')||'{}');document.documentElement.dataset.theme=p.theme==='light'||(p.theme==='system'&&matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark'}catch(e){}</script>
</head>
<body>
<a class="skip" href="#view">Skip to content</a>
<div id="app"></div>
<noscript><p style="padding:2rem">Rookery needs JavaScript to run the chessboard.</p></noscript>
<script>window.__rk_build="${build}";window.__rk_logo=${JSON.stringify(logo)};window.__rk_worker_src=${asciiJs(esc(JSON.stringify(workerSrc)))};</script>
<script>
(function () {
${asciiJs(esc(main))}
})();
</script>
</body>
</html>
`;
if (/[^\x00-\x7f]/.test(html)) throw new Error('non-ASCII left in output: ' + html.match(/[^\x00-\x7f]/)[0]);
const out = process.argv[2] || P('dist/index.html'); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
