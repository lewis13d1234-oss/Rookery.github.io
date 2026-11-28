const { chromium, watchErrors, clickMove } = require('./ui-helpers.cjs');
const file = process.argv[2]; let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); const errs = []; watchErrors(p, errs, 'pm');
  await p.goto('file://' + file + '#/play/computer'); await p.waitForSelector('button:has-text("Start")');
  await p.evaluate(() => { const s = [...document.querySelectorAll('select')]; }); await p.click('button:has-text("Start")'); await p.waitForSelector('.board');
  const plies = () => p.evaluate(() => document.querySelectorAll('.moves .mv, .moves [data-ply], .moves span.m').length || (document.querySelector('.moves')?.textContent.match(/[a-hKQRBNO][\w=+#-]*/g) || []).filter((x) => !/^\d/.test(x)).length);
  // make white's first move, then immediately queue a premove while the computer is thinking
  await clickMove(p, 'e2', 'e4');
  await p.waitForFunction(() => /Computer is thinking|Pensando|pensando/.test(document.querySelector('#app').innerText), null, { timeout: 3000 }).catch(() => {});
  await clickMove(p, 'g1', 'f3'); await p.waitForTimeout(100);
  const marked = await p.evaluate(() => document.querySelectorAll('.hl.pre').length);
  ok(marked === 2, 'premove highlight drawn while waiting (' + marked + ' squares)');
  await p.waitForFunction(() => /Nf3/.test(document.querySelector('.moves')?.textContent || ''), null, { timeout: 15000 }).then(() => ok(true, 'queued premove Nf3 was played automatically after the reply'), () => ok(false, 'premove Nf3 was not played'));
  ok(await p.evaluate(() => document.querySelectorAll('.hl.pre').length === 0), 'premove highlight cleared after playing');
  // cancel with Escape
  await p.waitForFunction(() => !/Computer is thinking/.test(document.querySelector('#app').innerText), null, { timeout: 15000 });
  await clickMove(p, 'd2', 'd4'); await p.waitForTimeout(40);
  await clickMove(p, 'b1', 'c3'); ok(await p.evaluate(() => document.querySelectorAll('.hl.pre').length === 2), 'second premove queued (highlighted)'); await p.focus('.board'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => document.querySelectorAll('.hl.pre').length === 0), 'Escape cancels a queued premove');
  await p.waitForFunction(() => !/Computer is thinking/.test(document.querySelector('#app').innerText), null, { timeout: 15000 });
  await p.waitForTimeout(300);
  ok(!/Nc3/.test(await p.textContent('.moves')), 'cancelled premove was not played');
  const t = await p.evaluate(() => { const bd = document.querySelector('.board'); return !!bd; });
  ok(t && errs.length === 0, 'no console errors ' + errs.join(';'));
  console.log(`\n${pass} passed, ${fail} failed`); await b.close(); process.exit(fail ? 1 : 0);
})();
