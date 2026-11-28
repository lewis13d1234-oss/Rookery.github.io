const { createRequire } = require('module');
const req = createRequire(require('child_process').execSync('npm root -g').toString().trim() + '/');
exports.chromium = req('playwright').chromium;
exports.sq = async (page, sq, orient = 'w') => { const b = await page.locator('.board').first().boundingBox(); const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1; const x = orient === 'w' ? f : 7 - f, y = orient === 'w' ? 7 - r : r; return [b.x + (x + 0.5) * b.width / 8, b.y + (y + 0.5) * b.height / 8]; };
exports.clickMove = async (page, from, to, orient = 'w') => { const [x1, y1] = await exports.sq(page, from, orient), [x2, y2] = await exports.sq(page, to, orient); await page.mouse.click(x1, y1); await page.waitForTimeout(80); await page.mouse.click(x2, y2); };
exports.dragMove = async (page, from, to, orient = 'w') => { const [x1, y1] = await exports.sq(page, from, orient), [x2, y2] = await exports.sq(page, to, orient); await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 }); await page.mouse.move(x2, y2, { steps: 4 }); await page.mouse.up(); };
exports.watchErrors = (page, errs, tag) => { page.on('console', (m) => { if (m.type() === 'error') errs.push(`[${tag}] ${m.text()}`); }); page.on('pageerror', (e) => errs.push(`[${tag}] PAGEERROR ${e.message}`)); };
