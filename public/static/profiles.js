// Local player profiles. Several people can share one browser; each profile has its own games, puzzle rating,
// lesson progress and repertoires. Data never leaves the device.
const rawGet = Storage.prototype.getItem, rawSet = Storage.prototype.setItem, rawDel = Storage.prototype.removeItem;
const PER = ['rk_games', 'rk_pz2', 'rk_pz_seen', 'rk_pz_streak', 'rk_lessons', 'rk_level', 'rk_repertoires', 'rk_cpu_game', 'rk_local_game'];
const AV = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
let list = [], active = 'p1';
const read = () => { try { return JSON.parse(rawGet.call(localStorage, 'rk_profiles') || 'null'); } catch { return null; } };
const write = () => { try { rawSet.call(localStorage, 'rk_profiles', JSON.stringify({ list, active })); } catch {} };
export const keyFor = (k, id = active) => (PER.includes(k) && id !== 'p1' ? k + '@' + id : k);
export function initProfiles() {
  const d = read(); if (d && d.list?.length) { list = d.list; active = list.some((p) => p.id === d.active) ? d.active : list[0].id; } else { list = [{ id: 'p1', name: 'Player', avatar: 'knight', bio: '', country: '', created: Date.now() }]; active = 'p1'; write(); }
  Storage.prototype.getItem = function (k) { return rawGet.call(this, this === localStorage ? keyFor(k) : k); };
  Storage.prototype.setItem = function (k, v) { return rawSet.call(this, this === localStorage ? keyFor(k) : k, v); };
  Storage.prototype.removeItem = function (k) { return rawDel.call(this, this === localStorage ? keyFor(k) : k); };
  window.__rkName = () => activeProfile().name; window.__rkUser = () => { const p = activeProfile(); return { username: p.name, avatar: p.photo || 'preset:' + p.avatar }; };
}
export const profiles = () => list.slice(); export const activeProfile = () => list.find((p) => p.id === active) || list[0]; export const AVATARS = AV;
export const asUser = (p) => ({ username: p.name, avatar: p.photo || 'preset:' + p.avatar });
export function updateProfile(id, patch) { const p = list.find((x) => x.id === id); if (!p) return; Object.assign(p, patch); write(); }
export function addProfile(name) { const id = 'p' + Date.now().toString(36); list.push({ id, name: name || 'Player ' + (list.length + 1), avatar: AV[list.length % AV.length], bio: '', country: '', created: Date.now() }); write(); return id; }
export function switchProfile(id) { if (list.some((p) => p.id === id)) { active = id; write(); } }
export function deleteProfile(id) { if (list.length < 2) return false; list = list.filter((p) => p.id !== id); for (const k of PER) rawDel.call(localStorage, k + '@' + id); if (id === 'p1') for (const k of PER) rawDel.call(localStorage, k); if (active === id) active = list[0].id; write(); return true; }
export function peek(id) { const g = (k) => { try { return JSON.parse(rawGet.call(localStorage, keyFor(k, id)) || 'null'); } catch { return null; } }; const games = g('rk_games') || []; const pz = g('rk_pz2') || {}; return { games: games.length, rating: Math.round(pz.rating || 1200), solved: pz.solved || 0 }; }
export function exportAll() { const out = {}; for (let i = 0; i < localStorage.length; i++) { const k = rawKeyAt(i); if (k && k.startsWith('rk_') && !k.startsWith('rk_admin')) out[k] = rawGet.call(localStorage, k); } return JSON.stringify({ app: 'rookery', version: 1, data: out }, null, 1); }
const rawKeyAt = (i) => Storage.prototype.key.call(localStorage, i);
export function importAll(text) { const j = JSON.parse(text); if (j.app !== 'rookery' || typeof j.data !== 'object') throw new Error('This is not a Rookery backup file.'); let n = 0; for (const [k, v] of Object.entries(j.data)) { if (/^rk_[A-Za-z0-9_@.-]+$/.test(k) && !k.startsWith('rk_admin') && typeof v === 'string' && v.length < 5_000_000) { rawSet.call(localStorage, k, v); n++; } } return n; }
