import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { init, ROOT, q, db, DB_PATH } from './db.js';
import { startBackups, flush } from './backup.js';
import * as S from './security.js';
import * as hub from './hub.js';
import * as G from './games.js';
import './tournaments.js';
import { routes } from './api.js';

init((m) => console.log(m));
G.restoreActive();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY = process.env.ROOKERY_TRUST_PROXY === '1';
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' ws: wss:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'",
};

const clientIp = (req) => (TRUST_PROXY && req.headers['x-forwarded-for']) ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress || '';
const isHttps = (req) => req.socket.encrypted || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
const originOf = (req) => `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;

function json(res, status, obj) { const b = JSON.stringify(obj); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...HEADERS }); res.end(b); }

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(new S.HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!n) return resolve({}); try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' ? v : {}); } catch { reject(new S.HttpError(400, 'Invalid JSON')); } });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const ip = clientIp(req);
  try {
    S.rateLimit('api:' + ip, 600, 60_000);
    const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!route) throw new S.HttpError(404, 'Not found');
    if (req.method !== 'GET') { // CSRF: custom header (not sendable cross-site without CORS) + same-origin check
      if (req.headers['x-rookery'] !== '1') throw new S.HttpError(403, 'Missing CSRF header');
      const o = req.headers.origin; if (o && new URL(o).host !== req.headers.host) throw new S.HttpError(403, 'Cross-origin request blocked');
    }
    if (route.opts.rl) S.rateLimit(`${route.opts.rl[0]}:${ip}`, route.opts.rl[1], route.opts.rl[2]);
    const m = route.re.exec(url.pathname); const params = {}; route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    const token = S.parseCookies(req.headers.cookie)[S.COOKIE];
    const user = S.userFromToken(token);
    if (route.opts.auth && !user) throw new S.HttpError(401, 'Please log in');
    if (user && user.status === 'banned') throw new S.HttpError(403, 'This account is banned');
    if (user && Date.now() - user.last_seen > 60_000) q.run('UPDATE users SET last_seen=? WHERE id=?', Date.now(), user.id);
    const body = req.method === 'GET' ? {} : await readBody(req, route.opts.maxBody || 64_000);
    let cookie = null;
    const setCookie = (v) => { cookie = v; };
    const out = await route.fn({ req, res, user, params, query: Object.fromEntries(url.searchParams), body, ip, ua: req.headers['user-agent'], token, setCookie, origin: originOf(req) });
    const headers = { ...HEADERS };
    if (cookie !== null) headers['Set-Cookie'] = `${S.COOKIE}=${encodeURIComponent(cookie)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cookie ? S.SESSION_DAYS * 86400 : 0}${isHttps(req) ? '; Secure' : ''}`;
    if (out && out.__raw) { headers['Content-Type'] = out.type; headers['Cache-Control'] = out.cache || 'no-store'; if (out.filename) headers['Content-Disposition'] = `attachment; filename="${out.filename}"`; res.writeHead(200, headers); return res.end(out.__raw); }
    headers['Content-Type'] = 'application/json; charset=utf-8'; headers['Cache-Control'] = 'no-store';
    res.writeHead(200, headers); res.end(JSON.stringify(out ?? { ok: true }));
  } catch (e) {
    const status = e instanceof S.HttpError ? e.status : 500;
    if (status === 500) console.error('API error', req.method, url.pathname, e);
    json(res, status, { error: status === 500 ? 'Internal server error' : e.message });
  }
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  let base = PUBLIC;
  if (p.startsWith('/shared/')) { base = path.join(ROOT, 'shared'); p = p.slice(7); }
  const file = path.normalize(path.join(base, p));
  if (!file.startsWith(base + path.sep) && file !== base) { res.writeHead(403, HEADERS); return res.end('Forbidden'); }
  let target = file;
  try { if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html'); } catch {}
  fs.readFile(target, (err, data) => {
    if (err) { if (path.extname(p)) { res.writeHead(404, HEADERS); return res.end('Not found'); } return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, d2) => { if (e2) { res.writeHead(404, HEADERS); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache', ...HEADERS }); res.end(d2); }); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...HEADERS });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

export const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return void handleApi(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, HEADERS); return res.end(); }
  serveStatic(req, res, url);
});

// ---------------------------------------------------------------- WebSocket
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') return socket.destroy();
  const o = req.headers.origin; if (o) { try { if (new URL(o).host !== req.headers.host) return socket.destroy(); } catch { return socket.destroy(); } }
  const ip = clientIp(req);
  try { S.rateLimit('ws:' + ip, 60, 60_000); } catch { return socket.destroy(); }
  const user = S.userFromToken(S.parseCookies(req.headers.cookie)[S.COOKIE]);
  wss.handleUpgrade(req, socket, head, (ws) => { ws.user = user && user.status !== 'banned' ? user : null; wss.emit('connection', ws, req); });
});
wss.on('connection', (ws) => {
  ws.bucket = { tokens: 30, t: Date.now() }; ws.alive = true;
  hub.addClient(ws);
  hub.send(ws, { t: 'hello', user: ws.user ? { id: ws.user.id, username: ws.user.username } : null, serverNow: Date.now() });
  G.onOpen(ws);
  if (ws.user) broadcastPresence(ws.user.id, true);
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data) => {
    const now = Date.now(); const b = ws.bucket;
    b.tokens = Math.min(30, b.tokens + (now - b.t) / 1000 * 10); b.t = now;
    if (b.tokens < 1) return hub.send(ws, { t: 'error', error: 'Slow down' });
    b.tokens--;
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'ping') return hub.send(ws, { t: 'pong', serverNow: Date.now(), c: m.c });
    try {
      if (ws.user) { const fresh = q.get('SELECT status, suspended_until FROM users WHERE id=?', ws.user.id); ws.user.status = S.checkStanding({ ...ws.user, ...fresh }).status; }
      G.handle(ws, m);
    } catch (e) { hub.send(ws, { t: 'error', error: e.message, ref: m.t, id: m.id }); }
  });
  ws.on('close', () => { hub.removeClient(ws); G.onClose(ws); if (ws.user && !hub.isOnline(ws.user.id)) broadcastPresence(ws.user.id, false); });
  ws.on('error', () => {});
});
function broadcastPresence(uid, online) {
  for (const f of q.all("SELECT CASE WHEN user_id=? THEN friend_id ELSE user_id END fid FROM friends WHERE (user_id=? OR friend_id=?) AND status='accepted'", uid, uid, uid)) hub.sendUser(f.fid, { t: 'presence', userId: uid, online });
}
setInterval(() => { for (const ws of hub.all) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch {} } }, 25_000).unref();
let last = Date.now(); setInterval(() => { const n = Date.now(); globalThis.__lag = Math.max(0, n - last - 500); last = n; }, 500).unref();

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename) || process.env.ROOKERY_AUTOSTART === '1') {
  server.listen(PORT, HOST, () => console.log(`Rookery listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
  startBackups(db, DB_PATH);
}
const stop = () => { flush(db, DB_PATH).finally(() => process.exit(0)); setTimeout(() => process.exit(0), 20_000).unref(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
