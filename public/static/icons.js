// Emoji are drawn differently (or not at all) on different devices, so every emoji used by the UI is swapped for a
// small inline SVG icon that looks the same everywhere. Runs once at start-up and watches the page for new text.
const I = {
  '🌱': 'M12 21V11M12 11C12 7 9 5 5 5c0 4 3 6 7 6M12 14c0-3 2-5 6-5 0 3-2 5-6 5',
  '🌳': 'M12 21v-6M12 15a6 6 0 1 0-1-11.9A5 5 0 0 0 6 8a5 5 0 0 0 6 7z',
  '🌿': 'M5 20c0-8 5-13 14-14 0 9-5 14-14 14zM5 20l9-9',
  '🎉': 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  '🎓': 'M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5',
  '🎮': 'M6 8h12a4 4 0 0 1 4 4v2a3 3 0 0 1-5 2l-1-1H8l-1 1a3 3 0 0 1-5-2v-2a4 4 0 0 1 4-4zM8 10v4M6 12h4M16 11h.01M18 13h.01',
  '🎯': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.500 4.500 0 1 0 0-9 4.500 4.500 0 0 0 0 9zM12 12h.01',
  '🎲': 'M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM8.500 8.500h.01M15.500 8.500h.01M12 12h.01M8.500 15.500h.01M15.500 15.500h.01',
  '🏅': 'M12 20a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM8 3l4 7 4-7',
  '🏆': 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M8 20h8M10 17h4',
  '🏛': 'M3 9l9-5 9 5zM5 11v7M9.500 11v7M14.500 11v7M19 11v7M3 20h18',
  '👑': 'M3 8l4 4 5-7 5 7 4-4-2 11H5z',
  '👥': 'M9 11a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7zM2 20c0-4 3-6 7-6s7 2 7 6M16 4.500a3.500 3.500 0 0 1 0 6.500M18 14c2.500.6 4 2.500 4 6',
  '💡': 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.500c.8.8 1 1.500 1 2.500h6c0-1 .2-1.700 1-2.500A6 6 0 0 0 12 3z',
  '📅': 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4',
  '📈': 'M3 17l6-6 4 4 8-9M15 6h6v6',
  '📋': 'M7 4h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 3h6v3H9zM9 12h6M9 16h6',
  '📖': 'M12 6c-2-2-5-2-9-2v14c4 0 7 0 9 2 2-2 5-2 9-2V4c-4 0-7 0-9 2zM12 6v14',
  '📘': 'M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM5 18a2 2 0 0 1 2-2h12',
  '📚': 'M4 4h4v16H4zM10 4h4v16h-4zM16 6l4-1 3 15-4 1z',
  '🔍': 'M10 16a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM15 15l6 6',
  '🔒': 'M7 11h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM8 11V8a4 4 0 0 1 8 0v3',
  '🔥': 'M12 3c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z',
  '🖥': 'M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 21h8M12 16v5',
  '🛡': 'M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z',
  '🤖': 'M8 8h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3zM12 4v4M9 13h.01M15 13h.01M9 17h6',
  '🧠': 'M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 5 2V4a3 3 0 0 0-2 0zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-5 2V4a3 3 0 0 1 2 0z',
  '🧩': 'M10 4a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 1 0 0 4h2v6H4v-6h2a2 2 0 1 0 0-4H4V6h6z',
  '🧭': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.500 8.500l-2 5-5 2 2-5z',
  '🌐': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  '🤝': 'M3 12l4-4 4 2 3-2 5 4-5 6-3 1-5-3zM7 8l-4 4',
  '⌂': 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
  '⏮': 'M6 5v14M19 5l-10 7 10 7z',
  '⏭': 'M18 5v14M5 5l10 7-10 7z',
  '⏱': 'M12 21a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM12 14v-3M10 3h4M18 6l1.500-1.500',
  '⏳': 'M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9',
  '☀': 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2M4.900 4.900l1.400 1.400M17.700 17.700l1.400 1.400M4.900 19.100l1.400-1.400M17.700 6.300l1.400-1.400',
  '☾': 'M20 14A8 8 0 1 1 10 4a6.500 6.500 0 0 0 10 10z',
  '☰': 'M4 6h16M4 12h16M4 18h16',
  '⚑': 'M5 21V4M5 4h12l-2 4 2 4H5',
  '⚔': 'M5 19L19 5M14 5h5v5M19 19L5 5M10 5H5v5',
  '⚡': 'M13 2L4 14h7l-1 8 9-12h-7z',
  '✉': 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 7l9 6 9-6',
  '⬆': 'M12 20V5M6 11l6-6 6 6',
  '⬇': 'M12 4v15M6 13l6 6 6-6',
};
const FILLED = new Set(['★', '▶', '◀']);
I['★'] = 'M12 3l2.800 5.700 6.200.9-4.500 4.400 1 6.200L12 17.200 6.500 20.200l1-6.200L3 9.600l6.200-.9z'; I['▶'] = 'M7 4l13 8-13 8z'; I['◀'] = 'M17 4L4 12l13 8z';
const KEYS = Object.keys(I); const RE = new RegExp('(' + KEYS.join('|') + ')\\uFE0F?', 'g'); const TEST = new RegExp(KEYS.join('|') + '|♟(?!︎)');
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'SVG', 'CODE']);
const NS = 'http://www.w3.org/2000/svg';
function icon(ch) {
  const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '1.15em'); s.setAttribute('height', '1.15em'); s.setAttribute('aria-hidden', 'true');
  const filled = FILLED.has(ch); s.setAttribute('fill', filled ? 'currentColor' : 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', filled ? '1.5' : '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', I[ch]); s.append(p);
  const w = document.createElement('span'); w.className = 'ico'; w.append(s); return w;
}
function fix(node) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (!SKIP.has(t.parentNode?.nodeName?.toUpperCase()) && !t.parentNode?.closest?.('svg') && TEST.test(t.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  const list = []; while (walker.nextNode()) list.push(walker.currentNode);
  for (const t of list) {
    const text = t.nodeValue.replace(/♟(?!︎)/g, '♟︎'); const frag = document.createDocumentFragment(); let last = 0, m; RE.lastIndex = 0;
    while ((m = RE.exec(text))) { if (m.index > last) frag.append(text.slice(last, m.index)); frag.append(icon(m[1])); last = m.index + m[0].length; }
    if (last < text.length) frag.append(text.slice(last)); t.replaceWith(frag);
  }
}
export function startIcons(root) {
  let queued = false; const run = () => { queued = false; obs.disconnect(); try { fix(root); } finally { obs.observe(root, { childList: true, subtree: true, characterData: true }); } };
  const obs = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } });
  run();
}
