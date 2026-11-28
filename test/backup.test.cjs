// Backup/restore through a mock of the GitHub releases API. Run from the project root: node test/backup.test.cjs
const { spawn } = require('child_process'); const http = require('http'); const os = require('os'), path = require('path'), fs = require('fs');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : (bad++, console.log('FAIL', n)); };
const assets = []; let nextId = 1, rel = null, uploads = 0;
const mock = http.createServer((q, r) => {
  const chunks = []; q.on('data', (c) => chunks.push(c)); q.on('end', () => {
    const body = Buffer.concat(chunks); const u = new URL(q.url, 'http://x'); const json = (o, s = 200) => { r.writeHead(s, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
    if (q.headers.authorization !== 'Bearer tok') return json({ message: 'bad token' }, 401);
    const view = () => ({ id: 7, assets: assets.map(({ id, name }) => ({ id, name })) });
    if (q.method === 'GET' && u.pathname.endsWith('/releases/tags/rookery-data')) return rel ? json(view()) : json({}, 404);
    if (q.method === 'POST' && u.pathname.endsWith('/releases')) { rel = true; return json(view(), 201); }
    if (q.method === 'POST' && u.pathname.includes('/releases/7/assets')) { uploads++; assets.push({ id: nextId++, name: u.searchParams.get('name'), data: body }); return json({}, 201); }
    let m = /\/releases\/assets\/(\d+)$/.exec(u.pathname);
    if (m && q.method === 'GET') { const a = assets.find((x) => x.id == m[1]); if (!a) return json({}, 404); r.writeHead(200, { 'content-type': 'application/octet-stream' }); return r.end(a.data); }
    if (m && q.method === 'DELETE') { const i = assets.findIndex((x) => x.id == m[1]); if (i >= 0) assets.splice(i, 1); r.writeHead(204); return r.end(); }
    json({}, 404);
  });
});
const post = (port, u, b) => fetch(`http://127.0.0.1:${port}${u}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-rookery': '1' }, body: JSON.stringify(b) }).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function start(env) { const port = 3600 + Math.floor(Math.random() * 300); const p = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/index.js'], { env: { ...process.env, PORT: port, ROOKERY_BACKUP_REPO: 'me/data', ROOKERY_BACKUP_TOKEN: 'tok', ROOKERY_BACKUP_API: M, ROOKERY_BACKUP_UPLOAD: M, ROOKERY_BACKUP_INTERVAL_MS: '400', ...env } }); let log = ''; p.stdout.on('data', (d) => log += d); p.stderr.on('data', (d) => log += d); return { p, port, log: () => log }; }
let M;
(async () => {
  await new Promise((r) => mock.listen(0, r)); M = 'http://127.0.0.1:' + mock.address().port;
  for (const key of ['', 'secret-key']) {
    assets.length = 0; rel = null; uploads = 0; const tag = key ? 'encrypted' : 'plain'; const envk = key ? { ROOKERY_BACKUP_KEY: key } : { ROOKERY_BACKUP_KEY: '' };
    const dbA = path.join(os.tmpdir(), 'rk-bk-a-' + Date.now() + key.length + '.db'), dbB = dbA.replace('-a-', '-b-');
    const A = start({ ROOKERY_DB: dbA, ...envk }); await wait(4500);
    const reg = await post(A.port, '/api/auth/register', { username: 'persist1', email: 'p@x.io', password: 'Passw0rd!long' });
    t(tag + ': registered on server A', !!reg.user);
    await wait(2500); t(tag + ': a snapshot was uploaded', uploads >= 1);
    const h = await fetch(`http://127.0.0.1:${A.port}/api/healthz`).then((r) => r.json()); t(tag + ': healthz shows backup on', h.backup.enabled === true && !!h.backup.lastBackupAt);
    if (key) t('snapshot is encrypted (no SQLite header)', assets.length && assets[assets.length - 1].data.subarray(0, 6).toString() === 'RKENC1');
    A.p.kill('SIGTERM'); await wait(1500);
    // brand-new empty disk -> must restore from the snapshot
    const B = start({ ROOKERY_DB: dbB, ...envk }); await wait(4500);
    const lg = await post(B.port, '/api/auth/login', { username: 'persist1', password: 'Passw0rd!long' });
    t(tag + ': account survived on a fresh disk', !!lg.user && lg.user.username === 'persist1'); if (!lg.user) console.log(B.log().slice(-600), JSON.stringify(lg));
    B.p.kill('SIGTERM'); await wait(800);
    for (const f of [dbA, dbB]) for (const s of ['', '-wal', '-shm']) fs.rmSync(f + s, { force: true });
  }
  // pruning keeps only the newest few
  t('old snapshots are pruned', assets.length <= 3);
  // a wrong key must refuse to start with an empty database
  const C = start({ ROOKERY_DB: path.join(os.tmpdir(), 'rk-bk-c-' + Date.now() + '.db'), ROOKERY_BACKUP_KEY: 'wrong' }); await wait(4000);
  t('wrong key: server refuses to start empty', /encrypted|decrypt|Unsupported state/i.test(C.log()) && (await fetch(`http://127.0.0.1:${C.port}/api/healthz`).then(() => false, () => true))); C.p.kill();
  console.log(ok + ' passed, ' + bad + ' failed'); mock.close(); process.exit(bad ? 1 : 0);
})();
