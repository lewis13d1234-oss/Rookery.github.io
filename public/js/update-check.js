// Tells people who have the site open on an old version to refresh the page.
const EVERY = 5 * 60_000, MIN_GAP = 60_000;

// A bar across the top of the page: used for "new version" and for announcements from the owner.
export function showBanner(id, text, buttons) {
  document.getElementById(id)?.remove();
  const b = document.createElement('div'); b.id = id; b.className = 'update-banner'; b.setAttribute('role', 'status');
  const t = document.createElement('span'); t.textContent = text; b.append(t);
  for (const [label, fn, ghost] of buttons) { const x = document.createElement('button'); x.className = 'btn small' + (ghost ? ' ghost' : ''); x.textContent = label; x.onclick = () => fn(b); b.append(x); }
  (document.getElementById('app') || document.body).prepend(b); return b;
}
const banner = () => showBanner('update-banner', 'A new version of Rookery is available. Refresh the page to update.', [['Refresh', () => location.reload()], ['Later', (b) => b.remove(), true]]);

export function startUpdateCheck({ current, fetchLatest }) {
  if (!current || typeof fetchLatest !== 'function') return;
  let last = 0, shown = false;
  const check = async () => {
    if (shown || Date.now() - last < MIN_GAP) return; last = Date.now();
    try { const l = await fetchLatest(); if (l && l !== current) { shown = true; banner(); } } catch { /* offline or blocked: try again later */ }
  };
  setInterval(check, EVERY);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('online', check);
}

// Single-file edition: the build id sits in a <meta> tag near the top of the page, so read only the first few KB.
export async function fetchPageBuild() {
  if (!/^https?:$/.test(location.protocol)) return null;
  const ctl = new AbortController(); const res = await fetch(location.href.split('#')[0].split('?')[0] + '?v=' + Date.now(), { cache: 'no-store', signal: ctl.signal });
  if (!res.ok || !res.body) return null;
  const rd = res.body.getReader(), dec = new TextDecoder(); let text = '';
  while (text.length < 6000) { const { done, value } = await rd.read(); if (done) break; text += dec.decode(value, { stream: true }); const m = /name="rk-build" content="([a-f0-9]+)"/.exec(text); if (m) { ctl.abort(); return m[1]; } }
  ctl.abort(); return null;
}
