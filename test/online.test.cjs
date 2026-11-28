// Two browser pages play each other over a real WebRTC data channel (no server).
const { chromium, clickMove } = require('./ui-helpers.cjs');
const FILE = 'file://' + (process.argv[2] || '/tmp/static-test/index.html');
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
(async () => {
  const b = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] }); const errs = [];
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1280, height: 850 } }); await c.addInitScript(() => { window.__rk_ice = []; }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); return p; };
  const H = await mk(), G = await mk();
  await H.goto(FILE + '#/online'); await G.goto(FILE + '#/online');
  await H.click('.seg button:has-text("Black")'); await H.click('.seg button:has-text("3+2")'); if (process.env.COMPAT) await H.check('.check input[type=checkbox]'); await H.click('button:has-text("Create invite link")');
  await H.waitForSelector('textarea[aria-label^="1."], textarea[readonly]'); const link = await H.inputValue('textarea[readonly]'); ok(/#\/join\/RK[0-4]\./.test(link), 'invite link generated (' + link.length + ' chars)');
  await G.goto(link); await G.waitForSelector('textarea[readonly]'); await G.waitForSelector('textarea[readonly]'); const reply = await G.inputValue('textarea[readonly]'); ok(/^RK[0-4]\./.test(reply) && reply.length < 260, 'short reply code generated (' + reply.length + ' chars)');
  await H.fill('textarea[aria-label="Reply code"]', reply);
  await H.waitForSelector('.board .piece', { timeout: 20000 }); await G.waitForSelector('.board .piece', { timeout: 20000 }); ok(true, 'both browsers connected and game started');
  ok((await H.locator('.pstrip').last().innerText()).includes('(you)') && (await G.locator('.pstrip').last().innerText()).includes('(you)'), 'each side sees itself at the bottom');
  // host chose Black => guest is White
  await clickMove(G, 'e2', 'e4', 'w'); await H.waitForSelector('.piece[data-sq="e4"]', { timeout: 8000 }); ok(true, 'guest move arrived at host');
  await clickMove(G, 'd2', 'd4', 'w').catch(() => {}); await G.waitForTimeout(300); ok((await G.locator('.piece[data-sq="d4"]').count()) === 0 && (await H.locator('.piece[data-sq="d4"]').count()) === 0, 'a move out of turn is refused');
  await clickMove(H, 'e7', 'e5', 'b'); await G.waitForSelector('.piece[data-sq="e5"]', { timeout: 8000 }); ok(true, 'host reply arrived at guest');
  await G.fill('input[aria-label="Chat message"]', 'hello <b>there</b>'); await G.press('input[aria-label="Chat message"]', 'Enter'); await H.waitForSelector('.club-line:has-text("hello")'); ok((await H.locator('.club-line').last().innerText()).includes('<b>'), 'chat delivered and shown as plain text');
  // resign
  await H.click('button:has-text("Resign")'); await H.click('.modal .btn.primary'); await G.waitForSelector('.result-banner', { timeout: 8000 }); ok(/wins|won/i.test(await G.locator('.result-banner').innerText()) || /You won/.test(await G.locator('.result-banner').innerText()), 'resignation ended the game on both sides');
  ok(await G.evaluate(() => JSON.parse(localStorage.getItem('rk_games') || '[]').some((g) => g.mode === 'online')), 'online game saved to My Games');
  const real = errs.filter((e) => !/favicon/.test(e)); ok(!real.length, 'no console errors' + (real.length ? ': ' + real.slice(0, 2).join('|') : ''));
  console.log(`\n${pass} passed, ${fail} failed`); await b.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message.split('\n').slice(0, 5).join(' | ')); process.exit(2); });
