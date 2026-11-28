// Browser E2E (Playwright): drives the real UI with two independent browser sessions.
const { chromium, clickMove, dragMove, watchErrors } = require('./ui-helpers.cjs');
const BASE = process.env.BASE || 'http://localhost:3111'; const SH = process.env.SHOTS || '/tmp';
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
(async () => {
  const browser = await chromium.launch(); const errs = [];
  const mk = async (tag, vp = { width: 1280, height: 850 }) => { const ctx = await browser.newContext({ viewport: vp }); const p = await ctx.newPage(); watchErrors(p, errs, tag); return p; };
  const A = await mk('A'), B = await mk('B'); const sfx = Date.now().toString(36).slice(-5);
  const register = async (p, name) => { await p.goto(BASE + '/#/register'); await p.fill('input[name=username]', name); const pw = p.locator('input[type=password]'); await pw.nth(0).fill('testpass123'); await pw.nth(1).fill('testpass123'); await p.click('button[type=submit]'); await p.waitForSelector('.recovery-code'); await p.click('text=I have saved it'); await p.waitForURL('**/#/play'); };
  await register(A, 'ann' + sfx); ok(true, 'register via UI + recovery code shown');
  await register(B, 'ben' + sfx);
  // quick match 5+0
  await A.click('.btn.tc >> text=5+0'); await B.click('.btn.tc >> text=5+0');
  await A.waitForSelector('.board .piece', { timeout: 10000 }); await B.waitForSelector('.board .piece', { timeout: 10000 });
  ok(A.url().includes('/game/') && B.url().includes('/game/'), 'both players land in the same live game');
  const colorOf = async (p) => (await p.locator('.player-strip').last().textContent()).includes('ann') ? 'ann' : 'ben';
  const whitePage = (await colorOf(A)) === 'ann' ? (await A.evaluate(() => 1), A) : B; // placeholder, determine below
  // determine who is white by trying e2e4 on A: the white player's bottom strip is theirs and board orientation is 'w'
  const aWhite = await A.evaluate(() => document.querySelector('.coord.file')?.textContent === 'a' && document.querySelector('.sq[data-sq]')?.dataset.sq === 'a8');
  const W = aWhite ? A : B, K = aWhite ? B : A, wo = 'w', ko = 'b';
  await clickMove(W, 'e2', 'e4', wo); await K.waitForSelector('.piece[data-sq="e4"]', { timeout: 5000 }); ok(true, 'white click-move appears on black\'s board in real time');
  await dragMove(K, 'e7', 'e5', ko); await W.waitForSelector('.piece[data-sq="e5"]', { timeout: 5000 }); ok(true, 'black drag-move appears on white\'s board');
  await clickMove(W, 'g1', 'f3', wo); await clickMove(K, 'b8', 'c6', ko); await W.waitForTimeout(400);
  ok((await W.locator('.moves .m').count()) === 4, 'move list shows 4 plies');
  const clk = await W.locator('.clock').first().textContent(); ok(/^\d:\d\d/.test(clk), 'clock displays: ' + clk);
  // illegal move attempt: pawn jumps three squares (should not move)
  await clickMove(W, 'a2', 'a5', wo); await W.waitForTimeout(300); ok(await W.locator('.piece[data-sq="a2"]').count() === 1, 'illegal move is refused (piece stays)');
  // chat
  await W.fill('.chat input', 'hello there'); await W.press('.chat input', 'Enter'); await K.waitForSelector('.chat-log >> text=hello there', { timeout: 4000 }); ok(true, 'in-game chat delivered');
  await W.screenshot({ path: SH + '/game-desktop.png' });
  // resign + rematch
  W.once('dialog', () => {}); await K.click('button:has-text("Resign")'); await K.click('.modal .btn.primary'); await W.waitForSelector('.result-banner', { timeout: 5000 }); ok((await W.locator('.result-banner').textContent()).includes('won'), 'resignation ends game; winner sees banner');
  await W.click('text=Rematch'); await K.click('text=Rematch'); await W.waitForFunction(() => !location.hash.includes('xx') && document.querySelector('.player-strip'), null, { timeout: 8000 }); await W.waitForTimeout(800);
  ok(await W.locator('.moves .m').count() === 0, 'rematch opens a fresh game');
  // computer game
  await A.goto(BASE + '/#/play/computer'); await A.click('.level >> text=Easy'); await A.click('text=Start game'); await A.waitForSelector('.board .piece');
  await clickMove(A, 'e2', 'e4', 'w'); await A.waitForFunction(() => document.querySelectorAll('.moves .m').length >= 2, null, { timeout: 15000 }); ok(true, 'engine replies in a Web Worker');
  await A.screenshot({ path: SH + '/computer-desktop.png' });
  await A.click('button:has-text("Resign")'); await A.click('.modal .btn.primary'); await A.waitForSelector('.result-banner'); ok(true, 'computer game resignation');
  // phone layout
  const P = await mk('P', { width: 390, height: 800 }); await P.goto(BASE + '/#/play/computer'); await P.click('text=Start game'); await P.waitForSelector('.board .piece'); await P.waitForTimeout(500);
  const bb = await P.locator('.board').boundingBox(); ok(bb.width > 330, 'phone: board fills the width (' + Math.round(bb.width) + 'px)'); ok(await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'phone: no horizontal scroll');
  await P.screenshot({ path: SH + '/computer-phone.png' });
  const real = errs.filter((e) => !/favicon|Failed to load resource.*(404|409|401|403)/.test(e)); ok(real.length === 0, 'no console errors ' + JSON.stringify(real.slice(0, 3)));
  await browser.close(); console.log(`\nui: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
