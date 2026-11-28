// Unfinished games survive a reload or closing the tab: the position is saved after every move (per profile).
import { h } from './util.js';
import { LEVELS } from '/shared/engine.js';
const K = { cpu: 'rk_cpu_game', local: 'rk_local_game' };
const load = (k) => { try { return JSON.parse(localStorage.getItem(K[k]) || 'null'); } catch { return null; } };
const save = (k, v) => { try { v ? localStorage.setItem(K[k], JSON.stringify(v)) : localStorage.removeItem(K[k]); } catch {} };
export const loadLocal = () => load('local'); export const saveLocal = (v) => save('local', v);
function card(k, title, detail, onResume) {
  const r = load(k); if (!r || !r.moves?.length) return null;
  const el = h('div', { class: 'card resume-card' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('strong', null, title), h('div', { class: 'muted small' }, detail(r))),
    h('button', { class: 'btn primary', onclick: () => onResume(r) }, 'Continue'), h('button', { class: 'btn ghost', onclick: () => { save(k, null); el.remove(); } }, 'Discard')));
  return el;
}
export const resumeCard = (k, title, detail, onResume) => card(k, title, detail, onResume);
export function installResume() {
  window.__rkSaveCpu = (o, moves, clocks) => save('cpu', { opts: { level: o.level, human: o.human, initial: o.initial, inc: o.inc }, moves, clocks, ts: Date.now() });
  window.__rkClearCpu = () => save('cpu', null);
  window.__rkResumeCard = (go) => card('cpu', 'Unfinished game against the computer', (r) => `${(LEVELS.find((l) => l.id === r.opts.level) || {}).name || 'Computer'}, you play ${r.opts.human === 'w' ? 'White' : 'Black'} · ${Math.ceil(r.moves.length / 2)} moves`, go);
}
