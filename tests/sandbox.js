const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
// Shows the page inside a frame with the same restrictions as a published Claude artifact (no forms, no pop-ups, no storage).
const WRAP = path.resolve(__dirname, '.wrap.html');
fs.writeFileSync(WRAP, '<!doctype html><html><body style="margin:0"><iframe id="f" src="../index.html" style="width:1200px;height:1000px;border:0" sandbox="allow-scripts"></iframe></body></html>');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1250, height: 1050 } })).newPage();
  const logs = [], fails = [];
  p.on('console', m => logs.push(m.type() + ': ' + m.text()));
  p.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
  const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' -> ' + x : '')); if (!c) fails.push(n); };
  await p.goto('file://' + WRAP);
  await p.waitForTimeout(800);
  const f = p.frameLocator('#f');
  const cards = () => f.locator('#list .ccard').count();
  // empty submit -> validation, nothing saved
  await f.locator('#c-submit').click(); await p.waitForTimeout(200);
  ok('empty form saves nothing', (await cards()) === 0);
  // good contract
  await f.locator('#c-vessel').fill('MV Aurora'); await f.locator('#c-party').fill('Nordic Bulk');
  await f.locator('#c-del').fill('2026-11-20'); await f.locator('#c-red').fill('2027-05-20');
  await f.locator('#c-submit').click(); await p.waitForTimeout(400);
  ok('contract saved in restricted frame', (await cards()) === 1);
  ok('success message', /Contract saved/.test(await f.locator('#c-msg').textContent()), await f.locator('#c-msg').textContent());
  ok('form cleared', (await f.locator('#c-vessel').inputValue()) === '');
  // Enter key saves
  await f.locator('#c-vessel').fill('MV Enter'); await f.locator('#c-party').fill('Y');
  await f.locator('#c-del').fill('2026-12-01'); await f.locator('#c-red').fill('2027-01-01');
  await f.locator('#c-red').press('Enter'); await p.waitForTimeout(400);
  ok('Enter key saves contract', (await cards()) === 2);
  // bad dates -> visible message
  await f.locator('#c-vessel').fill('MV Bad'); await f.locator('#c-party').fill('X');
  await f.locator('#c-del').fill('2026-12-20'); await f.locator('#c-red').fill('2026-12-01');
  await f.locator('#c-submit').click(); await p.waitForTimeout(300);
  ok('bad dates not saved', (await cards()) === 2);
  ok('bad dates shows message', /on or after/.test(await f.locator('#c-msg').textContent()), await f.locator('#c-msg').textContent());
  await f.locator('#c-red').fill('2027-02-01'); await f.locator('#c-submit').click(); await p.waitForTimeout(300);
  ok('corrected dates save', (await cards()) === 3);
  // notices
  await f.locator('#tab-n').click(); await p.waitForTimeout(200);
  await f.locator('#n-days-dd summary').click();
  await f.locator('#n-days input[value="5"]').check();
  await f.locator('#n-to1').fill('a@x.com');
  await f.locator('#n-submit').click(); await p.waitForTimeout(400);
  ok('notices added', (await f.locator('#nlist .item').count()) === 2, 'items=' + (await f.locator('#nlist .item').count()));
  ok('notice success message', /2 notices added/.test(await f.locator('#n-msg').textContent()), await f.locator('#n-msg').textContent());
  await f.locator('#n-submit').click(); await p.waitForTimeout(300);
  ok('duplicate message', /already on this contract/.test(await f.locator('#n-msg').textContent()), await f.locator('#n-msg').textContent());
  await f.locator('#n-what').selectOption('');
  await f.locator('#n-submit').click(); await p.waitForTimeout(200);
  ok('empty custom notice blocked', (await f.locator('#nlist .item').count()) === 2);
  await f.locator('#n-title').fill('Hire payment'); await f.locator('#n-date').fill('2026-12-15');
  await f.locator('#n-submit').click(); await p.waitForTimeout(300);
  ok('custom notice added', (await f.locator('#nlist .item').count()) === 3);
  // bad email
  await f.locator('#n-title').fill('Bad mail'); await f.locator('#n-to1').fill('not-an-email');
  await f.locator('#n-submit').click(); await p.waitForTimeout(300);
  ok('bad email message', /Please fix/.test(await f.locator('#n-msg').textContent()), await f.locator('#n-msg').textContent());
  ok('bad email not saved', (await f.locator('#nlist .item').count()) === 3);
  await f.locator('#n-to1').fill('ok@x.com');
  // edit notice
  await f.locator('#nlist .editbtn').first().click(); await p.waitForTimeout(200);
  await f.locator('#n-title').fill('Renamed'); await f.locator('#n-submit').click(); await p.waitForTimeout(300);
  ok('edit notice works', (await f.locator('#nlist').textContent()).includes('Renamed'));
  ok('edit confirmation', /Changes saved/.test(await f.locator('#n-msg').textContent()));
  // edit contract
  await f.locator('#tab-c').click();
  await f.locator('#list .ccard button:has-text("Edit contract")').first().click(); await p.waitForTimeout(200);
  await f.locator('#c-vessel').fill('MV Renamed'); await f.locator('#c-submit').click(); await p.waitForTimeout(300);
  ok('edit contract works', (await f.locator('#list').textContent()).includes('MV Renamed'));
  const bad = logs.filter(l => !/ERR_TUNNEL|Failed to load resource|SecurityError|localStorage|Storage/i.test(l));
  console.log('OTHER CONSOLE:', bad.join('\n') || 'none');
  console.log('FAILED:', fails.length ? fails.join('; ') : 'none');
  if (fails.length) process.exitCode = 1;
  
  await b.close();
})();
