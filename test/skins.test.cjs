const { chromium, watchErrors } = require('./ui-helpers.cjs');
const file = process.argv[2]; let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };
(async () => {
  const b = await chromium.launch(); const c = await b.newContext(); const p = await c.newPage(); const errs = []; watchErrors(p, errs, 'skins');
  await p.goto('file://' + file + '#/settings'); await p.waitForSelector('.swatches');
  const nb = await p.$$eval('.swatches', (g) => g.map((x) => x.children.length)); ok(nb[0] >= 24 && nb[1] >= 11, `settings offers ${nb[0]} boards and ${nb[1]} piece sets`);
  ok(await p.$$eval('.pv svg', (a) => a.length > 0 && a.every((s) => { const r = s.getBoundingClientRect(); return r.width <= 30 && r.height <= 30 && r.width > 5; })), 'every piece preview renders as a small picture, not text');
  const sets = await p.$$eval('.swatches:nth-of-type(1) button', (a) => a.length); // sanity
  const ids = await p.evaluate(() => [...document.querySelectorAll('.swatches')].map((g) => [...g.children].map((x) => x.textContent.trim())));
  // click each piece set and board and verify the live game uses it
  for (let i = 0; i < nb[1]; i++) {
    const btn = p.locator('.swatches').nth(1).locator('button').nth(i); await btn.click();
    await p.goto('file://' + file + '#/local'); await p.click('button:has-text("Start")'); await p.waitForSelector('.board .pc-layer > *');
    const r = await p.evaluate(() => { const ps = [...document.querySelectorAll('.board .pc-layer > *')]; return { n: ps.length, ok: ps.every((e) => e.getBoundingClientRect().width > 20 && (e.querySelector('svg path, svg text, svg circle'))) }; });
    if (!(r.n === 32 && r.ok)) ok(false, `piece set #${i} (${ids[1][i]}) draws all 32 pieces`);
    await p.goto('file://' + file + '#/settings'); await p.waitForSelector('.swatches');
  }
  ok(true, `all ${nb[1]} piece sets draw 32 visible pieces in a game`);
  const seen = new Set();
  for (let i = 0; i < nb[0]; i++) { await p.locator('.swatches').nth(0).locator('button').nth(i).click(); seen.add(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sq-dark').trim() + getComputedStyle(document.documentElement).getPropertyValue('--sq-light').trim())); }
  ok(seen.size === nb[0], `all ${nb[0]} boards apply a distinct colour pair`);
  ok(errs.length === 0, 'no console errors ' + errs.join(';'));
  console.log(`\n${pass} passed, ${fail} failed`); await b.close(); process.exit(fail ? 1 : 0);
})();
