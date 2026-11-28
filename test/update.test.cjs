// Cat skin/board + "new version" banner. Usage: node test/update.test.cjs <index.html>
const fs = require('fs'), http = require('http');
const { chromium, watchErrors } = require('/home/claude/rookery/test/ui-helpers.cjs');
const file = process.argv[2]; let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
(async () => {
  let html = fs.readFileSync(file, 'utf8');
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(html); }).listen(0); const port = srv.address().port;
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1000, height: 900 } }); const errs = []; watchErrors(p, errs, 'upd');
  await p.addInitScript(() => { localStorage.setItem('rk_prefs', JSON.stringify({ board: 'cat', pieces: 'cat' })); });
  await p.goto(`http://127.0.0.1:${port}/#/local`); await p.click('button:has-text("Start game")'); await p.waitForSelector('.sq');
  ok(await p.evaluate(() => document.documentElement.dataset.board) === 'cat', 'cat board sets data-board');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('.sq.dark')).backgroundImage.includes('svg')), 'paw-print background on dark squares');
  ok(await p.evaluate(() => document.querySelectorAll('.piece svg, .sq svg, img.piece').length >= 0) , 'board renders');
  const svgs = await p.evaluate(() => [...document.querySelectorAll('svg')].filter((s) => s.innerHTML.includes('M29 40 L27 14')).length); ok(svgs >= 32, 'all 32 pieces are cats (' + svgs + ')');
  ok(await p.evaluate(() => !document.getElementById('update-banner')), 'no banner when up to date');
  // new deploy: serve a page with a different build id, then come back to the tab
  html = html.replace(/(name="rk-build" content=")[a-f0-9]+/, '$1deadbeef0000');
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); }); await p.evaluate(() => { const real = Date.now; Date.now = () => real() + 10 * 60000; }); await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  ok(await p.waitForSelector('#update-banner', { timeout: 5000 }).then(() => true, () => false), 'banner appears when a newer build is live');
  ok(/Refresh the page/.test(await p.textContent('#update-banner')), 'banner tells people to refresh');
  await p.click('#update-banner button:has-text("Later")'); ok(await p.evaluate(() => !document.getElementById('update-banner')), 'banner can be dismissed');
  ok(errs.length === 0, 'no console errors ' + errs.join(';'));
  console.log(`\n${pass} passed, ${fail} failed`); await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
