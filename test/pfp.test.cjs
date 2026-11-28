const { chromium, watchErrors } = require('./ui-helpers.cjs'); const fs = require('fs'); const os = require('os'); const path = require('path');
const file = process.argv[2]; let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage(); const errs = []; watchErrors(p, errs, 'pfp');
  await p.goto('file://' + file + '#/profile'); await p.waitForSelector('.profile-head');
  const png = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#d33'; g.fillRect(0, 0, 300, 200); g.fillStyle = '#33d'; g.fillRect(100, 0, 100, 200); return c.toDataURL('image/png').split(',')[1]; });
  const img = path.join(os.tmpdir(), 'pfp-test.png'); fs.writeFileSync(img, Buffer.from(png, 'base64'));
  const bad = path.join(os.tmpdir(), 'pfp-bad.txt'); fs.writeFileSync(bad, 'hello');
  const choose = async (f) => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('text=Upload photo')]); await fc.setFiles(f); await p.waitForTimeout(700); };
  await choose(img);
  ok(await p.evaluate(() => !!document.querySelector('.profile-head img.avatar')), 'photo shows on profile page');
  const d = await p.evaluate(() => { const i = document.querySelector('.profile-head img.avatar'); return { src: i.src.slice(0, 22), len: i.src.length, w: i.naturalWidth, h: i.naturalHeight }; });
  ok(d.src.startsWith('data:image/jpeg') && d.w === 160 && d.h === 160 && d.len < 60000, 'resized to 160x160 JPEG, ' + d.len + ' chars');
  ok(await p.evaluate(() => !!document.querySelector('.profile-chip img.avatar')), 'photo shows in header chip');
  await p.reload(); await p.waitForSelector('.profile-head');
  ok(await p.evaluate(() => !!document.querySelector('.profile-head img.avatar')), 'photo persists after reload');
  ok(await p.evaluate(() => { const i = document.querySelector('.profile-head img.avatar'); const c = document.createElement('canvas'); c.width = c.height = 160; const g = c.getContext('2d'); g.drawImage(i, 0, 0); const mid = g.getImageData(80, 80, 1, 1).data, edge = g.getImageData(5, 80, 1, 1).data; return mid[2] > 150 && edge[0] > 150; }), 'centre-cropped (blue middle, red edge)');
  { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('text=Upload photo')]); await fc.setFiles(bad); await p.waitForTimeout(250); ok(/Choose a PNG, JPEG/.test(await p.evaluate(() => document.body.textContent)), 'non-image rejected with a message'); }
  ok(await p.evaluate(() => !!document.querySelector('.profile-head img.avatar')), 'photo kept after rejected upload');
  await p.click('text=Remove photo'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !document.querySelector('.profile-head img.avatar') && !!document.querySelector('.profile-head .avatar.init')), 'remove photo restores piece avatar');
  await choose(img); await p.click('button[aria-label="Avatar queen"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !document.querySelector('.profile-head img.avatar')), 'choosing a piece avatar replaces the photo');
  ok(errs.length === 0, 'no console errors ' + errs.join(';'));
  console.log(`\n${pass} passed, ${fail} failed`); await b.close(); process.exit(fail ? 1 : 0);
})();
