// Free, permanent storage for hosts with a temporary disk (e.g. Render's free plan).
// The live database stays a local SQLite file. A snapshot is copied to a private GitHub repository (as a release file)
// shortly after every change and when the server is told to stop; on start-up the newest snapshot is restored.
// Turn it on with ROOKERY_BACKUP_REPO ("owner/repo") and ROOKERY_BACKUP_TOKEN. Optional: ROOKERY_BACKUP_KEY encrypts snapshots.
import fs from 'node:fs';
import crypto from 'node:crypto';

const REPO = process.env.ROOKERY_BACKUP_REPO, TOKEN = process.env.ROOKERY_BACKUP_TOKEN, KEY = process.env.ROOKERY_BACKUP_KEY;
const API = (process.env.ROOKERY_BACKUP_API || 'https://api.github.com').replace(/\/$/, '');
const UPLOADS = (process.env.ROOKERY_BACKUP_UPLOAD || 'https://uploads.github.com').replace(/\/$/, '');
const EVERY = Number(process.env.ROOKERY_BACKUP_INTERVAL_MS) || 60_000, KEEP = 3, TAG = 'rookery-data', MAGIC = Buffer.from('RKENC1');
export const enabled = !!(REPO && TOKEN);
export const status = { enabled, restored: false, lastBackupAt: null, lastError: null, encrypted: !!KEY };
let ready = false; // backups only start once restore has finished, so an empty database can never replace a good snapshot

const gh = (url, o = {}) => fetch(url, { ...o, headers: { Authorization: 'Bearer ' + TOKEN, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'rookery', Accept: 'application/vnd.github+json', ...(o.headers || {}) } });
const mustOk = async (r, what) => { if (!r.ok) throw new Error(`${what} failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`); return r; };
const keyBytes = () => crypto.scryptSync(KEY, 'rookery-backup', 32);
export function seal(buf) {
  if (!KEY) return buf; const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv); const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), enc]);
}
export function unseal(buf) {
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) return buf;
  if (!KEY) throw new Error('The backup is encrypted but ROOKERY_BACKUP_KEY is not set');
  const iv = buf.subarray(6, 18), tag = buf.subarray(18, 34); const d = crypto.createDecipheriv('aes-256-gcm', keyBytes(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(34)), d.final()]);
}

async function release(create) {
  let r = await gh(`${API}/repos/${REPO}/releases/tags/${TAG}`);
  if (r.status === 404 && create) r = await gh(`${API}/repos/${REPO}/releases`, { method: 'POST', body: JSON.stringify({ tag_name: TAG, name: 'Rookery data (do not delete)', body: 'Automatic database snapshots written by the Rookery server.', prerelease: true }) });
  if (r.status === 404) return null;
  return (await mustOk(r, 'Reading the backup release')).json();
}
const newest = (rel) => (rel.assets || []).filter((a) => /^rookery-\d+\.db$/.test(a.name)).sort((a, b) => b.name.localeCompare(a.name));

export async function restore(dbPath) {
  if (!enabled || dbPath === ':memory:') { ready = true; return; }
  if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) { status.restored = false; ready = true; console.log('backup: local database already present, not restoring'); return; }
  const rel = await release(false); const list = rel ? newest(rel) : [];
  if (!list.length) { ready = true; console.log('backup: no snapshot yet, starting with a new database'); return; }
  // If a snapshot exists but cannot be read, stop rather than start empty (an empty start could later overwrite it).
  const r = await mustOk(await gh(`${API}/repos/${REPO}/releases/assets/${list[0].id}`, { headers: { Accept: 'application/octet-stream' } }), 'Downloading the backup');
  const data = unseal(Buffer.from(await r.arrayBuffer()));
  if (data.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error('The downloaded backup is not a SQLite database');
  for (const s of ['', '-wal', '-shm']) fs.rmSync(dbPath + s, { force: true });
  fs.writeFileSync(dbPath, data); status.restored = true; ready = true; console.log(`backup: restored ${list[0].name} (${(data.length / 1024).toFixed(0)} KB)`);
}

let busy = false, lastChanges = -1;
export async function snapshot(db, dbPath, force = false) {
  if (!enabled || !ready || busy) return false;
  const n = db.prepare('SELECT total_changes() n').get().n; if (!force && n === lastChanges) return false;
  busy = true; const tmp = dbPath + '.snap';
  try {
    fs.rmSync(tmp, { force: true }); db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const body = seal(fs.readFileSync(tmp)); fs.rmSync(tmp, { force: true });
    const rel = await release(true);
    await mustOk(await gh(`${UPLOADS}/repos/${REPO}/releases/${rel.id}/assets?name=rookery-${Date.now()}.db`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body }), 'Uploading the backup');
    lastChanges = n; status.lastBackupAt = new Date().toISOString(); status.lastError = null;
    const after = await release(false); for (const a of newest(after).slice(KEEP)) await gh(`${API}/repos/${REPO}/releases/assets/${a.id}`, { method: 'DELETE' }).catch(() => {});
    return true;
  } catch (e) { status.lastError = String(e.message || e).slice(0, 300); console.error('backup:', status.lastError); return false; }
  finally { busy = false; fs.rmSync(tmp, { force: true }); }
}

export function startBackups(db, dbPath) {
  if (!enabled || dbPath === ':memory:') return;
  console.log(`backup: on (repo ${REPO}${KEY ? ', encrypted' : ''})`);
  const t = setInterval(() => snapshot(db, dbPath), EVERY); t.unref();
}
export async function flush(db, dbPath) { for (let i = 0; i < 20 && busy; i++) await new Promise((r) => setTimeout(r, 250)); return snapshot(db, dbPath); }
