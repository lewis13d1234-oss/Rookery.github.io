// Profile pictures show in games. node test/avatar.test.cjs (starts its own server)
const { spawn } = require('child_process'); const os = require('os'), path = require('path'); const WebSocket = require('ws');
const { chromium } = require('/home/claude/rookery/test/ui-helpers.cjs');
const port = 4500 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${port}`, db = path.join(os.tmpdir(), 'rk-av-' + Date.now() + '.db');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/index.js'], { env: { ...process.env, PORT: port, ROOKERY_DB: db, ROOKERY_TRUST_PROXY: '1' } });
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
(async () => {
  await new Promise((r) => setTimeout(r, 6000)); const b = await chromium.launch(); const ctxs = [];
  const mk = async (name, avatar) => { const c = await b.newContext({ viewport: { width: 1100, height: 900 } }); ctxs.push(c); const hd = { 'x-rookery': '1', 'x-forwarded-for': '10.1.' + Math.floor(Math.random() * 250) + '.1' };
    const r = await c.request.post(base + '/api/auth/register', { headers: hd, data: { username: name, email: name + '@x.io', password: 'Passw0rd!long' } }); if (avatar) await c.request.put(base + '/api/me', { headers: hd, data: { avatar } }); const ck = (await c.cookies()).map((k) => `${k.name}=${k.value}`).join('; '); return { c, ck }; };
  const A = await mk('picA', PNG), B = await mk('picB', 'preset:knight');
  const open = (ck) => new Promise((res) => { const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: ck, origin: base } }); ws.msgs = []; ws.on('message', (d) => ws.msgs.push(JSON.parse(d))); ws.on('open', () => res(ws)); });
  const wa = await open(A.ck), wb = await open(B.ck); wa.send(JSON.stringify({ t: 'quick', initial: 300, inc: 0, rated: false })); wb.send(JSON.stringify({ t: 'quick', initial: 300, inc: 0, rated: false }));
  let gm; for (let i = 0; i < 100 && !gm; i++) { gm = wa.msgs.find((m) => m.t === 'game'); await new Promise((r) => setTimeout(r, 50)); }
  const g = gm.game; const mine = g.white.name === 'picA' ? g.white : g.black, theirs = mine === g.white ? g.black : g.white;
  ok(/^\/api\/avatar\/picA\?v=\d+$/.test(mine.avatar), 'game data carries the uploaded photo URL (' + mine.avatar + ')'); ok(theirs.avatar === 'preset:knight', 'and the preset for the other player');
  const p = await A.c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); await p.goto(`${base}/#/game/${g.id}`); await p.waitForSelector('.avatar', { timeout: 8000 });
  await p.waitForFunction(() => document.querySelector('img.avatar[src*="/api/avatar/picA"]'), null, { timeout: 8000 }).catch(() => {});
  ok(await p.locator('img.avatar[src*="/api/avatar/picA"]').count() >= 1, 'your photo is shown next to your name in the game');
  ok(await p.locator('.avatar.init').count() >= 1, 'preset avatar still shown for the opponent (as an icon)');
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  console.log(`\n${pass} passed, ${fail} failed`); await b.close(); srv.kill(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERR', e.message); srv.kill(); process.exit(1); });
