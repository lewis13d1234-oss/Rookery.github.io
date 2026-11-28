// Tiny DOM helpers. Text is ALWAYS inserted with textContent / text nodes, never innerHTML, so user content cannot inject markup.
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) { if (k == null || k === false) continue; el.append(k instanceof Node ? k : document.createTextNode(String(k))); }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const svgEl = (markup) => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstChild; }; // trusted constants only

export function fmtClock(ms, tenths = true) {
  ms = Math.max(0, ms); const s = ms / 1000;
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  if (s < 10 && tenths) return `${m}:${String(sec).padStart(2, '0')}.${Math.floor((s * 10) % 10)}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
export const fmtTc = (i, inc) => `${i % 60 === 0 && i >= 60 ? i / 60 : i < 60 ? i + 's' : (i / 60).toFixed(1)}${i % 60 === 0 || i < 60 ? '' : ''}+${inc}`;
export function ago(ts) { const s = (Date.now() - ts) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`; return new Date(ts).toLocaleDateString(); }
export const fmtDate = (ts) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
export const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
export const CAT_ICON = { bullet: '⚡', blitz: '🔥', rapid: '⏱', classical: '🏛', puzzle: '🧩' };

// ---- toasts & modals
let toastBox;
export function toast(msg, kind = 'info', ms = 3800) {
  if (!toastBox) toastBox = document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: 'toast ' + kind }, msg); toastBox.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms);
}
export function modal(title, body, { actions = [], onClose, wide = false } = {}) {
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } });
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h3', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close() }, '✕')),
    h('div', { class: 'modal-body' }, body), actions.length ? h('div', { class: 'modal-actions' }, actions) : null);
  back.append(box); document.body.append(back);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  function close() { document.removeEventListener('keydown', onKey); back.remove(); onClose?.(); }
  setTimeout(() => (box.querySelector('input,button.primary,button') || box).focus?.(), 30);
  return { close, box };
}
export function confirmBox(title, text, okLabel = 'Confirm') {
  return new Promise((res) => { let done = false; const m = modal(title, h('p', null, text), { onClose: () => { if (!done) res(false); }, actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { done = true; m.close(); res(true); } }, okLabel)] }); });
}
export function promptBox(title, label, { value = '', type = 'text', okLabel = 'OK', textarea = false } = {}) {
  return new Promise((res) => {
    let done = false; const inp = textarea ? h('textarea', { rows: 6, value }) : h('input', { type, value, onkeydown: (e) => { if (e.key === 'Enter') ok(); } });
    const ok = () => { done = true; m.close(); res(inp.value); };
    const m = modal(title, h('label', { class: 'field' }, h('span', null, label), inp), { onClose: () => { if (!done) res(null); }, actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: ok }, okLabel)] });
  });
}
export const spinner = () => h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' });
export function errorBox(msg) { return h('div', { class: 'card error-box' }, h('strong', null, 'Something went wrong'), h('p', null, msg)); }
export function download(name, text, type = 'text/plain') { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove(); }
export function pickFile(accept) { return new Promise((res) => { const i = h('input', { type: 'file', accept, onchange: () => res(i.files[0] || null) }); i.click(); }); }
export const avatar = (u, size = 32) => {
  const name = u?.username || '?'; const src = u?.avatar;
  if (src && !src.startsWith('preset:')) return h('img', { class: 'avatar', src, alt: '', width: size, height: size, style: { width: size + 'px', height: size + 'px' } });
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360;
  const icon = src?.startsWith('preset:') ? { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' }[src.slice(7)] : null;
  return h('span', { class: 'avatar init', style: { width: size + 'px', height: size + 'px', fontSize: size * 0.5 + 'px', background: `hsl(${hue} 45% 38%)` }, 'aria-hidden': 'true' }, icon || name[0].toUpperCase());
};
export function userLink(name, extra) { return h('a', { class: 'ulink', href: '#/u/' + encodeURIComponent(name) }, name, extra); }
export function tabs(items, active, onSelect) {
  const el = h('div', { class: 'tabs', role: 'tablist' }, items.map(([id, label]) => h('button', { class: 'tab' + (id === active ? ' active' : ''), role: 'tab', 'aria-selected': id === active, onclick: () => { $$('.tab', el).forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); }); const b = el.querySelector(`[data-id="${id}"]`); b.classList.add('active'); b.setAttribute('aria-selected', 'true'); onSelect(id); }, dataset: { id } }, label)));
  return el;
}
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
