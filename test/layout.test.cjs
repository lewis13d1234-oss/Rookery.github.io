// Phone-width overflow audit: every route x every language. Fails if the page scrolls sideways or an element pokes past the viewport.
const { chromium } = require('./ui-helpers.cjs');
const file = process.argv[2]; const W = +(process.env.W || 375);
const ROUTES = ['/', '/play', '/local', '/online', '/puzzles', '/puzzles/rush', '/learn', '/learn/knights', '/openings', '/board', '/analysis', '/me', '/profile', '/settings', '/admin'];
(async () => {
  const b = await chromium.launch(); let bad = 0, n = 0;
  for (const lang of ['en', 'es', 'fr', 'de', 'pt', 'it']) {
    const c = await b.newContext({ viewport: { width: W, height: 800 } }); const p = await c.newPage(); await p.addInitScript((l) => localStorage.setItem('rk_lang', l), lang);
    for (const r of ROUTES) {
      await p.goto('file://' + file + '#' + r); await p.waitForTimeout(700); n++;
      const o = await p.evaluate((W) => { const de = document.documentElement; const over = de.scrollWidth - W; const offenders = []; if (over > 1) for (const e of document.querySelectorAll('#app *, header *')) { const r = e.getBoundingClientRect(); if (r.width > 0 && r.right > W + 1 && !e.closest('svg') && getComputedStyle(e).position !== 'fixed') { offenders.push((e.className || e.tagName).toString().slice(0, 30) + ':' + Math.round(r.right)); if (offenders.length > 3) break; } } return { over, offenders }; }, W);
      if (o.over > 1) { bad++; console.log(`FAIL ${lang} ${r}: overflow ${o.over}px  ${o.offenders.join(', ')}`); }
    }
    await c.close();
  }
  console.log(`\n${n - bad}/${n} page views fit at ${W}px`); await b.close(); process.exit(bad ? 1 : 0);
})();
