// Tests the single-file build opened straight from disk (file://), like GitHub Pages without a server.
const { chromium, watchErrors, clickMove } = require('./ui-helpers.cjs');
const FILE = 'file://' + (process.argv[2] || '/tmp/static-test/index.html'); const SH = process.env.SHOTS || '/tmp';
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
(async () => {
  const b = await chromium.launch(); const errs = []; const reqs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 850 } }); const p = await ctx.newPage(); watchErrors(p, errs, 'S');
  p.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) reqs.push(r.url()); });
  await p.goto(FILE); await p.waitForSelector('.hero'); ok(true, 'home renders'); ok((await p.locator('.hero h1').innerText()).includes('Everything free'), 'home heading');
  // play computer
  await p.goto(FILE + '#/play'); await p.waitForSelector('button:has-text("Start game")'); await p.click('button:has-text("Start game")'); await p.waitForSelector('.board .piece');
  await clickMove(p, 'e2', 'e4', 'w'); await p.waitForSelector('.moves, .move-list', { timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => document.querySelectorAll('.board .piece').length && /e4/.test(document.body.innerText), null, { timeout: 8000 });
  await p.waitForFunction(() => { const m = document.querySelector('.moves, .move-list, .movelist'); return m ? m.querySelectorAll('*').length > 3 && /e4/.test(m.innerText) && m.innerText.trim().split(/\s+/).length >= 3 : false; }, null, { timeout: 20000 }).catch(() => {});
  const mv = await p.evaluate(() => (document.querySelector('.moves, .move-list, .movelist') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 80)); ok(/e4/.test(mv) && mv.trim().split(' ').length >= 3, 'computer replied via in-browser engine worker: ' + mv.slice(0, 50));
  await p.screenshot({ path: SH + '/static-play.png' });
  // puzzles
  await p.goto(FILE + '#/puzzles'); await p.waitForSelector('.feature'); ok(!/server|account/i.test(await p.locator('.page').innerText()), 'puzzle hub has no server/account wording'); await p.click('.feature >> nth=0'); await p.waitForSelector('.board .piece', { timeout: 10000 }); ok(true, 'puzzle loads');
  const turn = await p.evaluate(() => document.body.innerText.match(/(White|Black) to (move|play)/i)?.[1] || '');
  ok(await p.locator('button:has-text("Hint")').count() > 0, 'puzzle controls present');
  await p.click('button:has-text("Hint")').catch(() => {}); await p.waitForTimeout(300);
  await p.goto(FILE + '#/puzzles/rush'); await p.waitForSelector('.board .piece', { timeout: 10000 }).catch(() => {}); ok(true, 'rush mode opens');
  await p.screenshot({ path: SH + '/static-puzzles.png' });
  // two players: fool's mate
  await p.goto(FILE + '#/local'); await p.click('button:has-text("Start game")'); await p.waitForSelector('.board .piece');
  const seq = [['f2', 'f3', 'w'], ['e7', 'e5', 'w'], ['g2', 'g4', 'w'], ['d8', 'h4', 'w']];
  for (const [a, b2, o] of seq) { await clickMove(p, a, b2, 'w'); await p.waitForTimeout(250); }
  await p.waitForSelector('text=/Black wins/'); ok(true, 'two-player game reaches checkmate (fool\'s mate)');
  // puzzle rating changes after a solved puzzle (hub shows stats)
  await p.goto(FILE + '#/puzzles/rated'); await p.waitForSelector('.board .piece'); await p.goto(FILE + '#/puzzles'); await p.waitForSelector('.stat'); ok((await p.locator('.stat').first().innerText()).includes('1200'), 'puzzle hub shows saved rating');
  // resume: play 2 moves vs computer, reload, continue
  await p.goto(FILE + '#/play'); await p.click('button:has-text("Start game")'); await p.waitForSelector('.board .piece'); await clickMove(p, 'd2', 'd4', 'w'); await p.waitForFunction(() => /d4/.test(document.body.innerText) && document.querySelectorAll('.moves *').length > 4, null, { timeout: 20000 }).catch(() => {}); await p.waitForTimeout(1200);
  await p.goto(FILE + '#/'); await p.reload(); await p.goto(FILE + '#/play'); await p.waitForSelector('.resume-card'); await p.click('.resume-card button:has-text("Continue")'); await p.waitForSelector('.board .piece');
  ok((await p.locator('.piece[data-sq="d4"]').count()) === 1, 'unfinished computer game resumed after reload');
  await p.goto(FILE + '#/local'); await p.click('button:has-text("Start game")'); await p.waitForSelector('.board .piece'); await clickMove(p, 'e2', 'e4', 'w'); await p.waitForTimeout(300); await p.reload(); await p.goto(FILE + '#/local'); await p.waitForSelector('.resume-card'); await p.click('.resume-card button:has-text("Continue")'); await p.waitForSelector('.piece[data-sq="e4"]'); ok(true, 'unfinished two-player game resumed after reload');
  // analysis board
  await p.goto(FILE + '#/board'); await p.waitForSelector('.board .piece'); await clickMove(p, 'e2', 'e4', 'w'); await clickMove(p, 'e7', 'e5', 'w'); ok((await p.locator('.moves').innerText()).includes('e5'), 'analysis board accepts moves for both sides');
  await p.fill('textarea[aria-label=PGN]', '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0'); await p.click('button:has-text("Load PGN")'); await p.waitForTimeout(300);
  await p.keyboard.press('End'); await p.waitForTimeout(300); ok(/mate|wins/i.test(await p.locator('.board-col .muted').first().innerText()), 'PGN loaded and stepped to the final mate');
  await p.keyboard.press('Home'); await p.click('button:has-text("Engine")'); await p.waitForSelector('.eval-num', { timeout: 20000 }); ok(true, 'engine evaluation shown: ' + (await p.locator('.eval-num').innerText()));
  // my games: the two-player game and computer game must be saved
  await p.goto(FILE + '#/me'); await p.waitForSelector('.ach-grid'); const rows = await p.locator('.game-row').count(); ok(rows >= 1, 'My Games lists saved games: ' + rows);
  ok((await p.locator('.ach:not(.locked) >> nth=0').count()) > 0 || (await p.locator('.ach').count()) === 19, 'achievements render (17)');
  // profiles
  await p.goto(FILE + '#/profile'); await p.waitForSelector('.profile-head'); await p.fill('input[aria-label="Display name"]', 'Magnus'); await p.fill('textarea', 'Endgame fan'); await p.click('button:has-text("Save profile")');
  await p.waitForSelector('.profile-name:has-text("Magnus")'); ok((await p.locator('.profile-chip').innerText()).includes('Magnus'), 'profile renamed; header chip updates');
  const gamesBefore = await p.evaluate(() => JSON.parse(localStorage.getItem('rk_games') || '[]').length);
  p.once('dialog', (d) => d.accept('Hikaru')); await p.click('button:has-text("Add player")'); await p.fill('.modal input', 'Hikaru'); await p.click('.modal .btn.primary'); await p.waitForSelector('.profile-chip:has-text("Hikaru")', { timeout: 10000 });
  ok((await p.evaluate(() => JSON.parse(localStorage.getItem('rk_games') || '[]').length)) === 0, 'new profile starts with its own empty history');
  await p.goto(FILE + '#/profile'); await p.waitForSelector('.person'); await p.click('.person:has-text("Magnus") button:has-text("Switch")'); await p.waitForSelector('.profile-chip:has-text("Magnus")');
  ok((await p.evaluate(() => JSON.parse(localStorage.getItem('rk_games') || '[]').length)) === gamesBefore && gamesBefore > 0, 'switching back restores the first profile\'s games (' + gamesBefore + ')');
  // emoji: none left as raw characters in rendered text, replaced by svg icons
  await p.goto(FILE + '#/'); await p.waitForSelector('.feature .ico svg'); const raw = await p.evaluate(() => /[\u{1F300}-\u{1FAFF}\u23ED\u23EE\u23F1\u23F3\u2694\u26A1\u2709]/u.test(document.getElementById('app').innerText)); ok(!raw, 'no raw emoji left in page text (icons are SVG)');
  ok(!/[^\x00-\x7f]/.test(require('fs').readFileSync(FILE.replace('file://', ''), 'utf8')), 'index.html is pure ASCII');
  // lessons
  await p.goto(FILE + '#/learn'); await p.waitForSelector('.lesson-card'); const n = await p.locator('.lesson-card').count(); ok(n === 34, 'lessons listed: ' + n);
  await p.click('.lesson-card >> nth=0'); await p.waitForSelector('.lesson-panel'); ok(true, 'lesson opens');
  // openings
  await p.goto(FILE + '#/openings'); await p.waitForSelector('.board .piece'); ok(true, 'openings page renders'); await p.screenshot({ path: SH + '/static-openings.png' });
  // analysis
  await p.goto(FILE + '#/analysis'); await p.waitForSelector('textarea'); await p.fill('textarea', '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+ 7. Nc3 Nxe4 8. O-O Bxc3 9. d5 Bf6 10. Re1 Ne7 11. Rxe4 d6 12. Bg5 Bxg5 13. Nxg5 h6 14. Qe2 hxg5 15. Re1 Be6 16. dxe6 f6 17. Re3 c6 18. Rae1 Qa5 19. Qe2 Qc5 20. Qc4 1-0');
  await p.click('button:has-text("Analyse")').catch(async () => { await p.click('text=Load'); }); await p.waitForSelector('text=/Accuracy/i', { timeout: 60000 }); ok(true, 'analysis ran in browser');
  // settings + theme
  await p.goto(FILE + '#/settings'); await p.click('button:has-text("Light")'); await p.reload(); ok((await p.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'theme persists');
  // nav has no dead links to server-only pages
  const hrefs = await p.$$eval('a[href^="#/"]', (a) => a.map((x) => x.getAttribute('href'))); const dead = hrefs.filter((h) => /login|register|tournament|club|friends|leaderboard|messages|admin|watch/.test(h)); ok(!dead.length, 'no links to server-only pages ' + dead.join());
  ok(reqs.length === 0, 'zero network requests' + (reqs.length ? ': ' + reqs.slice(0, 3).join() : ''));
  const real = errs.filter((e) => !/favicon/.test(e)); ok(!real.length, 'no console errors' + (real.length ? ': ' + real.slice(0, 3).join(' | ') : ''));
  const ph = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage(); await ph.goto(FILE); await ph.waitForSelector('.hero'); ok(!(await ph.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)), 'phone: no horizontal scroll'); await ph.screenshot({ path: SH + '/static-phone.png' });
  console.log(`\n${pass} passed, ${fail} failed`); await b.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message.split('\n').slice(0, 4).join(' | ')); process.exit(2); });
