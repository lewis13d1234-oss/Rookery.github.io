// Owner protection. Run from the project root: node test/owner.test.cjs
const { spawn } = require('child_process'); const os = require('os'), path = require('path');
const port = 4100 + Math.floor(Math.random() * 90), db = path.join(os.tmpdir(), 'rk-own-' + Date.now() + '.db');
const p = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/index.js'], { env: { ...process.env, PORT: port, ROOKERY_DB: db, ROOKERY_ADMIN_USERNAME: 'Rookery' } });
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : (bad++, console.log('FAIL', n)); };
const call = async (cookie, method, u, b) => { const r = await fetch(`http://127.0.0.1:${port}${u}`, { method, headers: { 'content-type': 'application/json', 'x-rookery': '1', cookie: cookie || '' }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json().catch(() => ({})); return { s: r.status, j, ck: (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ') }; };
(async () => {
  await new Promise((r) => setTimeout(r, 4000));
  const pw = 'Passw0rd!long';
  const o = await call('', 'POST', '/api/auth/register', { username: 'Rookery', email: 'o@x.io', password: pw }); t('owner registered as admin + owner', o.j.user && o.j.user.role === 'admin' && o.j.user.owner === true);
  const a = await call('', 'POST', '/api/auth/register', { username: 'helper1', email: 'h@x.io', password: pw }); t('second user is not owner', a.j.user && a.j.user.owner === false);
  const oid = o.j.user.id, aid = a.j.user.id;
  t('owner promotes helper to admin', (await call(o.ck, 'POST', `/api/admin/users/${aid}/role`, { role: 'admin' })).s === 200);
  const r1 = await call(a.ck, 'POST', `/api/admin/users/${oid}/status`, { status: 'banned', reason: 'x' }); t('admin cannot ban owner (' + r1.s + ')', r1.s === 403);
  const r2 = await call(a.ck, 'POST', `/api/admin/users/${oid}/status`, { status: 'suspended', days: 1, reason: 'x' }); t('admin cannot suspend owner', r2.s === 403);
  const r3 = await call(a.ck, 'POST', `/api/admin/users/${oid}/role`, { role: 'user' }); t('admin cannot demote owner', r3.s === 403);
  const r4 = await call(a.ck, 'POST', `/api/admin/users/${oid}/reset-link`, {}); t('admin cannot make a reset link for owner', r4.s === 403);
  const lst = await call(o.ck, 'GET', '/api/admin/users?q=Rookery'); t('user list marks the owner', lst.j.users.some((u) => u.username === 'Rookery' && u.owner === true));
  const me = await call(o.ck, 'GET', '/api/me'); t('owner still signed in and active', me.s === 200 && me.j.user && me.j.user.status === 'active');
  const r5 = await call(o.ck, 'POST', `/api/admin/users/${aid}/status`, { status: 'banned', reason: 'test' }); t('owner CAN ban an admin', r5.s === 200);
  console.log(ok + ' passed, ' + bad + ' failed'); p.kill(); process.exit(bad ? 1 : 0);
})();
