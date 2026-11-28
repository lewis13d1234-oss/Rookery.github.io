// Browser E2E for community pages: profile, friends, DMs, clubs, tournament, settings, admin, XSS.
const { chromium, watchErrors, clickMove } = require('./ui-helpers.cjs');
const BASE = process.env.BASE || 'http://localhost:3112'; const SH = process.env.SHOTS || '/tmp';
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
(async () => {
  const browser = await chromium.launch(); const errs = [];
  const mk = async (tag, vp = { width: 1280, height: 850 }) => { const c = await browser.newContext({ viewport: vp }); const p = await c.newPage(); watchErrors(p, errs, tag); p.on('dialog', (d) => { ok(false, 'unexpected dialog ' + d.message()); d.dismiss(); }); return p; };
  const sfx = Date.now().toString(36).slice(-4);
  const register = async (p, name) => { await p.goto(BASE + '/#/register'); await p.fill('input[name=username]', name); const pw = p.locator('input[type=password]'); await pw.nth(0).fill('testpass123'); await pw.nth(1).fill('testpass123'); await p.click('button[type=submit]'); await p.waitForSelector('.recovery-code'); await p.click('text=I have saved it'); await p.waitForURL('**/#/play'); };
  const A = await mk('A'), B = await mk('B');
  const an = 'ada' + sfx, bn = 'bob' + sfx;
  await register(A, an); await register(B, bn);
  // --- profile + friend request
  await A.goto(`${BASE}/#/u/${bn}`); await A.waitForSelector('.profile-head');
  ok((await A.locator('.profile-name').textContent()).includes(bn), 'profile renders username');
  ok((await A.locator('.rating-cards .stat').count()) === 5, 'five rating categories');
  await A.click('text=＋ Add friend'); await A.waitForSelector('text=Request sent');
  await B.goto(`${BASE}/#/friends`); await B.waitForSelector('text=Friend requests'); await B.click('button:has-text("Accept")'); await B.waitForSelector(`.person:has-text("${an}")`);
  ok(true, 'friend request sent and accepted across sessions');
  // --- DMs, with XSS payload
  await A.goto(`${BASE}/#/messages/${bn}`); await A.waitForSelector('.chat-input input');
  const xss = '<img src=x onerror="window.__pwn=1"><script>window.__pwn=1</script>';
  await A.fill('.chat-input input', xss); await A.press('.chat-input input', 'Enter'); await A.waitForSelector('.bubble.mine');
  await B.goto(`${BASE}/#/messages/${an}`); await B.waitForSelector('.bubble.theirs');
  ok((await B.locator('.bubble.theirs').first().innerText()).includes('<img'), 'XSS payload shown as literal text');
  ok(!(await B.evaluate(() => window.__pwn)) && (await B.locator('.chat-log img').count()) === 0, 'no script / img injected');
  await B.fill('.chat-input input', 'hello ada'); await B.press('.chat-input input', 'Enter');
  await A.waitForSelector('.bubble.theirs:has-text("hello ada")', { timeout: 5000 }); ok(true, 'DM delivered live over WebSocket');
  // --- clubs
  await A.goto(`${BASE}/#/clubs`); await A.click('text=＋ Create a club'); await A.fill('.modal input', 'Club ' + sfx); await A.fill('.modal textarea', '<b>bold</b> desc'); await A.click('.modal .btn.primary');
  await A.waitForSelector('h1:has-text("Club ' + sfx + '")'); ok((await A.locator('section.card p').first().innerText()).includes('<b>'), 'club description escaped');
  const clubUrl = A.url();
  await B.goto(clubUrl); await B.click('button:has-text("Join club")'); await B.waitForSelector('text=Club chat');
  await B.fill('.chat-input input', 'club hi'); await B.press('.chat-input input', 'Enter');
  await A.reload(); await A.waitForSelector('.club-line:has-text("club hi")'); ok(true, 'club chat persisted and visible to owner');
  // --- tournament: 2-player swiss, play to completion by resignation
  await A.goto(`${BASE}/#/tournaments/new`); await A.fill('.form-card input[maxlength="60"]', 'Swiss ' + sfx); await A.selectOption('.form-card select', 'swiss');
  const rounds = A.locator('.form-card input[type=number]').nth(2); await rounds.fill('1');
  // start time: 1 minute ahead (min allowed is now-60s)
  await A.evaluate(() => { const i = document.querySelector('input[type=datetime-local]'); const d = new Date(Date.now() + 20000); const p = (n) => String(n).padStart(2, '0'); i.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; });
  await A.click('button:has-text("Create tournament")'); await A.waitForSelector('h1:has-text("Swiss ' + sfx + '")'); const tUrl = A.url();
  ok(await A.locator('text=Leave').count() > 0, 'creator auto-joined tournament');
  await B.goto(tUrl); await B.click('button:has-text("Join")'); await B.waitForSelector('button:has-text("Leave")');
  // start time may be in the past (minute rounding): wait for tournament to start and pair
  await A.waitForURL('**/#/game/**', { timeout: 120000 }).catch(() => {});
  const inGame = A.url().includes('/game/'); ok(inGame, 'Swiss tournament started and paired players into a game');
  if (inGame) {
    await A.waitForSelector('.board .piece'); await B.waitForURL('**/#/game/**', { timeout: 20000 });
    await B.waitForSelector('.board .piece');
    const aWhite = await A.evaluate(() => document.querySelector('.sq[data-sq]')?.dataset.sq === 'a8'); const W = aWhite ? A : B, K = aWhite ? B : A;
    await clickMove(W, 'e2', 'e4', 'w'); await K.waitForSelector('.piece[data-sq="e4"]'); await clickMove(K, 'e7', 'e5', 'b'); await W.waitForSelector('.piece[data-sq="e5"]');
    await A.click('button:has-text("Resign")'); const c = A.locator('.modal .btn.primary'); if (await c.count()) await c.click();
    await A.waitForTimeout(1500); await A.goto(tUrl); await A.waitForSelector('table.table');
    await A.waitForFunction(() => /Finished/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
    const txt = await A.locator('table.table').first().innerText(); ok(/1/.test(txt), 'standings show a score after the game: ' + txt.replace(/\s+/g, ' ').slice(0, 80));
  }
  // --- settings persistence
  await A.goto(`${BASE}/#/settings`); await A.waitForSelector('.swatches'); await A.click('.swatch[aria-label="Board Moss"]'); await A.click('button:has-text("☀ Light")');
  await A.waitForTimeout(600); await A.reload(); await A.waitForSelector('.swatches');
  ok((await A.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'light theme persisted after reload');
  ok((await A.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sq-dark').trim())) === '#769656', 'board colour persisted after reload');
  await A.click('button.tab:has-text("Profile")'); await A.fill('textarea', 'I love endgames'); await A.click('button:has-text("Save profile")'); await A.waitForTimeout(500);
  await A.goto(`${BASE}/#/u/${an}`); await A.waitForSelector('text=I love endgames'); ok(true, 'bio saved and shown on profile');
  // --- leaderboard
  await A.goto(`${BASE}/#/leaderboard`); await A.waitForSelector('.lb, .card.center'); ok(true, 'leaderboard renders');
  // --- admin (ann is first user => admin)
  await A.goto(`${BASE}/#/admin`); await A.waitForSelector('.stat'); ok(await A.locator('.stat').count() >= 10, 'admin overview shows stats');
  await A.click('button.tab:has-text("Users")'); await A.waitForSelector(`tr:has-text("${bn}")`);
  await A.click(`tr:has-text("${bn}") button:has-text("Ban")`); await A.fill('.modal input', 'test ban'); await A.click('.modal .btn.primary');
  await A.waitForSelector(`tr:has-text("${bn}") .pill.st-banned`); ok(true, 'admin banned a user');
  const bres = await B.evaluate(async () => (await fetch('/api/me', { headers: { 'X-Rookery': '1' } })).json()); ok(!bres.user, 'banned user session revoked');
  await A.click('button.tab:has-text("Audit log")'); await A.waitForSelector('text=status:banned'); ok(true, 'ban recorded in audit log');
  const C = await mk('C'); await C.goto(`${BASE}/#/admin`); await C.waitForSelector('text=/Moderators only|Log in/i, input[name=username]').catch(() => {}); ok(!(await C.locator('.stat').count()), 'anonymous cannot see admin');
  // --- screenshots
  await A.goto(`${BASE}/#/u/${an}`); await A.waitForSelector('.profile-head'); await A.screenshot({ path: SH + '/profile-desktop.png' });
  const P = await mk('P', { width: 390, height: 844 }); await register(P, 'cy' + sfx);
  for (const [n, u] of [['profile', `/#/u/cy${sfx}`], ['settings', '/#/settings'], ['tournaments', '/#/tournaments'], ['leaderboard', '/#/leaderboard']]) { await P.goto(BASE + u); await P.waitForTimeout(700); await P.screenshot({ path: `${SH}/${n}-phone.png` }); const ov = await P.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2); ok(!ov, `no horizontal overflow on phone: ${n}`); }
  await A.goto(`${BASE}/#/admin`); await A.waitForSelector('.stat'); await A.screenshot({ path: SH + '/admin-desktop.png' });
  const real = errs.filter((e) => !/Failed to load resource|\/api\/.*40[0-9]/.test(e)); ok(real.length === 0, 'no console errors' + (real.length ? ': ' + real.slice(0, 4).join(' | ') : ''));
  console.log(`\n${pass} passed, ${fail} failed`); await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
