import crypto from 'node:crypto';
import { q } from './db.js';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  try {
    const [alg, s, k] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const key = crypto.scryptSync(pw, Buffer.from(s, 'base64'), 64, SCRYPT);
    const want = Buffer.from(k, 'base64');
    return want.length === key.length && crypto.timingSafeEqual(key, want);
  } catch { return false; }
}
// a fixed dummy hash so unknown-user logins cost the same time as real ones
export const DUMMY_HASH = hashPassword('rookery-dummy-password');

// ---------- validation ----------
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const bad = (m) => new HttpError(400, m);

export function vUsername(u) {
  if (typeof u !== 'string' || !/^[A-Za-z0-9_-]{3,20}$/.test(u)) throw bad('Username must be 3–20 characters: letters, numbers, _ or -');
  const owner = (process.env.ROOKERY_ADMIN_USERNAME || '').trim().toLowerCase();
  if (u.toLowerCase() !== owner && /^(admin|root|system|rookery|moderator|support|computer|ai)$/i.test(u)) throw bad('That username is reserved');
  return u;
}
export function vPassword(p) {
  if (typeof p !== 'string' || p.length < 8 || p.length > 200) throw bad('Password must be 8–200 characters');
  if (/^(12345678|password|password1|qwertyui|11111111)$/i.test(p)) throw bad('That password is too common');
  return p;
}
export function vEmail(e) {
  if (e == null || e === '') return null;
  if (typeof e !== 'string' || e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('Invalid email address');
  return e.toLowerCase();
}
export function vText(s, { min = 0, max = 500, field = 'Text' } = {}) {
  if (typeof s !== 'string') throw bad(`${field} must be text`);
  // strip control characters except newline/tab
  const t = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (t.length < min || t.length > max) throw bad(`${field} must be ${min}–${max} characters`);
  return t;
}
export function vInt(n, { min = -Infinity, max = Infinity, field = 'Number' } = {}) {
  const v = Number(n);
  if (!Number.isInteger(v) || v < min || v > max) throw bad(`${field} must be an integer between ${min} and ${max}`);
  return v;
}

// ---------- rate limiting (fixed-window per key) ----------
const buckets = new Map();
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++;
  if (b.n > limit) throw new HttpError(429, 'Too many requests — slow down and try again shortly');
  return b.n;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k); }, 60_000).unref();

// ---------- sessions ----------
export const SESSION_DAYS = 30;
export const COOKIE = 'rk_session';

export function createSession(userId, ip, ua) {
  const token = randToken();
  const now = Date.now();
  q.run('INSERT INTO sessions (token_hash,user_id,created_at,expires_at,ip,ua) VALUES (?,?,?,?,?,?)', sha256(token), userId, now, now + SESSION_DAYS * 864e5, ip || '', String(ua || '').slice(0, 200));
  return token;
}
export function userFromToken(token) {
  if (!token) return null;
  const s = q.get('SELECT * FROM sessions WHERE token_hash=?', sha256(token));
  if (!s) return null;
  if (s.expires_at < Date.now()) { q.run('DELETE FROM sessions WHERE token_hash=?', s.token_hash); return null; }
  const u = q.get('SELECT * FROM users WHERE id=?', s.user_id);
  if (!u) return null;
  return checkStanding(u);
}
/** Lift expired suspensions, mark standing. Returns the user row with `blocked` reason if not allowed. */
export function checkStanding(u) {
  const owner = (process.env.ROOKERY_ADMIN_USERNAME || '').trim().toLowerCase(); // the owner is always an active admin
  if (owner && String(u.username).toLowerCase() === owner && (u.status !== 'active' || u.role !== 'admin')) { q.run("UPDATE users SET status='active', suspended_until=NULL, role='admin' WHERE id=?", u.id); u.status = 'active'; u.role = 'admin'; u.suspended_until = null; }
  if (u.status === 'suspended' && u.suspended_until && u.suspended_until < Date.now()) {
    q.run("UPDATE users SET status='active', suspended_until=NULL WHERE id=?", u.id);
    u.status = 'active';
  }
  return u;
}
export function destroySession(token) { if (token) q.run('DELETE FROM sessions WHERE token_hash=?', sha256(token)); }
setInterval(() => { try { q.run('DELETE FROM sessions WHERE expires_at < ?', Date.now()); q.run('DELETE FROM reset_tokens WHERE expires_at < ?', Date.now()); } catch {} }, 3600_000).unref();

export function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}

// ---------- chat anti-spam ----------
const chatState = new Map(); // userId -> {times:[], last:'', repeats:0, mutedUntil}
export function chatAllowed(userId, text) {
  const now = Date.now();
  let s = chatState.get(userId);
  if (!s) { s = { times: [], last: '', repeats: 0, mutedUntil: 0 }; chatState.set(userId, s); }
  if (s.mutedUntil > now) return { ok: false, reason: `You are muted for spam for another ${Math.ceil((s.mutedUntil - now) / 1000)}s` };
  s.times = s.times.filter((t) => now - t < 10_000);
  if (s.times.length >= 5) { s.mutedUntil = now + 30_000; return { ok: false, reason: 'Slow down — you are sending messages too fast (muted 30s)' }; }
  const norm = text.toLowerCase().replace(/\s+/g, ' ');
  if (norm === s.last) { s.repeats++; if (s.repeats >= 2) { s.mutedUntil = now + 30_000; return { ok: false, reason: 'Repeated messages are not allowed (muted 30s)' }; } } else { s.repeats = 0; s.last = norm; }
  if (/(https?:\/\/\S+.*){3,}/i.test(text)) return { ok: false, reason: 'Too many links' };
  if (/(.)\1{14,}/.test(text)) return { ok: false, reason: 'Message looks like spam' };
  s.times.push(now);
  return { ok: true };
}
const BAD_WORDS = /\b(?:n[i1]gg[ae]r|f[a4]gg?[o0]t|k[i1]ke|retard)\w*\b/gi; // minimal slur mask; moderation relies on reports
export const cleanChat = (t) => t.replace(BAD_WORDS, (m) => '*'.repeat(m.length));
